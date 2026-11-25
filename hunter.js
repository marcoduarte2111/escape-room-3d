// ══════════════════════════════════════════════════════════════
//  hunter.js — Inteligencia del asesino
//
//  · Política estocástica de percepción (vista + oído).
//  · Memoria: aprende en qué salas pasas más tiempo, oye ruidos
//    (puertas, objetos, alarmas) y se acostumbra al truco del espejo.
//  · Intercepción: cuando te ve, apunta a donde VAS a estar.
//  · Navegación por rejilla (BFS) alrededor de muebles y muros.
// ══════════════════════════════════════════════════════════════

// Política estocástica: las observaciones cambian la probabilidad de detectar
// al jugador. `aggression` (0.75–1.25) la fija el director adaptativo.
function createHunterBrain(random = Math.random) {
  let memory = 0;
  return {
    forget() { memory = 0; },
    observe({ distance, visible, sprinting, concealed, lit = false, aggression = 1 }) {
      memory = Math.max(0, memory - 1);
      if (!concealed) {
        const range = (lit ? 12 : 9) * aggression;          // la linterna te delata desde más lejos
        const sight = visible && distance < range ? (0.9 - distance * 0.04 * 9 / range) * aggression : 0;
        const sound = sprinting && distance < 11 * aggression ? (0.6 - distance * 0.035) * aggression : 0;
        if (distance < 1.8 && visible || random() < Math.max(sight, sound)) {
          memory = 4 + Math.floor(random() * 4);
          return 'detect';
        }
      }
      return memory ? 'search' : 'patrol';
    }
  };
}

// Lo que el asesino recuerda de ti durante la partida.
function createHunterMemory(random = Math.random) {
  const roomTime = Object.create(null);   // segundos (con olvido) por sala
  let noises = [];                        // {x, y, radius, ttl}
  let mirrorEscapes = 0;
  return {
    // El jugador ha pasado dt segundos en `room`
    dwell(room, dt) {
      if (!room) return;
      for (const key in roomTime) roomTime[key] *= 1 - dt * 0.004;   // olvida poco a poco
      roomTime[room] = (roomTime[room] || 0) + dt;
    },
    // Elige sala de patrulla: prefiere donde el jugador suele estar
    choosePatrol(candidates) {
      if (!candidates.length) return null;
      const total = candidates.reduce((sum, id) => sum + (roomTime[id] || 0), 0) || 1;
      const weights = candidates.map(id => 1 + 4 * (roomTime[id] || 0) / total);
      let r = random() * weights.reduce((a, b) => a + b, 0);
      for (let i = 0; i < candidates.length; i++) { r -= weights[i]; if (r <= 0) return candidates[i]; }
      return candidates[candidates.length - 1];
    },
    favourite() {
      return Object.keys(roomTime).sort((a, b) => roomTime[b] - roomTime[a])[0] || null;
    },
    noise(x, y, radius) { noises.push({ x, y, radius, ttl: 6 }); },
    // Ruido más cercano que alcanza al asesino (o null)
    heard(hx, hy, dt) {
      let best = null, bestD = Infinity;
      noises = noises.filter(n => (n.ttl -= dt) > 0);
      for (const n of noises) {
        const d = Math.hypot(n.x - hx, n.y - hy);
        if (d < n.radius && d < bestD) { best = n; bestD = d; }
      }
      if (best) noises = noises.filter(n => n !== best);
      return best;
    },
    // Cada huida por el espejo le engaña menos tiempo
    mirrorEscape() { mirrorEscapes++; return Math.max(2.5, 7 - 1.5 * (mirrorEscapes - 1)); },
    get mirrorEscapes() { return mirrorEscapes; }
  };
}

// Punto de intercepción: adelanta la posición del jugador según su velocidad.
function hunterIntercept(hunter, player, speed, isFree) {
  const distance = Math.hypot(player.x - hunter.x, player.y - hunter.y);
  const lead = Math.min(1.4, distance / Math.max(speed, 0.1) * 0.6);
  for (let k = lead; k > 0.15; k *= 0.5) {
    const x = player.x + player.vx * k, y = player.y + player.vy * k;
    if (isFree(x, y)) return { x, y };
  }
  return { x: player.x, y: player.y };
}

function createHunterNavigation(areas, blocked) {
  const cell = 0.5;
  const left = Math.min(...areas.map(a => a.x0));
  const bottom = Math.min(...areas.map(a => a.y0));
  const width = Math.ceil((Math.max(...areas.map(a => a.x1)) - left) / cell);
  const height = Math.ceil((Math.max(...areas.map(a => a.y1)) - bottom) / cell);
  const points = Array.from({ length: width * height }, (_, id) => ({
    x: left + (id % width + 0.5) * cell,
    y: bottom + (Math.floor(id / width) + 0.5) * cell
  }));
  const floor = points.map(p => areas.some(a => p.x >= a.x0 && p.x <= a.x1 && p.y >= a.y0 && p.y <= a.y1));
  let edges;

  function rebuild() {
    const clear = points.map((p, i) => floor[i] && !blocked(p.x, p.y));
    edges = points.map((p, i) => {
      if (!clear[i]) return null;
      return [i % width ? i - 1 : -1, i % width < width - 1 ? i + 1 : -1, i - width, i + width]
        .filter(j => clear[j] && !blocked((p.x + points[j].x) / 2, (p.y + points[j].y) / 2));
    });
  }

  return {
    invalidate() { edges = null; },
    route(from, goal) {
      if (!edges) rebuild();
      const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
      let start = -1;
      let nearest = Infinity;
      for (let i = 0; i < points.length; i++) {
        if (!edges[i]) continue;
        const d = dist(from, points[i]);
        if (d >= nearest || blocked((from.x + points[i].x) / 2, (from.y + points[i].y) / 2)) continue;
        start = i;
        nearest = d;
      }
      if (start < 0 || nearest > 1) return [];
      const previous = new Int32Array(points.length).fill(-1);
      const queue = [start];
      previous[start] = start;
      let end = start;
      for (let i = 0; i < queue.length; i++) {
        const id = queue[i];
        if (dist(points[id], goal) < dist(points[end], goal)) end = id;
        if (dist(points[end], goal) <= cell * 0.72) break;
        for (const next of edges[id]) {
          if (previous[next] !== -1) continue;
          previous[next] = id;
          queue.push(next);
        }
      }
      const path = [];
      for (let id = end; id !== start; id = previous[id]) path.push(points[id]);
      if (path.length || dist(from, points[start]) > 0.08) path.push(points[start]);
      return path.reverse();
    }
  };
}
