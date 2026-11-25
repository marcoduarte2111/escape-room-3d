// ══════════════════════════════════════════════════════════════
//  puzzlegen.js — Acertijos distintos en cada partida
//
//  Los números se generan por código, así que la solución siempre
//  existe y es única. El mundo 3D (world3d.js) dibuja los paneles a
//  partir de `puzzle.show`, y las pistas del HMM se adaptan solas.
//
//  Para jugar con los acertijos originales: index.html?clasico
// ══════════════════════════════════════════════════════════════

const PUZZLE_RUN = { classic: /[?&]clasico\b/.test(location.search), hiddenLines: null };

(function generatePuzzles() {
  const byId = id => PUZZLES.find(p => p.id === id);
  const pick = list => list[Math.floor(Math.random() * list.length)];
  const int = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
  const two = n => String(n).padStart(2, '0');

  // Valores originales (también sirven de respaldo para el dibujo 3D)
  byId('P1').show = { values: [3, 1, 4], answer: 2 };
  byId('P3').show = { values: [1, 1, 2, 3, 5, 8], answer: 13 };
  byId('P4').show = { dates: ['02/03', '04/06', '06/09', '08/12'], answer: '10/15' };
  byId('P5').show = { n: 100 };
  if (PUZZLE_RUN.classic) return;

  // ── P1 · Diales: las diferencias alternan (−a, +b, −a) ──────
  {
    let v;
    do {
      const start = int(3, 9), down = int(1, 4), up = int(2, 5);
      v = [start, start - down, start - down + up, start - down + up - down];
      v.ok = down !== up && v.every(n => n >= 1 && n <= 9) && new Set(v).size === 4;
    } while (!v.ok);
    const p = byId('P1');
    p.show = { values: v.slice(0, 3), answer: v[3] };
    p.answer = String(v[3]);
    p.desc = `Un panel con 4 diales oxidados.
Los números parecen tener una relación entre sí.

Diales: [ ${v[0]} ] [ ${v[1]} ] [ ${v[2]} ] [ ? ]

Tal vez todos siguen una misma regla.`;
    PUZZLE_HINTS.P1 = [
      'Las diferencias entre los diales alternan entre dos valores constantes: uno baja y otro sube.',
      'El patrón podría estar relacionado con alguna secuencia matemática conocida.',
      'Intenta multiplicar los primeros dos diales para obtener el tercero.'
    ];
  }

  // ── P3 · Secuencia tipo Fibonacci con semillas distintas ────
  {
    const [a, b] = pick([[1, 1], [1, 2], [2, 1], [1, 3], [2, 2], [3, 1], [1, 4]]);
    const s = [a, b];
    while (s.length < 7) s.push(s[s.length - 1] + s[s.length - 2]);
    const p = byId('P3');
    p.show = { values: s.slice(0, 6), answer: s[6] };
    p.answer = String(s[6]);
    p.desc = `Grabado en la pared:

  ${s.slice(0, 6).join(', ')}, ?

Los números parecen seguir un patrón repetitivo.`;
  }

  // ── P4 · Fechas en progresión aritmética ────────────────────
  {
    const d0 = int(1, 4), dStep = int(2, 4), m0 = int(1, 3), mStep = int(1, 2);
    const dates = Array.from({ length: 5 }, (_, i) => two(d0 + i * dStep) + '/' + two(m0 + i * mStep));
    const p = byId('P4');
    p.show = { dates: dates.slice(0, 4), answer: dates[4] };
    p.answer = String(d0 + 4 * dStep);
    p.desc = `Un tablero con fechas marcadas:

  ${dates.slice(0, 4).join(' — ')} — ?/?

Día y mes cambian de forma constante.`;
    PUZZLE_RUN.hiddenLines = ['LOS DÍAS SUBEN', `DE ${dStep} EN ${dStep}`];
  }

  // ── P5 · Primo más cercano a N (siempre único) ──────────────
  {
    const [n, prime] = pick([[100, 101], [200, 199], [80, 79], [90, 89], [110, 109], [130, 131], [140, 139], [190, 191], [210, 211]]);
    const above = prime > n;
    const p = byId('P5');
    p.show = { n };
    p.answer = String(prime);
    p.desc = `"El número primo más cercano a ${n}
desbloquea el compartimento secreto."

No todos los números son lo que parecen.`;
    PUZZLE_HINTS.P5 = [
      above ? `El número primo que buscas es el primero que supera el valor ${n}.`
            : `El número primo que buscas es el último antes de llegar a ${n}.`,
      'Un número primo únicamente puede dividirse por sí mismo y por 1.',
      above ? `El número que necesitas está justo por debajo del valor ${n}.`
            : `El número que necesitas está justo por encima del valor ${n}.`
    ];
  }
})();
