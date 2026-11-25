// ══════════════════════════════════════════════════════════════
//  game.js — Controlador principal
//
//  La lógica (paradigmas I–VII) es la misma de la versión 2D; lo que
//  cambia es quién dispara las acciones: ahora es el mundo 3D
//  (world3d.js) cuando el jugador camina, mira y pulsa [E].
// ══════════════════════════════════════════════════════════════

window._state = {
  location:   "ENTRADA",
  inventory:  [],
  solved:     [],
  bonusTime:  0,
  mirrorReward: false,
  ventilated: false
};

let npcStrategy   = "COOPERAR";
let npcGameChoice = "COOPERAR";
let lastNpcUpdate = 0;

window._currentPuzzle = null;
window._startTime     = null;
let _loopInterval     = null;
let _ended            = false;
let _pausedAt         = null;   // pausa real (menú Esc): congela reloj y gas
let _puzzleBusy       = false;

// ── Paradigma VI: Teoría de Juegos ────────────────────────────
// Matriz de pagos: filas = jugador, columnas = NPC
const PAYOFF_MATRIX = {
  COOPERAR: { COOPERAR: 20, COMPETIR: -10 },
  COMPETIR: { COOPERAR: 15, COMPETIR:   5 }
};
// p = (d-b)/(a-b-c+d) = (5-(-10))/(20-(-10)-15+5) = 15/20 = 0.75
const NPC_P_COOP  = 0.75;
const npcAI = createNpcAI();
const GAME_VALUE  = 12.5;
const NPC_COOLDOWN = 20;        // s entre rondas (evita "farmear" tiempo infinito)

let totalGamePayoff  = 0;
let gameTheoryRounds = 0;
let lastNpcRound     = -Infinity;

// Conversación con M-7: lo que digas desplaza su probabilidad de cooperar
// (como mucho ±0.25 sobre la estrategia mixta; la decisión sigue siendo al azar).
const NPC_MAX_PERSUASION = 0.25;
const NPC_MESSAGES_PER_ROUND = 4;
let npcPersuasion   = 0;
let npcMessagesLeft = NPC_MESSAGES_PER_ROUND;
let npcChatBusy     = false;
const npcChat       = [];        // {role: 'player' | 'npc', text}
const npcPastRounds = [];        // "jugador COOPERAR / M-7 COMPETIR"
let aiHints = 0;

// ── Paradigma IV: Markov ──────────────────────────────────────
let markovTransitions = 0;
let _lastMarkovTick   = 0;
const MARKOV_INTERVAL = 10; // segundos entre ticks

// ── Paradigma V: HMM ─────────────────────────────────────────
let hintsRequested = 0;

function elapsed() {
  if (window._startTime === null) return 0;
  const now = _pausedAt !== null ? _pausedAt : Date.now();
  return (now - window._startTime) / 1000;
}
function totalTime() { return TIME_LIMIT + window._state.bonusTime; }

function hunterCaughtPlayer() {
  if (_ended) return;
  window._state.bonusTime -= 22;
  const t = elapsed();
  updateTimer(Math.max(0, totalTime() - t));
  recordEvent("El asesino te alcanzó: −22 s", t);
  addLog("El asesino te alcanzó. Pierdes 22 segundos.", "err");
  UIToast("El asesino te alcanzó · −22 s", "err");
  SFX.err();
}

// Media móvil exponencial del tiempo por acertijo, normalizado por etapa.
const mazePaceTargets = { P1: 45, P2: 40, P3: 55 };
let mazePace = 1;
let mazeSamples = 0;
let lastMazeMilestone = 0;

function observeMazePace(puzzleId, time) {
  const target = mazePaceTargets[puzzleId];
  if (!target) return;
  const pace = (time - lastMazeMilestone) / target;
  mazePace = mazeSamples ? mazePace * 0.55 + pace * 0.45 : pace;
  mazeSamples++;
  lastMazeMilestone = time;
}

function canOpenWorldDoor(door) {
  const access = canEnterRoom(door.to);
  if (!access.ok || !door.detour || window._state.mirrorReward) return access;
  const t = elapsed();
  const critical = totalTime() - t <= 60 || gasConcentration(t) >= gasThreshold() * 0.72;
  if (mazeSamples >= 2 && mazePace < 1 && !critical) {
    return { ok: false, razon: "El laberinto detectó un avance rápido. Desvío: " + door.detour + "." };
  }
  return access;
}

function rewardMirrorRoom() {
  if (_ended || window._state.mirrorReward) return;
  const bonus = 25;
  window._state.mirrorReward = true;
  window._state.bonusTime += bonus;
  updateTimer(Math.max(0, totalTime() - elapsed()));
  recordEvent("Anomalía de espejos estabilizada: +25 s y atajos habilitados", elapsed());
  addLog("Anomalía estabilizada. +25 s. Los atajos volverán a responder al resolver los acertijos.", "ok");
  UIToast("Anomalía estabilizada · +25 s · Bloqueos adaptativos anulados", "ok");
}

function pauseClock()  { if (_pausedAt === null && !_ended && window._startTime !== null) _pausedAt = Date.now(); }
function resumeClock() {
  if (_pausedAt === null) return;
  window._startTime += Date.now() - _pausedAt;
  _pausedAt = null;
}

// ══════════════════════════════════════════════════════════════
//  INICIO
// ══════════════════════════════════════════════════════════════
function startGame() {
  document.getElementById('intro').classList.add('hidden');
  document.getElementById('game').classList.remove('hidden');

  SFX.init();
  World3D.init(document.getElementById('viewport'));

  window._startTime = Date.now();
  updateRoomCard("ENTRADA");
  updateInventoryUI([]);
  updateNpcUI(npcGameChoice);

  recordEvent("Temporizador programado en t=" + totalTime() + "s", 0);
  addLog("¡Escapa antes de que el gas te consuma!", "sys");
  addLog("Ruta: Laboratorio → Cripta → Archivo → Cámara Final", "warn");
  addLog("El laberinto adapta los atajos a tu ritmo. La sala de espejos queda al oeste del laboratorio.", "sys");
  addLog("⚠ Equivocarte en un puzzle aumenta el gas y hace sonar una alarma.", "warn");
  AI.ready.then(() => addLog(AI.available
    ? "IA conectada: M-7 conversa, las pistas se adaptan a tus errores y el Vigilante te observa."
    : "IA sin conexión: se usa la lógica local (inicia el juego con JUGAR.bat y una clave para activarla).", "sys"));

  World3D.start();
  gameLoop();
  _loopInterval = setInterval(gameLoop, 300);
}

// ── Paradigma VI: NPC con estrategia óptima p=0.75 ───────────
function npcMove(persuasion = 0) {
  const G = gasConcentration(elapsed());

  npcGameChoice = npcAI.choose(NPC_P_COOP + persuasion, G);
  npcStrategy   = npcGameChoice;
}

// ══════════════════════════════════════════════════════════════
//  GAME LOOP (lógica, cada 300 ms — el render 3D va aparte)
// ══════════════════════════════════════════════════════════════
function gameLoop() {
  if (_ended) return;
  const t         = elapsed();
  const remaining = Math.max(0, totalTime() - t);

  updateTimer(remaining);
  updateGasUI(t);
  Director.tick(t);      // Monte Carlo en vivo + megafonía

  // ── Tick de Cadena de Markov cada MARKOV_INTERVAL segundos ─
  if (t - _lastMarkovTick >= MARKOV_INTERVAL) {
    _lastMarkovTick = t;
    const mk = markovStep(t, window._state.ventilated);
    if (mk.changed) {
      markovTransitions++;
      recordEvent(
        `Markov: ${mk.prevState}→${mk.newState} (${window._state.ventilated ? 'P_ABIERTA' : 'P_CERRADA'})`,
        t
      );
    }
    const lbl = document.getElementById('gas-state-label');
    if (lbl) lbl.textContent = mk.newState;
    updateMarkovPanel(mk.newState, window._state.ventilated);
  }

  // ── NPC update cada 8 segundos ─────────────────────────────
  if (t - lastNpcUpdate > 8) {
    npcMove();
    lastNpcUpdate = t;
    updateNpcUI(npcGameChoice);
  }

  if (remaining <= 0) {
    recordEvent("Tiempo agotado → t=" + totalTime().toFixed(0) + "s", t);
    endGame('timeout');
    return;
  }
  if (gasConcentration(t) >= gasThreshold()) {
    endGame('gas');
  }
}

// ══════════════════════════════════════════════════════════════
//  PARADIGMA VI — Interacción jugador/NPC
// ══════════════════════════════════════════════════════════════
function openNpc() {
  const wait = NPC_COOLDOWN - (elapsed() - lastNpcRound);
  if (wait > 0) {
    UIToast(`M-7 recarga baterías. Vuelve en ${Math.ceil(wait)} s`, 'warn');
    return;
  }
  npcPersuasion = 0;
  npcMessagesLeft = NPC_MESSAGES_PER_ROUND;
  npcChatBusy = false;
  goStep('step-npc');
  renderNpcChat(true);
  if (!npcChat.length) npcSay('npc', 'Unidad M-7. Batería al 31 %. Di lo que quieras antes de elegir, humano: te escucho.');
}

// ── Conversación (IA si hay servidor; si no, reglas locales) ──
function npcSay(role, text) {
  npcChat.push({ role, text });
  if (npcChat.length > 24) npcChat.shift();
  renderNpcChat();
}

function localNpcReply(text) {
  const t = text.toLowerCase();
  let trust = -0.1;
  if (/(por favor|junt|ayud|promet|conf[ií]|equipo|sal(ir|gamos|imos)|bater|energ|compart|trato|ambos|los dos)/.test(t)) trust += 0.55;
  if (/(amenaz|destru|romp|apag|chatarra|idiota|est[uú]pid|obedece|orden|desguaz|inútil|inutil)/.test(t)) trust -= 0.7;
  if (npcPastRounds.length && /jugador COMPETIR/.test(npcPastRounds[npcPastRounds.length - 1])) trust -= 0.3;
  trust -= Math.min(0.3, gasConcentration(elapsed()) / gasThreshold() * 0.3);
  const pools = trust > 0.2
    ? ['Tu propuesta es… razonable. Mis circuitos casi te creen.', 'Compartir energía. Hace décadas que nadie me lo ofrecía.', 'Anotado. Si mientes, lo recordaré.']
    : trust < -0.3
      ? ['Hostilidad detectada. Mala estrategia, humano.', 'Mis sensores registran una amenaza. No esperes favores.', 'Ya me fallaste antes. Los robots no olvidamos.']
      : ['Palabras. Necesito algo más que palabras.', 'El gas corroe mis juntas. Dame un motivo para arriesgarme.', 'Procesando… sin conclusión.'];
  return { reply: pools[Math.floor(Math.random() * pools.length)], trust: Math.max(-1, Math.min(1, trust)), mood: trust > 0.2 ? 'amistoso' : trust < -0.3 ? 'hostil' : 'neutral' };
}

async function npcSend() {
  const input = document.getElementById('npc-chat-input');
  const text = input.value.trim();
  if (!text || npcChatBusy || npcMessagesLeft <= 0 || _ended) return;
  input.value = '';
  npcMessagesLeft--;
  npcChatBusy = true;
  npcSay('player', text);
  renderNpcChat();
  const t = elapsed();
  const res = await AI.npc(npcChat.slice(-10), {
    gasPct: gasConcentration(t) / gasThreshold(),
    remaining: totalTime() - t,
    solved: PUZZLES.filter(p => p.required && window._state.solved.includes(p.id)).length,
    pastRounds: npcPastRounds.slice(-4).join('; ') || 'ninguna'
  }) || localNpcReply(text);
  npcChatBusy = false;
  if (_ended) return;
  npcPersuasion = res.trust * NPC_MAX_PERSUASION;
  npcSay('npc', res.reply);
  World3D.npcReact(res.mood === 'hostil' ? 'No' : res.mood === 'amistoso' ? 'Yes' : 'Jump', res.mood !== 'hostil');
  const note = document.getElementById('npc-chat-note');
  if (note) note.dataset.mood = res.mood;
  renderNpcChat();
  recordEvent(`TJ conversación: M-7 queda ${res.mood} (persuasión ${npcPersuasion >= 0 ? '+' : ''}${npcPersuasion.toFixed(2)})`, t);
}

function playerChooseCooperation(action) {
  if (_ended) return;
  const t = elapsed();
  npcMove(npcPersuasion); // el NPC también decide (tu conversación inclina la balanza)

  const npcAction = npcGameChoice;
  npcAI.observe(action);
  npcPastRounds.push(`jugador ${action} / M-7 ${npcAction}`);
  npcSay('npc', npcAction === 'COOPERAR'
    ? (action === 'COOPERAR' ? 'Energía compartida. Trato cumplido.' : 'Cooperé… y tú no. Registrado en memoria permanente.')
    : (action === 'COOPERAR' ? 'Lo siento, humano. Mi batería es lo primero.' : 'Los dos desconfiamos. Previsible.'));
  World3D.npcReact(npcAction === 'COOPERAR' ? 'ThumbsUp' : 'No', npcAction === 'COOPERAR');
  const payoff    = PAYOFF_MATRIX[action][npcAction];
  totalGamePayoff += payoff;
  gameTheoryRounds++;
  lastNpcRound = t;

  recordEvent(`TJ: Jugador=${action} | NPC=${npcAction} | Pago=${payoff >= 0 ? '+' : ''}${payoff}s | persuasión=${npcPersuasion >= 0 ? '+' : ''}${npcPersuasion.toFixed(2)}`, t);
  npcPersuasion = 0;

  window._state.bonusTime += payoff;

  if (payoff >= 0) {
    addLog(`🤝 ${action} vs M-7 ${npcAction}: +${payoff}s al reloj.`, "ok");
    UIToast(`M-7 eligió ${npcAction} → +${payoff} s`, 'ok');
    SFX.ok();
  } else {
    addLog(`⚔ ${action} vs M-7 ${npcAction}: ${payoff}s del reloj.`, "err");
    UIToast(`M-7 eligió ${npcAction} → ${payoff} s`, 'err');
    SFX.err();
  }

  updateNpcUI(npcAction);
  goStep('step-menu');
}

// ══════════════════════════════════════════════════════════════
//  ACCESO A SALAS
// ══════════════════════════════════════════════════════════════
function canEnterRoom(roomKey) {
  const access = ROOM_ACCESS[roomKey];
  if (!access) return { ok: true };

  for (const pid of access.requierePuzzles) {
    if (!window._state.solved.includes(pid)) {
      const puzzle = PUZZLES.find(p => p.id === pid);
      return { ok: false, razon: `Primero debes resolver: "${puzzle?.title}" en ${ROOMS[puzzle?.room]?.label}` };
    }
  }
  if (access.requiereItem && !window._state.inventory.includes(access.requiereItem)) {
    return { ok: false, razon: `Necesitas tener: ${access.requiereItem}` };
  }
  return { ok: true };
}

// ══════════════════════════════════════════════════════════════
//  ACCIONES
// ══════════════════════════════════════════════════════════════

// ── Mover: el jugador cruza físicamente a otra sala ───────────
function enterRoom(destino, firstVisit) {
  if (_ended || destino === window._state.location) return;
  const t = elapsed();
  window._state.location = destino;
  fsmTransition("EXPLORANDO", t);
  recordEvent("Jugador se mueve → " + ROOMS[destino].label, t);
  addLog("Entras a " + ROOMS[destino].label, "sys");
  updateRoomCard(destino, firstVisit);
}

// ── Recoger ───────────────────────────────────────────────────
function doPick(item, room) {
  if (_ended) return;
  const t = elapsed();
  const from = room || window._state.location;
  window._state.inventory.push(item);
  // Se retira del mundo para que no reaparezca (p. ej. tras gastar el catalizador)
  const list = ITEMS_IN_ROOMS[from];
  if (list && list.includes(item)) list.splice(list.indexOf(item), 1);

  fsmTransition("RECOGIENDO", t);
  recordEvent("Objeto recogido → " + item, t);
  addLog("Recogiste: " + item, "ok");
  addLog("💡 " + (ITEM_INFO[item]?.uso || ''), "warn");
  UIToast(`${itemIcon(item)} ${item} recogido`, 'ok');
  SFX.pick();
  World3D.makeNoise(6);          // el asesino puede oírlo si está cerca

  if (item === 'mascara_gas') {
    GAS.hasMask = true;
    addLog("😷 Máscara equipada. Umbral → 500 ppm.", "ok");
  }

  updateInventoryUI(window._state.inventory);
  World3D.syncItems();
  fsmTransition("EXPLORANDO", t);
}

// ── Usar ──────────────────────────────────────────────────────
function doUse(item) {
  if (_ended) return;
  const t   = elapsed();
  const loc = window._state.location;
  fsmTransition("USANDO", t);
  recordEvent("Objeto usado → " + item, t);

  if (item === 'mascara_gas') {
    GAS.hasMask = true;
    addLog("😷 Máscara equipada. Umbral → 500 ppm.", "ok");

  } else if (item === 'llave_maestra') {
    addLog("La llave_maestra te permite acceder a la CÁMARA FINAL.", "warn");
    addLog("💡 La puerta está al oeste del ARCHIVO.", "warn");

  } else if (item === 'llave_oxidada') {
    if (loc === 'LABORATORIO') addLog("Úsala en la Caja fuerte (pared norte del LABORATORIO): mírala y pulsa [E].", "ok");
    else { addLog("Esta llave se usa en el LABORATORIO.", "warn"); addLog("💡 Solo sirve allí.", "warn"); }

  } else if (item === 'linterna') {
    if (loc === 'ARCHIVO') {
      addLog("Texto revelado: 'Las fechas siguen una progresión aritmética.'", "ok");
      addLog("Apunta la linterna a la pared norte del ARCHIVO.", "ok");
    } else {
      addLog("La linterna es útil en el ARCHIVO, que está adelante. [F] la enciende/apaga.", "warn");
    }

  } else if (item === 'catalizador') {
    gasUseCatalyst(t);
    window._state.inventory.splice(window._state.inventory.indexOf('catalizador'), 1);
    updateInventoryUI(window._state.inventory);
    addLog("Catalizador usado. Emisión de gas reducida.", "ok");
    UIToast("⚗️ Emisión de gas reducida", 'ok');
    SFX.ok();
    recordEvent("Catalizador aplicado (Q=" + GAS.Q.toFixed(2) + ")", t);

  } else if (item === 'cuaderno_cifrado') {
    if (loc === 'CRIPTA') {
      addLog("El cuaderno: 'Fibonacci — cada número = suma de los dos anteriores.'", "ok");
    } else {
      addLog("El cuaderno da pistas sobre la CRIPTA, que está adelante.", "warn");
    }

  } else if (item === 'vendas') {
    addLog("Te vendas las manos. Sin efecto mecánico.", "info");

  } else {
    addLog("No encuentras cómo usar " + item + " aquí.", "warn");
  }

  fsmTransition("EXPLORANDO", t);
}

// ── Abrir ventana ─────────────────────────────────────────────
function doVent() {
  if (_ended || window._state.ventilated) return;
  const t = elapsed();
  gasOpenVent(t);
  window._state.ventilated = true;
  recordEvent("Ventana abierta en CRIPTA (V=0.015, Q=0.3)", t);
  addLog("Ventana abierta. Gas sube más lento.", "ok");
  UIToast("💨 Ventana abierta: el gas sube más lento", 'ok');
  World3D.openWindow();
}

// ── Puzzle: abrir desde su estación en el mundo ──────────────
function openPuzzleStation(pid) {
  const puzzle = PUZZLES.find(p => p.id === pid);
  if (!puzzle) return;
  if (window._state.solved.includes(pid)) {
    UIToast("✔ Ya resolviste: " + puzzle.title, 'ok');
    return;
  }
  launchPuzzle(puzzle);
}

function launchPuzzle(puzzle) {
  if (puzzle.requiresItem && !window._state.inventory.includes(puzzle.requiresItem)) {
    addLog("Necesitas primero: " + puzzle.requiresItem, "err");
    addLog("💡 " + (ITEM_INFO[puzzle.requiresItem]?.uso || ''), "warn");
    UIToast("🔒 Necesitas: " + puzzle.requiresItem, 'err');
    SFX.locked();
    return;
  }
  window._currentPuzzle = puzzle;
  _puzzleBusy = false;
  goStep('step-puzzle');
}

// ── Paradigma V: Pedir pista voluntariamente ─────────────────
function requestHint() {
  const puzzle = window._currentPuzzle;
  if (!puzzle || _puzzleBusy || _ended) return;

  const t = elapsed();
  nextHintState();  // transición de estado oculto (Matriz A)
  hintsRequested++;

  let hintCost = 0;
  if (currentHintState === "CONFIABLE") hintCost = 5;
  if (currentHintState === "AMBIGUA")   hintCost = 10;
  if (currentHintState === "ENGANOSA")  hintCost = 15;

  window._state.bonusTime -= hintCost;

  // Samplear observación mediante Matriz B
  const hint = sampleHintForPuzzle(puzzle.id);
  recordEvent(`HMM pista ${puzzle.id} — costo ${hintCost}s`, t);
  addLog(`💡 Pista solicitada (-${hintCost}s)`, "warn");

  // Mostrar sin revelar el estado oculto
  const show = text => showPuzzleFeedback(null, `💡 Observación: ${text}\n(-${hintCost}s del reloj)`);
  show(hint.text);
  upgradeHint(puzzle, null, hint, show);
}

// Con IA, la pista se reescribe a medida (mismo TIPO que emitió el HMM).
// Si la IA no responde, se queda la pista local que ya se está mostrando.
function upgradeHint(puzzle, wrongAnswer, hint, show) {
  if (!AI.available) return;
  AI.hint(puzzle, wrongAnswer, hint.type).then(res => {
    if (!res || !res.hint || _ended || window._currentPuzzle !== puzzle) return;
    if (window._state.solved.includes(puzzle.id)) return;
    aiHints++;
    show(res.hint);
    addLog("💡 " + res.hint, "warn");
  });
}

// ── Puzzle: responder ─────────────────────────────────────────
function submitPuzzle() {
  const puzzle = window._currentPuzzle;
  if (!puzzle || _puzzleBusy || _ended) return;

  const input = document.getElementById('puzzle-input');
  const ans = input.value.trim();
  if (!ans) { input.focus(); return; }
  const t   = elapsed();

  npcMove();
  updateNpcUI(npcGameChoice);
  fsmTransition("RESOLVIENDO", t);

  if (ans.toUpperCase() === puzzle.answer.toUpperCase()) {

    // ✔ CORRECTO
    _puzzleBusy = true;
    window._state.solved.push(puzzle.id);
    observeMazePace(puzzle.id, t);
    updateDots(window._state.solved);
    recordEvent("Acertijo resuelto ✔ → " + puzzle.title, t);
    showPuzzleFeedback(true, "✔ ¡Correcto!  " + puzzle.rewardMsg);
    addLog("✔ Correcto: " + puzzle.title, "ok");
    SFX.ok();

    if (puzzle.reward === 'tiempo_extra') {
      window._state.bonusTime += 60;
      addLog("⭐ +60 segundos al reloj.", "ok");
    } else if (puzzle.reward !== 'EXIT') {
      if (!ITEMS_IN_ROOMS[puzzle.room]) ITEMS_IN_ROOMS[puzzle.room] = [];
      if (!ITEMS_IN_ROOMS[puzzle.room].includes(puzzle.reward))
        ITEMS_IN_ROOMS[puzzle.room].push(puzzle.reward);
    }
    World3D.onPuzzleSolved(puzzle.id);
    fsmTransition("EXPLORANDO", t);
    setPuzzleSolvedUI();

  } else {

    // ✘ INCORRECTO
    gasPenalty(t);

    if (npcStrategy === "COMPETIR" && Math.random() < 0.4) {
      addLog("⚠ El NPC interfirió. Gas adicional.", "err");
      gasPenalty(t);
    }

    recordEvent("Respuesta incorrecta ✘ → " + puzzle.title + " (+20 ppm)", t);
    addLog("✘ Incorrecto: " + puzzle.title, "err");
    addLog("⚠ Penalización: +20 ppm de gas.", "err");
    SFX.err();
    SFX.alarm();
    World3D.gasHit();
    World3D.makeNoise(20);       // la alarma atrae al asesino
    flashDamage();

    // HMM — transición automática + emisión (Matrices A y B)
    nextHintState();
    hintsRequested++;

    let hintCost = 0;
    if (currentHintState === "CONFIABLE") hintCost = 5;
    if (currentHintState === "AMBIGUA")   hintCost = 10;
    if (currentHintState === "ENGANOSA")  hintCost = 15;

    window._state.bonusTime -= hintCost;
    addLog(`⏱ Pista automática: -${hintCost}s`, "warn");

    // Pista específica del puzzle (Matriz B — sin revelar estado)
    const hint = sampleHintForPuzzle(puzzle.id);
    recordEvent(`HMM pista automática (${puzzle.id}) — costo ${hintCost}s`, t);

    const show = text => showPuzzleFeedback(false, `✘ Incorrecto — gas +20 ppm.\n💡 Observación: ${text}`);
    show(hint.text);
    addLog("💡 " + hint.text, "warn");
    upgradeHint(puzzle, ans, hint, show);
    fsmTransition("EXPLORANDO", t);

    // Breve bloqueo para que Enter repetido no cobre dos penalizaciones
    _puzzleBusy = true;
    input.value = '';
    setTimeout(() => { _puzzleBusy = false; if (window._currentPuzzle === puzzle) input.focus(); }, 700);
    gameLoop();
  }
}

// ── Intentar abrir la puerta de salida ────────────────────────
function tryDoor() {
  if (_ended) return;
  const t          = elapsed();
  const reqDone    = PUZZLES.filter(p => p.required && window._state.solved.includes(p.id)).length;
  const tieneLlave = window._state.inventory.includes('llave_maestra');

  fsmTransition("ESCAPANDO", t);
  recordEvent("Intento de apertura → Puerta Final", t);
  const dt = poissonDoorRetry(t);
  addLog("Intentas abrir la puerta final...", "sys");
  addLog("(Poisson: próximo reintento en " + dt.toFixed(1) + "s)", "warn");

  if (reqDone < 4) {
    const faltantes = PUZZLES.filter(p => p.required && !window._state.solved.includes(p.id));
    addLog("✘ Faltan " + (4 - reqDone) + " acertijo(s):", "err");
    faltantes.forEach(p => addLog("  • " + p.title + " → " + ROOMS[p.room].label, "warn"));
    UIToast("✘ Faltan " + (4 - reqDone) + " acertijo(s)", 'err');
    SFX.locked();
    fsmTransition("EXPLORANDO", t);
    return;
  }
  if (!tieneLlave) {
    addLog("✘ Te falta la llave_maestra.", "err");
    addLog("💡 Resuélvela: Caja fuerte en LABORATORIO.", "warn");
    UIToast("✘ Te falta la llave_maestra", 'err');
    SFX.locked();
    fsmTransition("EXPLORANDO", t);
    return;
  }

  fsmTransition("LIBRE", t);
  recordEvent("Puerta abierta → ¡Escape logrado!", t);
  addLog("La puerta se abre. ¡Aire fresco!", "ok");
  _ended = true;                 // congela el reloj y el gas mientras se abre
  clearInterval(_loopInterval);
  World3D.openExit();
  document.getElementById('whiteout').classList.add('on');
  setTimeout(() => endGame('win', t), 1800);
}

// ══════════════════════════════════════════════════════════════
//  FIN DEL JUEGO — resumen de los 6 paradigmas
// ══════════════════════════════════════════════════════════════
function endGame(razon, tFinal) {
  if (document.getElementById('endscreen').classList.contains('hidden') === false) return;
  _ended = true;
  clearInterval(_loopInterval);
  const t = tFinal !== undefined ? tFinal : elapsed();
  _pausedAt = null;

  World3D.stop();
  SFX.stop();
  Director.stop();
  const dir = Director.summary();
  document.getElementById('game').classList.add('hidden');
  document.getElementById('endscreen').classList.remove('hidden');

  const title = document.getElementById('end-title');
  if      (razon === 'win')     { title.textContent = '⬡ ¡ESCAPASTE! ⬡'; title.style.color = 'var(--green)'; }
  else if (razon === 'gas')     { title.textContent = '☠ GAS FATAL ☠';   title.style.color = 'var(--red)'; }
  else                          { title.textContent = '⏱ TIEMPO AGOTADO'; title.style.color = 'var(--yellow)'; }

  const req = PUZZLES.filter(p => p.required && window._state.solved.includes(p.id)).length;
  const G   = gasConcentration(t);

  document.getElementById('end-stats').textContent = [
    `━━ PARADIGMA I — EVENTOS DISCRETOS ━━`,
    `  Eventos registrados  : ${EVENT_LOG.length}`,
    ``,
    `━━ PARADIGMA II — FSM ━━`,
    `  Estado FSM final     : ${FSM.estado}`,
    `  Transiciones FSM     : ${FSM.historial.length}`,
    ``,
    `━━ PARADIGMA III — SISTEMA DINÁMICO ━━`,
    `  Gas final            : ${G.toFixed(1)} / ${gasThreshold()} ppm`,
    `  α (λ−V)              : ${gasAlpha().toFixed(4)}`,
    `  Tiempo jugado        : ${t.toFixed(1)} s`,
    ``,
    `━━ PARADIGMA IV — CADENA DE MARKOV ━━`,
    `  Estado Markov final  : ${getMarkovState()}`,
    `  Transiciones Markov  : ${markovTransitions}`,
    `  Matriz activa        : ${window._state.ventilated ? 'P_ABIERTA' : 'P_CERRADA'}`,
    ``,
    `━━ PARADIGMA V — HMM (PISTAS) ━━`,
    `  Estado HMM final     : ${currentHintState}`,
    `  Pistas consultadas   : ${hintsRequested}`,
    ``,
    `━━ PARADIGMA VI — TEORÍA DE JUEGOS ━━`,
    `  Rondas con M-7       : ${gameTheoryRounds}`,
    `  Pago acumulado       : ${totalGamePayoff >= 0 ? '+' : ''}${totalGamePayoff}s`,
    `  Valor del juego V    : ${GAME_VALUE}  (óptimo p=0.75)`,
    ``,
    `━━ PARADIGMA VII — MONTE CARLO EN VIVO (IA) ━━`,
    `  P(escape) al final   : ${Math.round(dir.pEscape * 100)}%  (mín ${Math.round(dir.pMin * 100)}% · máx ${Math.round(dir.pMax * 100)}%)`,
    `  Agresividad asesino  : ×${dir.aggression.toFixed(2)}  (dificultad adaptativa)`,
    `  Veces atrapado       : ${World3D.hunterInfo().catches}`,
    `  IA generativa        : ${AI.available ? 'conectada' : 'sin conexión (lógica local)'} · pistas a medida: ${aiHints} · frases del Vigilante: ${dir.lines}`,
    ``,
    `━━ RESULTADO ━━`,
    `  Puzzles obligatorios : ${req} / 4`,
    `  Puzzle bonus         : ${window._state.solved.includes('P5') ? '⭐ completado' : 'no completado'}`,
    `  Objetos recogidos    : ${window._state.inventory.join(', ') || 'ninguno'}`
  ].join('\n');

  document.getElementById('end-events').innerHTML =
    EVENT_LOG.map(e =>
      `<span style="color:var(--text-dim)">[${e.t.toFixed(1)}s]</span> ${e.nombre}`
    ).join('<br>');

  // PARADIGMA VII - Monte Carlo
  const _penalties = EVENT_LOG.filter(e => e.nombre.includes('Respuesta incorrecta')).length;
  const _rounds    = gameTheoryRounds;
  const _coopEvents= EVENT_LOG.filter(e => e.nombre.includes('TJ: Jugador=COOPERAR')).length;
  const _playerCoopRatio = _rounds > 0 ? _coopEvents / _rounds : 0.75;
  const _gasNow    = gasConcentration(t);

  const mcSession = {
    timeLimit:       TIME_LIMIT,
    bonusTimeBase:   window._state.bonusTime - totalGamePayoff,
    penalties:       _penalties,
    ventOpened:      window._state.ventilated,
    timeUsed:        t,
    rounds:          Math.max(_rounds, 3),
    playerCoopRatio: _playerCoopRatio,
    npcCoopBase:     NPC_P_COOP,
    gasAtDecision:   _gasNow
  };

  setTimeout(() => {
    const mcResults = runMonteCarlo(mcSession);
    renderMonteCarloPanel(mcResults, mcSession);
  }, 400);
}
