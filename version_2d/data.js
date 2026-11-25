// ══════════════════════════════════════════════════════════════
//  data.js — Datos del juego
// ══════════════════════════════════════════════════════════════

const TIME_LIMIT = 480; // 8 minutos

// ── Salas ─────────────────────────────────────────────────────
const ROOMS = {
  ENTRADA: {
    label: "ENTRADA",
    desc:  "La puerta por donde entraste está sellada. El aire huele raro.",
    tip:   "💡 Ve al LABORATORIO para empezar."
  },
  LABORATORIO: {
    label: "LABORATORIO",
    desc:  "Estantes con químicos rotos. Hay un panel de diales y una caja fuerte.",
    tip:   "💡 Hay 2 acertijos aquí. Empieza con el panel de diales."
  },
  CRIPTA: {
    label: "CRIPTA",
    desc:  "Paredes de piedra con inscripciones. Una ventana oxidada. Un cofre.",
    tip:   "💡 Abre la ventana para reducir el gas. 1 acertijo aquí."
  },
  ARCHIVO: {
    label: "ARCHIVO",
    desc:  "Carpetas por el suelo. Un tablero con fechas marcadas en la pared.",
    tip:   "💡 Usa la linterna aquí para revelar texto oculto. 1 acertijo aquí."
  },
  CAMARA_FINAL: {
    label: "CÁMARA FINAL",
    desc:  "Una puerta masiva con teclado numérico. Esta es la salida.",
    tip:   "💡 Necesitas 4 puzzles resueltos + llave_maestra para escapar."
  }
};

// ── Acceso a salas ────────────────────────────────────────────
const ROOM_ACCESS = {
  ENTRADA:      { requierePuzzles: [],           requiereItem: null },
  LABORATORIO:  { requierePuzzles: [],           requiereItem: null },
  CRIPTA:       { requierePuzzles: ["P1","P2"],  requiereItem: null },
  ARCHIVO:      { requierePuzzles: ["P3"],        requiereItem: null },
  CAMARA_FINAL: { requierePuzzles: ["P4"],        requiereItem: "llave_maestra" }
};

// ── Objetos por sala ───────────────────────────────────────────
const ITEMS_IN_ROOMS = {
  LABORATORIO:  ["linterna", "cuaderno_cifrado"],
  CRIPTA:       ["vendas"],
  ARCHIVO:      ["llave_oxidada"],
  CAMARA_FINAL: []
};

const ITEM_INFO = {
  linterna:         { desc: "Revela mensajes ocultos.",      uso: "Úsala en el ARCHIVO (sala siguiente a la CRIPTA)." },
  cuaderno_cifrado: { desc: "Pistas cifradas.",              uso: "Úsalo en la CRIPTA (siguiente sala)." },
  llave_oxidada:    { desc: "Abre la caja fuerte.",          uso: "Úsala aquí en el LABORATORIO → Caja fuerte." },
  vendas:           { desc: "Vendas médicas.",               uso: "Sin efecto mecánico en el juego." },
  llave_maestra:    { desc: "🔑 Abre la puerta de salida.",  uso: "Necesaria para entrar a la CÁMARA FINAL." },
  mascara_gas:      { desc: "😷 Sube el umbral de gas.",     uso: "Se equipa automáticamente al recogerla." },
  catalizador:      { desc: "Reduce la emisión de gas.",     uso: "Úsalo en cualquier sala para bajar el gas." }
};

// ── Puzzles ────────────────────────────────────────────────────
const PUZZLES = [
  {
    id: "P1", room: "LABORATORIO", required: true, dot: "d0",
    title: "Panel de diales",
    desc:
`Un panel con 4 diales oxidados.
Los números parecen tener una relación entre sí.

Diales: [ 3 ] [ 1 ] [ 4 ] [ ? ]

Tal vez todos siguen una misma regla.`,
    pregunta: "¿Qué número completa la secuencia?",
    answer: "2",
    reward: "llave_oxidada",
    rewardMsg: "Compartimento abierto → llave_oxidada\nRecógela con [Recoger objeto].",
    hint: "Observa cómo se relacionan los valores entre sí."
  },

  {
    id: "P2", room: "LABORATORIO", required: true, dot: "d1",
    title: "Caja fuerte",
    desc:
`Una caja fuerte metálica con una ranura para llave.

En la superficie se lee:

"Las acciones simples abren grandes puertas."

La llave parece encajar perfectamente.`,
    pregunta: "¿Qué acción realizas?",
    answer: "ABRIR",
    requiresItem: "llave_oxidada",
    reward: "llave_maestra",
    rewardMsg: "La caja se abre → llave_maestra\nRecógela con [Recoger objeto].",
    hint: "A veces la solución es más directa de lo que parece."
  },

  {
    id: "P3", room: "CRIPTA", required: true, dot: "d2",
    title: "Secuencia en la piedra",
    desc:
`Grabado en la pared:

  1, 1, 2, 3, 5, 8, ?

Los números parecen seguir un patrón repetitivo.`,
    pregunta: "¿Cuál es el siguiente número?",
    answer: "13",
    reward: "mascara_gas",
    rewardMsg: "El cofre se abre → mascara_gas\nRecógela — se equipa automáticamente.",
    hint: "Cada valor depende de los anteriores."
  },

  {
    id: "P4", room: "ARCHIVO", required: true, dot: "d3",
    title: "Tablero de fechas",
    desc:
`Un tablero con fechas marcadas:

  02/03 — 04/06 — 06/09 — 08/12 — ?/?

D�a y mes cambian de forma constante.`,
    pregunta: "¿Cuál es el siguiente número del día?",
    answer: "10",
    reward: "catalizador",
    rewardMsg: "Encuentras un catalizador → reduce el gas.\nRecógelo con [Recoger objeto].",
    hint: "Observa cómo evolucionan los números."
  },

  {
    id: "P5", room: "CAMARA_FINAL", required: false, dot: "d4",
    title: "⭐ Bonus — Número primo",
    desc:
`"El número primo más cercano a 100
desbloquea el compartimento secreto."

No todos los números son lo que parecen.`,
    pregunta: "¿Cuál es el número?",
    answer: "101",
    reward: "tiempo_extra",
    rewardMsg: "⭐ BONUS: +60 segundos al reloj.",
    hint: "Un número primo solo tiene dos divisores."
  }
];

// ══════════════════════════════════════════════════════════════
//  PARADIGMA V — HMM: Modelo Oculto de Markov para pistas
// ══════════════════════════════════════════════════════════════

const HMM_STATES = ["CONFIABLE", "AMBIGUA", "ENGANOSA"];

let currentHintState = "CONFIABLE";

// Matriz A: transición de estado oculto
// CONFIABLE→[0.6,0.3,0.1] | AMBIGUA→[0.3,0.4,0.3] | ENGAÑOSA→[0.2,0.4,0.4]
function nextHintState() {
  const r = Math.random();
  if (currentHintState === "CONFIABLE") {
    currentHintState = r < 0.6 ? "CONFIABLE" : r < 0.9 ? "AMBIGUA" : "ENGANOSA";
  } else if (currentHintState === "AMBIGUA") {
    currentHintState = r < 0.3 ? "CONFIABLE" : r < 0.7 ? "AMBIGUA" : "ENGANOSA";
  } else {
    currentHintState = r < 0.2 ? "CONFIABLE" : r < 0.6 ? "AMBIGUA" : "ENGANOSA";
  }
}

// Matriz B: emisión — B[estado] = [P(útil), P(ambigua), P(engañosa)]
const HMM_B = {
  "CONFIABLE": [0.80, 0.15, 0.05],
  "AMBIGUA":   [0.30, 0.50, 0.20],
  "ENGANOSA":  [0.10, 0.30, 0.60]
};

// Samplea el tipo de observación según la matriz B
// Retorna 0=útil, 1=ambigua, 2=engañosa
function sampleHintEmission() {
  const row = HMM_B[currentHintState];
  const r   = Math.random();
  let cum = 0;
  for (let i = 0; i < row.length; i++) {
    cum += row[i];
    if (r < cum) return i;
  }
  return 2;
}

// Pistas específicas por puzzle [útil, ambigua, engañosa]
// Textos neutros e interpretables — el jugador NO sabe qué tipo recibe
const PUZZLE_HINTS = {
  "P1": [
    "Las diferencias entre los diales alternan entre dos valores constantes.",
    "El patrón podría estar relacionado con alguna secuencia matemática conocida.",
    "Intenta multiplicar los primeros dos diales para obtener el tercero."
  ],
  "P2": [
    "La inscripción en la caja describe literalmente la acción que debes realizar.",
    "El texto sobre acciones y puertas podría tener un significado muy directo.",
    "Quizás la respuesta es un código numérico de cuatro dígitos."
  ],
  "P3": [
    "Cada número en la serie se obtiene sumando los dos que lo preceden.",
    "Los números tienen una relación especial con los que aparecen antes.",
    "Prueba multiplicando los dos últimos valores de la serie entre sí."
  ],
  "P4": [
    "El número del día aumenta de forma constante en cada entrada del tablero.",
    "Observa si las fechas siguen algún tipo de progresión entre sus partes.",
    "Los meses parecen seguir un patrón diferente al de los días."
  ],
  "P5": [
    "El número primo que buscas es el primero que supera el valor 100.",
    "Un número primo únicamente puede dividirse por sí mismo y por 1.",
    "El número que necesitas está justo por debajo del valor 100."
  ]
};

// Genera una pista para el puzzle dado usando la matriz B
function getHintForPuzzle(puzzleId) {
  const type  = sampleHintEmission();
  const hints = PUZZLE_HINTS[puzzleId];
  if (!hints) return "Observa con atención todos los elementos de la sala.";
  return hints[type];
}
