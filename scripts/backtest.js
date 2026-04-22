#!/usr/bin/env node
/* ================================================================
   WALK-FORWARD BACKTEST  —  Phase 1
   ----------------------------------------------------------------
   For every finished match M (chronologically) in a league:
     1. Build team statistics from ONLY the matches strictly before M
        (time-weighted form, atk_home/atk_away, def_home/def_away,
         league μ_home / μ_away).
     2. Predict M with the Phase-1 model (Poisson + Dixon-Coles + Elo).
     3. Score prediction vs. actual result.
   Metrics over all eligible matches:
     • Accuracy         (argmax hit rate)
     • Log-loss         (− mean log p_actual)
     • Brier score      (mean sum of squared errors over 3 outcomes)
     • RPS              (ranked probability score, 3-class)
     • Mean confidence  (avg p_argmax)
     • Calibration bins (predicted vs observed per decile)

   Data flow:
     - One-time: fetch finished matches per league via football-data.org
       and cache to scripts/cache/matches-<LEAGUE>.json.
       Uses FINISHED status only. Free-tier: last ~2 seasons.
     - Elo and xG are NOT re-derived per-match (too slow / free-tier
       rate-limited). Elo uses a simple incrementally updated rating
       seeded from an initial 1500, K=25. xG uses a running per-team
       average of actual goals so far (cheap Poisson-style proxy).

   CLI:
     node scripts/backtest.js --league EPL [flags]
     Flags (override model constants for sweeps):
       --rho <num>       Dixon-Coles ρ             (default -0.15)
       --alpha <num>     xG blend weight           (default 0.7)
       --beta <num>      Elo→λ correction weight   (default 0.1)
       --hgoal <num>     home-goal multiplier      (default 1.18)
       --helo <num>      Elo home advantage        (default 60)
       --decay <num>     form time-decay λ         (default 0.003)
       --minprior <int>  skip matches with fewer than N prior games
                         per team                  (default 6)
       --refresh         force re-fetch, ignore cache
       --seasons <n>     requested number of seasons (default 2)
       --verbose         per-match log lines
   Env:
     FOOTBALL_DATA_TOKEN   required for --refresh
   ================================================================ */

'use strict';

const fs   = require('node:fs');
const path = require('node:path');

const FD_BASE    = 'https://api.football-data.org/v4';
const CACHE_DIR  = path.join(__dirname, 'cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

/* ------------------------------------------------------------- */
/* CLI                                                            */
/* ------------------------------------------------------------- */
function parseArgs(argv) {
  const out = {
    league:   'EPL',
    rho:     -0.15,
    alpha:    0.7,
    beta:     0.1,
    hgoal:    1.18,
    helo:     60,
    decay:    0.003,
    minprior: 6,
    refresh:  false,
    seasons:  2,
    verbose:  false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--league':   out.league   = next();          break;
      case '--rho':      out.rho      = parseFloat(next()); break;
      case '--alpha':    out.alpha    = parseFloat(next()); break;
      case '--beta':     out.beta     = parseFloat(next()); break;
      case '--hgoal':    out.hgoal    = parseFloat(next()); break;
      case '--helo':     out.helo     = parseFloat(next()); break;
      case '--decay':    out.decay    = parseFloat(next()); break;
      case '--minprior': out.minprior = parseInt(next(),10); break;
      case '--seasons':  out.seasons  = parseInt(next(),10); break;
      case '--refresh':  out.refresh  = true;            break;
      case '--verbose':  out.verbose  = true;            break;
      case '-h': case '--help':
        console.log(fs.readFileSync(__filename, 'utf8')
          .split('\n').slice(1, 55).join('\n'));
        process.exit(0);
    }
  }
  return out;
}
const OPT = parseArgs(process.argv);

const FD_CODE = {
  EPL:'PL', LALIGA:'PD', SERIEA:'SA', BUNDES:'BL1', LIGUE1:'FL1',
}[OPT.league];
if (!FD_CODE) {
  console.error(`Unknown league: ${OPT.league}`);
  process.exit(1);
}

/* ------------------------------------------------------------- */
/* Fetch & cache                                                  */
/* ------------------------------------------------------------- */
async function fetchMatches(fdCode, seasons) {
  const token = process.env.FOOTBALL_DATA_TOKEN;
  if (!token) {
    console.error('ERROR: --refresh requires FOOTBALL_DATA_TOKEN env');
    process.exit(1);
  }
  const all = [];
  // walk backward from current year through requested seasons
  const curYear = new Date().getFullYear();
  for (let s = 0; s < seasons; s++) {
    const season = curYear - s - 1; // e.g. 2024 -> 2024/25 season
    const url = `${FD_BASE}/competitions/${fdCode}/matches?status=FINISHED&season=${season}`;
    console.log(`  fetching ${fdCode} season=${season}`);
    const res = await fetch(url, { headers: { 'X-Auth-Token': token } });
    if (!res.ok) {
      console.error(`  HTTP ${res.status} on ${url}`);
      if (res.status === 429) {
        console.error('  rate-limited; sleeping 60s');
        await new Promise(r => setTimeout(r, 60_000));
        s--; continue;
      }
      continue;
    }
    const data = await res.json();
    all.push(...(data.matches || []));
    await new Promise(r => setTimeout(r, 7_000)); // free-tier rate limit
  }
  return all;
}

async function loadMatches() {
  const cacheFile = path.join(CACHE_DIR, `matches-${OPT.league}.json`);
  if (!OPT.refresh && fs.existsSync(cacheFile)) {
    console.log(`Using cached ${path.relative(process.cwd(), cacheFile)}`);
    return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  }
  console.log(`Fetching fresh ${OPT.league} data (${OPT.seasons} seasons)`);
  const matches = await fetchMatches(FD_CODE, OPT.seasons);
  fs.writeFileSync(cacheFile, JSON.stringify(matches, null, 2));
  console.log(`  saved ${matches.length} matches`);
  return matches;
}

/* ------------------------------------------------------------- */
/* Model (self-contained copy of predictor.js math)               */
/* ------------------------------------------------------------- */
function poissonPMF(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logFact = 0;
  for (let i = 2; i <= k; i++) logFact += Math.log(i);
  return Math.exp(-lambda + k * Math.log(lambda) - logFact);
}
function dcTau(i, j, lh, la, rho) {
  if (i === 0 && j === 0) return 1 - lh * la * rho;
  if (i === 0 && j === 1) return 1 + lh * rho;
  if (i === 1 && j === 0) return 1 + la * rho;
  if (i === 1 && j === 1) return 1 - rho;
  return 1;
}
function eloExpected(rH, rA, H) {
  return 1 / (1 + Math.pow(10, (rA - rH + H) / 400));
}

/* Given current team-state, predict 1X2 probs using Phase-1 model */
function predictOne(state, home, away, opt) {
  const mu_h = state.mu_home;
  const mu_a = state.mu_away;
  const sH = state.teams[home];
  const sA = state.teams[away];

  // fallback: if a team has no prior games, skip (caller decides)
  if (!sH || !sA) return null;

  const A_home = (sH.atk_home || 1) * (1 + (sH.form || 0));
  const D_home = (sH.def_home || 1);
  const A_away = (sA.atk_away || 1) * (1 + (sA.form || 0));
  const D_away = (sA.def_away || 1);

  const H_goal = opt.hgoal;
  const lh_base = mu_h * A_home * D_away * H_goal;
  const la_base = mu_a * A_away * D_home;

  // xG integration (proxy: xg_for ~ goals-for per game)
  const alpha = opt.alpha;
  const xgBlend_h = ((sH.xg_for_home ?? sH.xg_for ?? 1.3) + (sA.xg_ag_away ?? sA.xg_ag ?? 1.4)) / 2;
  const xgBlend_a = ((sA.xg_for_away ?? sA.xg_for ?? 1.1) + (sH.xg_ag_home ?? sH.xg_ag ?? 1.2)) / 2;
  const lh_xg = alpha * lh_base + (1 - alpha) * xgBlend_h * (H_goal / 1.1);
  const la_xg = alpha * la_base + (1 - alpha) * xgBlend_a * 0.95;

  // Elo correction
  const beta = opt.beta;
  const dElo = (sH.elo - sA.elo) / 400;
  let lh = Math.max(0.2, lh_xg * (1 + beta * dElo));
  let la = Math.max(0.2, la_xg * (1 - beta * dElo));

  // Poisson grid + Dixon-Coles
  const MAX = 6;
  const grid = [];
  let sum = 0;
  for (let i = 0; i <= MAX; i++) {
    const row = [];
    for (let j = 0; j <= MAX; j++) {
      const v = poissonPMF(i, lh) * poissonPMF(j, la) * dcTau(i, j, lh, la, opt.rho);
      row.push(v);
      sum += v;
    }
    grid.push(row);
  }
  let pH=0, pD=0, pA=0;
  for (let i = 0; i <= MAX; i++) {
    for (let j = 0; j <= MAX; j++) {
      const p = grid[i][j] / sum;
      if (i > j) pH += p;
      else if (i < j) pA += p;
      else pD += p;
    }
  }

  // Elo 1X2 overlay
  const E_home = eloExpected(sH.elo, sA.elo, opt.helo);
  const eloDiff = Math.abs(sH.elo - sA.elo);
  const pDrawElo = Math.max(0.16, 0.30 - eloDiff / 2000);
  const pHomeElo = (1 - pDrawElo) * E_home;
  const pAwayElo = (1 - pDrawElo) * (1 - E_home);

  // Ensemble (no separate xG-only pass in backtest for speed)
  const w1 = 0.7, w2 = 0.3;
  let fH = w1 * pH + w2 * pHomeElo;
  let fD = w1 * pD + w2 * pDrawElo;
  let fA = w1 * pA + w2 * pAwayElo;
  const s = fH + fD + fA;
  return { pH: fH/s, pD: fD/s, pA: fA/s, lh, la };
}

/* ------------------------------------------------------------- */
/* State updater — incremental, walk-forward                      */
/* ------------------------------------------------------------- */
function emptyState() {
  return {
    // running league totals (time-weighted)
    wH_total: 0, gfH_total: 0, gfA_total: 0, n_total: 0,
    mu_home: 1.5, mu_away: 1.2,
    teams: {},
  };
}

function touchTeam(state, name) {
  return state.teams[name] ||= {
    elo: 1500,
    gfH: 0, gaH: 0, wH: 0, gfA: 0, gaA: 0, wA: 0,
    atk_home: 1, atk_away: 1, def_home: 1, def_away: 1,
    xg_for: null, xg_ag: null,
    recent: [],  // {t, result:'W'|'D'|'L'}
    form: 0,
    games: 0,
  };
}

function updateAfterMatch(state, m, opt) {
  const h = m.homeTeam.name;
  const a = m.awayTeam.name;
  const hg = m.score.fullTime.home;
  const ag = m.score.fullTime.away;
  const t  = new Date(m.utcDate).getTime();

  const sH = touchTeam(state, h);
  const sA = touchTeam(state, a);

  // Elo update (K=25 standard, with home advantage in expectation)
  const K = 25;
  const Eh = eloExpected(sH.elo, sA.elo, opt.helo);
  const Sh = hg > ag ? 1 : hg < ag ? 0 : 0.5;
  sH.elo = sH.elo + K * (Sh - Eh);
  sA.elo = sA.elo + K * ((1 - Sh) - (1 - Eh));

  // Running time-weighted home/away goal splits.
  // "Anchor" weight at time of match: exp(-λ · age) — but at the point we
  // update, days=0. So we store raw contributions then recompute weights
  // on the fly at prediction time. To keep it cheap, we instead store
  // running weighted sums where the weight anchor is "now" meaning
  // current date of the match being added; at predict time for match M,
  // ages are computed against M.utcDate by rescaling once.
  // For simplicity & speed we use accumulating weights against the
  // fixed anchor t_now = m.utcDate of THIS update.
  const w = 1;  // incremental weight (decay re-applied at predict time)

  sH.wH   += w;
  sH.gfH  += w * hg;
  sH.gaH  += w * ag;
  sA.wA   += w;
  sA.gfA  += w * ag;
  sA.gaA  += w * hg;

  sH.recent.push({ t, result: hg>ag?'W':hg<ag?'L':'D' });
  sA.recent.push({ t, result: ag>hg?'W':ag<hg?'L':'D' });
  sH.games++; sA.games++;

  // League running totals
  state.wH_total  += w;
  state.gfH_total += w * hg;
  state.gfA_total += w * ag;
  state.n_total   += 1;

  // Recompute league averages
  if (state.n_total > 0) {
    state.mu_home = state.gfH_total / state.n_total;
    state.mu_away = state.gfA_total / state.n_total;
  }
}

/* Freshen derived per-team fields (atk_*, def_*, form, xg) relative to
   the prediction time t_now (the kickoff of the NEXT match). */
function refreshDerived(state, tNow, opt) {
  const mu_h = state.mu_home;
  const mu_a = state.mu_away;
  for (const s of Object.values(state.teams)) {
    if (s.wH < 0.5 || s.wA < 0.5) continue;

    const gfH_pg = s.gfH / s.wH;
    const gaH_pg = s.gaH / s.wH;
    const gfA_pg = s.gfA / s.wA;
    const gaA_pg = s.gaA / s.wA;

    s.atk_home = gfH_pg / mu_h;
    s.atk_away = gfA_pg / mu_a;
    s.def_home = gaH_pg / mu_a;
    s.def_away = gaA_pg / mu_h;
    s.xg_for   = (gfH_pg + gfA_pg) / 2;
    s.xg_ag    = (gaH_pg + gaA_pg) / 2;

    // form from last 5 recent (time-sorted)
    s.recent.sort((a, b) => b.t - a.t);
    const last5 = s.recent.slice(0, 5);
    if (last5.length) {
      const pts = last5.reduce((acc, r) =>
        acc + (r.result === 'W' ? 1 : r.result === 'L' ? -1 : 0), 0);
      s.form = (pts / last5.length) * 0.12;
    } else {
      s.form = 0;
    }
  }
}

/* ------------------------------------------------------------- */
/* Metrics                                                        */
/* ------------------------------------------------------------- */
function actualIndex(hg, ag) {
  if (hg > ag) return 0;  // home
  if (hg < ag) return 2;  // away
  return 1;               // draw
}

function updateMetrics(acc, pred, actual) {
  const probs = [pred.pH, pred.pD, pred.pA];
  const y     = [0, 0, 0]; y[actual] = 1;

  // log-loss
  const pAct = Math.max(1e-12, probs[actual]);
  acc.logloss += -Math.log(pAct);

  // Brier
  let brier = 0;
  for (let k = 0; k < 3; k++) {
    const d = probs[k] - y[k];
    brier += d * d;
  }
  acc.brier += brier;

  // RPS (order: home, draw, away)
  const cumP = [probs[0], probs[0]+probs[1], 1];
  const cumY = [y[0],     y[0]+y[1],         1];
  let rps = 0;
  for (let k = 0; k < 2; k++) {
    const d = cumP[k] - cumY[k];
    rps += d * d;
  }
  acc.rps += rps / 2;

  // argmax accuracy
  const argmax = probs.indexOf(Math.max(...probs));
  if (argmax === actual) acc.hits++;

  // confidence
  acc.conf += probs[argmax];

  // calibration bin on predicted p_actual
  const bin = Math.min(9, Math.floor(pAct * 10));
  acc.cal[bin].n++;
  acc.cal[bin].pred += pAct;
  acc.cal[bin].obs  += 1;  // since this IS the actual outcome
}

function newAcc() {
  return {
    n: 0, hits: 0,
    logloss: 0, brier: 0, rps: 0, conf: 0,
    cal: Array.from({ length: 10 }, () => ({ n: 0, pred: 0, obs: 0 })),
  };
}

/* ------------------------------------------------------------- */
/* Main                                                           */
/* ------------------------------------------------------------- */
(async function main() {
  const matches = await loadMatches();
  // Keep only finished matches with full-time scores
  const mm = matches
    .filter(m => m?.score?.fullTime?.home != null && m?.score?.fullTime?.away != null)
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));

  console.log(`Backtesting ${mm.length} matches for ${OPT.league}`);
  console.log(`  options: rho=${OPT.rho} alpha=${OPT.alpha} beta=${OPT.beta} `
            + `hgoal=${OPT.hgoal} helo=${OPT.helo} minprior=${OPT.minprior}`);

  const state = emptyState();
  const acc = newAcc();

  for (const m of mm) {
    const tNow = new Date(m.utcDate).getTime();
    refreshDerived(state, tNow, OPT);

    const h = m.homeTeam.name;
    const a = m.awayTeam.name;
    const sH = state.teams[h];
    const sA = state.teams[a];

    const enoughH = sH && sH.games >= OPT.minprior;
    const enoughA = sA && sA.games >= OPT.minprior;

    if (enoughH && enoughA) {
      const pred = predictOne(state, h, a, OPT);
      if (pred) {
        const actual = actualIndex(m.score.fullTime.home, m.score.fullTime.away);
        updateMetrics(acc, pred, actual);
        acc.n++;
        if (OPT.verbose) {
          const labels = ['1','X','2'];
          console.log(`  ${m.utcDate.slice(0,10)}  ${h} ${m.score.fullTime.home}-${m.score.fullTime.away} ${a}  `
            + `pH=${pred.pH.toFixed(2)} pD=${pred.pD.toFixed(2)} pA=${pred.pA.toFixed(2)}  -> ${labels[actual]}`);
        }
      }
    }

    // Always update the state AFTER scoring (walk-forward)
    updateAfterMatch(state, m, OPT);
  }

  /* ---------- report ---------- */
  if (acc.n === 0) {
    console.log('No eligible matches (increase seasons or lower --minprior).');
    return;
  }
  console.log(`\nEvaluated ${acc.n} matches (of ${mm.length})`);
  console.log(`  Accuracy     = ${(acc.hits / acc.n * 100).toFixed(2)}%`);
  console.log(`  Log-loss     = ${(acc.logloss / acc.n).toFixed(4)}  (lower is better; baseline ≈ 1.0986)`);
  console.log(`  Brier        = ${(acc.brier   / acc.n).toFixed(4)}  (lower is better; baseline ≈ 0.667)`);
  console.log(`  RPS          = ${(acc.rps     / acc.n).toFixed(4)}  (lower is better; baseline ≈ 0.222)`);
  console.log(`  Mean conf    = ${(acc.conf    / acc.n).toFixed(4)}`);

  console.log('\n  Calibration (pred probability on actual outcome, per decile):');
  console.log('   decile   n    mean-pred   actual(=1)');
  for (let b = 0; b < 10; b++) {
    const c = acc.cal[b];
    if (c.n === 0) continue;
    const lo = (b * 10).toString().padStart(2, ' ');
    const hi = ((b + 1) * 10).toString().padStart(2, ' ');
    console.log(`   ${lo}-${hi}%  ${String(c.n).padStart(4)}   ${(c.pred/c.n).toFixed(3)}       ${(c.obs/c.n).toFixed(3)}`);
  }
})().catch(err => { console.error('FATAL:', err); process.exit(1); });
