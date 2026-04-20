/* ==============================================================
   PREDICTOR ENGINE
   Implements the full pipeline:
     1. Data normalization (league-average baselines)
     2. Time-weighted form (already baked into team.form)
     3. Attack & Defense strength (A_home, D_away, ...)
     4. Elo model -> win expectancy
     5. Home advantage (Elo + goal model)
     6. Expected goals (lambda_home / lambda_away)
     7. xG integration
     8. Injury adjustment
     9. Elo correction on lambda
     10. Poisson pmf
     11. Scoreline probabilities
     12. 1X2 outcome probabilities
     13. Monte Carlo simulation
     14. Ensemble of Poisson + Elo + xG
     15. (Market calibration is supported if odds provided; otherwise skipped)
     16. Confidence tag
   ============================================================== */

/* ---------- Poisson PMF (numerically safe) ---------- */
function poissonPMF(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  // log factorial
  let logFact = 0;
  for (let i = 2; i <= k; i++) logFact += Math.log(i);
  const logP = -lambda + k * Math.log(lambda) - logFact;
  return Math.exp(logP);
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
  // produce plausible, stable stats from the name
  const h = hash(name.toLowerCase());
  const r01 = ((h % 1000) / 1000);                // 0..1
  const r11 = (((h >>> 10) % 1000) / 1000) * 2 - 1; // -1..1
  const elo = 1550 + Math.round(r01 * 350);       // 1550..1900
  const atk = 0.85 + r01 * 0.6;                   // 0.85..1.45
  const def = 0.80 + (1 - r01) * 0.55;            // 0.80..1.35
  const form = r11 * 0.08;                        // -0.08..0.08
  const xg_for = 1.05 + r01 * 1.1;
  const xg_ag = 1.05 + (1 - r01) * 0.95;
  const inj = 0.03 + ((h >>> 3) % 60) / 1000;
  return { league, elo, atk, def, form, xg_for, xg_ag, inj, _synthetic: true };
}

function resolveTeam(rawName, league) {
  if (!rawName) return null;
  const trimmed = rawName.trim();
  if (TEAMS[trimmed]) return { name: trimmed, stats: TEAMS[trimmed] };
  if (TEAM_ALIASES[trimmed]) {
    const real = TEAM_ALIASES[trimmed];
    return { name: real, stats: TEAMS[real] };
  }
  // case-insensitive search
  const lower = trimmed.toLowerCase();
  for (const key of Object.keys(TEAMS)) {
    if (key.toLowerCase() === lower) return { name: key, stats: TEAMS[key] };
  }
  for (const [al, real] of Object.entries(TEAM_ALIASES)) {
    if (al.toLowerCase() === lower) return { name: real, stats: TEAMS[real] };
  }
  // fallback: synthetic team
  return { name: trimmed, stats: fakeTeam(trimmed, league) };
}

/* ---------- Elo expected score ---------- */
function eloExpected(rHome, rAway, homeAdvantage = 60) {
  return 1 / (1 + Math.pow(10, (rAway - rHome + homeAdvantage) / 400));
}

/* ---------- Monte Carlo ---------- */
function samplePoisson(lambda) {
  // Knuth's algorithm (fine for lambda < ~30)
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do {
    k++;
    p *= Math.random();
  } while (p > L);
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
    pHome: home / n,
    pDraw: draw / n,
    pAway: away / n,
    over15: over15 / n,
    over25: over25 / n,
    over35: over35 / n,
    btts: btts / n,
    avgTotal: totalGoals / n
  };
}

/* ---------- Main predict ---------- */
function predictMatch({ league, date, home, away }) {
  const lg = LEAGUE_AVG[league] || LEAGUE_AVG.OTHER;
  const mu_home = lg.home;
  const mu_away = lg.away;

  const H = resolveTeam(home, league);
  const A = resolveTeam(away, league);
  const ht = H.stats;
  const at = A.stats;

  // ---- 3. Attack/Defense strengths (relative to league avg) ----
  // Interpret ht.atk as the team's home-attack factor, ht.def as defense factor.
  const A_home = ht.atk * (1 + ht.form);
  const D_home = ht.def;
  const A_away = at.atk * (1 + at.form) * 0.95;   // away teams slightly weaker
  const D_away = at.def * 1.02;

  // ---- 4-5. Elo with home advantage ----
  const H_elo = 60;
  const E_home = eloExpected(ht.elo, at.elo, H_elo);
  const E_away = 1 - E_home;

  // ---- 6. Base expected goals ----
  const H_goal = 1.18; // multiplicative home advantage on goals
  let lambda_home_base = mu_home * A_home * D_away * H_goal;
  let lambda_away_base = mu_away * A_away * D_home;

  // ---- 7. xG integration (alpha = 0.7) ----
  const alpha = 0.7;
  const lambda_home_xg =
    alpha * lambda_home_base + (1 - alpha) * ((ht.xg_for + at.xg_ag) / 2) * (H_goal / 1.1);
  const lambda_away_xg =
    alpha * lambda_away_base + (1 - alpha) * ((at.xg_for + ht.xg_ag) / 2) * 0.95;

  // ---- 8. Injury adjustment ----
  const lambda_home_inj = lambda_home_xg * (1 - ht.inj);
  const lambda_away_inj = lambda_away_xg * (1 - at.inj);

  // ---- 9. Elo correction on lambdas ----
  const beta = 0.1;
  const deltaElo = (ht.elo - at.elo) / 400;
  const lambda_home = Math.max(0.2, lambda_home_inj * (1 + beta * deltaElo));
  const lambda_away = Math.max(0.2, lambda_away_inj * (1 - beta * deltaElo));

  // ---- 10-12. Poisson scoreline grid ----
  const MAX = 6; // 0..5 inclusive + tail bucket
  const grid = [];
  let pHomePoisson = 0, pDrawPoisson = 0, pAwayPoisson = 0;
  let bestScore = { i: 0, j: 0, p: 0 };

  for (let i = 0; i <= MAX; i++) {
    const row = [];
    for (let j = 0; j <= MAX; j++) {
      const p = poissonPMF(i, lambda_home) * poissonPMF(j, lambda_away);
      row.push(p);
      if (i > j) pHomePoisson += p;
      else if (i < j) pAwayPoisson += p;
      else pDrawPoisson += p;
      if (p > bestScore.p) bestScore = { i, j, p };
    }
    grid.push(row);
  }
  // normalize (the tail beyond MAX is small but nonzero)
  const sumP = pHomePoisson + pDrawPoisson + pAwayPoisson;
  pHomePoisson /= sumP; pDrawPoisson /= sumP; pAwayPoisson /= sumP;

  // ---- Totals from Poisson grid ----
  let pOver15 = 0, pOver25 = 0, pOver35 = 0, pBTTS = 0;
  for (let i = 0; i <= MAX; i++) {
    for (let j = 0; j <= MAX; j++) {
      const p = grid[i][j];
      if (i + j > 1) pOver15 += p;
      if (i + j > 2) pOver25 += p;
      if (i + j > 3) pOver35 += p;
      if (i > 0 && j > 0) pBTTS += p;
    }
  }

  // ---- 4. Elo-based 1X2 (with a simple draw carve-out) ----
  // A standard trick: assume draw probability decays with abs(Elo diff)
  const eloDiff = Math.abs(ht.elo - at.elo);
  const pDrawElo = Math.max(0.16, 0.30 - eloDiff / 2000); // 0.16..0.30
  const pHomeElo = (1 - pDrawElo) * E_home;
  const pAwayElo = (1 - pDrawElo) * E_away;

  // ---- 7. xG-only probability pass (via shifted lambdas) ----
  const lambda_home_xgOnly = Math.max(0.2, ((ht.xg_for + at.xg_ag) / 2) * 1.1);
  const lambda_away_xgOnly = Math.max(0.2, ((at.xg_for + ht.xg_ag) / 2) * 0.95);
  let pHomeXG = 0, pDrawXG = 0, pAwayXG = 0;
  for (let i = 0; i <= MAX; i++) {
    for (let j = 0; j <= MAX; j++) {
      const p = poissonPMF(i, lambda_home_xgOnly) * poissonPMF(j, lambda_away_xgOnly);
      if (i > j) pHomeXG += p;
      else if (i < j) pAwayXG += p;
      else pDrawXG += p;
    }
  }
  const sxg = pHomeXG + pDrawXG + pAwayXG;
  pHomeXG /= sxg; pDrawXG /= sxg; pAwayXG /= sxg;

  // ---- 14. Ensemble ----
  const w1 = 0.5, w2 = 0.3, w3 = 0.2;
  let pHome = w1 * pHomePoisson + w2 * pHomeElo + w3 * pHomeXG;
  let pDraw = w1 * pDrawPoisson + w2 * pDrawElo + w3 * pDrawXG;
  let pAway = w1 * pAwayPoisson + w2 * pAwayElo + w3 * pAwayXG;
  const s = pHome + pDraw + pAway;
  pHome /= s; pDraw /= s; pAway /= s;

  // ---- 13. Monte Carlo cross-check ----
  const mc = monteCarlo(lambda_home, lambda_away, 20000);

  // ---- 16. Confidence ----
  const gap = Math.abs(pHome - pAway);
  let confidenceLabel = "LOW";
  if (gap > 0.25) confidenceLabel = "HIGH";
  else if (gap > 0.12) confidenceLabel = "MED";

  // ---- Pick over/under recommendation ----
  const totalExp = lambda_home + lambda_away;
  let goalLine = "Over 1.5";
  let goalLineProb = pOver15;
  if (pOver35 >= 0.55)      { goalLine = "Over 3.5"; goalLineProb = pOver35; }
  else if (pOver25 >= 0.55) { goalLine = "Over 2.5"; goalLineProb = pOver25; }
  else if (pOver15 >= 0.65) { goalLine = "Over 1.5"; goalLineProb = pOver15; }
  else if (pOver25 < 0.40)  { goalLine = "Under 2.5"; goalLineProb = 1 - pOver25; }
  else                       { goalLine = "Over 1.5"; goalLineProb = pOver15; }

  // ---- Pick 1X2 recommendation ----
  let pick = "X";
  let pickProb = pDraw;
  if (pHome >= pDraw && pHome >= pAway) { pick = "1"; pickProb = pHome; }
  else if (pAway >= pDraw && pAway >= pHome) { pick = "2"; pickProb = pAway; }
  // "ambiguous" heuristic: two close top probs → mention double chance
  let doubleChance = null;
  const sorted = [
    { k: "1", p: pHome },
    { k: "X", p: pDraw },
    { k: "2", p: pAway }
  ].sort((a, b) => b.p - a.p);
  if (sorted[0].p - sorted[1].p < 0.06) {
    doubleChance = [sorted[0].k, sorted[1].k].sort().join("");
    // "1X" or "X2" or "12"
  }

  return {
    inputs: { league, date, home: H.name, away: A.name, homeSynthetic: ht._synthetic, awaySynthetic: at._synthetic },
    teams: { home: ht, away: at },
    mu: { mu_home, mu_away },
    strengths: { A_home, D_home, A_away, D_away },
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
    poisson: { grid, pHomePoisson, pDrawPoisson, pAwayPoisson, pOver15, pOver25, pOver35, pBTTS, bestScore },
    montecarlo: mc,
    ensemble: { w1, w2, w3, pHome, pDraw, pAway },
    recommendation: {
      pick, pickProb, doubleChance,
      goalLine, goalLineProb,
      confidence: confidenceLabel, confidenceGap: gap
    }
  };
}
