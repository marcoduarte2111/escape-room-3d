// ══════════════════════════════════════════════════════════════
//  UI.js — HUD y paneles superpuestos al mundo 3D
// ══════════════════════════════════════════════════════════════

const ITEM_ICON = {
  linterna: '🔦', cuaderno_cifrado: '📓', llave_oxidada: '🗝️', llave_maestra: '🔑',
  vendas: '🩹', mascara_gas: '😷', catalizador: '⚗️'
};
function itemIcon(item) { return ITEM_ICON[item] || '📦'; }

// ── Paneles superpuestos ──────────────────────────────────────
// 'step-menu' = volver a jugar (cerrar panel); el resto abre un panel.
let _overlayOpen = false;
function goStep(stepId) {
  const overlay = document.getElementById('overlay');
  if (stepId === 'step-menu') {
    if (!_overlayOpen) return;
    _overlayOpen = false;
    overlay.classList.add('hidden');
    document.querySelectorAll('.step').forEach(s => s.classList.add('hidden'));
    window._currentPuzzle = null;
    document.activeElement && document.activeElement.blur && document.activeElement.blur();
    World3D.closeOverlay();
    return;
  }
  _overlayOpen = true;
  document.querySelectorAll('.step').forEach(s => s.classList.add('hidden'));
  document.getElementById(stepId).classList.remove('hidden');
  overlay.classList.remove('hidden');
  World3D.openOverlay();

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

  const limEl = document.getElementById('gas-limit');
  if (limEl) limEl.textContent = thr + ' ppm';

  // Efectos visuales del gas en el mundo
  // Con postprocesado el tinte lo hace el shader final: la capa CSS solo acompaña
  document.getElementById('gas-vignette').style.opacity = (Math.min(1, pct * 1.1) * (GFX.preset().post ? 0.4 : 1)).toFixed(3);
  document.getElementById('mask-icon').classList.toggle('hidden', !GAS.hasMask);
  World3D.setGas(pct, state);
}

// ── HUD: Puntos de puzzle ─────────────────────────────────────
function updateDots(solvedIds) {
  PUZZLES.forEach(p => {
    const dot = document.getElementById(p.dot);
    if (dot) dot.classList.toggle('done', solvedIds.includes(p.id));
  });
}

// ── Tarjeta de sala (aparece al entrar y se desvanece) ────────
let _roomCardTimer = null;
function updateRoomCard(locationKey) {
  const room = ROOMS[locationKey];
  document.getElementById('room-name').textContent = room.label;
  document.getElementById('room-desc').textContent = room.desc;
  document.getElementById('room-tip').textContent  = room.tip;
  document.getElementById('hud-room').textContent  = room.label;
  const card = document.getElementById('room-card');
  card.classList.remove('show');
  void card.offsetWidth;            // reinicia la animación
  card.classList.add('show');
  clearTimeout(_roomCardTimer);
  _roomCardTimer = setTimeout(() => card.classList.remove('show'), 6500);
}

// ── Inventario (barra rápida 1-9) ─────────────────────────────
function updateInventoryUI(inventory) {
  const container = document.getElementById('inv-items');
  container.innerHTML = '';

  if (inventory.length === 0) {
    container.innerHTML = '<span class="inv-empty">inventario vacío</span>';
    return;
  }
  inventory.forEach((item, i) => {
    const slot     = document.createElement('div');
    slot.className = 'inv-slot' + (item === 'linterna' && World3D.isFlashOn() ? ' active' : '');
    slot.dataset.item = item;
    slot.title     = `${item}: ${ITEM_INFO[item]?.uso || ''}`;
    slot.innerHTML = `<span class="inv-key">${i + 1}</span><span class="inv-ico">${itemIcon(item)}</span><span class="inv-name">${item.replace('_', ' ')}</span>`;
    container.appendChild(slot);
  });
}

function UISetFlashIcon(on) {
  document.querySelectorAll('.inv-slot').forEach(s => {
    if (s.dataset.item === 'linterna') s.classList.toggle('active', on);
  });
}

// ── Conversación con M-7 ──────────────────────────────────────
function renderNpcChat(focus = false) {
  const log = document.getElementById('npc-chat-log');
  if (!log) return;
  log.innerHTML = '';
  npcChat.slice(-8).forEach(m => {
    const row = document.createElement('div');
    row.className = 'npc-chat-msg ' + m.role;
    row.textContent = (m.role === 'npc' ? 'M-7 › ' : 'TÚ › ') + m.text;
    log.appendChild(row);
  });
  if (npcChatBusy) {
    const row = document.createElement('div');
    row.className = 'npc-chat-msg npc thinking';
    row.textContent = 'M-7 › procesando…';
    log.appendChild(row);
  }
  log.scrollTop = log.scrollHeight;
  const input = document.getElementById('npc-chat-input');
  const send = document.getElementById('npc-chat-send');
  const out = npcMessagesLeft <= 0;
  input.disabled = send.disabled = out || npcChatBusy;
  input.placeholder = out ? 'M-7 ya no escucha: elige' : 'Convence a M-7… (Enter para enviar)';
  const note = document.getElementById('npc-chat-note');
  const mood = { amistoso: 'M-7 parece receptivo', hostil: 'M-7 parece hostil', neutral: 'M-7 parece indeciso' }[note.dataset.mood] || 'M-7 te observa';
  note.textContent = `${mood} · mensajes restantes: ${npcMessagesLeft} · ${AI.available ? 'IA conectada' : 'IA sin conexión (respuestas locales)'}`;
  if (focus) { note.dataset.mood = ''; setTimeout(() => input.focus(), 60); }
}

// ── Prompt de interacción (centro de pantalla) ────────────────
let _lastPrompt = null;
function UISetPrompt(text) {
  if (text === _lastPrompt) return;
  _lastPrompt = text;
  const el = document.getElementById('prompt');
  const ch = document.getElementById('crosshair');
  if (!text) { el.classList.add('hidden'); ch.classList.remove('hot'); return; }
  el.textContent = text;
  el.classList.remove('hidden');
  el.classList.toggle('locked', text.startsWith('🔒'));
  ch.classList.add('hot');
}

// ── Avisos breves ─────────────────────────────────────────────
let _toastTimer = null;
function UIToast(msg, tipo = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show ' + tipo;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.className = 'toast ' + tipo; }, 2600);
}

function flashDamage() {
  const el = document.getElementById('damage-flash');
  el.classList.remove('on');
  void el.offsetWidth;
  el.classList.add('on');
}

// ── Log lateral ───────────────────────────────────────────────
function addLog(msg, tipo = 'info') {
  const t    = elapsed();
  const cont = document.getElementById('log-lines');
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `
    <span class="log-time">[${t.toFixed(1)}s]</span>
    <span class="log-msg ${tipo}"></span>
  `;
  entry.querySelector('.log-msg').textContent = msg;
  cont.appendChild(entry);
  while (cont.children.length > 120) cont.removeChild(cont.firstChild);
  cont.scrollTop = cont.scrollHeight;
}

// ── Puzzle: inyectar contenido ────────────────────────────────
function renderPuzzleStep() {
  const puzzle = window._currentPuzzle;
  if (!puzzle) { goStep('step-menu'); return; }

  const tag = puzzle.required ? 'OBLIGATORIO' : 'BONUS ⭐';
  document.getElementById('puzzle-title').textContent = `${puzzle.title} [${tag}]`;
  document.getElementById('puzzle-desc').textContent  = puzzle.desc + '\n\n' + puzzle.pregunta;
  const input = document.getElementById('puzzle-input');
  input.value       = '';
  input.disabled    = false;
  input.placeholder = puzzle.pregunta;

  document.getElementById('puzzle-actions').classList.remove('hidden');
  document.getElementById('puzzle-continue').classList.add('hidden');

  const fb = document.getElementById('puzzle-feedback');
  fb.className = 'puzzle-feedback hidden';

  setTimeout(() => input.focus(), 60);
}

function setPuzzleSolvedUI() {
  document.getElementById('puzzle-input').disabled = true;
  document.getElementById('puzzle-actions').classList.add('hidden');
  const btn = document.getElementById('puzzle-continue');
  btn.classList.remove('hidden');
  setTimeout(() => btn.focus(), 30);
}

// ── Feedback de puzzle ────────────────────────────────────────
function showPuzzleFeedback(ok, mensaje) {
  const fb = document.getElementById('puzzle-feedback');
  fb.textContent = mensaje;
  if (ok === true)       fb.className = 'puzzle-feedback ok';
  else if (ok === false) fb.className = 'puzzle-feedback err';
  else                   fb.className = 'puzzle-feedback hint';
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
  World3D.setNpcMood(strategy);
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
