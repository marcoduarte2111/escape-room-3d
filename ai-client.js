// ══════════════════════════════════════════════════════════════
//  ai-client.js — Puente con la IA del servidor (server.js)
//
//  Si el juego se abre sin servidor (doble clic en index.html) o no
//  hay clave de API, `AI.available` es false y cada función devuelve
//  null: quien llama usa entonces su lógica local de respaldo.
// ══════════════════════════════════════════════════════════════

const AI = (() => {
  let available = false;
  let failures = 0;

  const ready = location.protocol.startsWith('http')
    ? fetch('/api/status').then(r => r.json()).then(s => { available = !!s.ai; return s; }).catch(() => null)
    : Promise.resolve(null);

  async function call(route, body, timeout = 12000) {
    if (!available) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const r = await fetch('/api/' + route, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal
      });
      if (!r.ok) {
        // 503 = sin credenciales; varios fallos seguidos = se deja de insistir
        if (r.status === 503 || ++failures >= 4) available = false;
        return null;
      }
      failures = 0;
      return await r.json();
    } catch (e) {
      if (++failures >= 4) available = false;
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    ready,
    get available() { return available; },
    npc: (history, state) => call('npc', { history, state }),
    hint: (puzzle, wrong, kind) => call('hint', {
      puzzle: { title: puzzle.title, desc: puzzle.desc, pregunta: puzzle.pregunta, answer: puzzle.answer }, wrong, kind
    }),
    director: (events, state, previous) => call('director', { events, state, previous }, 9000)
  };
})();
