#!/usr/bin/env node
/* ================================================================
   NIGHTLY TEAM-DATA UPDATER  —  Phase 1
   ----------------------------------------------------------------
   Sources:
     1) api.clubelo.com              — daily Elo per club (CSV)
     2) api.football-data.org (v4)   — finished matches, top-5 Eur.
     3) understat.com                — real shot-based xG per team
   Computes (per team):
     • atk_home / atk_away           — separate home & away attack
     • def_home / def_away           — separate home & away defense
     • atk, def                      — averaged versions (legacy)
     • form ∈ [-0.12 .. +0.12]       — from last 5 most-recent games
     • xg_for / xg_ag                — from Understat when available,
                                       else goal-average proxy
     • xg_for_home / xg_for_away
       xg_ag_home  / xg_ag_away      — split versions (Understat only)
     • xg_source                     — "understat" | "proxy"
   League averages (μ_home, μ_away) are computed from actual goals.
   Requires env:
     FOOTBALL_DATA_TOKEN
   ================================================================ */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FD_BASE       = 'https://api.football-data.org/v4';
const CLUBELO_BASE  = 'http://api.clubelo.com';
const UNDERSTAT_BASE = 'https://understat.com/league';
const OUTPUT_FILE   = path.join(__dirname, '..', 'teams.js');

const FD_TOKEN = process.env.FOOTBALL_DATA_TOKEN;
if (!FD_TOKEN) {
  console.error('ERROR: FOOTBALL_DATA_TOKEN env var is required.');
  process.exit(1);
}

/* ---------- league config ----------------------------------- */
const LEAGUES = {
  EPL:    { fdCode: 'PL',  understat: 'EPL'        },
  LALIGA: { fdCode: 'PD',  understat: 'La_liga'    },
  SERIEA: { fdCode: 'SA',  understat: 'Serie_A'    },
  BUNDES: { fdCode: 'BL1', understat: 'Bundesliga' },
  LIGUE1: { fdCode: 'FL1', understat: 'Ligue_1'    },
};

/* ---------- canonical team names ---------------------------- */
const NAME_MAP = {
  // Premier League
  'Manchester City FC':'Manchester City',        'ManCity':'Manchester City',
  'Manchester United FC':'Manchester United',    'ManUnited':'Manchester United',
  'Liverpool FC':'Liverpool',
  'Arsenal FC':'Arsenal',
  'Chelsea FC':'Chelsea',
  'Tottenham Hotspur FC':'Tottenham',            'Tottenham':'Tottenham',
  'Newcastle United FC':'Newcastle',             'Newcastle United':'Newcastle',
  'Aston Villa FC':'Aston Villa',
  'Brighton & Hove Albion FC':'Brighton',        'Brighton':'Brighton',
  'West Ham United FC':'West Ham',               'WestHam':'West Ham',
  'Crystal Palace FC':'Crystal Palace',          'CrystalPalace':'Crystal Palace',
  'Fulham FC':'Fulham',
  'Brentford FC':'Brentford',
  'Everton FC':'Everton',
  'Wolverhampton Wanderers FC':'Wolves',         'Wolverhampton Wanderers':'Wolves',
  'Nottingham Forest FC':'Nottingham Forest',    'Forest':'Nottingham Forest',
  'AFC Bournemouth':'Bournemouth',               'Bournemouth':'Bournemouth',
  'Leicester City FC':'Leicester',               'Leicester':'Leicester',
  'Ipswich Town FC':'Ipswich',                   'Ipswich':'Ipswich',
  'Southampton FC':'Southampton',                'Southampton':'Southampton',
  'Leeds United FC':'Leeds United',              'Leeds':'Leeds United',
  'Burnley FC':'Burnley',                        'Burnley':'Burnley',

  // La Liga
  'Real Madrid CF':'Real Madrid',                'RealMadrid':'Real Madrid',
  'FC Barcelona':'Barcelona',                    'Barcelona':'Barcelona',
  'Club Atlético de Madrid':'Atletico Madrid',   'AtlMadrid':'Atletico Madrid',
  'Atletico':'Atletico Madrid',
  'Athletic Club':'Athletic Bilbao',             'Bilbao':'Athletic Bilbao',
  'Real Sociedad de Fútbol':'Real Sociedad',     'Sociedad':'Real Sociedad',
  'Villarreal CF':'Villarreal',                  'Villarreal':'Villarreal',
  'Real Betis Balompié':'Real Betis',            'Betis':'Real Betis',
  'Sevilla FC':'Sevilla',                        'Sevilla':'Sevilla',
  'Valencia CF':'Valencia',                      'Valencia':'Valencia',
  'Girona FC':'Girona',                          'Girona':'Girona',
  'CA Osasuna':'Osasuna',                        'Osasuna':'Osasuna',
  'RC Celta de Vigo':'Celta Vigo',               'Celta':'Celta Vigo',
  'Getafe CF':'Getafe',                          'Getafe':'Getafe',
  'Rayo Vallecano de Madrid':'Rayo Vallecano',   'Vallecano':'Rayo Vallecano',
  'RCD Mallorca':'Mallorca',                     'Mallorca':'Mallorca',
  'UD Las Palmas':'Las Palmas',                  'LasPalmas':'Las Palmas',
  'Deportivo Alavés':'Alaves',                   'Alaves':'Alaves', 'Alavés':'Alaves',
  'RCD Espanyol de Barcelona':'Espanyol',        'Espanyol':'Espanyol',
  'CD Leganés':'Leganes',                        'Leganes':'Leganes','Leganés':'Leganes',
  'Real Valladolid CF':'Valladolid',             'Valladolid':'Valladolid',
  'Elche CF':'Elche',                            'Elche':'Elche',
  'Levante UD':'Levante UD',                     'Levante':'Levante UD',

  // Serie A
  'FC Internazionale Milano':'Inter',            'Inter':'Inter',
  'AC Milan':'AC Milan',                         'Milan':'AC Milan',
  'Juventus FC':'Juventus',                      'Juventus':'Juventus',
  'SSC Napoli':'Napoli',                         'Napoli':'Napoli',
  'Atalanta BC':'Atalanta',                      'Atalanta':'Atalanta',
  'AS Roma':'Roma',                              'Roma':'Roma',
  'SS Lazio':'Lazio',                            'Lazio':'Lazio',
  'Bologna FC 1909':'Bologna',                   'Bologna':'Bologna',
  'ACF Fiorentina':'Fiorentina',                 'Fiorentina':'Fiorentina',
  'Torino FC':'Torino',                          'Torino':'Torino',
  'Udinese Calcio':'Udinese',                    'Udinese':'Udinese',
  'Genoa CFC':'Genoa',                           'Genoa':'Genoa',
  'Hellas Verona FC':'Hellas Verona',            'Verona':'Hellas Verona',
  'US Lecce':'Lecce',                            'Lecce':'Lecce',
  'Empoli FC':'Empoli',                          'Empoli':'Empoli',
  'Cagliari Calcio':'Cagliari',                  'Cagliari':'Cagliari',
  'Parma Calcio 1913':'Parma',                   'Parma':'Parma',
  'Venezia FC':'Venezia',                        'Venezia':'Venezia',
  'AC Monza':'Monza',                            'Monza':'Monza',
  'Como 1907':'Como',                            'Como':'Como',

  // Bundesliga
  'FC Bayern München':'Bayern Munich',           'Bayern':'Bayern Munich',
  'Bayer 04 Leverkusen':'Bayer Leverkusen',      'Leverkusen':'Bayer Leverkusen',
  'Borussia Dortmund':'Borussia Dortmund',       'Dortmund':'Borussia Dortmund',
  'RB Leipzig':'RB Leipzig',                     'Leipzig':'RB Leipzig',
  'Eintracht Frankfurt':'Eintracht Frankfurt',   'Frankfurt':'Eintracht Frankfurt',
  'VfB Stuttgart':'VfB Stuttgart',               'Stuttgart':'VfB Stuttgart',
  'TSG 1899 Hoffenheim':'Hoffenheim',            'Hoffenheim':'Hoffenheim',
  'SV Werder Bremen':'Werder Bremen',            'Bremen':'Werder Bremen',
  'VfL Wolfsburg':'Wolfsburg',                   'Wolfsburg':'Wolfsburg',
  'Borussia Mönchengladbach':'Borussia Monchengladbach',
  'Borussia M.Gladbach':'Borussia Monchengladbach',
  'Gladbach':'Borussia Monchengladbach',
  '1. FSV Mainz 05':'Mainz',                     'Mainz 05':'Mainz', 'Mainz':'Mainz',
  'FC Augsburg':'FC Augsburg',                   'Augsburg':'FC Augsburg',
  '1. FC Union Berlin':'Union Berlin',           'Union Berlin':'Union Berlin',
  '1. FC Heidenheim 1846':'FC Heidenheim',       'Heidenheim':'FC Heidenheim',
  'FC St. Pauli 1910':'St. Pauli',               'St. Pauli':'St. Pauli','St Pauli':'St. Pauli',
  'Holstein Kiel':'Holstein Kiel',               'Kiel':'Holstein Kiel',
  'VfL Bochum 1848':'Bochum',                    'Bochum':'Bochum',
  'Sport-Club Freiburg':'SC Freiburg',           'SC Freiburg':'SC Freiburg','Freiburg':'SC Freiburg',
  '1. FC Köln':'1. FC Köln',                     'Köln':'1. FC Köln','Cologne':'1. FC Köln',
  'Hamburger SV':'Hamburger SV',                 'Hamburg':'Hamburger SV',

  // Ligue 1
  'Paris Saint-Germain FC':'Paris Saint-Germain','Paris Saint Germain':'Paris Saint-Germain',
  'PSG':'Paris Saint-Germain',
  'Olympique de Marseille':'Marseille',          'Marseille':'Marseille',
  'AS Monaco FC':'Monaco',                       'Monaco':'Monaco',
  'LOSC Lille':'Lille',                          'Lille':'Lille', 'Lille OSC':'Lille OSC',
  'OGC Nice':'Nice',                             'Nice':'Nice',
  'Olympique Lyonnais':'Lyon',                   'Lyon':'Lyon','Olympique Lyon':'Lyon',
  'Stade Rennais FC 1901':'Rennes',              'Stade Rennais':'Rennes','Rennes':'Rennes',
  'RC Strasbourg Alsace':'Strasbourg',           'Strasbourg':'Strasbourg',
  'Toulouse FC':'Toulouse',                      'Toulouse':'Toulouse',
  'FC Nantes':'Nantes',                          'Nantes':'Nantes',
  'Stade de Reims':'Reims',                      'Reims':'Reims',
  'Stade Brestois 29':'Brest',                   'Brest':'Brest',
  'RC Lens':'Lens',                              'Lens':'Lens',
  'AJ Auxerre':'Auxerre',                        'Auxerre':'Auxerre',
  'Angers SCO':'Angers',                         'Angers':'Angers',
  'Le Havre AC':'Le Havre',                      'LeHavre':'Le Havre','Le Havre':'Le Havre',
  'Montpellier HSC':'Montpellier',               'Montpellier':'Montpellier',
  'AS Saint-Étienne':'Saint-Etienne',            'StEtienne':'Saint-Etienne',
  'Saint-Etienne':'Saint-Etienne',
  'FC Lorient':'Lorient',                        'Lorient':'Lorient',
};

/* ---------- NB1 static entries (no free feed) ---------------- */
const NB1_TEAMS = {
  'Ferencvaros':     { league: 'NB1', elo: 1720, atk: 1.40, def: 0.85, form:  0.05, xg_for: 1.90, xg_ag: 1.00, inj: 0.05, xg_source: 'manual' },
  'Puskas Akademia': { league: 'NB1', elo: 1620, atk: 1.20, def: 0.95, form:  0.03, xg_for: 1.55, xg_ag: 1.15, inj: 0.05, xg_source: 'manual' },
  'Paks':            { league: 'NB1', elo: 1600, atk: 1.15, def: 0.95, form:  0.02, xg_for: 1.50, xg_ag: 1.15, inj: 0.05, xg_source: 'manual' },
  'MTK':             { league: 'NB1', elo: 1540, atk: 1.00, def: 1.05, form:  0.00, xg_for: 1.25, xg_ag: 1.35, inj: 0.05, xg_source: 'manual' },
  'Debrecen':        { league: 'NB1', elo: 1540, atk: 0.95, def: 1.05, form: -0.01, xg_for: 1.20, xg_ag: 1.40, inj: 0.05, xg_source: 'manual' },
  'Ujpest':          { league: 'NB1', elo: 1550, atk: 0.95, def: 1.00, form:  0.00, xg_for: 1.20, xg_ag: 1.30, inj: 0.05, xg_source: 'manual' },
  'Kecskemet':       { league: 'NB1', elo: 1520, atk: 0.90, def: 1.05, form: -0.01, xg_for: 1.15, xg_ag: 1.40, inj: 0.05, xg_source: 'manual' },
  'Gyor':            { league: 'NB1', elo: 1540, atk: 0.95, def: 1.05, form:  0.00, xg_for: 1.20, xg_ag: 1.40, inj: 0.05, xg_source: 'manual' },
  'ZTE':             { league: 'NB1', elo: 1530, atk: 0.90, def: 1.08, form: -0.02, xg_for: 1.15, xg_ag: 1.45, inj: 0.05, xg_source: 'manual' },
  'Diosgyor':        { league: 'NB1', elo: 1510, atk: 0.85, def: 1.10, form: -0.03, xg_for: 1.05, xg_ag: 1.45, inj: 0.06, xg_source: 'manual' },
  'Nyiregyhaza':     { league: 'NB1', elo: 1500, atk: 0.85, def: 1.15, form: -0.04, xg_for: 1.00, xg_ag: 1.55, inj: 0.06, xg_source: 'manual' },
};

/* ---------- user-facing alias map --------------------------- */
const TEAM_ALIASES = {
  'Man City':'Manchester City', 'Man Utd':'Manchester United', 'MU':'Manchester United',
  'Spurs':'Tottenham', "Nott'm Forest":'Nottingham Forest',
  'Atleti':'Atletico Madrid', 'Atletico':'Atletico Madrid',
  'Real':'Real Madrid', 'Barca':'Barcelona',
  'BVB':'Borussia Dortmund', 'Gladbach':'Borussia Monchengladbach',
  'Bayern':'Bayern Munich', 'Leverkusen':'Bayer Leverkusen',
  'PSG':'Paris Saint-Germain', 'Fradi':'Ferencvaros', 'FTC':'Ferencvaros',
};

/* ---------- helpers ---------------------------------------- */
function canonicalName(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (NAME_MAP[trimmed]) return NAME_MAP[trimmed];
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
async function fetchText(url, headers = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  return res.text();
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ---------- ClubElo ---------------------------------------- */
async function getClubEloMap() {
  const today = new Date().toISOString().slice(0, 10);
  const csv = await fetchText(`${CLUBELO_BASE}/${today}`);
  const lines = csv.trim().split('\n');
  const header = lines.shift();
  const cols = header.split(',').map(s => s.trim());
  const idxClub = cols.indexOf('Club');
  const idxElo  = cols.indexOf('Elo');
  if (idxClub < 0 || idxElo < 0) throw new Error('Unexpected ClubElo CSV header');

  const out = {};
  for (const line of lines) {
    const parts = line.split(',');
    const name = canonicalName(parts[idxClub]);
    const elo  = parseFloat(parts[idxElo]);
    if (name && Number.isFinite(elo)) out[name] = Math.round(elo);
  }
  return out;
}

/* ---------- football-data.org ------------------------------ */
async function getFinishedMatches(code) {
  const data = await fetchJson(
    `${FD_BASE}/competitions/${code}/matches?status=FINISHED`,
    { 'X-Auth-Token': FD_TOKEN }
  );
  return data.matches || [];
}

/* ---------- Understat xG ------------------------------------
   Parses the embedded `teamsData` JSON from Understat's league page.
   Each team has a `history` array with per-match { h_a, xG, xGA, date }.
   ----------------------------------------------------------- */
function unescapeUnderstat(s) {
  // Understat encodes JSON with \xNN escapes inside a JS string literal
  return s.replace(/\\x([0-9a-fA-F]{2})/g,
                   (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

async function getUnderstatXG(slug) {
  const html = await fetchText(`${UNDERSTAT_BASE}/${slug}`, {
    'User-Agent': 'Mozilla/5.0 (compatible; ai-sportsbet/1.0; +https://github.com/dl-invest/AI-sportsbet)'
  });
  const m = html.match(/var\s+teamsData\s*=\s*JSON\.parse\(\s*'([^']+)'\s*\)/);
  if (!m) throw new Error(`teamsData not found on Understat/${slug}`);
  const decoded = unescapeUnderstat(m[1]);
  const data = JSON.parse(decoded);

  const now = Date.now();
  const LAMBDA = 0.003;
  const out = {};

  for (const t of Object.values(data)) {
    const name = canonicalName(t.title);
    if (!name) continue;

    let wH=0, wA=0, xgF_h=0, xgA_h=0, xgF_a=0, xgA_a=0;

    for (const g of t.history || []) {
      const xg  = parseFloat(g.xG);
      const xga = parseFloat(g.xGA);
      if (!Number.isFinite(xg) || !Number.isFinite(xga)) continue;
      const days = Math.max(0, (now - new Date(g.date).getTime()) / 86_400_000);
      const w = Math.exp(-LAMBDA * days);

      if (g.h_a === 'h') { wH += w; xgF_h += w*xg; xgA_h += w*xga; }
      else                { wA += w; xgF_a += w*xg; xgA_a += w*xga; }
    }

    if (wH + wA === 0) continue;

    out[name] = {
      xg_for_home: wH > 0 ? xgF_h / wH : null,
      xg_ag_home:  wH > 0 ? xgA_h / wH : null,
      xg_for_away: wA > 0 ? xgF_a / wA : null,
      xg_ag_away:  wA > 0 ? xgA_a / wA : null,
      xg_for: (xgF_h + xgF_a) / (wH + wA),
      xg_ag:  (xgA_h + xgA_a) / (wH + wA),
    };
  }
  return out;
}

/* ---------- per-league stat computation -------------------- */
function computeLeagueStats(matches, leagueKey) {
  const now = Date.now();
  const LAMBDA = 0.003;
  const byTeam = {};
  let totH = 0, totA = 0, totN = 0;

  for (const m of matches) {
    const hg = m.score?.fullTime?.home;
    const ag = m.score?.fullTime?.away;
    if (hg == null || ag == null) continue;

    const days = Math.max(0, (now - new Date(m.utcDate).getTime()) / 86_400_000);
    const w = Math.exp(-LAMBDA * days);

    const h = canonicalName(m.homeTeam?.name);
    const a = canonicalName(m.awayTeam?.name);
    if (!h || !a) continue;

    totH += hg; totA += ag; totN += 1;

    byTeam[h] ||= { wH:0, gfH:0, gaH:0, wA:0, gfA:0, gaA:0, recent:[] };
    byTeam[a] ||= { wH:0, gfH:0, gaH:0, wA:0, gfA:0, gaA:0, recent:[] };

    byTeam[h].wH += w;   byTeam[h].gfH += w*hg;   byTeam[h].gaH += w*ag;
    byTeam[a].wA += w;   byTeam[a].gfA += w*ag;   byTeam[a].gaA += w*hg;

    byTeam[h].recent.push({ days, result: hg>ag?'W':hg<ag?'L':'D' });
    byTeam[a].recent.push({ days, result: ag>hg?'W':ag<hg?'L':'D' });
  }

  if (totN === 0) return { teams:{}, mu_home:1.5, mu_away:1.2 };

  const mu_home = totH / totN;
  const mu_away = totA / totN;

  const teams = {};
  for (const [name, s] of Object.entries(byTeam)) {
    if (s.wH < 0.5 || s.wA < 0.5) continue;

    const gfH_pg = s.gfH / s.wH;
    const gaH_pg = s.gaH / s.wH;
    const gfA_pg = s.gfA / s.wA;
    const gaA_pg = s.gaA / s.wA;

    // --- split strengths: each team's attack/defense at home AND away
    const atk_home = gfH_pg / mu_home;   // home scoring vs league home avg
    const atk_away = gfA_pg / mu_away;   // away scoring vs league away avg
    const def_home = gaH_pg / mu_away;   // home conceded vs away-team avg
    const def_away = gaA_pg / mu_home;   // away conceded vs home-team avg

    // --- averaged (kept for legacy / fallback)
    const atk = (atk_home + atk_away) / 2;
    const def = (def_home + def_away) / 2;

    // --- form (last 5 matches by recency)
    s.recent.sort((a,b) => a.days - b.days);
    const last5 = s.recent.slice(0, 5);
    let form = 0;
    if (last5.length) {
      const pts = last5.reduce((acc, r) =>
        acc + (r.result === 'W' ? 1 : r.result === 'L' ? -1 : 0), 0);
      form = (pts / last5.length) * 0.12;
    }

    // --- xG proxy from goals (replaced later if Understat has data)
    const xg_for = (gfH_pg + gfA_pg) / 2;
    const xg_ag  = (gaH_pg + gaA_pg) / 2;

    teams[name] = {
      league:   leagueKey,
      atk_home: round(atk_home, 3),
      atk_away: round(atk_away, 3),
      def_home: round(def_home, 3),
      def_away: round(def_away, 3),
      atk:      round(atk, 3),
      def:      round(def, 3),
      form:     round(form, 3),
      xg_for:   round(xg_for, 2),
      xg_ag:    round(xg_ag, 2),
      xg_source:'proxy',
      inj:      0.05,
    };
  }

  return { teams, mu_home: round(mu_home, 3), mu_away: round(mu_away, 3) };
}

/* ---------- main ------------------------------------------- */
async function main() {
  console.log('[1/4] Fetching ClubElo ratings…');
  const eloMap = await getClubEloMap();
  console.log(`      → ${Object.keys(eloMap).length} clubs`);

  const allTeams = {};
  const leagueAvgs = {};

  console.log('[2/4] Fetching FD matches and computing stats…');
  for (const [key, cfg] of Object.entries(LEAGUES)) {
    console.log(`  - ${key} (${cfg.fdCode})`);
    try {
      const matches = await getFinishedMatches(cfg.fdCode);
      const { teams, mu_home, mu_away } = computeLeagueStats(matches, key);
      leagueAvgs[key] = { home: mu_home, away: mu_away };

      for (const [name, s] of Object.entries(teams)) {
        const elo = eloMap[name] ?? 1600;
        allTeams[name] = { elo, ...s };
      }
      console.log(`      → ${matches.length} matches, ${Object.keys(teams).length} teams, μH=${mu_home}, μA=${mu_away}`);
    } catch (e) {
      console.error(`      ! ${key} FD failed: ${e.message}`);
    }
    await sleep(7000); // FD rate-limit
  }

  console.log('[3/4] Enriching with Understat xG…');
  for (const [key, cfg] of Object.entries(LEAGUES)) {
    console.log(`  - ${key} (Understat/${cfg.understat})`);
    try {
      const xgMap = await getUnderstatXG(cfg.understat);
      let merged = 0;
      for (const [name, xg] of Object.entries(xgMap)) {
        if (allTeams[name]) {
          allTeams[name].xg_for = round(xg.xg_for, 2);
          allTeams[name].xg_ag  = round(xg.xg_ag,  2);
          if (xg.xg_for_home != null) allTeams[name].xg_for_home = round(xg.xg_for_home, 2);
          if (xg.xg_for_away != null) allTeams[name].xg_for_away = round(xg.xg_for_away, 2);
          if (xg.xg_ag_home  != null) allTeams[name].xg_ag_home  = round(xg.xg_ag_home,  2);
          if (xg.xg_ag_away  != null) allTeams[name].xg_ag_away  = round(xg.xg_ag_away,  2);
          allTeams[name].xg_source = 'understat';
          merged++;
        }
      }
      console.log(`      → ${Object.keys(xgMap).length} teams on page, ${merged} merged`);
    } catch (e) {
      console.error(`      ! ${key} Understat failed: ${e.message}`);
      // not fatal — proxy xG stays
    }
    await sleep(3000);
  }

  // static entries
  leagueAvgs.NB1   = { home: 1.45, away: 1.15 };
  leagueAvgs.UCL   = { home: 1.60, away: 1.30 };
  leagueAvgs.OTHER = { home: 1.50, away: 1.20 };
  Object.assign(allTeams, NB1_TEAMS);

  console.log(`[4/4] Writing ${path.relative(process.cwd(), OUTPUT_FILE)}`);
  writeTeamsFile(allTeams, leagueAvgs);

  const understatCount = Object.values(allTeams).filter(t => t.xg_source === 'understat').length;
  console.log(`      → ${Object.keys(allTeams).length} total teams (${understatCount} with real xG)`);
}

function writeTeamsFile(teams, avgs) {
  const ts = new Date().toISOString();
  const header =
`/* =============================================================
   AUTO-GENERATED by scripts/update-teams.js
   Last run: ${ts}
   Sources:  football-data.org + api.clubelo.com + understat.com
   Schema v2: per-team atk_home/atk_away/def_home/def_away split
              + real xG when xg_source === "understat".
   DO NOT EDIT — this file is overwritten nightly.
   ============================================================= */

`;
  let body = `const LEAGUE_AVG = ${JSON.stringify(avgs, null, 2)};\n\n`;

  body += 'const TEAMS = {\n';
  for (const name of Object.keys(teams).sort((a,b) => a.localeCompare(b))) {
    body += `  ${JSON.stringify(name)}: ${JSON.stringify(teams[name])},\n`;
  }
  body += '};\n\n';

  body += `const TEAM_ALIASES = ${JSON.stringify(TEAM_ALIASES, null, 2)};\n`;
  fs.writeFileSync(OUTPUT_FILE, header + body, 'utf8');
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
