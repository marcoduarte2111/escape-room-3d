// ══════════════════════════════════════════════════════════════
//  UI.js — Funciones de interfaz de usuario
// ══════════════════════════════════════════════════════════════

// ── Navegación entre pasos ────────────────────────────────────
function goStep(stepId) {
  document.querySelectorAll('.step').forEach(s => s.classList.add('hidden'));
  document.getElementById(stepId).classList.remove('hidden');

  if (stepId === 'step-move')   renderMoveList();
  if (stepId === 'step-pick')   renderPickList();
  if (stepId === 'step-use')    renderUseList();
  if (stepId === 'step-puzzle') renderPuzzleStep();
}

// ── HUD: Timer ────────────────────────────────────────────────
function updateTimer(remaining) {
  const m  = Math.floor(remaining / 60);
  const s  = Math.floor(remaining % 60);
  const el = document.getElementById('timer');
  el.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  el.className   = 'hud-timer' +
    (remaining <= 60 ? ' crit' : remaining <= 120 ? ' warn' : '');
}

// ── HUD: Gas ──────────────────────────────────────────────────
function updateGasUI(t) {
  const G   = gasConcentration(t);
  const thr = gasThreshold();
  const pct = Math.min(G / thr, 1.0);

  const fill = document.getElementById('gas-fill');
  fill.style.width = (pct * 100) + '%';
  fill.className   = 'gas-fill' +
    (pct >= 0.8 ? ' crit' : pct >= 0.5 ? ' warn' : '');

  const state  = getGasState(G);
  const ppmEl  = document.getElementById('gas-ppm');
  ppmEl.textContent = G.toFixed(1) + ' ppm (' + state + ')';

  if      (state === "SEGURO")  ppmEl.style.color = "var(--green)";
  else if (state === "ALERTA")  ppmEl.style.color = "var(--yellow)";
  else if (state === "PELIGRO") ppmEl.style.color = "orange";
  else                          ppmEl.style.color = "var(--red)";

  // Actualizar límite visible
  const limEl = document.getElementById('gas-limit');
  if (limEl) limEl.textContent = thr + ' ppm';
}

// ── HUD: Puntos de puzzle ─────────────────────────────────────
function updateDots(solvedIds) {
  PUZZLES.forEach(p => {
    const dot = document.getElementById(p.dot);
    if (dot) dot.classList.toggle('done', solvedIds.includes(p.id));
  });
}

// ── Tarjeta de sala ───────────────────────────────────────────
function updateRoomCard(locationKey) {
  const room = ROOMS[locationKey];
  document.getElementById('room-name').textContent = room.label;
  document.getElementById('room-desc').textContent = room.desc;
  document.getElementById('room-tip').textContent  = room.tip;
}

// ── Inventario ────────────────────────────────────────────────
function updateInventoryUI(inventory) {
  const container = document.getElementById('inv-items');
  container.innerHTML = '';

  if (inventory.length === 0) {
    container.innerHTML = '<span class="inv-empty">vacío</span>';
    return;
  }
  inventory.forEach(item => {
    const chip     = document.createElement('div');
    chip.className = 'inv-chip';
    chip.textContent = item;
    chip.title     = ITEM_INFO[item]?.uso || '';
    chip.onclick   = () => showItemTip(item);
    container.appendChild(chip);
  });
}

let tipTimeout = null;
function showItemTip(item) {
  const info = ITEM_INFO[item];
  const tip  = document.getElementById('item-tip');
  tip.textContent = `${item}: ${info?.uso || 'sin uso especial'}`;
  tip.classList.remove('hidden');
  clearTimeout(tipTimeout);
  tipTimeout = setTimeout(() => tip.classList.add('hidden'), 3000);
}

// ── Log lateral ───────────────────────────────────────────────
function addLog(msg, tipo = 'info') {
  const t    = (Date.now() - window._startTime) / 1000;
  const cont = document.getElementById('log-lines');
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `
    <span class="log-time">[${t.toFixed(1)}s]</span>
    <span class="log-msg ${tipo}">${msg}</span>
  `;
  cont.appendChild(entry);
  cont.scrollTop = cont.scrollHeight;
}

// ── Listas de opciones ────────────────────────────────────────

function renderMoveList() {
  const list = document.getElementById('move-list');
  list.innerHTML = '';
  const destinos = Object.keys(ROOMS).filter(r => r !== window._state.location);

  destinos.forEach(r => {
    const room     = ROOMS[r];
    const check    = canEnterRoom(r);
    const puzzPend = PUZZLES.filter(p => p.room === r && !window._state.solved.includes(p.id)).length;
    const itemsPend = (ITEMS_IN_ROOMS[r] || []).filter(i => !window._state.inventory.includes(i)).length;

    let sub = '';
    if (!check.ok) {
      sub = '🔒 ' + check.razon;
    } else {
      if (puzzPend  > 0) sub += `🧩 ${puzzPend} acertijo${puzzPend > 1 ? 's' : ''}  `;
      if (itemsPend > 0) sub += `📦 ${itemsPend} objeto${itemsPend > 1 ? 's' : ''}`;
      if (!sub) sub = 'Sin pendientes';
    }

    const btn = document.createElement('button');
    btn.className = 'choice-btn' + (!check.ok ? ' locked' : '');
    btn.innerHTML = `<span>${room.label}</span><span class="choice-sub">${sub}</span>`;
    btn.onclick = () => doMove(r);
    list.appendChild(btn);
  });
}

function renderPickList() {
  const list = document.getElementById('pick-list');
  list.innerHTML = '';
  const disponibles = (ITEMS_IN_ROOMS[window._state.location] || [])
    .filter(i => !window._state.inventory.includes(i));

  if (disponibles.length === 0) {
    list.innerHTML = '<p style="color:var(--text-dim);font-size:12px">No hay objetos nuevos aquí.</p>';
    return;
  }

  disponibles.forEach(item => {
    const btn = document.createElement('button');
    btn.className = 'choice-btn';
    btn.innerHTML = `
      <span>${item}</span>
      <span class="choice-sub">${ITEM_INFO[item]?.desc || ''}</span>
    `;
    btn.onclick = () => doPick(item);
    list.appendChild(btn);
  });
}

function renderUseList() {
  const list = document.getElementById('use-list');
  list.innerHTML = '';

  if (window._state.inventory.length === 0) {
    list.innerHTML = '<p style="color:var(--text-dim);font-size:12px">Inventario vacío.</p>';
    return;
  }

  window._state.inventory.forEach(item => {
    const btn = document.createElement('button');
    btn.className = 'choice-btn';
    btn.innerHTML = `
      <span>${item}</span>
      <span class="choice-sub">${ITEM_INFO[item]?.uso || 'sin uso conocido aquí'}</span>
    `;
    btn.onclick = () => doUse(item);
    list.appendChild(btn);
  });
}

// ── Puzzle: inyectar contenido ────────────────────────────────
function renderPuzzleStep() {
  const puzzle = window._currentPuzzle;
  if (!puzzle) { goStep('step-menu'); return; }

  const tag = puzzle.required ? 'OBLIGATORIO' : 'BONUS ⭐';
  document.getElementById('puzzle-title').textContent = `${puzzle.title} [${tag}]`;
  document.getElementById('puzzle-desc').textContent  = puzzle.desc;
  document.getElementById('puzzle-input').value       = '';
  document.getElementById('puzzle-input').placeholder = puzzle.pregunta;

  const fb = document.getElementById('puzzle-feedback');
  fb.classList.add('hidden');
  fb.className = 'puzzle-feedback hidden';

  setTimeout(() => document.getElementById('puzzle-input').focus(), 100);
}

// ── Feedback de puzzle ────────────────────────────────────────
function showPuzzleFeedback(ok, mensaje) {
  const fb = document.getElementById('puzzle-feedback');
  fb.textContent = mensaje;
  if (ok === true)       fb.className = 'puzzle-feedback ok';
  else if (ok === false) fb.className = 'puzzle-feedback err';
  else                   fb.className = 'puzzle-feedback hint';
  fb.classList.remove('hidden');
}

// ── NPC: actualizar panel (Paradigma VI) ─────────────────────
function updateNpcUI(strategy) {
  const msgEl  = document.getElementById('npc-msg');
  const badge  = document.getElementById('npc-badge');

  const coopLines = [
    "Parece querer ayudarte...",
    "Te observa con calma...",
    "Asiente ligeramente...",
    "Señala algo importante..."
  ];
  const compLines = [
    "Algo no cuadra...",
    "Su mirada es extraña...",
    "Parece confundirte...",
    "No confíes del todo..."
  ];

  const lines = strategy === "COOPERAR" ? coopLines : compLines;
  if (msgEl) msgEl.textContent = lines[Math.floor(Math.random() * lines.length)];

  if (badge) {
    badge.textContent = strategy === "COOPERAR" ? "COOPERAR" : "COMPETIR";
    badge.className   = strategy === "COOPERAR" ? "npc-badge badge-coop" : "npc-badge badge-comp";
  }
}

// ── Markov: actualizar panel (Paradigma IV) ──────────────────
function updateMarkovPanel(stateName, ventilated) {
  const stateEl = document.getElementById('markov-state-val');
  const matEl   = document.getElementById('markov-matrix-val');

  if (stateEl) {
    stateEl.textContent = stateName;
    stateEl.className   = 'mk-state mk-' + stateName.toLowerCase();
  }
  if (matEl) {
    matEl.textContent = ventilated ? 'P_ABIERTA' : 'P_CERRADA';
    matEl.className   = ventilated ? 'mk-matrix open' : 'mk-matrix closed';
  }
}
