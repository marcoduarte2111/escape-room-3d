// ══════════════════════════════════════════════════════════════
//  sfx.js — Sonido sintetizado con WebAudio (sin archivos externos)
//
//  · Audio 3D posicional (HRTF): los pasos y la respiración del
//    asesino se oyen desde donde está realmente. Usa auriculares.
//  · Reverberación por sala: el eco cambia con el tamaño de la sala.
//  · Capa de tensión que sube cuando el asesino te persigue.
// ══════════════════════════════════════════════════════════════

const SFX = (() => {
  let ctx = null, master = null, dry = null, droneGain = null, noiseBuf = null;
  const reverbs = {};            // small | medium | large → { gain }
  let reverbNow = null;
  let hunterVoice = null;        // { panner, gain, filter }
  let tension = null;            // { gain, lfo }

  function impulse(seconds, decay) {
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
    }
    return buf;
  }

  function panner(refDistance = 2.5, maxDistance = 40, rolloff = 1.3) {
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = refDistance;
    p.maxDistance = maxDistance;
    p.rolloffFactor = rolloff;
    return p;
  }

  function place(node, x, y, z) {
    if (node.positionX) {
      const t = ctx.currentTime;
      node.positionX.setTargetAtTime(x, t, 0.05);
      node.positionY.setTargetAtTime(y, t, 0.05);
      node.positionZ.setTargetAtTime(z, t, 0.05);
    } else node.setPosition(x, y, z);
  }

  function init() {
    if (ctx) return;
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { ctx = null; return; }

    // master → dry → salida ;  master → reverberación → salida
    master = ctx.createGain();
    master.gain.value = 0.55;
    dry = ctx.createGain();
    dry.gain.value = 0.9;
    master.connect(dry);
    dry.connect(ctx.destination);
    [['small', 0.7, 3.2], ['medium', 1.5, 2.6], ['large', 2.8, 2.0]].forEach(([name, seconds, decay]) => {
      const conv = ctx.createConvolver();
      conv.buffer = impulse(seconds, decay);
      const gain = ctx.createGain();
      gain.gain.value = 0;
      master.connect(conv); conv.connect(gain); gain.connect(ctx.destination);
      reverbs[name] = { gain };
    });
    setRoom('medium');

    // Zumbido ambiental del búnker
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 170;
    droneGain = ctx.createGain();
    droneGain.gain.value = 0.035;
    [[55, 'sawtooth'], [82.4, 'sine'], [55.6, 'sawtooth']].forEach(([f, type]) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.connect(lp);
      o.start();
    });
    lp.connect(droneGain);
    droneGain.connect(master);

    // Buffer de ruido blanco reutilizable
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // Respiración del asesino: ruido filtrado que "respira", colocado en 3D
    {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf; src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass'; filter.frequency.value = 420; filter.Q.value = 1.4;
      const breath = ctx.createGain(); breath.gain.value = 0.5;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.45;
      const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.5;
      lfo.connect(lfoGain); lfoGain.connect(breath.gain); lfo.start();
      const gain = ctx.createGain(); gain.gain.value = 0;
      const pan = panner(1.6, 30, 1.6);
      src.connect(filter); filter.connect(breath); breath.connect(gain); gain.connect(pan); pan.connect(master);
      src.start();
      hunterVoice = { panner: pan, gain, filter, lfo };
    }

    // Capa de tensión (persecución): pulso grave que late más rápido
    {
      const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 46;
      const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 69.3;
      const lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 240;
      const pulse = ctx.createGain(); pulse.gain.value = 0.5;
      const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 2;
      const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.5;
      lfo.connect(lfoGain); lfoGain.connect(pulse.gain);
      const gain = ctx.createGain(); gain.gain.value = 0;
      o1.connect(lp2); o2.connect(lp2); lp2.connect(pulse); pulse.connect(gain); gain.connect(master);
      o1.start(); o2.start(); lfo.start();
      tension = { gain, lfo };
    }
  }

  // `out` permite enviar el sonido a un panner 3D en vez de al máster
  function tone(freq, dur, type = 'sine', vol = 0.2, slide = 0, delay = 0, out = master) {
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.linearRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(out);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  function noise(dur, vol, freq, q = 1, out = master) {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp); bp.connect(g); g.connect(out);
    src.start(t0, Math.random() * 0.5); src.stop(t0 + dur + 0.05);
  }

  // Panner de un solo uso en una posición del mundo
  function at(x, y, z, ref) {
    const p = panner(ref);
    place(p, x, y, z);
    p.connect(master);
    setTimeout(() => p.disconnect(), 4000);
    return p;
  }

  function setRoom(size) {
    if (!ctx || size === reverbNow) return;
    reverbNow = size;
    const wet = { small: 0.16, medium: 0.26, large: 0.42 };
    Object.entries(reverbs).forEach(([name, r]) =>
      r.gain.gain.setTargetAtTime(name === size ? wet[name] : 0, ctx.currentTime, 0.35));
  }

  return {
    init,
    resume()  { if (ctx && ctx.state === 'suspended') ctx.resume(); },
    stop()    { if (ctx && ctx.state === 'running') ctx.suspend(); },
    step()    { noise(0.09, 0.10, 160 + Math.random() * 60, 0.8); },
    pick()    { tone(880, 0.12, 'triangle', 0.14); tone(1320, 0.16, 'triangle', 0.11, 0, 0.08); },
    ok()      { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.2, 'triangle', 0.13, 0, i * 0.09)); },
    err()     { tone(150, 0.4, 'sawtooth', 0.16, -70); noise(0.3, 0.08, 900, 2); },
    door()    { noise(0.8, 0.18, 380, 0.6); tone(90, 0.6, 'sine', 0.12, 40); },
    locked()  { tone(220, 0.1, 'square', 0.07); tone(170, 0.14, 'square', 0.07, 0, 0.12); },
    click()   { tone(1200, 0.04, 'square', 0.05); },
    wind()    { noise(2.2, 0.2, 700, 0.4); },
    heart()   { tone(58, 0.14, 'sine', 0.35, -10); tone(52, 0.16, 'sine', 0.28, -10, 0.22); },
    setGas(p) {
      if (!ctx || !droneGain) return;
      droneGain.gain.setTargetAtTime(0.03 + Math.min(1, p) * 0.07, ctx.currentTime, 0.6);
    },

    // ── Audio 3D ────────────────────────────────────────────
    setRoom,
    // Posición y dirección de la cámara (coordenadas de Three.js)
    setListener(x, y, z, fx, fy, fz) {
      if (!ctx) return;
      const l = ctx.listener;
      if (l.positionX) {
        const t = ctx.currentTime;
        l.positionX.setTargetAtTime(x, t, 0.03); l.positionY.setTargetAtTime(y, t, 0.03); l.positionZ.setTargetAtTime(z, t, 0.03);
        l.forwardX.setTargetAtTime(fx, t, 0.03); l.forwardY.setTargetAtTime(fy, t, 0.03); l.forwardZ.setTargetAtTime(fz, t, 0.03);
        l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
      } else {
        l.setPosition(x, y, z);
        l.setOrientation(fx, fy, fz, 0, 1, 0);
      }
    },
    // level: 0 = no está, 0.4 = patrulla, 0.7 = busca, 1 = te persigue
    setHunter(x, y, z, level) {
      if (!ctx || !hunterVoice) return;
      place(hunterVoice.panner, x, y, z);
      const t = ctx.currentTime;
      hunterVoice.gain.gain.setTargetAtTime(level * 0.55, t, 0.4);
      hunterVoice.lfo.frequency.setTargetAtTime(0.4 + level * 1.1, t, 0.5);
      hunterVoice.filter.frequency.setTargetAtTime(380 + level * 260, t, 0.5);
    },
    hunterStep(x, y, z, running) {
      if (!ctx) return;
      const p = at(x, y, z, 2.2);
      noise(0.12, running ? 0.55 : 0.34, 95 + Math.random() * 30, 0.9, p);
      tone(62, 0.1, 'sine', running ? 0.5 : 0.3, -18, 0, p);
    },
    // Sonido puntual en el mundo (puerta lejana, alarma…)
    doorAt(x, y, z) {
      if (!ctx) return;
      const p = at(x, y, z, 3);
      noise(0.8, 0.5, 380, 0.6, p); tone(90, 0.6, 'sine', 0.3, 40, 0, p);
    },
    setTension(level) {
      if (!ctx || !tension) return;
      const t = ctx.currentTime;
      tension.gain.gain.setTargetAtTime(Math.max(0, Math.min(1, level)) * 0.16, t, level > 0.5 ? 0.25 : 1.4);
      tension.lfo.frequency.setTargetAtTime(1.6 + level * 2.6, t, 0.5);
    },
    stinger() {   // te han visto
      [233, 247, 311, 466].forEach((f, i) => tone(f, 1.1, 'sawtooth', 0.085, -30, i * 0.015));
      noise(0.5, 0.16, 2400, 1.2);
    },
    caught()  { tone(70, 0.7, 'sawtooth', 0.4, -40); noise(0.6, 0.35, 300, 0.5); },
    alarm()   { [0, 0.28, 0.56].forEach(d => { tone(740, 0.22, 'square', 0.07, 0, d); tone(555, 0.22, 'square', 0.07, 0, d + 0.12); }); },
    megaphone() { noise(0.25, 0.12, 2800, 3); tone(1900, 0.06, 'square', 0.03, 0, 0.05); },
    talk(friendly = true) {   // "voz" del robot
      const base = friendly ? 420 : 250;
      for (let i = 0; i < 5; i++) tone(base + Math.random() * 260, 0.06, 'square', 0.05, 0, i * 0.07);
    }
  };
})();
