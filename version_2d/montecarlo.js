// ================================================================
//  montecarlo.js  -  Paradigma VII: Simulacion Monte Carlo
//  Modal con 3 pestanas. Se abre desde boton en pantalla final.
// ================================================================

const MC_RUNS = 5000;

// ----------------------------------------------------------------
//  MOTOR DE GAS  (replica gas.js sin depender de el)
// ----------------------------------------------------------------
function simGasFinal(penalties, ventOpened, timeUsed) {
  const lam = 0.006;
  const V   = ventOpened ? 0.015 : 0.0;
  const Q   = ventOpened ? 0.3   : 1.0;
  const a   = lam - V;
  let G = 0, t = 0;
  const step = timeUsed / (penalties + 1);
  for (let i = 0; i < penalties; i++) {
    t += step;
    if (Math.abs(a) < 1e-9) G = G + Q * t;
    else G = (G + Q / a) * Math.exp(a * t) - Q / a;
    G += 20;
    t = 0;
  }
  const dtFinal = Math.max(0, timeUsed - penalties * step);
  if (Math.abs(a) < 1e-9) G = G + Q * dtFinal;
  else G = (G + Q / a) * Math.exp(a * dtFinal) - Q / a;
  return Math.max(0, G);
}

// ----------------------------------------------------------------
//  SIMULACION 1 - Probabilidad de escape por estrategia NPC
// ----------------------------------------------------------------
function mcSimEscapeProbByNpc(s) {
  const results = [];
  for (let pNpc = 0.1; pNpc <= 1.001; pNpc += 0.1) {
    let escapes = 0;
    for (let run = 0; run < MC_RUNS; run++) {
      let bonus = s.bonusTimeBase;
      for (let r = 0; r < s.rounds; r++) {
        const pCoop = Math.random() < s.playerCoopRatio ? "C" : "D";
        const nCoop = Math.random() < pNpc             ? "C" : "D";
        bonus += PAYOFF_MATRIX[pCoop === "C" ? "COOPERAR" : "COMPETIR"][nCoop === "C" ? "COOPERAR" : "COMPETIR"];
      }
      const totalT = s.timeLimit + bonus;
      const gas    = simGasFinal(s.penalties, s.ventOpened, Math.min(totalT, 480));
      if (gas < 300 && bonus > -s.timeLimit) escapes++;
    }
    results.push({ pNpc: parseFloat(pNpc.toFixed(1)), prob: parseFloat((escapes / MC_RUNS * 100).toFixed(1)) });
  }
  return results;
}

// ----------------------------------------------------------------
//  SIMULACION 2 - Distribucion de gas por numero de errores
// ----------------------------------------------------------------
function mcSimGasDistribution(s) {
  const results = [];
  for (let pen = 0; pen <= 12; pen++) {
    const vals = [];
    for (let run = 0; run < MC_RUNS; run++) {
      const jitter = 1 + (Math.random() - 0.5) * 0.2;
      vals.push(simGasFinal(pen, s.ventOpened, s.timeUsed * jitter));
    }
    vals.sort((a, b) => a - b);
    results.push({
      penalties: pen,
      p50: parseFloat(vals[Math.floor(MC_RUNS * 0.50)].toFixed(1)),
      p90: parseFloat(vals[Math.floor(MC_RUNS * 0.90)].toFixed(1))
    });
  }
  return results;
}

// ----------------------------------------------------------------
//  SIMULACION 3 - Pago esperado por ratio de cooperacion
// ----------------------------------------------------------------
function mcSimPayoffByCoopRatio(s) {
  let pNpc = s.npcCoopBase;
  if      (s.gasAtDecision > 250) pNpc = 0.10;
  else if (s.gasAtDecision > 150) pNpc = 0.40;
  const results = [];
  for (let pPlayer = 0; pPlayer <= 1.001; pPlayer += 0.1) {
    let total = 0;
    for (let run = 0; run < MC_RUNS; run++) {
      let payoff = 0;
      for (let r = 0; r < s.rounds; r++) {
        const pc = Math.random() < pPlayer ? "COOPERAR" : "COMPETIR";
        const nc = Math.random() < pNpc    ? "COOPERAR" : "COMPETIR";
        payoff += PAYOFF_MATRIX[pc][nc];
      }
      total += payoff;
    }
    results.push({ pPlayer: parseFloat(pPlayer.toFixed(1)), avgPayoff: parseFloat((total / MC_RUNS).toFixed(2)) });
  }
  return results;
}

// ----------------------------------------------------------------
//  RUNNER PRINCIPAL
// ----------------------------------------------------------------
function runMonteCarlo(sessionData) {
  const t0   = performance.now();
  const sim1 = mcSimEscapeProbByNpc(sessionData);
  const sim2 = mcSimGasDistribution(sessionData);
  const sim3 = mcSimPayoffByCoopRatio(sessionData);
  return { sim1, sim2, sim3, ms: (performance.now() - t0).toFixed(0), runs: MC_RUNS };
}

// ================================================================
//  RENDER  -  Boton en pantalla final + Modal con 3 tabs
// ================================================================
function renderMonteCarloPanel(mcResults, sessionData) {
  const { sim1, sim2, sim3, ms, runs } = mcResults;
  const realPNpc    = parseFloat(sessionData.npcCoopBase.toFixed(1));
  const realPen     = sessionData.penalties;
  const realPPlayer = parseFloat(sessionData.playerCoopRatio.toFixed(1));

  // Insight para tab 3
  const optSim3   = sim3.reduce((b, r) => r.avgPayoff > b.avgPayoff ? r : b, sim3[0]);
  const coopReal  = (sessionData.playerCoopRatio * 100).toFixed(0);
  const coopOpt   = (optSim3.pPlayer * 100).toFixed(0);
  const payoffOpt = (optSim3.avgPayoff >= 0 ? "+" : "") + optSim3.avgPayoff;
  const insightTxt = `Con el NPC que enfrentaste (gas ${sessionData.gasAtDecision.toFixed(0)} ppm), ` +
    `cooperar el <b>${coopOpt}%</b> de las veces maximizaba tu tiempo ganado (<b>${payoffOpt} s</b> por partida). ` +
    `Tu cooperaste el <b>${coopReal}%</b> de las veces.`;

  // ── BOTON en pantalla final ────────────────────────────────
  const btn = document.createElement('button');
  btn.id        = 'mc-open-btn';
  btn.className = 'mc-trigger-btn';
  btn.innerHTML = '<span class="mc-btn-icon">&#9707;</span> Ver Analisis Monte Carlo';
  btn.onclick   = openMcModal;
  const endBox       = document.querySelector('.end-box');
  const playAgainBtn = endBox.querySelector('.btn-primary');
  endBox.insertBefore(btn, playAgainBtn);

  // ── CHARTS: construir HTML de cada panel ─────────────────
  const maxProb1 = Math.max(...sim1.map(r => r.prob));
  const chart1   = sim1.map(r => {
    const pct    = maxProb1 > 0 ? (r.prob / maxProb1 * 100).toFixed(1) : 0;
    const isReal = Math.abs(r.pNpc - realPNpc) < 0.05;
    const color  = r.prob >= 70 ? '#4caf50' : r.prob >= 40 ? '#ff9800' : '#f44336';
    return `
      <div class="mc-bar-row ${isReal ? 'mc-bar-row--real' : ''}">
        <span class="mc-bar-lbl">${r.pNpc.toFixed(1)}</span>
        <div class="mc-bar-track">
          <div class="mc-bar-fill" style="width:${pct}%;background:${color}"></div>
        </div>
        <span class="mc-bar-val">${r.prob}%${isReal ? ' &larr; tu partida' : ''}</span>
      </div>`;
  }).join('');

  const table2 = sim2.map(r => {
    const isReal  = r.penalties === realPen;
    const dead50  = r.p50 >= 300;
    const dead90  = r.p90 >= 300;
    return `
      <tr class="${isReal ? 'mc-tr--real' : ''}">
        <td>${r.penalties}${isReal ? ' &larr;' : ''}</td>
        <td class="${dead50 ? 'mc-td--dead' : ''}">${r.p50} ppm${dead50 ? ' &#9760;' : ''}</td>
        <td class="${dead90 ? 'mc-td--dead' : ''}">${r.p90} ppm${dead90 ? ' &#9760;' : ''}</td>
      </tr>`;
  }).join('');

  const maxAbs3 = Math.max(...sim3.map(r => Math.abs(r.avgPayoff)));
  const chart3  = sim3.map(r => {
    const pct    = maxAbs3 > 0 ? (Math.abs(r.avgPayoff) / maxAbs3 * 100).toFixed(1) : 0;
    const isReal = Math.abs(r.pPlayer - realPPlayer) < 0.05;
    const color  = r.avgPayoff >= 0 ? '#4caf50' : '#f44336';
    const sign   = r.avgPayoff >= 0 ? '+' : '';
    return `
      <div class="mc-bar-row ${isReal ? 'mc-bar-row--real' : ''}">
        <span class="mc-bar-lbl">${(r.pPlayer * 100).toFixed(0)}%</span>
        <div class="mc-bar-track">
          <div class="mc-bar-fill" style="width:${pct}%;background:${color}"></div>
        </div>
        <span class="mc-bar-val">${sign}${r.avgPayoff}s${isReal ? ' &larr; tu partida' : ''}</span>
      </div>`;
  }).join('');

  // ── MODAL HTML ────────────────────────────────────────────
  const modal = document.createElement('div');
  modal.id    = 'mc-modal';
  modal.innerHTML = `
    <div class="mc-backdrop" onclick="closeMcModal()"></div>
    <div class="mc-box">

      <div class="mc-header">
        <div>
          <div class="mc-header-title">&#9707; Paradigma VII &mdash; Simulacion Monte Carlo</div>
          <div class="mc-header-meta">${parseInt(runs).toLocaleString()} simulaciones &middot; ${ms} ms &middot; datos de tu partida</div>
        </div>
        <button class="mc-close" onclick="closeMcModal()" title="Cerrar">&times;</button>
      </div>

      <div class="mc-tabs" role="tablist">
        <button class="mc-tab mc-tab--active" onclick="mcTab(0,this)">&#9312; Estrategia NPC</button>
        <button class="mc-tab"                onclick="mcTab(1,this)">&#9313; Gas y Errores</button>
        <button class="mc-tab"                onclick="mcTab(2,this)">&#9314; Cooperacion</button>
      </div>

      <div class="mc-panels">

        <!-- PANEL 0: NPC -->
        <div class="mc-panel mc-panel--active" id="mcp0">
          <div class="mc-panel-question">
            &iquest;Cuantos jugadores escaparian si el NPC fuera mas o menos cooperativo?
          </div>
          <p class="mc-panel-desc">
            Se simularon <b>${parseInt(runs).toLocaleString()} partidas</b> para cada nivel de cooperacion del NPC (de 10% a 100%).
            La barra muestra que porcentaje de esas partidas terminaria en <b>escape exitoso</b>.
            Tu partida real esta marcada con una flecha.
          </p>
          <div class="mc-chart-labels">
            <span>p_NPC</span><span>Probabilidad de escape</span>
          </div>
          <div class="mc-chart">${chart1}</div>
          <div class="mc-legend">
            <span class="mc-leg-dot" style="background:#4caf50"></span> &ge;70% escape &nbsp;
            <span class="mc-leg-dot" style="background:#ff9800"></span> 40-70% &nbsp;
            <span class="mc-leg-dot" style="background:#f44336"></span> &lt;40%
          </div>
        </div>

        <!-- PANEL 1: GAS -->
        <div class="mc-panel" id="mcp1">
          <div class="mc-panel-question">
            &iquest;Cuanto gas habria al final segun cuantos errores cometieras?
          </div>
          <p class="mc-panel-desc">
            Para cada numero posible de respuestas incorrectas (0 a 12), se simularon
            <b>${parseInt(runs).toLocaleString()} partidas</b> con variacion aleatoria en los tiempos.
            La fila de tus errores reales esta resaltada. El umbral letal sin mascara es <b>300 ppm</b>.
          </p>
          <table class="mc-table">
            <thead>
              <tr>
                <th>Errores</th>
                <th>P50 &mdash; mediana</th>
                <th>P90 &mdash; peor 10%</th>
              </tr>
            </thead>
            <tbody>${table2}</tbody>
          </table>
          <p class="mc-table-note">
            <b>P50:</b> la mitad de las simulaciones tuvieron ese gas o menos. &nbsp;
            <b>P90:</b> solo el 10% mas desfavorable supero ese nivel.
          </p>
        </div>

        <!-- PANEL 2: COOPERACION -->
        <div class="mc-panel" id="mcp2">
          <div class="mc-panel-question">
            &iquest;Cuanto tiempo habrias ganado si cooperaras mas o menos?
          </div>
          <p class="mc-panel-desc">
            Usando el mismo NPC que te toco (ajustado por el gas de tu partida), se simulo
            <b>${parseInt(runs).toLocaleString()} partidas</b> por cada posible ratio de cooperacion del jugador (0% a 100%).
          </p>
          <div class="mc-chart-labels">
            <span>% cooperas</span><span>Segundos esperados</span>
          </div>
          <div class="mc-chart">${chart3}</div>
          <div class="mc-insight">
            &#128161; ${insightTxt}
          </div>
        </div>

      </div>
    </div>`;

  document.body.appendChild(modal);
  // Forzar reflow para activar transicion CSS
  requestAnimationFrame(() => modal.classList.add('mc-modal--visible'));
}

// ── Funciones del modal ────────────────────────────────────────
function openMcModal() {
  const m = document.getElementById('mc-modal');
  if (m) {
    m.style.display = 'flex';
    requestAnimationFrame(() => m.classList.add('mc-modal--visible'));
  }
}
function closeMcModal() {
  const m = document.getElementById('mc-modal');
  if (m) {
    m.classList.remove('mc-modal--visible');
    setTimeout(() => { m.style.display = 'none'; }, 260);
  }
}
function mcTab(idx, el) {
  document.querySelectorAll('.mc-tab').forEach(t => t.classList.remove('mc-tab--active'));
  document.querySelectorAll('.mc-panel').forEach(p => p.classList.remove('mc-panel--active'));
  el.classList.add('mc-tab--active');
  document.getElementById('mcp' + idx).classList.add('mc-panel--active');
}

// ================================================================
//  ESTILOS  (inyectados dinamicamente)
// ================================================================
(function injectMcStyles() {
  const s = document.createElement('style');
  s.textContent = `
    /* ── Boton trigger ─────────────────────────────────── */
    .mc-trigger-btn {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 14px auto 4px;
      padding: 10px 24px;
      background: transparent;
      border: 1px solid var(--accent, #7ef);
      color: var(--accent, #7ef);
      font-family: 'Courier New', monospace;
      font-size: 13px;
      letter-spacing: 1px;
      border-radius: 4px;
      cursor: pointer;
      transition: background .2s, color .2s;
    }
    .mc-trigger-btn:hover {
      background: var(--accent, #7ef);
      color: #000;
    }
    .mc-btn-icon { font-size: 16px; }

    /* ── Overlay y caja ────────────────────────────────── */
    #mc-modal {
      display: none;
      position: fixed;
      inset: 0;
      z-index: 9999;
      align-items: center;
      justify-content: center;
      opacity: 0;
      transition: opacity .25s ease;
    }
    #mc-modal.mc-modal--visible { opacity: 1; }
    .mc-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(0,0,0,.72);
      backdrop-filter: blur(3px);
    }
    .mc-box {
      position: relative;
      width: min(680px, 96vw);
      max-height: 88vh;
      background: var(--surface, #141414);
      border: 1px solid var(--border, #2a2a2a);
      border-radius: 10px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-shadow: 0 24px 64px rgba(0,0,0,.7);
      transform: translateY(16px);
      transition: transform .25s ease;
    }
    #mc-modal.mc-modal--visible .mc-box { transform: translateY(0); }

    /* ── Header ─────────────────────────────────────────── */
    .mc-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding: 18px 20px 14px;
      border-bottom: 1px solid var(--border, #2a2a2a);
      flex-shrink: 0;
    }
    .mc-header-title {
      font-family: 'Courier New', monospace;
      font-size: 13px;
      font-weight: bold;
      letter-spacing: 1px;
      color: var(--accent, #7ef);
    }
    .mc-header-meta {
      font-family: 'Courier New', monospace;
      font-size: 10px;
      color: var(--text-dim, #666);
      margin-top: 3px;
    }
    .mc-close {
      background: none;
      border: none;
      color: var(--text-dim, #666);
      font-size: 22px;
      line-height: 1;
      cursor: pointer;
      padding: 0 4px;
      transition: color .15s;
    }
    .mc-close:hover { color: var(--text, #ccc); }

    /* ── Tabs ───────────────────────────────────────────── */
    .mc-tabs {
      display: flex;
      border-bottom: 1px solid var(--border, #2a2a2a);
      flex-shrink: 0;
    }
    .mc-tab {
      flex: 1;
      padding: 10px 4px;
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      color: var(--text-dim, #777);
      font-family: 'Courier New', monospace;
      font-size: 11px;
      cursor: pointer;
      transition: color .15s, border-color .15s;
    }
    .mc-tab:hover { color: var(--text, #ccc); }
    .mc-tab--active {
      color: var(--accent, #7ef) !important;
      border-bottom-color: var(--accent, #7ef);
    }

    /* ── Panels ─────────────────────────────────────────── */
    .mc-panels {
      overflow-y: auto;
      padding: 20px;
      flex: 1;
    }
    .mc-panel { display: none; }
    .mc-panel--active { display: block; }
    .mc-panel-question {
      font-family: 'Courier New', monospace;
      font-size: 13px;
      color: var(--accent, #7ef);
      font-weight: bold;
      margin-bottom: 8px;
    }
    .mc-panel-desc {
      font-size: 12px;
      color: var(--text-dim, #999);
      line-height: 1.6;
      margin: 0 0 16px;
    }
    .mc-panel-desc b { color: var(--text, #ccc); }

    /* ── Chart de barras ────────────────────────────────── */
    .mc-chart-labels {
      display: flex;
      justify-content: space-between;
      font-size: 9px;
      color: var(--text-dim, #666);
      margin-bottom: 4px;
      font-family: 'Courier New', monospace;
    }
    .mc-chart { display: flex; flex-direction: column; gap: 4px; }
    .mc-bar-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 2px 4px;
      border-radius: 3px;
    }
    .mc-bar-row--real {
      background: rgba(100,200,255,.07);
      outline: 1px solid rgba(100,200,255,.2);
    }
    .mc-bar-lbl {
      width: 34px;
      text-align: right;
      font-size: 10px;
      font-family: 'Courier New', monospace;
      color: var(--text-dim, #888);
      flex-shrink: 0;
    }
    .mc-bar-track {
      flex: 1;
      height: 14px;
      background: rgba(255,255,255,.05);
      border-radius: 3px;
      overflow: hidden;
    }
    .mc-bar-fill {
      height: 100%;
      border-radius: 3px;
      transition: width .5s ease;
    }
    .mc-bar-val {
      width: 120px;
      font-size: 10px;
      font-family: 'Courier New', monospace;
      color: var(--text-dim, #888);
      flex-shrink: 0;
    }
    .mc-bar-row--real .mc-bar-val {
      color: var(--accent, #7ef);
      font-weight: bold;
    }
    .mc-legend {
      margin-top: 10px;
      font-size: 10px;
      color: var(--text-dim, #777);
      display: flex;
      align-items: center;
      gap: 4px;
      flex-wrap: wrap;
    }
    .mc-leg-dot {
      display: inline-block;
      width: 10px; height: 10px;
      border-radius: 50%;
    }

    /* ── Tabla (panel 2) ────────────────────────────────── */
    .mc-table {
      width: 100%;
      border-collapse: collapse;
      font-family: 'Courier New', monospace;
      font-size: 11px;
    }
    .mc-table th {
      text-align: left;
      padding: 6px 10px;
      border-bottom: 1px solid var(--border, #2a2a2a);
      color: var(--text-dim, #888);
      font-weight: normal;
    }
    .mc-table td {
      padding: 5px 10px;
      border-bottom: 1px solid rgba(255,255,255,.04);
    }
    .mc-tr--real td {
      color: var(--accent, #7ef);
      font-weight: bold;
      background: rgba(100,200,255,.06);
    }
    .mc-td--dead { color: #f44336 !important; }
    .mc-table-note {
      font-size: 10px;
      color: var(--text-dim, #777);
      margin-top: 10px;
      line-height: 1.5;
    }

    /* ── Insight ────────────────────────────────────────── */
    .mc-insight {
      margin-top: 16px;
      padding: 12px 14px;
      background: rgba(100,200,255,.06);
      border-left: 3px solid var(--accent, #7ef);
      border-radius: 0 6px 6px 0;
      font-size: 12px;
      color: var(--text, #ccc);
      line-height: 1.7;
    }
    .mc-insight b { color: var(--accent, #7ef); }
  `;
  document.head.appendChild(s);
})();
