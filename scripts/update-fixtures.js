#!/usr/bin/env node
/* ================================================================
   DAILY FIXTURES UPDATER
   ----------------------------------------------------------------
   Fetches yesterday + today + tomorrow's matches for the top-5
   European leagues from football-data.org and writes fixtures.js.
   Triggered by a separate GitHub Actions workflow every ~6 hours
   so kick-offs, status updates (TIMED → IN_PLAY → FINISHED) are
   reflected on the site.
   Requires env:
     FOOTBALL_DATA_TOKEN
   ================================================================ */

'use strict';

const fs   = require('node:fs');
const path = require('node:path');

const FD_BASE = 'https://api.football-data.org/v4';
const OUTPUT_FILE = path.join(__dirname, '..', 'fixtures.js');
const TOKEN = process.env.FOOTBALL_DATA_TOKEN;
if (!TOKEN) {
  console.error('ERROR: FOOTBALL_DATA_TOKEN env var is required.');
  process.exit(1);
}

const LEAGUES = {
  EPL:    'PL',
  LALIGA: 'PD',
  SERIEA: 'SA',
  BUNDES: 'BL1',
  LIGUE1: 'FL1',
};

/* ---------- canonicalization (subset of update-teams.js NAME_MAP) --- */
const NAME_MAP = {
  'Manchester City FC':'Manchester City','Manchester United FC':'Manchester United',
  'Liverpool FC':'Liverpool','Arsenal FC':'Arsenal','Chelsea FC':'Chelsea',
  'Tottenham Hotspur FC':'Tottenham','Newcastle United FC':'Newcastle',
  'Aston Villa FC':'Aston Villa','Brighton & Hove Albion FC':'Brighton',
  'West Ham United FC':'West Ham','Crystal Palace FC':'Crystal Palace',
  'Fulham FC':'Fulham','Brentford FC':'Brentford','Everton FC':'Everton',
  'Wolverhampton Wanderers FC':'Wolves','Nottingham Forest FC':'Nottingham Forest',
  'AFC Bournemouth':'Bournemouth','Leicester City FC':'Leicester',
  'Ipswich Town FC':'Ipswich','Southampton FC':'Southampton',
  'Leeds United FC':'Leeds United','Burnley FC':'Burnley',

  'Real Madrid CF':'Real Madrid','FC Barcelona':'Barcelona',
  'Club Atlético de Madrid':'Atletico Madrid','Athletic Club':'Athletic Bilbao',
  'Real Sociedad de Fútbol':'Real Sociedad','Villarreal CF':'Villarreal',
  'Real Betis Balompié':'Real Betis','Sevilla FC':'Sevilla','Valencia CF':'Valencia',
  'Girona FC':'Girona','CA Osasuna':'Osasuna','RC Celta de Vigo':'Celta Vigo',
  'Getafe CF':'Getafe','Rayo Vallecano de Madrid':'Rayo Vallecano',
  'RCD Mallorca':'Mallorca','UD Las Palmas':'Las Palmas','Deportivo Alavés':'Alaves',
  'RCD Espanyol de Barcelona':'Espanyol','CD Leganés':'Leganes',
  'Real Valladolid CF':'Valladolid','Elche CF':'Elche','Levante UD':'Levante UD',

  'FC Internazionale Milano':'Inter','AC Milan':'AC Milan','Juventus FC':'Juventus',
  'SSC Napoli':'Napoli','Atalanta BC':'Atalanta','AS Roma':'Roma','SS Lazio':'Lazio',
  'Bologna FC 1909':'Bologna','ACF Fiorentina':'Fiorentina','Torino FC':'Torino',
  'Udinese Calcio':'Udinese','Genoa CFC':'Genoa','Hellas Verona FC':'Hellas Verona',
  'US Lecce':'Lecce','Empoli FC':'Empoli','Cagliari Calcio':'Cagliari',
  'Parma Calcio 1913':'Parma','Venezia FC':'Venezia','AC Monza':'Monza','Como 1907':'Como',

  'FC Bayern München':'Bayern Munich','Bayer 04 Leverkusen':'Bayer Leverkusen',
  'Borussia Dortmund':'Borussia Dortmund','RB Leipzig':'RB Leipzig',
  'Eintracht Frankfurt':'Eintracht Frankfurt','VfB Stuttgart':'VfB Stuttgart',
  'TSG 1899 Hoffenheim':'Hoffenheim','SV Werder Bremen':'Werder Bremen',
  'VfL Wolfsburg':'Wolfsburg','Borussia Mönchengladbach':'Borussia Monchengladbach',
  '1. FSV Mainz 05':'Mainz','FC Augsburg':'FC Augsburg',
  '1. FC Union Berlin':'Union Berlin','1. FC Heidenheim 1846':'FC Heidenheim',
  'FC St. Pauli 1910':'St. Pauli','Holstein Kiel':'Holstein Kiel',
  'VfL Bochum 1848':'Bochum','Sport-Club Freiburg':'SC Freiburg',
  '1. FC Köln':'1. FC Köln','Hamburger SV':'Hamburger SV',

  'Paris Saint-Germain FC':'Paris Saint-Germain','Olympique de Marseille':'Marseille',
  'AS Monaco FC':'Monaco','LOSC Lille':'Lille','OGC Nice':'Nice',
  'Olympique Lyonnais':'Lyon','Stade Rennais FC 1901':'Rennes',
  'RC Strasbourg Alsace':'Strasbourg','Toulouse FC':'Toulouse','FC Nantes':'Nantes',
  'Stade de Reims':'Reims','Stade Brestois 29':'Brest','RC Lens':'Lens',
  'AJ Auxerre':'Auxerre','Angers SCO':'Angers','Le Havre AC':'Le Havre',
  'Montpellier HSC':'Montpellier','AS Saint-Étienne':'Saint-Etienne','FC Lorient':'Lorient',
};

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

/* ---------- helpers ---------------------------------------- */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function dateRange() {
  const now = new Date();
  const start = new Date(now); start.setUTCDate(start.getUTCDate() - 1);
  const end   = new Date(now); end.setUTCDate(end.getUTCDate() + 2);
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

async function getFixtures(code, range) {
  const url = `${FD_BASE}/competitions/${code}/matches?dateFrom=${range.from}&dateTo=${range.to}`;
  const res = await fetch(url, { headers: { 'X-Auth-Token': TOKEN } });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  const data = await res.json();
  return data.matches || [];
}

/* ---------- main ------------------------------------------- */
async function main() {
  const range = dateRange();
  console.log(`Fetching fixtures ${range.from} .. ${range.to}`);

  const out = [];
  for (const [key, code] of Object.entries(LEAGUES)) {
    try {
      const matches = await getFixtures(code, range);
      for (const m of matches) {
        const home = canonicalName(m.homeTeam?.name || m.homeTeam?.shortName);
        const away = canonicalName(m.awayTeam?.name || m.awayTeam?.shortName);
        if (!home || !away) continue;
        out.push({
          id:        m.id,
          league:    key,
          utcDate:   m.utcDate,
          status:    m.status,
          matchday:  m.matchday ?? null,
          home, away,
          homeRaw:   m.homeTeam?.name || null,
          awayRaw:   m.awayTeam?.name || null,
          score:     (m.score?.fullTime?.home != null && m.score?.fullTime?.away != null)
                     ? { home: m.score.fullTime.home, away: m.score.fullTime.away }
                     : null,
        });
      }
      console.log(`  ${key}: ${matches.length} fixtures`);
    } catch (e) {
      console.error(`  ${key} failed: ${e.message}`);
    }
    await sleep(7000); // FD free-tier rate limit
  }

  out.sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));

  const ts = new Date().toISOString();
  const body =
`/* =============================================================
   AUTO-GENERATED by scripts/update-fixtures.js
   Last run: ${ts}
   Range:    ${range.from} .. ${range.to}
   DO NOT EDIT — overwritten every ~6 hours.
   ============================================================= */

const FIXTURES_UPDATED = ${JSON.stringify(ts)};
const FIXTURES = ${JSON.stringify(out, null, 2)};
`;
  fs.writeFileSync(OUTPUT_FILE, body, 'utf8');
  console.log(`Wrote ${out.length} fixtures → ${path.relative(process.cwd(), OUTPUT_FILE)}`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
