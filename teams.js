/* ==============================================================
   TEAM DATABASE
   Approximate, publicly-known style ratings used by the model:
     elo     — base Elo rating (club-level)
     atk     — attacking strength multiplier (1.0 = league average)
     def     — defensive strength multiplier (1.0 = league avg; lower = better)
     form    — recent-form modifier in [-0.15 .. +0.15]
     xg_for  — recent avg xG per match
     xg_ag   — recent avg xG allowed per match
     inj     — cumulative injury/absence impact [0 .. 0.3]
   Values are approximations derived from widely-known public form/rating
   sources (ClubElo-style). Used as priors — not authoritative stats.
   ============================================================== */

const LEAGUE_AVG = {
  EPL:    { home: 1.55, away: 1.25 },
  LALIGA: { home: 1.45, away: 1.15 },
  SERIEA: { home: 1.50, away: 1.20 },
  BUNDES: { home: 1.65, away: 1.35 },
  LIGUE1: { home: 1.50, away: 1.20 },
  NB1:    { home: 1.45, away: 1.15 },
  UCL:    { home: 1.60, away: 1.30 },
  OTHER:  { home: 1.50, away: 1.20 }
};

const TEAMS = {
  // ---------- PREMIER LEAGUE ----------
  "Manchester City":     { league: "EPL", elo: 2010, atk: 1.55, def: 0.75, form: 0.08,  xg_for: 2.35, xg_ag: 1.05, inj: 0.05 },
  "Arsenal":             { league: "EPL", elo: 1965, atk: 1.40, def: 0.78, form: 0.10,  xg_for: 2.05, xg_ag: 1.00, inj: 0.04 },
  "Liverpool":           { league: "EPL", elo: 1975, atk: 1.50, def: 0.85, form: 0.09,  xg_for: 2.20, xg_ag: 1.15, inj: 0.04 },
  "Manchester United":   { league: "EPL", elo: 1820, atk: 1.15, def: 1.02, form: -0.03, xg_for: 1.55, xg_ag: 1.45, inj: 0.07 },
  "Chelsea":             { league: "EPL", elo: 1850, atk: 1.25, def: 0.95, form: 0.04,  xg_for: 1.75, xg_ag: 1.25, inj: 0.06 },
  "Tottenham":           { league: "EPL", elo: 1860, atk: 1.30, def: 1.00, form: 0.02,  xg_for: 1.85, xg_ag: 1.40, inj: 0.05 },
  "Newcastle":           { league: "EPL", elo: 1830, atk: 1.20, def: 0.92, form: 0.03,  xg_for: 1.70, xg_ag: 1.20, inj: 0.05 },
  "Aston Villa":         { league: "EPL", elo: 1835, atk: 1.25, def: 0.98, form: 0.05,  xg_for: 1.80, xg_ag: 1.30, inj: 0.04 },
  "Brighton":            { league: "EPL", elo: 1770, atk: 1.10, def: 1.02, form: 0.00,  xg_for: 1.55, xg_ag: 1.45, inj: 0.04 },
  "West Ham":            { league: "EPL", elo: 1745, atk: 1.05, def: 1.10, form: -0.02, xg_for: 1.40, xg_ag: 1.55, inj: 0.06 },
  "Crystal Palace":      { league: "EPL", elo: 1715, atk: 0.95, def: 1.05, form: 0.01,  xg_for: 1.25, xg_ag: 1.40, inj: 0.04 },
  "Fulham":              { league: "EPL", elo: 1720, atk: 1.00, def: 1.05, form: 0.00,  xg_for: 1.35, xg_ag: 1.45, inj: 0.04 },
  "Brentford":           { league: "EPL", elo: 1710, atk: 1.00, def: 1.08, form: -0.01, xg_for: 1.30, xg_ag: 1.50, inj: 0.05 },
  "Everton":             { league: "EPL", elo: 1690, atk: 0.90, def: 1.05, form: -0.02, xg_for: 1.15, xg_ag: 1.45, inj: 0.06 },
  "Wolves":              { league: "EPL", elo: 1695, atk: 0.95, def: 1.05, form: -0.01, xg_for: 1.20, xg_ag: 1.45, inj: 0.05 },
  "Nottingham Forest":   { league: "EPL", elo: 1685, atk: 0.95, def: 1.12, form: -0.01, xg_for: 1.15, xg_ag: 1.55, inj: 0.05 },
  "Bournemouth":         { league: "EPL", elo: 1680, atk: 0.95, def: 1.15, form: 0.00,  xg_for: 1.20, xg_ag: 1.60, inj: 0.05 },
  "Leicester":           { league: "EPL", elo: 1660, atk: 0.90, def: 1.18, form: -0.03, xg_for: 1.05, xg_ag: 1.65, inj: 0.06 },
  "Ipswich":             { league: "EPL", elo: 1580, atk: 0.80, def: 1.25, form: -0.05, xg_for: 0.95, xg_ag: 1.80, inj: 0.06 },
  "Southampton":         { league: "EPL", elo: 1570, atk: 0.75, def: 1.30, form: -0.08, xg_for: 0.85, xg_ag: 1.90, inj: 0.07 },

  // ---------- LA LIGA ----------
  "Real Madrid":         { league: "LALIGA", elo: 2020, atk: 1.55, def: 0.78, form: 0.10,  xg_for: 2.25, xg_ag: 0.95, inj: 0.05 },
  "Barcelona":           { league: "LALIGA", elo: 1970, atk: 1.50, def: 0.85, form: 0.08,  xg_for: 2.10, xg_ag: 1.05, inj: 0.06 },
  "Atletico Madrid":     { league: "LALIGA", elo: 1910, atk: 1.30, def: 0.80, form: 0.06,  xg_for: 1.75, xg_ag: 0.95, inj: 0.05 },
  "Athletic Bilbao":     { league: "LALIGA", elo: 1800, atk: 1.20, def: 0.95, form: 0.04,  xg_for: 1.55, xg_ag: 1.15, inj: 0.05 },
  "Real Sociedad":       { league: "LALIGA", elo: 1790, atk: 1.15, def: 0.95, form: 0.02,  xg_for: 1.50, xg_ag: 1.15, inj: 0.05 },
  "Villarreal":          { league: "LALIGA", elo: 1760, atk: 1.15, def: 1.02, form: 0.01,  xg_for: 1.45, xg_ag: 1.30, inj: 0.05 },
  "Real Betis":          { league: "LALIGA", elo: 1750, atk: 1.10, def: 1.05, form: 0.00,  xg_for: 1.40, xg_ag: 1.35, inj: 0.05 },
  "Sevilla":             { league: "LALIGA", elo: 1740, atk: 1.00, def: 1.05, form: -0.01, xg_for: 1.25, xg_ag: 1.35, inj: 0.06 },
  "Valencia":            { league: "LALIGA", elo: 1700, atk: 0.95, def: 1.08, form: -0.02, xg_for: 1.15, xg_ag: 1.40, inj: 0.05 },
  "Girona":              { league: "LALIGA", elo: 1745, atk: 1.15, def: 1.05, form: 0.02,  xg_for: 1.45, xg_ag: 1.35, inj: 0.05 },
  "Osasuna":             { league: "LALIGA", elo: 1700, atk: 0.95, def: 1.05, form: 0.00,  xg_for: 1.15, xg_ag: 1.35, inj: 0.04 },
  "Celta Vigo":          { league: "LALIGA", elo: 1690, atk: 1.00, def: 1.10, form: 0.00,  xg_for: 1.20, xg_ag: 1.45, inj: 0.05 },
  "Getafe":              { league: "LALIGA", elo: 1680, atk: 0.85, def: 1.05, form: -0.01, xg_for: 1.00, xg_ag: 1.35, inj: 0.04 },
  "Rayo Vallecano":      { league: "LALIGA", elo: 1690, atk: 0.95, def: 1.08, form: 0.00,  xg_for: 1.15, xg_ag: 1.40, inj: 0.05 },
  "Mallorca":            { league: "LALIGA", elo: 1680, atk: 0.90, def: 1.05, form: 0.00,  xg_for: 1.10, xg_ag: 1.35, inj: 0.05 },
  "Las Palmas":          { league: "LALIGA", elo: 1660, atk: 0.90, def: 1.15, form: -0.02, xg_for: 1.05, xg_ag: 1.55, inj: 0.05 },
  "Alaves":              { league: "LALIGA", elo: 1650, atk: 0.85, def: 1.15, form: -0.02, xg_for: 1.00, xg_ag: 1.55, inj: 0.05 },
  "Espanyol":            { league: "LALIGA", elo: 1640, atk: 0.85, def: 1.15, form: -0.02, xg_for: 1.00, xg_ag: 1.55, inj: 0.05 },
  "Leganes":             { league: "LALIGA", elo: 1610, atk: 0.80, def: 1.18, form: -0.03, xg_for: 0.95, xg_ag: 1.65, inj: 0.05 },
  "Valladolid":          { league: "LALIGA", elo: 1590, atk: 0.80, def: 1.22, form: -0.04, xg_for: 0.90, xg_ag: 1.70, inj: 0.06 },

  // ---------- SERIE A ----------
  "Inter":               { league: "SERIEA", elo: 1950, atk: 1.50, def: 0.80, form: 0.08,  xg_for: 2.10, xg_ag: 1.00, inj: 0.05 },
  "AC Milan":            { league: "SERIEA", elo: 1870, atk: 1.35, def: 0.95, form: 0.03,  xg_for: 1.85, xg_ag: 1.20, inj: 0.05 },
  "Juventus":            { league: "SERIEA", elo: 1880, atk: 1.25, def: 0.85, form: 0.04,  xg_for: 1.70, xg_ag: 1.05, inj: 0.05 },
  "Napoli":              { league: "SERIEA", elo: 1880, atk: 1.35, def: 0.90, form: 0.05,  xg_for: 1.85, xg_ag: 1.15, inj: 0.05 },
  "Atalanta":            { league: "SERIEA", elo: 1880, atk: 1.45, def: 0.95, form: 0.06,  xg_for: 2.00, xg_ag: 1.25, inj: 0.06 },
  "Roma":                { league: "SERIEA", elo: 1810, atk: 1.20, def: 1.00, form: 0.01,  xg_for: 1.60, xg_ag: 1.30, inj: 0.06 },
  "Lazio":               { league: "SERIEA", elo: 1800, atk: 1.15, def: 1.00, form: 0.00,  xg_for: 1.55, xg_ag: 1.30, inj: 0.05 },
  "Bologna":             { league: "SERIEA", elo: 1770, atk: 1.10, def: 0.95, form: 0.02,  xg_for: 1.45, xg_ag: 1.20, inj: 0.05 },
  "Fiorentina":          { league: "SERIEA", elo: 1755, atk: 1.10, def: 1.02, form: 0.01,  xg_for: 1.45, xg_ag: 1.35, inj: 0.05 },
  "Torino":              { league: "SERIEA", elo: 1710, atk: 0.95, def: 1.00, form: 0.00,  xg_for: 1.15, xg_ag: 1.30, inj: 0.05 },
  "Udinese":             { league: "SERIEA", elo: 1700, atk: 0.95, def: 1.05, form: -0.01, xg_for: 1.15, xg_ag: 1.35, inj: 0.05 },
  "Genoa":               { league: "SERIEA", elo: 1680, atk: 0.90, def: 1.08, form: -0.01, xg_for: 1.10, xg_ag: 1.40, inj: 0.05 },
  "Hellas Verona":       { league: "SERIEA", elo: 1660, atk: 0.90, def: 1.15, form: -0.02, xg_for: 1.05, xg_ag: 1.50, inj: 0.05 },
  "Lecce":               { league: "SERIEA", elo: 1650, atk: 0.85, def: 1.18, form: -0.03, xg_for: 1.00, xg_ag: 1.55, inj: 0.05 },
  "Empoli":              { league: "SERIEA", elo: 1660, atk: 0.85, def: 1.10, form: -0.02, xg_for: 1.00, xg_ag: 1.45, inj: 0.05 },
  "Cagliari":            { league: "SERIEA", elo: 1650, atk: 0.85, def: 1.15, form: -0.02, xg_for: 1.00, xg_ag: 1.50, inj: 0.05 },
  "Parma":               { league: "SERIEA", elo: 1640, atk: 0.85, def: 1.15, form: -0.02, xg_for: 1.00, xg_ag: 1.55, inj: 0.05 },
  "Venezia":             { league: "SERIEA", elo: 1600, atk: 0.80, def: 1.20, form: -0.04, xg_for: 0.90, xg_ag: 1.65, inj: 0.06 },
  "Monza":               { league: "SERIEA", elo: 1650, atk: 0.85, def: 1.12, form: -0.02, xg_for: 1.00, xg_ag: 1.50, inj: 0.05 },
  "Como":                { league: "SERIEA", elo: 1640, atk: 0.85, def: 1.15, form: -0.02, xg_for: 1.00, xg_ag: 1.55, inj: 0.05 },

  // ---------- BUNDESLIGA ----------
  "Bayern Munich":       { league: "BUNDES", elo: 1980, atk: 1.60, def: 0.80, form: 0.09,  xg_for: 2.60, xg_ag: 1.10, inj: 0.05 },
  "Bayer Leverkusen":    { league: "BUNDES", elo: 1960, atk: 1.55, def: 0.85, form: 0.08,  xg_for: 2.40, xg_ag: 1.15, inj: 0.04 },
  "Borussia Dortmund":   { league: "BUNDES", elo: 1870, atk: 1.35, def: 1.00, form: 0.02,  xg_for: 2.00, xg_ag: 1.40, inj: 0.06 },
  "RB Leipzig":          { league: "BUNDES", elo: 1880, atk: 1.35, def: 0.95, form: 0.04,  xg_for: 2.00, xg_ag: 1.30, inj: 0.05 },
  "Eintracht Frankfurt": { league: "BUNDES", elo: 1800, atk: 1.20, def: 1.00, form: 0.03,  xg_for: 1.70, xg_ag: 1.40, inj: 0.05 },
  "VfB Stuttgart":       { league: "BUNDES", elo: 1830, atk: 1.25, def: 0.95, form: 0.02,  xg_for: 1.80, xg_ag: 1.30, inj: 0.05 },
  "Hoffenheim":          { league: "BUNDES", elo: 1720, atk: 1.05, def: 1.15, form: -0.01, xg_for: 1.45, xg_ag: 1.65, inj: 0.05 },
  "Werder Bremen":       { league: "BUNDES", elo: 1700, atk: 1.00, def: 1.15, form: -0.01, xg_for: 1.40, xg_ag: 1.60, inj: 0.05 },
  "Wolfsburg":           { league: "BUNDES", elo: 1720, atk: 1.00, def: 1.05, form: 0.00,  xg_for: 1.40, xg_ag: 1.50, inj: 0.05 },
  "Borussia Monchengladbach": { league: "BUNDES", elo: 1710, atk: 1.00, def: 1.10, form: -0.01, xg_for: 1.40, xg_ag: 1.55, inj: 0.05 },
  "Mainz":               { league: "BUNDES", elo: 1690, atk: 0.95, def: 1.08, form: 0.00,  xg_for: 1.30, xg_ag: 1.50, inj: 0.05 },
  "FC Augsburg":         { league: "BUNDES", elo: 1690, atk: 0.90, def: 1.05, form: 0.00,  xg_for: 1.25, xg_ag: 1.45, inj: 0.05 },
  "Union Berlin":        { league: "BUNDES", elo: 1680, atk: 0.85, def: 1.05, form: -0.02, xg_for: 1.15, xg_ag: 1.45, inj: 0.06 },
  "FC Heidenheim":       { league: "BUNDES", elo: 1640, atk: 0.85, def: 1.15, form: -0.02, xg_for: 1.10, xg_ag: 1.60, inj: 0.05 },
  "St. Pauli":           { league: "BUNDES", elo: 1630, atk: 0.85, def: 1.15, form: -0.02, xg_for: 1.10, xg_ag: 1.60, inj: 0.05 },
  "Holstein Kiel":       { league: "BUNDES", elo: 1570, atk: 0.80, def: 1.25, form: -0.05, xg_for: 0.95, xg_ag: 1.80, inj: 0.06 },
  "Bochum":              { league: "BUNDES", elo: 1600, atk: 0.80, def: 1.20, form: -0.04, xg_for: 0.95, xg_ag: 1.70, inj: 0.06 },
  "SC Freiburg":         { league: "BUNDES", elo: 1730, atk: 1.00, def: 1.02, form: 0.01,  xg_for: 1.40, xg_ag: 1.45, inj: 0.05 },

  // ---------- LIGUE 1 ----------
  "Paris Saint-Germain": { league: "LIGUE1", elo: 1960, atk: 1.60, def: 0.80, form: 0.09,  xg_for: 2.40, xg_ag: 1.00, inj: 0.05 },
  "Marseille":           { league: "LIGUE1", elo: 1800, atk: 1.25, def: 0.95, form: 0.04,  xg_for: 1.75, xg_ag: 1.25, inj: 0.05 },
  "Monaco":              { league: "LIGUE1", elo: 1820, atk: 1.25, def: 0.95, form: 0.05,  xg_for: 1.80, xg_ag: 1.25, inj: 0.05 },
  "Lille":               { league: "LIGUE1", elo: 1800, atk: 1.20, def: 0.90, form: 0.03,  xg_for: 1.70, xg_ag: 1.15, inj: 0.05 },
  "Nice":                { league: "LIGUE1", elo: 1770, atk: 1.10, def: 0.90, form: 0.02,  xg_for: 1.50, xg_ag: 1.15, inj: 0.05 },
  "Lyon":                { league: "LIGUE1", elo: 1760, atk: 1.15, def: 1.00, form: 0.02,  xg_for: 1.55, xg_ag: 1.30, inj: 0.05 },
  "Rennes":              { league: "LIGUE1", elo: 1740, atk: 1.10, def: 1.00, form: 0.00,  xg_for: 1.45, xg_ag: 1.30, inj: 0.05 },
  "Strasbourg":          { league: "LIGUE1", elo: 1700, atk: 1.00, def: 1.05, form: 0.01,  xg_for: 1.30, xg_ag: 1.40, inj: 0.05 },
  "Toulouse":            { league: "LIGUE1", elo: 1690, atk: 0.95, def: 1.05, form: 0.00,  xg_for: 1.25, xg_ag: 1.40, inj: 0.05 },
  "Nantes":              { league: "LIGUE1", elo: 1680, atk: 0.90, def: 1.08, form: -0.02, xg_for: 1.15, xg_ag: 1.45, inj: 0.05 },
  "Reims":               { league: "LIGUE1", elo: 1680, atk: 0.90, def: 1.08, form: -0.01, xg_for: 1.20, xg_ag: 1.45, inj: 0.05 },
  "Brest":               { league: "LIGUE1", elo: 1750, atk: 1.10, def: 0.98, form: 0.03,  xg_for: 1.50, xg_ag: 1.30, inj: 0.05 },
  "Lens":                { league: "LIGUE1", elo: 1750, atk: 1.05, def: 0.95, form: 0.01,  xg_for: 1.40, xg_ag: 1.25, inj: 0.05 },
  "Auxerre":             { league: "LIGUE1", elo: 1650, atk: 0.85, def: 1.12, form: -0.02, xg_for: 1.05, xg_ag: 1.50, inj: 0.05 },
  "Angers":              { league: "LIGUE1", elo: 1620, atk: 0.80, def: 1.18, form: -0.03, xg_for: 0.95, xg_ag: 1.60, inj: 0.05 },
  "Le Havre":            { league: "LIGUE1", elo: 1640, atk: 0.85, def: 1.15, form: -0.02, xg_for: 1.00, xg_ag: 1.55, inj: 0.05 },
  "Montpellier":         { league: "LIGUE1", elo: 1610, atk: 0.80, def: 1.20, form: -0.04, xg_for: 0.95, xg_ag: 1.65, inj: 0.06 },
  "Saint-Etienne":       { league: "LIGUE1", elo: 1620, atk: 0.85, def: 1.18, form: -0.03, xg_for: 1.00, xg_ag: 1.60, inj: 0.06 },

  // ---------- HUNGARIAN NB I ----------
  "Ferencvaros":         { league: "NB1", elo: 1720, atk: 1.40, def: 0.85, form: 0.05,  xg_for: 1.90, xg_ag: 1.00, inj: 0.05 },
  "Puskas Akademia":     { league: "NB1", elo: 1620, atk: 1.20, def: 0.95, form: 0.03,  xg_for: 1.55, xg_ag: 1.15, inj: 0.05 },
  "Paks":                { league: "NB1", elo: 1600, atk: 1.15, def: 0.95, form: 0.02,  xg_for: 1.50, xg_ag: 1.15, inj: 0.05 },
  "MTK":                 { league: "NB1", elo: 1540, atk: 1.00, def: 1.05, form: 0.00,  xg_for: 1.25, xg_ag: 1.35, inj: 0.05 },
  "Debrecen":            { league: "NB1", elo: 1540, atk: 0.95, def: 1.05, form: -0.01, xg_for: 1.20, xg_ag: 1.40, inj: 0.05 },
  "Ujpest":              { league: "NB1", elo: 1550, atk: 0.95, def: 1.00, form: 0.00,  xg_for: 1.20, xg_ag: 1.30, inj: 0.05 },
  "Kecskemet":           { league: "NB1", elo: 1520, atk: 0.90, def: 1.05, form: -0.01, xg_for: 1.15, xg_ag: 1.40, inj: 0.05 },
  "Gyor":                { league: "NB1", elo: 1540, atk: 0.95, def: 1.05, form: 0.00,  xg_for: 1.20, xg_ag: 1.40, inj: 0.05 },
  "ZTE":                 { league: "NB1", elo: 1530, atk: 0.90, def: 1.08, form: -0.02, xg_for: 1.15, xg_ag: 1.45, inj: 0.05 },
  "Diosgyor":            { league: "NB1", elo: 1510, atk: 0.85, def: 1.10, form: -0.03, xg_for: 1.05, xg_ag: 1.45, inj: 0.06 },
  "Nyiregyhaza":         { league: "NB1", elo: 1500, atk: 0.85, def: 1.15, form: -0.04, xg_for: 1.00, xg_ag: 1.55, inj: 0.06 }
};

/* aliases so users can type common alternatives */
const TEAM_ALIASES = {
  "Man City": "Manchester City",
  "Man Utd": "Manchester United",
  "MU": "Manchester United",
  "Spurs": "Tottenham",
  "Nott'm Forest": "Nottingham Forest",
  "Atleti": "Atletico Madrid",
  "Atletico": "Atletico Madrid",
  "Real": "Real Madrid",
  "Barca": "Barcelona",
  "BVB": "Borussia Dortmund",
  "Gladbach": "Borussia Monchengladbach",
  "Bayern": "Bayern Munich",
  "Leverkusen": "Bayer Leverkusen",
  "PSG": "Paris Saint-Germain",
  "Fradi": "Ferencvaros",
  "FTC": "Ferencvaros"
};

