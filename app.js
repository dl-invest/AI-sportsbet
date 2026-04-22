/* ==============================================================
   UI GLUE
   ============================================================== */

document.addEventListener("DOMContentLoaded", () => {
  // populate datalist
  const dl = document.getElementById("teams");
  const names = Object.keys(TEAMS).sort();
  for (const n of names) {
    const opt = document.createElement("option");
    opt.value = n;
    dl.appendChild(opt);
  }

  // default today's date
  const today = new Date();
  const iso = today.toISOString().slice(0, 10);
  document.getElementById("match-date").value = iso;

  document.getElementById("predict-form").addEventListener("submit", onSubmit);
  document.getElementById("toggle-breakdown").addEventListener("click", toggleBreakdown);

  // fixtures + betslip
  initFixtures();
});

function onSubmit(e) {
  e.preventDefault();
  const league = document.getElementById("league").value;
  const date = document.getElementById("match-date").value;
  const home = document.getElementById("home-team").value.trim();
  const away = document.getElementById("away-team").value.trim();

  if (!league || !date || !home || !away) return;
  if (home.toLowerCase() === away.toLowerCase()) {
    alert("A hazai és vendég csapat nem egyezhet meg.");
    return;
  }

  const res = predictMatch({ league, date, home, away });
  renderResult(res);
  renderBreakdown(res);
  document.getElementById("result").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------- RESULT ---------- */
function renderResult(r) {
  const panel = document.getElementById("result");
  const body = document.getElementById("result-body");
  panel.classList.remove("hidden");

  const pct = (x) => (x * 100).toFixed(1) + "%";
  const { pHome, pDraw, pAway } = r.ensemble;
  const { pick, pickProb, doubleChance, goalLine, goalLineProb, confidence, confidenceGap } = r.recommendation;

  const pickLabel =
    pick === "1" ? `${r.inputs.home} (hazai győzelem)` :
    pick === "2" ? `${r.inputs.away} (vendég győzelem)` :
                   "Döntetlen (X)";

  const confClass =
    confidence === "HIGH" ? "conf-high" :
    confidence === "MED"  ? "conf-med"  : "conf-low";

  const leagueLabel = document.querySelector(`#league option[value="${r.inputs.league}"]`)?.textContent || r.inputs.league;

  body.innerHTML = `
    <div class="headline">
      <span class="league-tag">${leagueLabel}</span>
      <span class="match">${escapeHtml(r.inputs.home)} <span style="color:var(--text-dim)">vs</span> ${escapeHtml(r.inputs.away)}</span>
      <span style="color:var(--text-dim); letter-spacing:2px;">${r.inputs.date}</span>
    </div>

    <div class="verdict">
      <div class="card">
        <h3>&gt;&gt; LEGVALÓSZÍNŰBB KIMENETEL</h3>
        <div class="big">${pickLabel}</div>
        <div class="sub">
          <span class="confidence-tag ${confClass}">CONF: ${confidence}</span>
          valószínűség: ${pct(pickProb)} · bizonytalansági gap: ${pct(confidenceGap)}
          ${doubleChance ? `<br/><span style="color:var(--neon-yellow)">szoros verseny → dupla esély: ${doubleChance}</span>` : ""}
        </div>
      </div>
      <div class="card">
        <h3>&gt;&gt; VÁRHATÓ GÓLSZÁM</h3>
        <div class="big">${goalLine}</div>
        <div class="sub">
          valószínűség: ${pct(goalLineProb)} · várható gólszám: <span class="mono">${r.goalModel.totalExp.toFixed(2)}</span>
          · leggyakoribb eredmény: <span class="mono">${r.poisson.bestScore.i}–${r.poisson.bestScore.j}</span>
        </div>
      </div>
    </div>

    <div class="bars">
      ${bar("HAZAI (1)", pHome)}
      ${bar("DÖNTETLEN (X)", pDraw)}
      ${bar("VENDÉG (2)", pAway)}
    </div>

    <div class="bars">
      ${bar("Over 1.5", r.poisson.pOver15)}
      ${bar("Over 2.5", r.poisson.pOver25)}
      ${bar("BTTS", r.poisson.pBTTS)}
    </div>

    <div class="actions">
      <button id="show-breakdown" class="btn-small">&gt;&gt; RÉSZLETES LEVEZETÉS</button>
    </div>
  `;

  // animate bars
  requestAnimationFrame(() => {
    document.querySelectorAll("#result .bar .fill").forEach((el) => {
      el.style.width = el.dataset.w;
    });
  });

  document.getElementById("show-breakdown").addEventListener("click", () => {
    const b = document.getElementById("breakdown");
    b.classList.remove("hidden");
    document.getElementById("toggle-breakdown").textContent = "HIDE";
    b.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function bar(label, p) {
  const pct = (p * 100).toFixed(1);
  return `
    <div class="bar-row">
      <span class="label">${label}</span>
      <div class="bar"><div class="fill" data-w="${pct}%" style="width:0"></div></div>
      <span class="pct">${pct}%</span>
    </div>
  `;
}

/* ---------- BREAKDOWN ---------- */
function renderBreakdown(r) {
  const el = document.getElementById("breakdown-body");
  const pct = (x) => (x * 100).toFixed(1) + "%";
  const n = (x, d = 2) => Number(x).toFixed(d);

  // Poisson heatmap table: 0..5 home rows, 0..5 away cols
  const MAX = 5;
  const heat = [];
  heat.push(`<div class="scoregrid">`);
  heat.push(`<div class="sq hdr"></div>`);
  for (let j = 0; j <= MAX; j++) heat.push(`<div class="sq hdr">${j}</div>`);
  for (let i = 0; i <= MAX; i++) {
    heat.push(`<div class="sq hdr">${i}</div>`);
    for (let j = 0; j <= MAX; j++) {
      const p = r.poisson.grid[i][j];
      const isBest = (i === r.poisson.bestScore.i && j === r.poisson.bestScore.j);
      heat.push(`<div class="sq ${isBest ? "best" : ""}">${(p*100).toFixed(1)}</div>`);
    }
  }
  heat.push(`</div>`);

  const ht = r.teams.home, at = r.teams.away;

  el.innerHTML = `
    <h3>1. ADAT NORMALIZÁLÁS — liga alap-mutatók</h3>
    <p>
      A kiválasztott bajnokságban a történeti átlaggólok:
      <span class="mono">μ_home = ${n(r.mu.mu_home)}</span>,
      <span class="mono">μ_away = ${n(r.mu.mu_away)}</span>.
      Ez a baseline minden várhatógól-számítás alapja.
    </p>

    <h3>2–3. CSAPAT ERŐSÉGEK (home/away bontás, forma beépítve)</h3>
    <p>
      A csapat-prior értékek külön a hazai és a vendég viselkedésre
      (a korábbi verzió átlagolta a kettőt, ami jelentős információt mosott el).
      A támadó (A) és védő (D) értékek az adott liga átlagához viszonyítottak:
      <span class="mono">A &gt; 1</span> erősebb támadás, <span class="mono">D &lt; 1</span> erősebb védelem.
    </p>
    <table>
      <tr>
        <th>Csapat</th><th>Elo</th>
        <th>A_home</th><th>A_away</th>
        <th>D_home</th><th>D_away</th>
        <th>Forma</th><th>xG/meccs</th><th>xGA</th><th>xG forrás</th><th>Sérülés</th>
      </tr>
      <tr>
        <td>${escapeHtml(r.inputs.home)} (hazai)</td>
        <td class="mono">${ht.elo}</td>
        <td class="mono">${n(ht.atk_home ?? ht.atk, 3)}</td>
        <td class="mono">${n(ht.atk_away ?? (ht.atk ?? 1) * 0.95, 3)}</td>
        <td class="mono">${n(ht.def_home ?? ht.def, 3)}</td>
        <td class="mono">${n(ht.def_away ?? (ht.def ?? 1) * 1.02, 3)}</td>
        <td class="mono">${ht.form >= 0 ? "+" : ""}${n(ht.form)}</td>
        <td class="mono">${n(ht.xg_for)}</td>
        <td class="mono">${n(ht.xg_ag)}</td>
        <td class="mono" style="color:${ht.xg_source === 'understat' ? 'var(--neon-green)' : 'var(--text-dim)'}">${ht.xg_source || "proxy"}</td>
        <td class="mono">${n((ht.inj ?? 0)*100, 1)}%</td>
      </tr>
      <tr>
        <td>${escapeHtml(r.inputs.away)} (vendég)</td>
        <td class="mono">${at.elo}</td>
        <td class="mono">${n(at.atk_home ?? at.atk, 3)}</td>
        <td class="mono">${n(at.atk_away ?? (at.atk ?? 1) * 0.95, 3)}</td>
        <td class="mono">${n(at.def_home ?? at.def, 3)}</td>
        <td class="mono">${n(at.def_away ?? (at.def ?? 1) * 1.02, 3)}</td>
        <td class="mono">${at.form >= 0 ? "+" : ""}${n(at.form)}</td>
        <td class="mono">${n(at.xg_for)}</td>
        <td class="mono">${n(at.xg_ag)}</td>
        <td class="mono" style="color:${at.xg_source === 'understat' ? 'var(--neon-green)' : 'var(--text-dim)'}">${at.xg_source || "proxy"}</td>
        <td class="mono">${n((at.inj ?? 0)*100, 1)}%</td>
      </tr>
    </table>
    <p style="color:var(--text-dim); font-size:0.85rem">
      A modell a λ-számításban az <span class="mono">A_home</span>-ot és
      <span class="mono">D_away</span>-t keresztezi a hazai λ-hoz, illetve
      <span class="mono">A_away</span>-t és <span class="mono">D_home</span>-ot
      a vendég λ-hoz. Ha az xG forrása „understat", valódi lövésminőségen alapul;
      „proxy" esetén csak a gólátlagból becsült közelítés.
    </p>
    ${(r.inputs.homeSynthetic || r.inputs.awaySynthetic) ? `
      <p style="color:var(--neon-yellow)">
        Figyelmeztetés: legalább az egyik csapatra nincs explicit adat az adatbázisban,
        így determinisztikus, név-alapú prior kerül használatra. Az eredmény iránymutató.
      </p>` : ""}

    <h3>4–5. ELO MODELL & HAZAI ELŐNY</h3>
    <p>
      Hazai előny Elo-ban: <span class="mono">H = ${r.elo.H_elo}</span>.
      A Elo várható pontszám:
      <span class="mono">E_home = 1 / (1 + 10^((R_away − R_home + H)/400))</span>
      = <span class="mono">${n(r.elo.E_home, 3)}</span>,
      <span class="mono">E_away = ${n(r.elo.E_away, 3)}</span>.
    </p>
    <p>
      Az Elo-alapú 1X2 valószínűségek (Elo különbségtől függő döntetlen-kihasítással):
      <span class="mono">1 = ${pct(r.elo.pHomeElo)}</span>,
      <span class="mono">X = ${pct(r.elo.pDrawElo)}</span>,
      <span class="mono">2 = ${pct(r.elo.pAwayElo)}</span>.
    </p>

    <h3>6. VÁRHATÓ GÓL (CORE MODEL)</h3>
    <p>
      <span class="mono">λ_home = μ_home · A_home · D_away · H_goal</span>
      = ${n(r.mu.mu_home)} · ${n(r.strengths.A_home)} · ${n(r.strengths.D_away)} · ${n(r.goalModel.H_goal)}
      = <span class="mono">${n(r.goalModel.lambda_home_base, 3)}</span>
    </p>
    <p>
      <span class="mono">λ_away = μ_away · A_away · D_home</span>
      = ${n(r.mu.mu_away)} · ${n(r.strengths.A_away)} · ${n(r.strengths.D_home)}
      = <span class="mono">${n(r.goalModel.lambda_away_base, 3)}</span>
    </p>

    <h3>7. xG INTEGRÁCIÓ (α = 0.7)</h3>
    <p>
      <span class="mono">λ = α·λ_model + (1−α)·xG_komp</span>
      → λ_home_xg = <span class="mono">${n(r.goalModel.lambda_home_xg, 3)}</span>,
      λ_away_xg = <span class="mono">${n(r.goalModel.lambda_away_xg, 3)}</span>.
    </p>

    <h3>8. SÉRÜLÉSEK / HIÁNYZÓK</h3>
    <p>
      λ_adj = λ · (1 − I).
      λ_home_inj = <span class="mono">${n(r.goalModel.lambda_home_inj, 3)}</span>,
      λ_away_inj = <span class="mono">${n(r.goalModel.lambda_away_inj, 3)}</span>.
    </p>

    <h3>9. ELO-KORREKCIÓ A λ-RA (β = 0.1)</h3>
    <p>
      ΔElo = (R_home − R_away)/400 = <span class="mono">${n(r.elo.deltaElo, 3)}</span>.
      Végső <span class="mono">λ_home = ${n(r.goalModel.lambda_home, 3)}</span>,
      <span class="mono">λ_away = ${n(r.goalModel.lambda_away, 3)}</span>,
      várható össz-gól: <span class="mono">${n(r.goalModel.totalExp, 2)}</span>.
    </p>

    <h3>10–11. POISSON + DIXON–COLES KORRIGÁLT SCORELINE MÁTRIX</h3>
    <p>
      Oszlopok = vendég gólok (0..5), sorok = hazai gólok (0..5). Az érték <span class="mono">%</span>.
      A nyers Poisson-szorzatot a Dixon–Coles (1997) korrekció módosítja a
      <span class="mono">0–0, 1–0, 0–1, 1–1</span> cellákban
      (<span class="mono">ρ = ${n(r.poisson.dixon_coles_rho ?? -0.15, 2)}</span>):
      a 0–0 és 1–1 valószínűségét felhúzza, a 0–1 / 1–0 cellákat visszavágja,
      majd a mátrix újranormalizálásra kerül.
    </p>
    ${heat.join("")}
    <p>
      Legvalószínűbb pontos végeredmény:
      <span class="mono">${r.poisson.bestScore.i}–${r.poisson.bestScore.j}</span>
      (≈ ${pct(r.poisson.bestScore.p)}).
    </p>

    <h3>12. POISSON ALAPÚ 1X2 ÉS TOTALS</h3>
    <table>
      <tr><th>Esemény</th><th>Valószínűség</th></tr>
      <tr><td>1 (hazai győzelem)</td><td class="mono">${pct(r.poisson.pHomePoisson)}</td></tr>
      <tr><td>X (döntetlen)</td><td class="mono">${pct(r.poisson.pDrawPoisson)}</td></tr>
      <tr><td>2 (vendég győzelem)</td><td class="mono">${pct(r.poisson.pAwayPoisson)}</td></tr>
      <tr><td>Over 1.5</td><td class="mono">${pct(r.poisson.pOver15)}</td></tr>
      <tr><td>Over 2.5</td><td class="mono">${pct(r.poisson.pOver25)}</td></tr>
      <tr><td>Over 3.5</td><td class="mono">${pct(r.poisson.pOver35)}</td></tr>
      <tr><td>BTTS (mindkét csapat gólt szerez)</td><td class="mono">${pct(r.poisson.pBTTS)}</td></tr>
    </table>

    <h3>13. MONTE CARLO SZIMULÁCIÓ (N = ${r.montecarlo.n.toLocaleString()})</h3>
    <table>
      <tr><th>Esemény</th><th>MC eredmény</th></tr>
      <tr><td>1</td><td class="mono">${pct(r.montecarlo.pHome)}</td></tr>
      <tr><td>X</td><td class="mono">${pct(r.montecarlo.pDraw)}</td></tr>
      <tr><td>2</td><td class="mono">${pct(r.montecarlo.pAway)}</td></tr>
      <tr><td>Over 1.5</td><td class="mono">${pct(r.montecarlo.over15)}</td></tr>
      <tr><td>Over 2.5</td><td class="mono">${pct(r.montecarlo.over25)}</td></tr>
      <tr><td>Over 3.5</td><td class="mono">${pct(r.montecarlo.over35)}</td></tr>
      <tr><td>BTTS</td><td class="mono">${pct(r.montecarlo.btts)}</td></tr>
      <tr><td>Átlagos össz-gól</td><td class="mono">${n(r.montecarlo.avgTotal, 2)}</td></tr>
    </table>

    <h3>14. ENSEMBLE KOMBINÁCIÓ (Poisson 0.5 · Elo 0.3 · xG 0.2)</h3>
    <table>
      <tr><th>Forrás</th><th>1 (hazai)</th><th>X</th><th>2 (vendég)</th></tr>
      <tr><td>Poisson</td><td class="mono">${pct(r.poisson.pHomePoisson)}</td><td class="mono">${pct(r.poisson.pDrawPoisson)}</td><td class="mono">${pct(r.poisson.pAwayPoisson)}</td></tr>
      <tr><td>Elo</td><td class="mono">${pct(r.elo.pHomeElo)}</td><td class="mono">${pct(r.elo.pDrawElo)}</td><td class="mono">${pct(r.elo.pAwayElo)}</td></tr>
      <tr><td>xG</td><td class="mono">${pct(r.xgOnly.pHomeXG)}</td><td class="mono">${pct(r.xgOnly.pDrawXG)}</td><td class="mono">${pct(r.xgOnly.pAwayXG)}</td></tr>
      <tr><td><strong>Ensemble</strong></td><td class="mono"><strong>${pct(r.ensemble.pHome)}</strong></td><td class="mono"><strong>${pct(r.ensemble.pDraw)}</strong></td><td class="mono"><strong>${pct(r.ensemble.pAway)}</strong></td></tr>
    </table>

    <h3>15. PIACI ODDS KALIBRÁCIÓ</h3>
    <p>
      Jelen verzióban nincs élő odds-feed. Ha megadsz decimális oddsokat, a modell
      képes γ = 0.7 keveréssel kalibrálni:
      <span class="mono">P_final = γ·P_model + (1−γ)·P_market</span>.
    </p>

    <h3>16. KONFIDENCIA</h3>
    <p>
      |P(home) − P(away)| = <span class="mono">${pct(r.recommendation.confidenceGap)}</span>
      → <strong>${r.recommendation.confidence}</strong> bizalmi szint.
    </p>
    <p>
      <strong>Végső javaslat:</strong>
      ${r.recommendation.pick === "1" ? r.inputs.home + " győzelem"
        : r.recommendation.pick === "2" ? r.inputs.away + " győzelem"
        : "döntetlen"}
      (${pct(r.recommendation.pickProb)})
      · gólvonal: ${r.recommendation.goalLine} (${pct(r.recommendation.goalLineProb)}).
      ${r.recommendation.doubleChance
          ? ` Szoros kimenet, ezért dupla esély (<strong>${r.recommendation.doubleChance}</strong>) is ajánlható.`
          : ""}
    </p>
  `;
}

function toggleBreakdown() {
  const b = document.getElementById("breakdown");
  const btn = document.getElementById("toggle-breakdown");
  if (b.classList.contains("hidden")) {
    b.classList.remove("hidden");
    btn.textContent = "HIDE";
  } else {
    b.classList.add("hidden");
    btn.textContent = "SHOW";
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ==============================================================
   FIXTURES + BET SLIP
   ============================================================== */

const LEAGUE_LABEL = {
  EPL:    "Premier League",
  LALIGA: "La Liga",
  SERIEA: "Serie A",
  BUNDES: "Bundesliga",
  LIGUE1: "Ligue 1",
  NB1:    "NB I.",
  UCL:    "UEFA Champions League",
  OTHER:  "Egyéb",
};

let manualFixtures = loadLS("manualFixtures", []);
let slip           = loadLS("betslip",        []);
const expandedFx   = new Set(); // IDs of fixture cards in expanded mode

function loadLS(key, def) {
  try { return JSON.parse(localStorage.getItem(key)) ?? def; }
  catch { return def; }
}
function saveLS(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

function initFixtures() {
  renderFixtures();
  renderSlip();
  document.getElementById("fixture-league-filter").addEventListener("change", renderFixtures);
  document.getElementById("fixture-day-filter").addEventListener("change", renderFixtures);
  document.getElementById("fixture-manual-btn").addEventListener("click", toggleManualForm);
  document.getElementById("manual-fixture-form").addEventListener("submit", onManualAdd);
  document.getElementById("slip-clear").addEventListener("click", clearSlip);

  const upd = document.getElementById("fixtures-updated");
  if (typeof FIXTURES_UPDATED !== "undefined" && FIXTURES_UPDATED) {
    const d = new Date(FIXTURES_UPDATED);
    upd.textContent = `// FIXTURES UPDATED: ${d.toLocaleString("hu-HU")} //`;
  } else {
    upd.textContent = "// nincs auto-frissített lista — használd a + KÉZI gombot //";
  }
}

function toggleManualForm() {
  const f = document.getElementById("manual-fixture-form");
  f.classList.toggle("hidden");
}

function onManualAdd(e) {
  e.preventDefault();
  const league = document.getElementById("m-league").value;
  const dateRaw = document.getElementById("m-date").value;
  const home = document.getElementById("m-home").value.trim();
  const away = document.getElementById("m-away").value.trim();
  if (!league || !dateRaw || !home || !away) return;
  if (home.toLowerCase() === away.toLowerCase()) {
    alert("A hazai és vendég csapat nem egyezhet meg.");
    return;
  }
  const id = `manual-${Date.now()}`;
  manualFixtures.push({
    id, league,
    utcDate: new Date(dateRaw).toISOString(),
    status: "SCHEDULED",
    home, away, manual: true,
  });
  saveLS("manualFixtures", manualFixtures);
  e.target.reset();
  renderFixtures();
}

function allFixtures() {
  const auto = (typeof FIXTURES !== "undefined" && Array.isArray(FIXTURES)) ? FIXTURES : [];
  return [...auto, ...manualFixtures];
}

function filterByDay(fixtures, day) {
  const now = new Date();
  const t0 = new Date(now); t0.setHours(0, 0, 0, 0);
  const t1 = new Date(t0);  t1.setDate(t1.getDate() + 1);
  const t2 = new Date(t0);  t2.setDate(t2.getDate() + 2);
  return fixtures.filter((f) => {
    const d = new Date(f.utcDate);
    if (day === "today")    return d >= t0 && d < t1;
    if (day === "tomorrow") return d >= t1 && d < t2;
    return d >= t0 && d < t2;
  });
}

function renderFixtures() {
  const list    = document.getElementById("fixtures-list");
  const lgF     = document.getElementById("fixture-league-filter").value;
  const dayF    = document.getElementById("fixture-day-filter").value;

  let fixtures = allFixtures();
  fixtures = filterByDay(fixtures, dayF);
  if (lgF !== "ALL") fixtures = fixtures.filter((f) => f.league === lgF);
  fixtures = fixtures.filter((f) => f.status !== "CANCELLED" && f.status !== "POSTPONED");

  fixtures.sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));

  // Suggestions are computed on the same filtered set, minus finished/live games
  renderSuggestions(fixtures);

  if (fixtures.length === 0) {
    list.innerHTML = `<div class="empty">NINCS MECCS A SZŰRT IDŐSZAKRA</div>`;
    return;
  }

  // group by league
  const byLeague = {};
  for (const f of fixtures) (byLeague[f.league] ||= []).push(f);

  const order = ["EPL", "LALIGA", "SERIEA", "BUNDES", "LIGUE1", "UCL", "NB1", "OTHER"];
  const keys = Object.keys(byLeague).sort((a, b) => {
    const ai = order.indexOf(a), bi = order.indexOf(b);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });

  list.innerHTML = keys.map((lg) => `
    <div class="fixture-group">
      <h3>${escapeHtml(LEAGUE_LABEL[lg] || lg)}</h3>
      <div class="fixture-cards">
        ${byLeague[lg].map(renderFixtureCard).join("")}
      </div>
    </div>
  `).join("");

  // wire up buttons
  list.querySelectorAll(".add-event-btn").forEach((btn) => {
    btn.addEventListener("click", onAddEvent);
  });
  list.querySelectorAll(".remove-fixture-btn").forEach((btn) => {
    btn.addEventListener("click", onRemoveManualFixture);
  });
  list.querySelectorAll(".fx-expand-btn").forEach((btn) => {
    btn.addEventListener("click", onToggleExpand);
  });
}

function onToggleExpand(e) {
  const id = e.currentTarget.dataset.fxId;
  if (expandedFx.has(id)) expandedFx.delete(id);
  else expandedFx.add(id);
  renderFixtures();
}

function renderFixtureCard(fx) {
  let pred;
  try {
    pred = predictMatch({
      league: fx.league,
      date:   fx.utcDate.slice(0, 10),
      home:   fx.home,
      away:   fx.away,
    });
  } catch (err) {
    return `<div class="fixture-card error">Predikció hiba: ${escapeHtml(err.message)}</div>`;
  }

  const time = new Date(fx.utcDate).toLocaleTimeString("hu-HU",
    { hour: "2-digit", minute: "2-digit" });

  const statusBadge = renderStatus(fx.status, fx.score);
  const removeBtn = fx.manual
    ? `<button class="remove-fixture-btn" data-fx-id="${escapeHtml(fx.id)}" title="Törlés">✕</button>` : "";

  const fxMeta = {
    id: fx.id, league: fx.league, utcDate: fx.utcDate, home: fx.home, away: fx.away,
  };
  const fxEnc = encodeURIComponent(JSON.stringify(fxMeta));

  // ---- Build ALL events grouped by category ----
  const e = pred.ensemble;
  const p = pred.poisson;

  const outcomes = [
    { code: "1", label: `${fx.home} (1)`, prob: e.pHome, kind: "1X2" },
    { code: "X", label: `Döntetlen (X)`,  prob: e.pDraw, kind: "1X2" },
    { code: "2", label: `${fx.away} (2)`, prob: e.pAway, kind: "1X2" },
  ].sort((a, b) => b.prob - a.prob);

  const dc = {
    home1x: e.pHome + e.pDraw,     // 1X
    drawAw: e.pDraw + e.pAway,     // X2
    homeAw: e.pHome + e.pAway,     // 12
  };
  const dcEvents = [
    { code: "1X", label: `Dupla esély 1X`, prob: dc.home1x, kind: "DC" },
    { code: "X2", label: `Dupla esély X2`, prob: dc.drawAw, kind: "DC" },
    { code: "12", label: `Dupla esély 12`, prob: dc.homeAw, kind: "DC" },
  ].sort((a, b) => b.prob - a.prob);

  const totals = [
    { code: "O15", label: "Over 1.5",  prob: p.pOver15,     kind: "TOTAL" },
    { code: "U15", label: "Under 1.5", prob: 1 - p.pOver15, kind: "TOTAL" },
    { code: "O25", label: "Over 2.5",  prob: p.pOver25,     kind: "TOTAL" },
    { code: "U25", label: "Under 2.5", prob: 1 - p.pOver25, kind: "TOTAL" },
    { code: "O35", label: "Over 3.5",  prob: p.pOver35,     kind: "TOTAL" },
    { code: "U35", label: "Under 3.5", prob: 1 - p.pOver35, kind: "TOTAL" },
  ].sort((a, b) => b.prob - a.prob);

  const bttsEvents = [
    { code: "BTTS_Y", label: "BTTS: Igen", prob: p.pBTTS,     kind: "BTTS" },
    { code: "BTTS_N", label: "BTTS: Nem",  prob: 1 - p.pBTTS, kind: "BTTS" },
  ].sort((a, b) => b.prob - a.prob);

  // Top scoreline (from DC-corrected grid): take the 3 highest cells
  const topScores = [];
  for (let i = 0; i < p.grid.length; i++) {
    for (let j = 0; j < p.grid[i].length; j++) {
      topScores.push({ i, j, prob: p.grid[i][j] });
    }
  }
  topScores.sort((a, b) => b.prob - a.prob);
  const scoreEvents = topScores.slice(0, 3).map((s) => ({
    code: `S_${s.i}_${s.j}`,
    label: `Pontos eredmény ${s.i}–${s.j}`,
    prob: s.prob,
    kind: "SCORE",
  }));

  const fxId = String(fx.id);
  const isExpanded = expandedFx.has(fxId);

  // ---- Default (collapsed) preview: the model's single best pick per category ----
  const preview = [
    outcomes[0],   // most likely 1X2
    totals[0],     // most likely total line
  ];

  const bodyHtml = isExpanded
    ? renderExpandedEvents(fxMeta, fxEnc, {
        outcomes, dcEvents, totals, bttsEvents, scoreEvents,
      })
    : renderEventChips(fxEnc, preview, fxId);

  const toggleLabel = isExpanded ? "— KEVESEBB" : "+ ÖSSZES FOGADÁSI ESEMÉNY";

  return `
    <div class="fixture-card ${isExpanded ? "expanded" : ""}" data-fx-id="${escapeHtml(fxId)}">
      <div class="fx-header">
        <span class="fx-time">${time}</span>
        <span class="fx-teams">${escapeHtml(fx.home)} <span class="vs">vs</span> ${escapeHtml(fx.away)}</span>
        ${statusBadge}
        ${removeBtn}
      </div>
      ${bodyHtml}
      <button class="fx-expand-btn" data-fx-id="${escapeHtml(fxId)}">${toggleLabel}</button>
    </div>
  `;
}

function renderEventChips(fxEnc, events, fxId) {
  return `
    <div class="fx-events">
      ${events.map((ev) => renderChip(fxEnc, ev, fxId)).join("")}
    </div>
  `;
}

function renderChip(fxEnc, ev, fxId) {
  const inSlip = slip.some((s) => s.fxId == fxId && s.eventKind === ev.kind && s.eventCode === ev.code);
  const evEnc = encodeURIComponent(JSON.stringify(ev));
  return `
    <div class="event-chip">
      <span class="event-label">${escapeHtml(ev.label)}</span>
      <span class="event-prob">${(ev.prob * 100).toFixed(1)}%</span>
      <button class="add-event-btn ${inSlip ? "in-slip" : ""}"
              data-fx="${fxEnc}"
              data-event="${evEnc}"
              title="${inSlip ? "Már a szelvényen" : "Hozzáadás a szelvényhez"}">
        ${inSlip ? "✓" : "+"}
      </button>
    </div>
  `;
}

function renderExpandedEvents(fxMeta, fxEnc, groups) {
  const fxId = String(fxMeta.id);
  const section = (title, events) => `
    <div class="fx-event-group">
      <div class="fx-event-group-title">${escapeHtml(title)}</div>
      <div class="fx-events">
        ${events.map((ev) => renderChip(fxEnc, ev, fxId)).join("")}
      </div>
    </div>
  `;
  return `
    <div class="fx-events-expanded">
      ${section("Kimenet (1X2)",    groups.outcomes)}
      ${section("Dupla esély",       groups.dcEvents)}
      ${section("Gólszám (Over/Under)", groups.totals)}
      ${section("Mindkét csapat szerez gólt", groups.bttsEvents)}
      ${section("Legvalószínűbb pontos eredmények", groups.scoreEvents)}
    </div>
  `;
}

function renderStatus(status, score) {
  if (!status || status === "SCHEDULED" || status === "TIMED") return "";
  if (status === "IN_PLAY" || status === "PAUSED") {
    return `<span class="fx-status live">LIVE${score ? ` ${score.home}-${score.away}` : ""}</span>`;
  }
  if (status === "FINISHED") {
    return `<span class="fx-status finished">FT ${score ? `${score.home}-${score.away}` : ""}</span>`;
  }
  return `<span class="fx-status">${escapeHtml(status)}</span>`;
}

function onAddEvent(e) {
  const fx = JSON.parse(decodeURIComponent(e.currentTarget.dataset.fx));
  const ev = JSON.parse(decodeURIComponent(e.currentTarget.dataset.event));
  const sid = `${fx.id}__${ev.kind}__${ev.code}`;

  // toggle — if already in slip, remove
  const existingIdx = slip.findIndex((s) => s.id === sid);
  if (existingIdx >= 0) {
    slip.splice(existingIdx, 1);
  } else {
    // one 1X2 per match (replace any existing 1X2 on the same match)
    if (ev.kind === "1X2") {
      slip = slip.filter((s) => !(s.fxId == fx.id && s.eventKind === "1X2"));
    }
    slip.push({
      id:         sid,
      fxId:       fx.id,
      league:     fx.league,
      matchLabel: `${fx.home} vs ${fx.away}`,
      utcDate:    fx.utcDate,
      eventLabel: ev.label,
      eventCode:  ev.code,
      eventKind:  ev.kind,
      prob:       ev.prob,
      addedAt:    Date.now(),
    });
  }
  saveLS("betslip", slip);

  // micro-flash feedback
  e.currentTarget.classList.add("added");
  setTimeout(() => e.currentTarget.classList.remove("added"), 400);

  renderSlip();
  renderFixtures(); // re-render to update the "in-slip" check marks
}

function onRemoveManualFixture(e) {
  const id = e.currentTarget.dataset.fxId;
  manualFixtures = manualFixtures.filter((f) => f.id !== id);
  saveLS("manualFixtures", manualFixtures);
  // also remove any slip items referencing this fixture
  slip = slip.filter((s) => s.fxId !== id);
  saveLS("betslip", slip);
  renderFixtures();
  renderSlip();
}

function renderSlip() {
  const items   = document.getElementById("slip-items");
  const count   = document.getElementById("slip-count");
  const probEl  = document.getElementById("slip-prob");
  const oddsEl  = document.getElementById("slip-odds");

  count.textContent = `(${slip.length})`;

  if (slip.length === 0) {
    items.innerHTML = `
      <div class="slip-empty">
        ÜRES SZELVÉNY<br/>
        <span style="color:var(--text-dim); font-size:0.75rem">
          Adj hozzá eseményeket a meccsek mellől a <strong style="color:var(--neon-green)">+</strong> gombbal.
        </span>
      </div>`;
    probEl.textContent = "—";
    oddsEl.textContent = "—";
    return;
  }

  // sorted by match time
  const sorted = [...slip].sort((a, b) =>
    new Date(a.utcDate) - new Date(b.utcDate) || a.addedAt - b.addedAt);

  items.innerHTML = sorted.map((s) => {
    const t = new Date(s.utcDate).toLocaleString("hu-HU",
      { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    return `
      <div class="slip-item">
        <div class="slip-match">${t} · ${escapeHtml(LEAGUE_LABEL[s.league] || s.league)} · ${escapeHtml(s.matchLabel)}</div>
        <div class="slip-event">
          <span>${escapeHtml(s.eventLabel)}</span>
          <span class="mono">${(s.prob * 100).toFixed(1)}%</span>
          <button class="slip-remove" data-id="${escapeHtml(s.id)}" title="Eltávolítás">✕</button>
        </div>
      </div>
    `;
  }).join("");

  items.querySelectorAll(".slip-remove").forEach((b) => {
    b.addEventListener("click", (e) => {
      const id = e.currentTarget.dataset.id;
      slip = slip.filter((s) => s.id !== id);
      saveLS("betslip", slip);
      renderSlip();
      renderFixtures();
    });
  });

  // combined probability (assumes independence — standard accumulator math)
  const combined = slip.reduce((p, s) => p * s.prob, 1);
  probEl.textContent = (combined * 100).toFixed(2) + "%";
  oddsEl.textContent = combined > 0 ? (1 / combined).toFixed(2) : "—";
}

function clearSlip() {
  if (slip.length === 0) return;
  if (!confirm("Biztosan üríted a szelvényt?")) return;
  slip = [];
  saveLS("betslip", slip);
  renderSlip();
  renderFixtures();
}

/* --------------------------------------------------------------
   SUGGESTIONS — three automatic slip candidates built from the
   model's highest-probability events across all today's fixtures.
   Each card: max 1 event per match (diversified parlay), top 3
   by ensemble probability in its scope.
   -------------------------------------------------------------- */
function renderSuggestions(fixtures) {
  const container = document.getElementById("fixtures-suggestions");
  if (!container) return;

  // Only bettable matches (exclude finished / live / cancelled)
  const bettable = fixtures.filter((f) =>
    f.status !== "FINISHED" &&
    f.status !== "IN_PLAY"  &&
    f.status !== "PAUSED"   &&
    f.status !== "CANCELLED");

  if (bettable.length === 0) {
    container.innerHTML = "";
    return;
  }

  // For every match compute the event pools once
  const perMatch = [];
  for (const fx of bettable) {
    let pred;
    try {
      pred = predictMatch({
        league: fx.league,
        date:   fx.utcDate.slice(0, 10),
        home:   fx.home,
        away:   fx.away,
      });
    } catch { continue; }
    const e = pred.ensemble, p = pred.poisson;
    const outcome = [
      { code: "1",  label: `${fx.home} (1)`,    prob: e.pHome,           kind: "1X2" },
      { code: "X",  label: `Döntetlen (X)`,      prob: e.pDraw,           kind: "1X2" },
      { code: "2",  label: `${fx.away} (2)`,    prob: e.pAway,           kind: "1X2" },
      { code: "1X", label: "Dupla esély 1X",    prob: e.pHome + e.pDraw, kind: "DC"  },
      { code: "X2", label: "Dupla esély X2",    prob: e.pDraw + e.pAway, kind: "DC"  },
      { code: "12", label: "Dupla esély 12",    prob: e.pHome + e.pAway, kind: "DC"  },
    ];
    const goal = [
      { code: "O15",    label: "Over 1.5",   prob: p.pOver15,     kind: "TOTAL" },
      { code: "U15",    label: "Under 1.5",  prob: 1 - p.pOver15, kind: "TOTAL" },
      { code: "O25",    label: "Over 2.5",   prob: p.pOver25,     kind: "TOTAL" },
      { code: "U25",    label: "Under 2.5",  prob: 1 - p.pOver25, kind: "TOTAL" },
      { code: "O35",    label: "Over 3.5",   prob: p.pOver35,     kind: "TOTAL" },
      { code: "U35",    label: "Under 3.5",  prob: 1 - p.pOver35, kind: "TOTAL" },
      { code: "BTTS_Y", label: "BTTS: Igen", prob: p.pBTTS,       kind: "BTTS"  },
      { code: "BTTS_N", label: "BTTS: Nem",  prob: 1 - p.pBTTS,   kind: "BTTS"  },
    ];
    perMatch.push({ fx, outcome, goal });
  }

  if (perMatch.length === 0) {
    container.innerHTML = "";
    return;
  }

  // Build one suggestion: from each match pick its best event in the scope,
  // then sort across matches and keep top 3 distinct matches.
  function buildScope(scope) {
    const cands = [];
    for (const { fx, outcome, goal } of perMatch) {
      const pool = scope === "outcome" ? outcome
                 : scope === "goal"    ? goal
                                       : [...outcome, ...goal];
      if (pool.length === 0) continue;
      const best = pool.reduce((a, b) => (a.prob > b.prob ? a : b));
      cands.push({ fx, ev: best });
    }
    cands.sort((a, b) => b.ev.prob - a.ev.prob);
    return cands.slice(0, 3);
  }

  const goalSugg    = buildScope("goal");
  const outcomeSugg = buildScope("outcome");
  const mixedSugg   = buildScope("mixed");

  container.innerHTML = `
    <div class="sugg-header">
      <h3 class="sugg-title">&gt;&gt; SZELVÉNY JAVASLATOK</h3>
      <div class="sugg-subtitle">a modell legmagasabb valószínűségű eseményei · meccsenként max. 1 tipp</div>
    </div>
    <div class="sugg-grid">
      ${renderSuggCard("GÓLSZÁM-TIPPEK",   "goal",    goalSugg,    "var(--neon-yellow)")}
      ${renderSuggCard("KIMENET / GYŐZTES","outcome", outcomeSugg, "var(--neon-cyan)")}
      ${renderSuggCard("VEGYES (BÁRMI)",   "mixed",   mixedSugg,   "var(--neon-purple)")}
    </div>
  `;

  container.querySelectorAll(".sugg-add-all").forEach((btn) => {
    btn.addEventListener("click", onAddSuggestionAll);
  });
  container.querySelectorAll(".add-event-btn").forEach((btn) => {
    btn.addEventListener("click", onAddEvent);
  });
}

function renderSuggCard(title, id, items, accent) {
  if (items.length === 0) {
    return `
      <div class="sugg-card" data-sugg-id="${id}" style="--sugg-accent:${accent}">
        <div class="sugg-card-header">
          <span class="sugg-card-title">${escapeHtml(title)}</span>
        </div>
        <div class="sugg-empty">Nincs elegendő meccs</div>
      </div>
    `;
  }

  const combined = items.reduce((p, it) => p * it.ev.prob, 1);
  const impliedOdds = combined > 0 ? (1 / combined).toFixed(2) : "—";

  const rows = items.map((it) => {
    const fx = it.fx, ev = it.ev;
    const fxEnc = encodeURIComponent(JSON.stringify({
      id: fx.id, league: fx.league, utcDate: fx.utcDate, home: fx.home, away: fx.away,
    }));
    const evEnc = encodeURIComponent(JSON.stringify(ev));
    const inSlip = slip.some((s) =>
      s.fxId == fx.id && s.eventKind === ev.kind && s.eventCode === ev.code);
    const time = new Date(fx.utcDate).toLocaleTimeString("hu-HU",
      { hour: "2-digit", minute: "2-digit" });
    return `
      <div class="sugg-row">
        <div class="sugg-row-match">
          <span class="sugg-row-time">${time}</span>
          ${escapeHtml(fx.home)} <span class="vs">vs</span> ${escapeHtml(fx.away)}
        </div>
        <div class="sugg-row-event">
          <span class="event-label">${escapeHtml(ev.label)}</span>
          <span class="event-prob">${(ev.prob * 100).toFixed(1)}%</span>
          <button class="add-event-btn ${inSlip ? "in-slip" : ""}"
                  data-fx="${fxEnc}" data-event="${evEnc}"
                  title="${inSlip ? "Már a szelvényen" : "Hozzáadás a szelvényhez"}">
            ${inSlip ? "✓" : "+"}
          </button>
        </div>
      </div>
    `;
  }).join("");

  const bulk = items.map((it) => ({
    fx: {
      id: it.fx.id, league: it.fx.league, utcDate: it.fx.utcDate,
      home: it.fx.home, away: it.fx.away,
    },
    ev: it.ev,
  }));
  const bulkEnc = encodeURIComponent(JSON.stringify(bulk));

  return `
    <div class="sugg-card" data-sugg-id="${id}" style="--sugg-accent:${accent}">
      <div class="sugg-card-header">
        <span class="sugg-card-title">${escapeHtml(title)}</span>
        <span class="sugg-card-badge mono" title="együttes valószínűség · implicit odds">
          ${(combined * 100).toFixed(1)}% · ${impliedOdds}
        </span>
      </div>
      <div class="sugg-rows">${rows}</div>
      <button class="sugg-add-all" data-items="${bulkEnc}">+ MINDHÁROM A SZELVÉNYHEZ</button>
    </div>
  `;
}

function onAddSuggestionAll(e) {
  const items = JSON.parse(decodeURIComponent(e.currentTarget.dataset.items));
  let added = 0;
  for (const { fx, ev } of items) {
    const sid = `${fx.id}__${ev.kind}__${ev.code}`;
    if (slip.some((s) => s.id === sid)) continue;
    // one 1X2 per match rule
    if (ev.kind === "1X2") {
      slip = slip.filter((s) => !(s.fxId == fx.id && s.eventKind === "1X2"));
    }
    slip.push({
      id:         sid,
      fxId:       fx.id,
      league:     fx.league,
      matchLabel: `${fx.home} vs ${fx.away}`,
      utcDate:    fx.utcDate,
      eventLabel: ev.label,
      eventCode:  ev.code,
      eventKind:  ev.kind,
      prob:       ev.prob,
      addedAt:    Date.now(),
    });
    added++;
  }
  saveLS("betslip", slip);

  e.currentTarget.classList.add("added");
  setTimeout(() => e.currentTarget.classList.remove("added"), 500);

  renderSlip();
  renderFixtures();
}
