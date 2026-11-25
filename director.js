// ══════════════════════════════════════════════════════════════
//  director.js — El Vigilante: narrador + dificultad adaptativa
//
//  PARADIGMA VII en vivo: cada pocos segundos lanza una simulación
//  Monte Carlo del resto de la partida y estima P(escape). Con ese
//  dato ajusta la agresividad del asesino (más tregua si vas mal,
//  más presión si vas sobrado).
//
//  Además comenta lo que haces por megafonía: con IA (Claude) si hay
//  servidor y clave; si no, con frases locales según el evento.
// ══════════════════════════════════════════════════════════════

const Director = (() => {
  const MC_LIVE_RUNS = 400;
  let pEscape = 0.5, aggression = 1, band = 'normal';
  let lastEstimate = -99, lastLine = -99, seenEvents = 0, busy = false, started = false;
  let pMin = 1, pMax = 0, lines = 0;
  const said = [];
  let voiceOn = true;
  try { voiceOn = localStorage.getItem('escape3d.voice') !== 'off'; } catch (e) { /* sin almacenamiento */ }

  // ── Monte Carlo: ¿qué probabilidad hay de escapar desde aquí? ──
  const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
  function poisson(mean) {
    const limit = Math.exp(-mean);
    let k = 0, p = 1;
    do { k++; p *= Math.random(); } while (p > limit && k < 12);
    return k - 1;
  }

  function estimate(t) {
    const required = PUZZLES.filter(p => p.required);
    const solved = required.filter(p => window._state.solved.includes(p.id)).length;
    const left = required.length - solved;
    const remaining = totalTime() - t;
    const wrong = EVENT_LOG.filter(e => e.nombre.includes('Respuesta incorrecta')).length;
    const hunter = World3D.hunterInfo();

    // Ritmo observado del jugador (con una creencia inicial de 55 s por acertijo)
    const pace = Math.max(25, Math.min(120, (t + 55) / (solved + 1)));
    const wrongPerPuzzle = Math.min(1.5, (wrong + 0.3) / (solved + 1));
    const catchRate = hunter.present ? (hunter.catches + 0.4) / (t + 90) * hunter.aggression : 0.0015;

    // Gas: misma ecuación del Paradigma III, pero suponiendo que el jugador
    // abrirá la ventana al llegar a la CRIPTA (tras P1 y P2) y que el cofre
    // de P3 le dará la máscara (umbral 500 ppm).
    const grow = (g, dt, alpha, q) => Math.abs(alpha) < 1e-9 ? g + q * dt : (g + q / alpha) * Math.exp(alpha * dt) - q / alpha;
    const beforeCrypt = ['P1', 'P2'].filter(id => !window._state.solved.includes(id)).length;
    const maskSoon = window._state.solved.includes('P3') || left > 0;
    const gasNow = gasConcentration(t);

    let wins = 0;
    for (let i = 0; i < MC_LIVE_RUNS; i++) {
      let need = left ? 25 : 8;          // caminar hasta la salida
      let lost = 0, errors = 0, untilVent = 0;
      for (let k = 0; k < left; k++) {
        const e = poisson(wrongPerPuzzle);
        const spent = pace * Math.exp(0.45 * gauss() - 0.1) + e * 8;   // resolver + reintentos
        errors += e;
        need += spent; lost += e * 10;   // coste de la pista automática
        if (k < beforeCrypt) untilVent += spent;
      }
      lost += poisson(catchRate * need) * 22;
      let gas = gasNow, alive = true;
      if (!window._state.ventilated && beforeCrypt > 0) {
        untilVent += 15;                 // llegar hasta la ventana
        gas = grow(gas, untilVent, gasAlpha(), GAS.Q) + Math.min(errors, beforeCrypt) * GAS_PENALTY;
        alive = gas < gasThreshold();
        gas = grow(gas, Math.max(0, need - untilVent), GAS.lam - 0.015, Math.min(GAS.Q, 0.3));
        gas += Math.max(0, errors - beforeCrypt) * GAS_PENALTY;
      } else {
        gas = grow(gas, need, gasAlpha(), GAS.Q) + errors * GAS_PENALTY;
      }
      if (alive && need <= remaining - lost && gas < (maskSoon ? 500 : gasThreshold())) wins++;
    }
    return wins / MC_LIVE_RUNS;
  }

  function adapt(t) {
    const p = estimate(t);
    pEscape += (p - pEscape) * 0.5;
    pMin = Math.min(pMin, pEscape); pMax = Math.max(pMax, pEscape);
    const goal = Math.max(0.75, Math.min(1.25, 1 + (pEscape - 0.5) * 0.7));
    aggression += (goal - aggression) * 0.3;
    World3D.setHunterAggression(aggression);
    const now = aggression > 1.1 ? 'presión' : aggression < 0.9 ? 'tregua' : 'normal';
    if (now !== band) {
      band = now;
      recordEvent(`Director: P(escape)=${Math.round(pEscape * 100)}% → asesino en modo ${now} (×${aggression.toFixed(2)})`, t);
    }
    const el = document.getElementById('mc-live');
    if (el) {
      el.textContent = Math.round(pEscape * 100) + '%';
      el.className = 'mc-live ' + (pEscape > 0.6 ? 'good' : pEscape > 0.3 ? 'mid' : 'bad');
    }
    const ag = document.getElementById('mc-aggr');
    if (ag) ag.textContent = 'asesino ×' + aggression.toFixed(2);
  }

  // ── Megafonía ───────────────────────────────────────────────
  const LOCAL = {
    intro: ['Bienvenido al búnker. El aire tiene los minutos contados, y tú también.',
            'Otro invitado. Veamos cuánto tardas en entender las reglas.'],
    wrong: ['Incorrecto. El gas agradece tu generosidad.', 'Cada error huele un poco más a despedida.',
            'Piensa despacio. O no pienses; a mí me entretiene igual.', 'Esa alarma la ha oído todo el búnker. Él también.'],
    solved: ['Uno menos. No te acostumbres a la sensación.', 'Bien. El siguiente no será tan amable.',
             'Avanzas. Qué lástima; empezaba a encariñarme con esta sala.'],
    caught: ['Te ha rozado. La próxima vez no tendrá tanta prisa.', 'Veintidós segundos menos. Él cobra siempre.',
             'Correr en círculos no cuenta como plan.'],
    gas: ['¿Notas ese sabor metálico? Es el final acercándose.', 'Respira hondo. Ah, no: mejor no lo hagas.',
          'El verde te sienta bien. Lástima que sea el gas.'],
    time: ['Queda un minuto. Yo que tú dejaría de mirar el reloj.', 'El tiempo se acaba y sigues ahí parado.'],
    near: ['No mires atrás. O sí; da igual.', 'Tiene buen oído. Y tú haces mucho ruido.', 'Está más cerca de lo que crees.'],
    idle: ['Te veo por las cámaras. Elige una dirección.', 'El búnker es grande, tu paciencia no tanto.',
           'Tranquilo, nadie ha salido de aquí… todavía.', 'M-7 miente a veces. Como todos aquí abajo.']
  };
  const pickNew = list => {
    const fresh = list.filter(l => !said.includes(l));
    const pool = fresh.length ? fresh : list;
    return pool[Math.floor(Math.random() * pool.length)];
  };

  function speak(line) {
    said.push(line); if (said.length > 8) said.shift();
    lines++;
    SFX.megaphone();
    const el = document.getElementById('director-line');
    if (el) {
      el.querySelector('.director-text').textContent = line;
      el.classList.add('show');
      clearTimeout(speak.timer);
      speak.timer = setTimeout(() => el.classList.remove('show'), 6500);
    }
    if (voiceOn && window.speechSynthesis) {
      try {
        const u = new SpeechSynthesisUtterance(line);
        const voice = speechSynthesis.getVoices().find(v => /^es/i.test(v.lang));
        if (voice) u.voice = voice;
        u.lang = voice ? voice.lang : 'es-ES';
        u.rate = 0.92; u.pitch = 0.45; u.volume = 0.75;
        speechSynthesis.cancel();
        speechSynthesis.speak(u);
      } catch (e) { /* sin voz: queda el subtítulo */ }
    }
  }

  async function comment(category, t) {
    if (busy) return;
    busy = true;
    lastLine = t;
    let line = null;
    if (AI.available && category !== 'intro') {
      const hunter = World3D.hunterInfo();
      const res = await AI.director(
        EVENT_LOG.slice(-8).map(e => e.nombre),
        {
          room: ROOMS[window._state.location].label,
          gasPct: gasConcentration(t) / gasThreshold(),
          remaining: totalTime() - t,
          solved: PUZZLES.filter(p => p.required && window._state.solved.includes(p.id)).length,
          pEscape,
          hunter: !hunter.present ? 'todavía no ha entrado' :
            hunter.state === 'detect' ? `persiguiendo al jugador a ${hunter.distance.toFixed(0)} m` :
            hunter.state === 'search' ? 'buscando al jugador' : `patrullando a ${hunter.distance.toFixed(0)} m`
        },
        said
      );
      if (res && res.line) line = res.line;
    }
    busy = false;
    if (window._state && document.getElementById('game').classList.contains('hidden')) return;   // la partida terminó
    speak(line || pickNew(LOCAL[category] || LOCAL.idle));
  }

  // Llamado desde el bucle de lógica (cada 300 ms)
  function tick(t) {
    if (!started) { started = true; seenEvents = EVENT_LOG.length; lastLine = t - 30; }
    if (t - lastEstimate >= 4) { lastEstimate = t; adapt(t); }

    // ¿Ha pasado algo que merezca comentario?
    let category = null;
    for (const e of EVENT_LOG.slice(seenEvents)) {
      if (e.nombre.includes('asesino te alcanzó')) category = 'caught';
      else if (e.nombre.includes('Respuesta incorrecta')) category = category || 'wrong';
      else if (e.nombre.includes('Acertijo resuelto')) category = category || 'solved';
    }
    seenEvents = EVENT_LOG.length;
    const quiet = t - lastLine;
    if (lines === 0 && t > 5) return comment('intro', t);
    if (category && quiet > 12) return comment(category, t);
    if (quiet > 40) {
      const hunter = World3D.hunterInfo();
      const gasPct = gasConcentration(t) / gasThreshold();
      const remaining = totalTime() - t;
      comment(remaining < 70 ? 'time' : gasPct > 0.6 ? 'gas' : hunter.present && hunter.distance < 9 ? 'near' : 'idle', t);
    }
  }

  return {
    tick,
    stop() { if (window.speechSynthesis) speechSynthesis.cancel(); },
    toggleVoice() {
      voiceOn = !voiceOn;
      try { localStorage.setItem('escape3d.voice', voiceOn ? 'on' : 'off'); } catch (e) { /* sin almacenamiento */ }
      if (!voiceOn && window.speechSynthesis) speechSynthesis.cancel();
      return voiceOn;
    },
    summary: () => ({ pEscape, pMin, pMax, aggression, lines })
  };
})();
