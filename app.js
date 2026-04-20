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

    <h3>2–3. CSAPAT ERŐSÉGEK (időben súlyozott forma beépítve)</h3>
    <p>A csapat-prior értékek (ideértve az utolsó meccsek exponenciálisan súlyozott formáját is):</p>
    <table>
      <tr><th>Csapat</th><th>Elo</th><th>Támadó (A)</th><th>Védő (D)</th><th>Forma</th><th>xG/meccs</th><th>xGA</th><th>Hiányzók hatása</th></tr>
      <tr>
        <td>${escapeHtml(r.inputs.home)} (hazai)</td>
        <td class="mono">${ht.elo}</td>
        <td class="mono">${n(ht.atk)}</td>
        <td class="mono">${n(ht.def)}</td>
        <td class="mono">${ht.form >= 0 ? "+" : ""}${n(ht.form)}</td>
        <td class="mono">${n(ht.xg_for)}</td>
        <td class="mono">${n(ht.xg_ag)}</td>
        <td class="mono">${n(ht.inj*100,1)}%</td>
      </tr>
      <tr>
        <td>${escapeHtml(r.inputs.away)} (vendég)</td>
        <td class="mono">${at.elo}</td>
        <td class="mono">${n(at.atk)}</td>
        <td class="mono">${n(at.def)}</td>
        <td class="mono">${at.form >= 0 ? "+" : ""}${n(at.form)}</td>
        <td class="mono">${n(at.xg_for)}</td>
        <td class="mono">${n(at.xg_ag)}</td>
        <td class="mono">${n(at.inj*100,1)}%</td>
      </tr>
    </table>
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

    <h3>10–11. POISSON ELOSZLÁS · SCORELINE MÁTRIX</h3>
    <p>Oszlopok = vendég gólok (0..5), sorok = hazai gólok (0..5). Az érték <span class="mono">%</span>:</p>
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
