// ══════════════════════════════════════════════════════════════
//  game.js — Controlador principal
// ══════════════════════════════════════════════════════════════

window._state = {
  location:   "ENTRADA",
  inventory:  [],
  solved:     [],
  bonusTime:  0,
  ventilated: false
};

let npcStrategy   = "COOPERAR";
let npcGameChoice = "COOPERAR";
let lastNpcUpdate = 0;

window._currentPuzzle = null;
window._startTime     = null;
let _loopInterval     = null;

// ── Paradigma VI: Teoría de Juegos ────────────────────────────
// Matriz de pagos: filas = jugador, columnas = NPC
const PAYOFF_MATRIX = {
  COOPERAR: { COOPERAR: 20, COMPETIR: -10 },
  COMPETIR: { COOPERAR: 15, COMPETIR:   5 }
};
// p = (d-b)/(a-b-c+d) = (5-(-10))/(20-(-10)-15+5) = 15/20 = 0.75
const NPC_P_COOP  = 0.75;
const GAME_VALUE  = 12.5;

let totalGamePayoff  = 0;
let gameTheoryRounds = 0;

// ── Paradigma IV: Markov ──────────────────────────────────────
let markovTransitions = 0;
let _lastMarkovTick   = 0;
const MARKOV_INTERVAL = 10; // segundos entre ticks

// ── Paradigma V: HMM ─────────────────────────────────────────
let hintsRequested = 0;

function elapsed()   { return (Date.now() - window._startTime) / 1000; }
function totalTime() { return TIME_LIMIT + window._state.bonusTime; }

// ══════════════════════════════════════════════════════════════
//  INICIO
// ══════════════════════════════════════════════════════════════
function startGame() {
  window._startTime = Date.now();
  document.getElementById('intro').classList.add('hidden');
  document.getElementById('game').classList.remove('hidden');

  updateRoomCard("ENTRADA");
  updateInventoryUI([]);
  goStep('step-menu');

  recordEvent("Temporizador programado en t=" + totalTime() + "s", 0);
  addLog("¡Escapa antes de que el gas te consuma!", "sys");
  addLog("Ruta: Laboratorio → Cripta → Archivo → Cámara Final", "warn");
  addLog("⚠ Equivocarte en un puzzle aumenta el gas.", "warn");

  _loopInterval = setInterval(gameLoop, 300);
}

// ── Paradigma VI: NPC con estrategia óptima p=0.75 ───────────
function npcMove() {
  const G = gasConcentration(elapsed());

  // Estrategia óptima base p=0.75 (Teoría de Juegos)
  // Modulada por presión del gas para realismo narrativo
  let pCoop = NPC_P_COOP;
  if      (G > 250) pCoop = 0.10;
  else if (G > 150) pCoop = 0.40;

  npcGameChoice = Math.random() < pCoop ? "COOPERAR" : "COMPETIR";
  npcStrategy   = npcGameChoice;
}

// ══════════════════════════════════════════════════════════════
//  GAME LOOP
// ══════════════════════════════════════════════════════════════
function gameLoop() {
  const t         = elapsed();
  const remaining = Math.max(0, totalTime() - t);

  updateTimer(remaining);
  updateGasUI(t);

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
  if (elapsed() - lastNpcUpdate > 8) {
    npcMove();
    lastNpcUpdate = elapsed();
    updateNpcUI(npcGameChoice);
  }

  if (window._state.location === 'CRIPTA' && !window._state.ventilated)
    document.getElementById('btn-vent').style.display = '';

  if (remaining <= 0) {
    recordEvent("Tiempo agotado → t=" + totalTime().toFixed(0) + "s", t);
    endGame('timeout');
  }
  if (gasConcentration(t) >= gasThreshold()) {
    endGame('gas');
  }
}

// ══════════════════════════════════════════════════════════════
//  PARADIGMA VI — Interacción jugador/NPC
// ══════════════════════════════════════════════════════════════
function playerChooseCooperation(action) {
  const t = elapsed();
  npcMove(); // el NPC también decide

  const npcAction = npcGameChoice;
  const payoff    = PAYOFF_MATRIX[action][npcAction];
  totalGamePayoff += payoff;
  gameTheoryRounds++;

  recordEvent(`TJ: Jugador=${action} | NPC=${npcAction} | Pago=${payoff >= 0 ? '+' : ''}${payoff}s`, t);

  window._state.bonusTime += payoff;

  if (payoff >= 0) {
    addLog(`🤝 ${action} vs NPC ${npcAction}: +${payoff}s al reloj.`, "ok");
  } else {
    addLog(`⚔ ${action} vs NPC ${npcAction}: ${payoff}s del reloj.`, "err");
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

// ── Mover ─────────────────────────────────────────────────────
function doMove(destino) {
  const check = canEnterRoom(destino);
  if (!check.ok) {
    addLog("🔒 Sala bloqueada: " + check.razon, "err");
    return;
  }

  const t = elapsed();
  window._state.location = destino;
  fsmTransition("EXPLORANDO", t);
  recordEvent("Jugador se mueve → " + ROOMS[destino].label, t);
  addLog("Te mueves a " + ROOMS[destino].label, "sys");

  updateRoomCard(destino);
  if (destino !== 'CRIPTA') document.getElementById('btn-vent').style.display = 'none';
  goStep('step-menu');
}

// ── Recoger ───────────────────────────────────────────────────
function doPick(item) {
  const t = elapsed();
  window._state.inventory.push(item);
  fsmTransition("RECOGIENDO", t);
  recordEvent("Objeto recogido → " + item, t);
  addLog("Recogiste: " + item, "ok");
  addLog("💡 " + (ITEM_INFO[item]?.uso || ''), "warn");

  if (item === 'mascara_gas') {
    GAS.hasMask = true;
    addLog("😷 Máscara equipada. Umbral → 500 ppm.", "ok");
  }

  updateInventoryUI(window._state.inventory);
  fsmTransition("EXPLORANDO", t);
  goStep('step-menu');
}

// ── Usar ──────────────────────────────────────────────────────
function doUse(item) {
  const t   = elapsed();
  const loc = window._state.location;
  fsmTransition("USANDO", t);
  recordEvent("Objeto usado → " + item, t);

  if (item === 'mascara_gas') {
    GAS.hasMask = true;
    addLog("😷 Máscara equipada. Umbral → 500 ppm.", "ok");

  } else if (item === 'llave_maestra') {
    addLog("La llave_maestra te permite acceder a la CÁMARA FINAL.", "warn");
    addLog("💡 Ve a [Ir a otra sala] y selecciona CÁMARA FINAL.", "warn");

  } else if (item === 'llave_oxidada') {
    if (loc === 'LABORATORIO') addLog("Úsala en [Resolver acertijo] → Caja fuerte.", "ok");
    else { addLog("Esta llave se usa en el LABORATORIO.", "warn"); addLog("💡 Ya estás fuera. Solo sirve allí.", "warn"); }

  } else if (item === 'linterna') {
    if (loc === 'ARCHIVO') {
      addLog("Texto revelado: 'Las fechas siguen una progresión aritmética.'", "ok");
      addLog("Día y mes aumentan de 2 en 2 cada entrada.", "ok");
    } else {
      addLog("La linterna es útil en el ARCHIVO, que está adelante.", "warn");
    }

  } else if (item === 'catalizador') {
    gasUseCatalyst(t);
    window._state.inventory.splice(window._state.inventory.indexOf('catalizador'), 1);
    updateInventoryUI(window._state.inventory);
    addLog("Catalizador usado. Emisión de gas reducida.", "ok");
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
  goStep('step-menu');
}

// ── Abrir ventana ─────────────────────────────────────────────
function doVent() {
  const t = elapsed();
  gasOpenVent(t);
  window._state.ventilated = true;
  document.getElementById('btn-vent').style.display = 'none';
  recordEvent("Ventana abierta en CRIPTA (V=0.015, Q=0.3)", t);
  addLog("Ventana abierta. Gas sube más lento.", "ok");
  goStep('step-menu');
}

// ── Puzzle: seleccionar ───────────────────────────────────────
function goStep_puzzle() {
  const pendientes = PUZZLES.filter(p =>
    p.room === window._state.location && !window._state.solved.includes(p.id)
  );

  if (pendientes.length === 0) {
    addLog("No hay acertijos pendientes aquí.", "warn");
    const conPuzz = Object.keys(ROOMS).filter(r =>
      PUZZLES.some(p => p.room === r && !window._state.solved.includes(p.id))
    );
    if (conPuzz.length > 0)
      addLog("Salas con acertijos: " + conPuzz.map(r => ROOMS[r].label).join(', '), "warn");
    return;
  }

  if (pendientes.length === 1) {
    launchPuzzle(pendientes[0]);
  } else {
    document.querySelectorAll('.step').forEach(s => s.classList.add('hidden'));
    const step = document.getElementById('step-pick');
    step.classList.remove('hidden');
    document.querySelector('#step-pick .step-label').textContent = '¿Qué acertijo resuelves?';
    const list = document.getElementById('pick-list');
    list.innerHTML = '';
    pendientes.forEach(p => {
      const btn = document.createElement('button');
      btn.className = 'choice-btn';
      btn.innerHTML = `<span>${p.title}</span><span class="choice-sub">${p.required ? 'Obligatorio' : 'Bonus ⭐'}</span>`;
      btn.onclick = () => launchPuzzle(p);
      list.appendChild(btn);
    });
  }
}

function launchPuzzle(puzzle) {
  if (puzzle.requiresItem && !window._state.inventory.includes(puzzle.requiresItem)) {
    addLog("Necesitas primero: " + puzzle.requiresItem, "err");
    addLog("💡 " + (ITEM_INFO[puzzle.requiresItem]?.uso || ''), "warn");
    goStep('step-menu');
    return;
  }
  window._currentPuzzle = puzzle;
  goStep('step-puzzle');
}

// ── Paradigma V: Pedir pista voluntariamente ─────────────────
function requestHint() {
  const puzzle = window._currentPuzzle;
  if (!puzzle) return;

  const t = elapsed();
  nextHintState();  // transición de estado oculto (Matriz A)
  hintsRequested++;

  let hintCost = 0;
  if (currentHintState === "CONFIABLE") hintCost = 5;
  if (currentHintState === "AMBIGUA")   hintCost = 10;
  if (currentHintState === "ENGANOSA")  hintCost = 15;

  window._state.bonusTime -= hintCost;

  // Samplear observación mediante Matriz B
  const hint = getHintForPuzzle(puzzle.id);
  recordEvent(`HMM pista ${puzzle.id} — costo ${hintCost}s`, t);
  addLog(`💡 Pista solicitada (-${hintCost}s)`, "warn");

  // Mostrar sin revelar el estado oculto
  showPuzzleFeedback(null, `💡 Observación: ${hint}\n(-${hintCost}s del reloj)`);
}

// ── Puzzle: responder ─────────────────────────────────────────
function submitPuzzle() {
  const puzzle = window._currentPuzzle;
  if (!puzzle) return;

  const ans = document.getElementById('puzzle-input').value.trim();
  const t   = elapsed();

  npcMove();
  updateNpcUI(npcGameChoice);
  fsmTransition("RESOLVIENDO", t);

  if (ans.toUpperCase() === puzzle.answer.toUpperCase()) {

    // ✔ CORRECTO
    window._state.solved.push(puzzle.id);
    updateDots(window._state.solved);
    recordEvent("Acertijo resuelto ✔ → " + puzzle.title, t);
    showPuzzleFeedback(true, "✔ ¡Correcto!  " + puzzle.rewardMsg);
    addLog("✔ Correcto: " + puzzle.title, "ok");

    if (puzzle.reward === 'tiempo_extra') {
      window._state.bonusTime += 60;
      addLog("⭐ +60 segundos al reloj.", "ok");
    } else if (puzzle.reward !== 'EXIT') {
      if (!ITEMS_IN_ROOMS[puzzle.room]) ITEMS_IN_ROOMS[puzzle.room] = [];
      if (!ITEMS_IN_ROOMS[puzzle.room].includes(puzzle.reward))
        ITEMS_IN_ROOMS[puzzle.room].push(puzzle.reward);
    }

    setTimeout(() => {
      fsmTransition("EXPLORANDO", elapsed());
      goStep('step-menu');
    }, 2200);

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
    const hint = getHintForPuzzle(puzzle.id);
    recordEvent(`HMM pista automática (${puzzle.id}) — costo ${hintCost}s`, t);

    showPuzzleFeedback(false,
      `✘ Incorrecto — gas +20 ppm.\n💡 Observación: ${hint}`
    );
    addLog("💡 " + hint, "warn");

    setTimeout(() => {
      fsmTransition("EXPLORANDO", elapsed());
      goStep('step-menu');
    }, 3000);
  }
}

// ── Intentar abrir puerta ─────────────────────────────────────
function tryDoor() {
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
    setTimeout(() => {
      fsmTransition("EXPLORANDO", elapsed());
      goStep('step-menu');
    }, 5000);
    return;
  }
  if (!tieneLlave) {
    addLog("✘ Te falta la llave_maestra.", "err");
    addLog("💡 Resuélvela: Caja fuerte en LABORATORIO.", "warn");
    fsmTransition("EXPLORANDO", t);
    return;
  }

  fsmTransition("LIBRE", t);
  recordEvent("Puerta abierta → ¡Escape logrado!", t);
  setTimeout(() => endGame('win'), 600);
}

// ══════════════════════════════════════════════════════════════
//  FIN DEL JUEGO — resumen de los 6 paradigmas
// ══════════════════════════════════════════════════════════════
function endGame(razon) {
  clearInterval(_loopInterval);
  const t = elapsed();

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
    `  Rondas NPC           : ${gameTheoryRounds}`,
    `  Pago acumulado       : ${totalGamePayoff >= 0 ? '+' : ''}${totalGamePayoff}s`,
    `  Valor del juego V    : ${GAME_VALUE}  (óptimo p=0.75)`,
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
