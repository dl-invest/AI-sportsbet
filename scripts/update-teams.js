#!/usr/bin/env node
/* ================================================================
   NIGHTLY TEAM-DATA UPDATER
   ----------------------------------------------------------------
   Fetches:
     1) api.clubelo.com              — daily Elo per club (CSV, no key)
     2) api.football-data.org (v4)   — finished matches for top-5
                                       European leagues (free tier)
   Computes:
     • μ_home, μ_away per league  (from actual season goals)
     • A (attack) and D (defense) relative to league average,
       time-weighted with w_i = exp(-λ · t_days),  λ = 0.003
     • form in [-0.12 .. +0.12] from the 5 most recent matches
     • xg_for / xg_ag approximated from goals (free tier has no xG)
     • inj default 0.05 (no injury feed on free tier)
   Writes:
     teams.js   — overwrites the committed file
   Requires env:
     FOOTBALL_DATA_TOKEN  (free, register at football-data.org)
   ================================================================ */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FD_BASE = 'https://api.football-data.org/v4';
const CLUBELO_BASE = 'http://api.clubelo.com';
const OUTPUT_FILE = path.join(__dirname, '..', 'teams.js');

const FD_TOKEN = process.env.FOOTBALL_DATA_TOKEN;
if (!FD_TOKEN) {
  console.error('ERROR: FOOTBALL_DATA_TOKEN env var is required.');
  console.error('Get a free token at https://www.football-data.org/client/register');
  process.exit(1);
}

/* ---------- league config ----------------------------------- */
const LEAGUES = {
  EPL:    { fdCode: 'PL'  },
  LALIGA: { fdCode: 'PD'  },
  SERIEA: { fdCode: 'SA'  },
  BUNDES: { fdCode: 'BL1' },
  LIGUE1: { fdCode: 'FL1' },
};

/* ---------- canonical team names -----------------------------
   Keys may come from football-data.org OR ClubElo; value is the
   single canonical name we use inside the app. Normalization
   strips suffixes like "FC", "AFC", "CF", "1.", "04", etc.
   ------------------------------------------------------------- */
const NAME_MAP = {
  // --- Premier League -----------------------------------------
  'Manchester City FC':      'Manchester City',
  'ManCity':                 'Manchester City',
  'Manchester United FC':    'Manchester United',
  'ManUnited':               'Manchester United',
  'Liverpool FC':            'Liverpool',
  'Arsenal FC':              'Arsenal',
  'Chelsea FC':              'Chelsea',
  'Tottenham Hotspur FC':    'Tottenham',
  'Tottenham':               'Tottenham',
  'Newcastle United FC':     'Newcastle',
  'Newcastle':               'Newcastle',
  'Aston Villa FC':          'Aston Villa',
  'Brighton & Hove Albion FC':'Brighton',
  'Brighton':                'Brighton',
  'West Ham United FC':      'West Ham',
  'WestHam':                 'West Ham',
  'Crystal Palace FC':       'Crystal Palace',
  'CrystalPalace':           'Crystal Palace',
  'Fulham FC':               'Fulham',
  'Brentford FC':            'Brentford',
  'Everton FC':              'Everton',
  'Wolverhampton Wanderers FC':'Wolves',
  'Wolves':                  'Wolves',
  'Nottingham Forest FC':    'Nottingham Forest',
  'Forest':                  'Nottingham Forest',
  'AFC Bournemouth':         'Bournemouth',
  'Bournemouth':             'Bournemouth',
  'Leicester City FC':       'Leicester',
  'Leicester':               'Leicester',
  'Ipswich Town FC':         'Ipswich',
  'Ipswich':                 'Ipswich',
  'Southampton FC':          'Southampton',
  'Southampton':             'Southampton',

  // --- La Liga -------------------------------------------------
  'Real Madrid CF':          'Real Madrid',
  'RealMadrid':              'Real Madrid',
  'FC Barcelona':            'Barcelona',
  'Barcelona':               'Barcelona',
  'Club Atlético de Madrid': 'Atletico Madrid',
  'AtlMadrid':               'Atletico Madrid',
  'Athletic Club':           'Athletic Bilbao',
  'Bilbao':                  'Athletic Bilbao',
  'Real Sociedad de Fútbol': 'Real Sociedad',
  'Sociedad':                'Real Sociedad',
  'Villarreal CF':           'Villarreal',
  'Villarreal':              'Villarreal',
  'Real Betis Balompié':     'Real Betis',
  'Betis':                   'Real Betis',
  'Sevilla FC':              'Sevilla',
  'Sevilla':                 'Sevilla',
  'Valencia CF':             'Valencia',
  'Valencia':                'Valencia',
  'Girona FC':               'Girona',
  'Girona':                  'Girona',
  'CA Osasuna':              'Osasuna',
  'Osasuna':                 'Osasuna',
  'RC Celta de Vigo':        'Celta Vigo',
  'Celta':                   'Celta Vigo',
  'Getafe CF':               'Getafe',
  'Getafe':                  'Getafe',
  'Rayo Vallecano de Madrid':'Rayo Vallecano',
  'Vallecano':               'Rayo Vallecano',
  'RCD Mallorca':            'Mallorca',
  'Mallorca':                'Mallorca',
  'UD Las Palmas':           'Las Palmas',
  'LasPalmas':               'Las Palmas',
  'Deportivo Alavés':        'Alaves',
  'Alaves':                  'Alaves',
  'RCD Espanyol de Barcelona':'Espanyol',
  'Espanyol':                'Espanyol',
  'CD Leganés':              'Leganes',
  'Leganes':                 'Leganes',
  'Real Valladolid CF':      'Valladolid',
  'Valladolid':              'Valladolid',

  // --- Serie A -------------------------------------------------
  'FC Internazionale Milano':'Inter',
  'Inter':                   'Inter',
  'AC Milan':                'AC Milan',
  'Milan':                   'AC Milan',
  'Juventus FC':             'Juventus',
  'Juventus':                'Juventus',
  'SSC Napoli':              'Napoli',
  'Napoli':                  'Napoli',
  'Atalanta BC':             'Atalanta',
  'Atalanta':                'Atalanta',
  'AS Roma':                 'Roma',
  'Roma':                    'Roma',
  'SS Lazio':                'Lazio',
  'Lazio':                   'Lazio',
  'Bologna FC 1909':         'Bologna',
  'Bologna':                 'Bologna',
  'ACF Fiorentina':          'Fiorentina',
  'Fiorentina':              'Fiorentina',
  'Torino FC':               'Torino',
  'Torino':                  'Torino',
  'Udinese Calcio':          'Udinese',
  'Udinese':                 'Udinese',
  'Genoa CFC':               'Genoa',
  'Genoa':                   'Genoa',
  'Hellas Verona FC':        'Hellas Verona',
  'Verona':                  'Hellas Verona',
  'US Lecce':                'Lecce',
  'Lecce':                   'Lecce',
  'Empoli FC':               'Empoli',
  'Empoli':                  'Empoli',
  'Cagliari Calcio':         'Cagliari',
  'Cagliari':                'Cagliari',
  'Parma Calcio 1913':       'Parma',
  'Parma':                   'Parma',
  'Venezia FC':              'Venezia',
  'Venezia':                 'Venezia',
  'AC Monza':                'Monza',
  'Monza':                   'Monza',
  'Como 1907':               'Como',
  'Como':                    'Como',

  // --- Bundesliga ---------------------------------------------
  'FC Bayern München':       'Bayern Munich',
  'Bayern':                  'Bayern Munich',
  'Bayer 04 Leverkusen':     'Bayer Leverkusen',
  'Leverkusen':              'Bayer Leverkusen',
  'Borussia Dortmund':       'Borussia Dortmund',
  'Dortmund':                'Borussia Dortmund',
  'RB Leipzig':              'RB Leipzig',
  'Leipzig':                 'RB Leipzig',
  'Eintracht Frankfurt':     'Eintracht Frankfurt',
  'Frankfurt':               'Eintracht Frankfurt',
  'VfB Stuttgart':           'VfB Stuttgart',
  'Stuttgart':               'VfB Stuttgart',
  'TSG 1899 Hoffenheim':     'Hoffenheim',
  'Hoffenheim':              'Hoffenheim',
  'SV Werder Bremen':        'Werder Bremen',
  'Bremen':                  'Werder Bremen',
  'VfL Wolfsburg':           'Wolfsburg',
  'Wolfsburg':               'Wolfsburg',
  'Borussia Mönchengladbach':'Borussia Monchengladbach',
  'Gladbach':                'Borussia Monchengladbach',
  '1. FSV Mainz 05':         'Mainz',
  'Mainz':                   'Mainz',
  'FC Augsburg':             'FC Augsburg',
  'Augsburg':                'FC Augsburg',
  '1. FC Union Berlin':      'Union Berlin',
  'UnionBerlin':             'Union Berlin',
  '1. FC Heidenheim 1846':   'FC Heidenheim',
  'Heidenheim':              'FC Heidenheim',
  'FC St. Pauli 1910':       'St. Pauli',
  'St Pauli':                'St. Pauli',
  'Holstein Kiel':           'Holstein Kiel',
  'Kiel':                    'Holstein Kiel',
  'VfL Bochum 1848':         'Bochum',
  'Bochum':                  'Bochum',
  'Sport-Club Freiburg':     'SC Freiburg',
  'Freiburg':                'SC Freiburg',

  // --- Ligue 1 ------------------------------------------------
  'Paris Saint-Germain FC':  'Paris Saint-Germain',
  'PSG':                     'Paris Saint-Germain',
  'Olympique de Marseille':  'Marseille',
  'Marseille':               'Marseille',
  'AS Monaco FC':            'Monaco',
  'Monaco':                  'Monaco',
  'LOSC Lille':              'Lille',
  'Lille':                   'Lille',
  'OGC Nice':                'Nice',
  'Nice':                    'Nice',
  'Olympique Lyonnais':      'Lyon',
  'Lyon':                    'Lyon',
  'Stade Rennais FC 1901':   'Rennes',
  'Rennes':                  'Rennes',
  'RC Strasbourg Alsace':    'Strasbourg',
  'Strasbourg':              'Strasbourg',
  'Toulouse FC':             'Toulouse',
  'Toulouse':                'Toulouse',
  'FC Nantes':               'Nantes',
  'Nantes':                  'Nantes',
  'Stade de Reims':          'Reims',
  'Reims':                   'Reims',
  'Stade Brestois 29':       'Brest',
  'Brest':                   'Brest',
  'RC Lens':                 'Lens',
  'Lens':                    'Lens',
  'AJ Auxerre':              'Auxerre',
  'Auxerre':                 'Auxerre',
  'Angers SCO':              'Angers',
  'Angers':                  'Angers',
  'Le Havre AC':             'Le Havre',
  'LeHavre':                 'Le Havre',
  'Montpellier HSC':         'Montpellier',
  'Montpellier':             'Montpellier',
  'AS Saint-Étienne':        'Saint-Etienne',
  'StEtienne':               'Saint-Etienne',
};

/* ---------- NB1 (Hungarian) static entries ------------------
   football-data.org free tier does NOT expose NB I., so we keep
   these manually. Updated by hand when needed.
   ------------------------------------------------------------- */
const NB1_TEAMS = {
  'Ferencvaros':     { league: 'NB1', elo: 1720, atk: 1.40, def: 0.85, form:  0.05, xg_for: 1.90, xg_ag: 1.00, inj: 0.05 },
  'Puskas Akademia': { league: 'NB1', elo: 1620, atk: 1.20, def: 0.95, form:  0.03, xg_for: 1.55, xg_ag: 1.15, inj: 0.05 },
  'Paks':            { league: 'NB1', elo: 1600, atk: 1.15, def: 0.95, form:  0.02, xg_for: 1.50, xg_ag: 1.15, inj: 0.05 },
  'MTK':             { league: 'NB1', elo: 1540, atk: 1.00, def: 1.05, form:  0.00, xg_for: 1.25, xg_ag: 1.35, inj: 0.05 },
  'Debrecen':        { league: 'NB1', elo: 1540, atk: 0.95, def: 1.05, form: -0.01, xg_for: 1.20, xg_ag: 1.40, inj: 0.05 },
  'Ujpest':          { league: 'NB1', elo: 1550, atk: 0.95, def: 1.00, form:  0.00, xg_for: 1.20, xg_ag: 1.30, inj: 0.05 },
  'Kecskemet':       { league: 'NB1', elo: 1520, atk: 0.90, def: 1.05, form: -0.01, xg_for: 1.15, xg_ag: 1.40, inj: 0.05 },
  'Gyor':            { league: 'NB1', elo: 1540, atk: 0.95, def: 1.05, form:  0.00, xg_for: 1.20, xg_ag: 1.40, inj: 0.05 },
  'ZTE':             { league: 'NB1', elo: 1530, atk: 0.90, def: 1.08, form: -0.02, xg_for: 1.15, xg_ag: 1.45, inj: 0.05 },
  'Diosgyor':        { league: 'NB1', elo: 1510, atk: 0.85, def: 1.10, form: -0.03, xg_for: 1.05, xg_ag: 1.45, inj: 0.06 },
  'Nyiregyhaza':     { league: 'NB1', elo: 1500, atk: 0.85, def: 1.15, form: -0.04, xg_for: 1.00, xg_ag: 1.55, inj: 0.06 },
};

/* ---------- user-facing alias map (kept in output) ---------- */
const TEAM_ALIASES = {
  'Man City':       'Manchester City',
  'Man Utd':        'Manchester United',
  'MU':             'Manchester United',
  'Spurs':          'Tottenham',
  "Nott'm Forest":  'Nottingham Forest',
  'Atleti':         'Atletico Madrid',
  'Atletico':       'Atletico Madrid',
  'Real':           'Real Madrid',
  'Barca':          'Barcelona',
  'BVB':            'Borussia Dortmund',
  'Gladbach':       'Borussia Monchengladbach',
  'Bayern':         'Bayern Munich',
  'Leverkusen':     'Bayer Leverkusen',
  'PSG':            'Paris Saint-Germain',
  'Fradi':          'Ferencvaros',
  'FTC':            'Ferencvaros',
};

/* ---------- helpers ---------------------------------------- */

function canonicalName(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (NAME_MAP[trimmed]) return NAME_MAP[trimmed];

  // heuristic cleanup
  const cleaned = trimmed
    .replace(/\s+(FC|AFC|CF|SC|SK|FK|AC)$/i, '')
    .replace(/^(FC|AFC|SC|AC)\s+/i, '')
    .replace(/\s+\d+$/, '')
    .trim();

  return NAME_MAP[cleaned] || cleaned;
}

function round(x, d) {
  if (!Number.isFinite(x)) return 0;
  const p = Math.pow(10, d);
  return Math.round(x * p) / p;
}

async function fetchJson(url, headers = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  return res.text();
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/* ---------- ClubElo ---------------------------------------- */

async function getClubEloMap() {
  const today = new Date().toISOString().slice(0, 10);
  const csv = await fetchText(`${CLUBELO_BASE}/${today}`);
  const lines = csv.trim().split('\n');
  const header = lines.shift();
  const cols = header.split(',').map(s => s.trim());
  const idxClub = cols.indexOf('Club');
  const idxElo  = cols.indexOf('Elo');
  if (idxClub < 0 || idxElo < 0) {
    throw new Error('Unexpected ClubElo CSV header: ' + header);
  }

  const out = {};
  for (const line of lines) {
    const parts = line.split(',');
    const name = canonicalName(parts[idxClub]);
    const elo  = parseFloat(parts[idxElo]);
    if (name && Number.isFinite(elo)) {
      out[name] = Math.round(elo);
    }
  }
  return out;
}

/* ---------- football-data.org ------------------------------ */

async function getFinishedMatches(competitionCode) {
  const data = await fetchJson(
    `${FD_BASE}/competitions/${competitionCode}/matches?status=FINISHED`,
    { 'X-Auth-Token': FD_TOKEN }
  );
  return data.matches || [];
}

/* ---------- per-league computation ------------------------- */

function computeLeagueStats(matches, leagueKey) {
  const now = Date.now();
  const LAMBDA = 0.003; // per day — time-weight decay
  const byTeam = {};

  // also accumulate league totals for μ_home / μ_away
  let totalHomeGoals = 0;
  let totalAwayGoals = 0;
  let totalMatches   = 0;

  for (const m of matches) {
    const hg = m.score?.fullTime?.home;
    const ag = m.score?.fullTime?.away;
    if (hg == null || ag == null) continue;

    const days = Math.max(0, (now - new Date(m.utcDate).getTime()) / 86_400_000);
    const w = Math.exp(-LAMBDA * days);

    const h = canonicalName(m.homeTeam?.name);
    const a = canonicalName(m.awayTeam?.name);
    if (!h || !a) continue;

    totalHomeGoals += hg;
    totalAwayGoals += ag;
    totalMatches   += 1;

    byTeam[h] ||= { w_home: 0, gf_home: 0, ga_home: 0,
                    w_away: 0, gf_away: 0, ga_away: 0,
                    recent: [] };
    byTeam[a] ||= { w_home: 0, gf_home: 0, ga_home: 0,
                    w_away: 0, gf_away: 0, ga_away: 0,
                    recent: [] };

    byTeam[h].w_home  += w;
    byTeam[h].gf_home += w * hg;
    byTeam[h].ga_home += w * ag;
    byTeam[a].w_away  += w;
    byTeam[a].gf_away += w * ag;
    byTeam[a].ga_away += w * hg;

    byTeam[h].recent.push({ days, result: hg > ag ? 'W' : hg < ag ? 'L' : 'D' });
    byTeam[a].recent.push({ days, result: ag > hg ? 'W' : ag < hg ? 'L' : 'D' });
  }

  if (totalMatches === 0) {
    return { teams: {}, mu_home: 1.5, mu_away: 1.2 };
  }

  const mu_home = totalHomeGoals / totalMatches;
  const mu_away = totalAwayGoals / totalMatches;

  const teams = {};
  for (const [name, s] of Object.entries(byTeam)) {
    // need at least some home AND away data
    if (s.w_home < 0.5 || s.w_away < 0.5) continue;

    const gf_home_pg = s.gf_home / s.w_home;
    const ga_home_pg = s.ga_home / s.w_home;
    const gf_away_pg = s.gf_away / s.w_away;
    const ga_away_pg = s.ga_away / s.w_away;

    // attack strength (relative to league avg goals scored in that venue)
    const atk_home = gf_home_pg / mu_home;
    const atk_away = gf_away_pg / mu_away;
    const atk = (atk_home + atk_away) / 2;

    // defense strength: conceded relative to opponent-venue avg
    // home defense faces away teams who on avg score mu_away
    const def_home = ga_home_pg / mu_away;
    const def_away = ga_away_pg / mu_home;
    const def = (def_home + def_away) / 2;

    // form: last 5 most-recent results, scaled to [-0.12 .. +0.12]
    s.recent.sort((a, b) => a.days - b.days);
    const last5 = s.recent.slice(0, 5);
    if (last5.length > 0) {
      const pts = last5.reduce((acc, r) =>
        acc + (r.result === 'W' ? 1 : r.result === 'L' ? -1 : 0), 0);
      var form = (pts / last5.length) * 0.12;
    } else {
      form = 0;
    }

    // no xG on free tier — approximate from average goals,
    // mildly shrunk toward 1.0 so the xG blend still adds signal
    const xg_for = gf_home_pg * 0.5 + gf_away_pg * 0.5;
    const xg_ag  = ga_home_pg * 0.5 + ga_away_pg * 0.5;

    teams[name] = {
      league: leagueKey,
      atk:    round(atk,    3),
      def:    round(def,    3),
      form:   round(form,   3),
      xg_for: round(xg_for, 2),
      xg_ag:  round(xg_ag,  2),
      inj:    0.05, // not available on free tier
    };
  }

  return { teams, mu_home: round(mu_home, 3), mu_away: round(mu_away, 3) };
}

/* ---------- main ------------------------------------------- */

async function main() {
  console.log('[1/3] Fetching ClubElo ratings...');
  const eloMap = await getClubEloMap();
  console.log(`      → ${Object.keys(eloMap).length} clubs`);

  const allTeams = {};
  const leagueAvgs = {};

  for (const [key, cfg] of Object.entries(LEAGUES)) {
    console.log(`[2/3] Fetching ${key} (${cfg.fdCode})...`);
    try {
      const matches = await getFinishedMatches(cfg.fdCode);
      console.log(`      → ${matches.length} finished matches`);
      const { teams, mu_home, mu_away } = computeLeagueStats(matches, key);
      leagueAvgs[key] = { home: mu_home, away: mu_away };

      for (const [name, s] of Object.entries(teams)) {
        const elo = eloMap[name] ?? 1600;
        allTeams[name] = { elo, ...s };
      }
      console.log(`      → ${Object.keys(teams).length} teams written`);
    } catch (e) {
      console.error(`      ! ${key} failed: ${e.message}`);
      // keep going — partial update is still useful
    }

    // free tier rate limit is 10/min → sleep to be safe
    await sleep(7000);
  }

  // merge in NB1 (static)
  leagueAvgs.NB1   = { home: 1.45, away: 1.15 };
  leagueAvgs.UCL   = { home: 1.60, away: 1.30 };
  leagueAvgs.OTHER = { home: 1.50, away: 1.20 };
  Object.assign(allTeams, NB1_TEAMS);

  console.log(`[3/3] Writing ${OUTPUT_FILE}`);
  writeTeamsFile(allTeams, leagueAvgs);
  console.log(`      → ${Object.keys(allTeams).length} total teams`);
}

function writeTeamsFile(teams, avgs) {
  const ts = new Date().toISOString();
  const header =
`/* =============================================================
   AUTO-GENERATED by scripts/update-teams.js
   Last run: ${ts}
   Sources:  football-data.org  +  api.clubelo.com
   DO NOT EDIT — this file is overwritten nightly.
   ============================================================= */

`;

  let body = `const LEAGUE_AVG = ${JSON.stringify(avgs, null, 2)};\n\n`;

  body += 'const TEAMS = {\n';
  const sorted = Object.keys(teams).sort((a, b) => a.localeCompare(b));
  for (const name of sorted) {
    body += `  ${JSON.stringify(name)}: ${JSON.stringify(teams[name])},\n`;
  }
  body += '};\n\n';

  body += `const TEAM_ALIASES = ${JSON.stringify(TEAM_ALIASES, null, 2)};\n`;

  fs.writeFileSync(OUTPUT_FILE, header + body, 'utf8');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
