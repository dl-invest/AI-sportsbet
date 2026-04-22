/* ==============================================================
   PREDICTOR ENGINE — Phase 1
   Pipeline:
     1. Data normalization (league-average baselines)
     2. Time-weighted form (pre-baked into team.form)
     3. Home/away-SPLIT Attack & Defense strengths
        (atk_home / atk_away / def_home / def_away)
     4. Elo model → win expectancy
     5. Home advantage (Elo + goal model)
     6. Expected goals λ_home / λ_away
     7. xG integration (home/away split when available)
     8. Injury adjustment
     9. Elo correction on lambda
     10. Poisson pmf
     11. DIXON-COLES low-score correction
     12. Scoreline probabilities
     13. 1X2 outcome probabilities
     14. Monte Carlo simulation
     15. Ensemble of Poisson + Elo + xG
     16. Confidence tag
   ============================================================== */

/* ---------- Poisson PMF (numerically safe) ---------- */
function poissonPMF(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logFact = 0;
  for (let i = 2; i <= k; i++) logFact += Math.log(i);
  const logP = -lambda + k * Math.log(lambda) - logFact;
  return Math.exp(logP);
}

/* ---------- Dixon-Coles low-score correction ---------- */
/* Standard DC (1997) τ multiplier: modifies only (0,0), (0,1), (1,0), (1,1).
   With ρ negative (typical: -0.18 … -0.10), boosts P(0,0) & P(1,1) and
   slightly reduces P(1,0) & P(0,1) — exactly the empirical bias of pure
   Poisson vs. real football low-scoring distributions.                   */
const DIXON_COLES_RHO = -0.15;
function dixonColesTau(i, j, lh, la, rho = DIXON_COLES_RHO) {
  if (i === 0 && j === 0) return 1 - lh * la * rho;
  if (i === 0 && j === 1) return 1 + lh * rho;
  if (i === 1 && j === 0) return 1 + la * rho;
  if (i === 1 && j === 1) return 1 - rho;
  return 1;
}

/* ---------- Deterministic fallback for unknown teams ---------- */
function hash(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}
function fakeTeam(name, league) {
  const h = hash(name.toLowerCase());
  const r01 = ((h % 1000) / 1000);
  const r11 = (((h >>> 10) % 1000) / 1000) * 2 - 1;
  const elo = 1550 + Math.round(r01 * 350);
  const atk = 0.85 + r01 * 0.6;
  const def = 0.80 + (1 - r01) * 0.55;
  const form = r11 * 0.08;
  const xg_for = 1.05 + r01 * 1.1;
  const xg_ag = 1.05 + (1 - r01) * 0.95;
  const inj = 0.03 + ((h >>> 3) % 60) / 1000;
  return { league, elo, atk, def, form, xg_for, xg_ag, inj, xg_source: 'synthetic', _synthetic: true };
}

function resolveTeam(rawName, league) {
  if (!rawName) return null;
  const trimmed = rawName.trim();
  if (TEAMS[trimmed]) return { name: trimmed, stats: TEAMS[trimmed] };
  if (TEAM_ALIASES[trimmed]) {
    const real = TEAM_ALIASES[trimmed];
    return { name: real, stats: TEAMS[real] };
  }
  const lower = trimmed.toLowerCase();
  for (const key of Object.keys(TEAMS)) {
    if (key.toLowerCase() === lower) return { name: key, stats: TEAMS[key] };
  }
  for (const [al, real] of Object.entries(TEAM_ALIASES)) {
    if (al.toLowerCase() === lower) return { name: real, stats: TEAMS[real] };
  }
  return { name: trimmed, stats: fakeTeam(trimmed, league) };
}

/* ---------- Elo expected score ---------- */
function eloExpected(rHome, rAway, homeAdvantage = 60) {
  return 1 / (1 + Math.pow(10, (rAway - rHome + homeAdvantage) / 400));
}

/* ---------- Monte Carlo ---------- */
function samplePoisson(lambda) {
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= Math.random(); } while (p > L);
  return k - 1;
}
function monteCarlo(lh, la, n = 20000) {
  let home = 0, draw = 0, away = 0;
  let over15 = 0, over25 = 0, over35 = 0, btts = 0;
  let totalGoals = 0;
  for (let i = 0; i < n; i++) {
    const gh = samplePoisson(lh);
    const ga = samplePoisson(la);
    totalGoals += gh + ga;
    if (gh + ga > 1.5) over15++;
    if (gh + ga > 2.5) over25++;
    if (gh + ga > 3.5) over35++;
    if (gh > 0 && ga > 0) btts++;
    if (gh > ga) home++;
    else if (gh < ga) away++;
    else draw++;
  }
  return {
    n,
    pHome: home / n, pDraw: draw / n, pAway: away / n,
    over15: over15 / n, over25: over25 / n, over35: over35 / n,
    btts: btts / n, avgTotal: totalGoals / n
  };
}

/* ---------- Small helpers for reading new/legacy team fields ---------- */
function atkHome(t) { return t.atk_home ?? t.atk ?? 1.0; }
function atkAway(t) { return t.atk_away ?? ((t.atk ?? 1.0) * 0.95); }
function defHome(t) { return t.def_home ?? t.def ?? 1.0; }
function defAway(t) { return t.def_away ?? ((t.def ?? 1.0) * 1.02); }
function xgForHome(t) { return t.xg_for_home ?? t.xg_for ?? 1.3; }
function xgForAway(t) { return t.xg_for_away ?? t.xg_for ?? 1.1; }
function xgAgHome(t)  { return t.xg_ag_home  ?? t.xg_ag  ?? 1.2; }
function xgAgAway(t)  { return t.xg_ag_away  ?? t.xg_ag  ?? 1.4; }

/* ---------- Main predict ---------- */
function predictMatch({ league, date, home, away }) {
  const lg = LEAGUE_AVG[league] || LEAGUE_AVG.OTHER;
  const mu_home = lg.home;
  const mu_away = lg.away;

  const H = resolveTeam(home, league);
  const A = resolveTeam(away, league);
  const ht = H.stats;
  const at = A.stats;

  // ---- 3. Attack/Defense strengths — SPLIT home/away ----
  // A_home = home team's attacking strength when playing at home
  // D_away = away team's defensive strength when playing away
  // A_away = away team's attacking strength when playing away
  // D_home = home team's defensive strength when playing at home
  const A_home = atkHome(ht) * (1 + ht.form);
  const D_home = defHome(ht);
  const A_away = atkAway(at) * (1 + at.form);
  const D_away = defAway(at);

  // ---- 4-5. Elo with home advantage ----
  const H_elo = 60;
  const E_home = eloExpected(ht.elo, at.elo, H_elo);
  const E_away = 1 - E_home;

  // ---- 6. Base expected goals ----
  const H_goal = 1.18;
  const lambda_home_base = mu_home * A_home * D_away * H_goal;
  const lambda_away_base = mu_away * A_away * D_home;

  // ---- 7. xG integration (alpha = 0.7), SPLIT home/away when available ----
  const alpha = 0.7;
  const xgBlend_home = (xgForHome(ht) + xgAgAway(at)) / 2;
  const xgBlend_away = (xgForAway(at) + xgAgHome(ht)) / 2;
  const lambda_home_xg = alpha * lambda_home_base + (1 - alpha) * xgBlend_home * (H_goal / 1.1);
  const lambda_away_xg = alpha * lambda_away_base + (1 - alpha) * xgBlend_away * 0.95;

  // ---- 8. Injury adjustment ----
  const lambda_home_inj = lambda_home_xg * (1 - ht.inj);
  const lambda_away_inj = lambda_away_xg * (1 - at.inj);

  // ---- 9. Elo correction on lambdas ----
  const beta = 0.1;
  const deltaElo = (ht.elo - at.elo) / 400;
  const lambda_home = Math.max(0.2, lambda_home_inj * (1 + beta * deltaElo));
  const lambda_away = Math.max(0.2, lambda_away_inj * (1 - beta * deltaElo));

  // ---- 10. Poisson scoreline grid ----
  const MAX = 6;
  const grid = [];
  for (let i = 0; i <= MAX; i++) {
    const row = [];
    for (let j = 0; j <= MAX; j++) {
      row.push(poissonPMF(i, lambda_home) * poissonPMF(j, lambda_away));
    }
    grid.push(row);
  }

  // ---- 11. Dixon-Coles correction applied to the grid ----
  // Multiply only low-score cells by τ, then renormalize the whole grid.
  for (let i = 0; i <= MAX; i++) {
    for (let j = 0; j <= MAX; j++) {
      grid[i][j] *= dixonColesTau(i, j, lambda_home, lambda_away, DIXON_COLES_RHO);
    }
  }
  let gridSum = 0;
  for (let i = 0; i <= MAX; i++)
    for (let j = 0; j <= MAX; j++)
      gridSum += grid[i][j];
  if (gridSum > 0) {
    for (let i = 0; i <= MAX; i++)
      for (let j = 0; j <= MAX; j++)
        grid[i][j] /= gridSum;
  }

  // ---- 12. Scoreline and 1X2 from corrected grid ----
  let pHomePoisson = 0, pDrawPoisson = 0, pAwayPoisson = 0;
  let pOver15 = 0, pOver25 = 0, pOver35 = 0, pBTTS = 0;
  let bestScore = { i: 0, j: 0, p: 0 };
  for (let i = 0; i <= MAX; i++) {
    for (let j = 0; j <= MAX; j++) {
      const p = grid[i][j];
      if (i > j) pHomePoisson += p;
      else if (i < j) pAwayPoisson += p;
      else pDrawPoisson += p;
      if (i + j > 1) pOver15 += p;
      if (i + j > 2) pOver25 += p;
      if (i + j > 3) pOver35 += p;
      if (i > 0 && j > 0) pBTTS += p;
      if (p > bestScore.p) bestScore = { i, j, p };
    }
  }

  // ---- 13. Elo-based 1X2 (draw carve-out) ----
  const eloDiff = Math.abs(ht.elo - at.elo);
  const pDrawElo = Math.max(0.16, 0.30 - eloDiff / 2000);
  const pHomeElo = (1 - pDrawElo) * E_home;
  const pAwayElo = (1 - pDrawElo) * E_away;

  // ---- 7b. xG-only probability pass (DC-corrected as well) ----
  const lambda_home_xgOnly = Math.max(0.2, xgBlend_home * 1.1);
  const lambda_away_xgOnly = Math.max(0.2, xgBlend_away * 0.95);
  let pHomeXG = 0, pDrawXG = 0, pAwayXG = 0;
  {
    const g2 = [];
    for (let i = 0; i <= MAX; i++) {
      const row = [];
      for (let j = 0; j <= MAX; j++) {
        row.push(
          poissonPMF(i, lambda_home_xgOnly) *
          poissonPMF(j, lambda_away_xgOnly) *
          dixonColesTau(i, j, lambda_home_xgOnly, lambda_away_xgOnly)
        );
      }
      g2.push(row);
    }
    let sXg = 0;
    for (let i = 0; i <= MAX; i++)
      for (let j = 0; j <= MAX; j++)
        sXg += g2[i][j];
    for (let i = 0; i <= MAX; i++) {
      for (let j = 0; j <= MAX; j++) {
        const p = g2[i][j] / sXg;
        if (i > j) pHomeXG += p;
        else if (i < j) pAwayXG += p;
        else pDrawXG += p;
      }
    }
  }

  // ---- 15. Ensemble ----
  const w1 = 0.5, w2 = 0.3, w3 = 0.2;
  let pHome = w1 * pHomePoisson + w2 * pHomeElo + w3 * pHomeXG;
  let pDraw = w1 * pDrawPoisson + w2 * pDrawElo + w3 * pDrawXG;
  let pAway = w1 * pAwayPoisson + w2 * pAwayElo + w3 * pAwayXG;
  const s = pHome + pDraw + pAway;
  pHome /= s; pDraw /= s; pAway /= s;

  // ---- 14. Monte Carlo cross-check (pure Poisson, no DC — intentional) ----
  const mc = monteCarlo(lambda_home, lambda_away, 20000);

  // ---- 16. Confidence ----
  const gap = Math.abs(pHome - pAway);
  let confidenceLabel = "LOW";
  if (gap > 0.25) confidenceLabel = "HIGH";
  else if (gap > 0.12) confidenceLabel = "MED";

  // ---- goal-line recommendation ----
  const totalExp = lambda_home + lambda_away;
  let goalLine = "Over 1.5";
  let goalLineProb = pOver15;
  if (pOver35 >= 0.55)       { goalLine = "Over 3.5";  goalLineProb = pOver35; }
  else if (pOver25 >= 0.55)  { goalLine = "Over 2.5";  goalLineProb = pOver25; }
  else if (pOver15 >= 0.65)  { goalLine = "Over 1.5";  goalLineProb = pOver15; }
  else if (pOver25 < 0.40)   { goalLine = "Under 2.5"; goalLineProb = 1 - pOver25; }
  else                       { goalLine = "Over 1.5";  goalLineProb = pOver15; }

  // ---- 1X2 recommendation ----
  let pick = "X";
  let pickProb = pDraw;
  if (pHome >= pDraw && pHome >= pAway) { pick = "1"; pickProb = pHome; }
  else if (pAway >= pDraw && pAway >= pHome) { pick = "2"; pickProb = pAway; }

  let doubleChance = null;
  const sorted = [
    { k: "1", p: pHome },
    { k: "X", p: pDraw },
    { k: "2", p: pAway }
  ].sort((a, b) => b.p - a.p);
  if (sorted[0].p - sorted[1].p < 0.06) {
    doubleChance = [sorted[0].k, sorted[1].k].sort().join("");
  }

  return {
    inputs: {
      league, date,
      home: H.name, away: A.name,
      homeSynthetic: ht._synthetic, awaySynthetic: at._synthetic,
      xgSourceHome: ht.xg_source, xgSourceAway: at.xg_source
    },
    teams: { home: ht, away: at },
    mu: { mu_home, mu_away },
    strengths: {
      A_home, D_home, A_away, D_away,
      atkHome_raw: atkHome(ht), atkAway_raw: atkAway(at),
      defHome_raw: defHome(ht), defAway_raw: defAway(at)
    },
    elo: { rHome: ht.elo, rAway: at.elo, H_elo, E_home, E_away, pHomeElo, pDrawElo, pAwayElo, deltaElo },
    goalModel: {
      H_goal,
      lambda_home_base, lambda_away_base,
      lambda_home_xg, lambda_away_xg,
      lambda_home_inj, lambda_away_inj,
      lambda_home, lambda_away,
      totalExp
    },
    xgOnly: { lambda_home_xgOnly, lambda_away_xgOnly, pHomeXG, pDrawXG, pAwayXG },
    poisson: {
      grid, pHomePoisson, pDrawPoisson, pAwayPoisson,
      pOver15, pOver25, pOver35, pBTTS, bestScore,
      dixon_coles_rho: DIXON_COLES_RHO
    },
    montecarlo: mc,
    ensemble: { w1, w2, w3, pHome, pDraw, pAway },
    recommendation: {
      pick, pickProb, doubleChance,
      goalLine, goalLineProb,
      confidence: confidenceLabel, confidenceGap: gap
    }
  };
}
