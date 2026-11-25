// ══════════════════════════════════════════════════════════════
//  gas.js — Paradigma 3: Sistema Dinámico
//
//  Ecuación:  dG/dt = (λ - V)·G + Q
//  Solución:  G(t) = (G₀ + Q/α)·e^(α·Δt) - Q/α   (α ≠ 0)
//             G(t) = G₀ + Q·Δt                    (α = 0)
// ══════════════════════════════════════════════════════════════

const GAS = {
  lam:    0.006,
  Q:      1.0,
  V:      0.0,
  tStart: 0.0,
  G0:     0.0,
  hasMask: false
};

const GAS_PENALTY = 20;

function gasAlpha() {
  return GAS.lam - GAS.V;
}

function gasConcentration(t) {
  const dt = Math.max(0, t - GAS.tStart);
  const a  = gasAlpha();
  if (Math.abs(a) < 1e-9) return GAS.G0 + GAS.Q * dt;
  return (GAS.G0 + GAS.Q / a) * Math.exp(a * dt) - GAS.Q / a;
}

function gasThreshold() {
  return GAS.hasMask ? 500 : 300;
}

function gasResegment(t) {
  GAS.G0     = gasConcentration(t);
  GAS.tStart = t;
}

function gasPenalty(t) {
  gasResegment(t);
  GAS.G0 += GAS_PENALTY;
}

function gasOpenVent(t) {
  gasResegment(t);
  GAS.V = 0.015;
  GAS.Q = 0.3;
}

function gasUseCatalyst(t) {
  gasResegment(t);
  GAS.Q = Math.max(0.1, GAS.Q - 0.5);
}

// ── Estados discretos ──────────────────────────────────────────
const GAS_STATES = ["SEGURO", "ALERTA", "PELIGRO", "FATAL"];

function getGasState(G) {
  if (G < 100) return "SEGURO";
  if (G < 200) return "ALERTA";
  if (G < 300) return "PELIGRO";
  return "FATAL";
}

// ══════════════════════════════════════════════════════════════
//  PARADIGMA IV — Cadena de Markov
//
//  Matrices de transición explícitas según ventana abierta/cerrada.
//  Índices: 0=SEGURO, 1=ALERTA, 2=PELIGRO, 3=FATAL
// ══════════════════════════════════════════════════════════════

// Ventana CERRADA — el gas tiende a subir
const P_CERRADA = [
  [0.4, 0.6, 0.0, 0.0], // SEGURO  → SEGURO 40%, ALERTA 60%
  [0.0, 0.3, 0.7, 0.0], // ALERTA  → ALERTA 30%, PELIGRO 70%
  [0.0, 0.0, 0.2, 0.8], // PELIGRO → PELIGRO 20%, FATAL 80%
  [0.0, 0.0, 0.0, 1.0]  // FATAL   → absorbente 100%
];

// Ventana ABIERTA — la dinámica se invierte a favor del jugador
const P_ABIERTA = [
  [1.0, 0.0, 0.0, 0.0], // SEGURO  → SEGURO 100%
  [0.4, 0.6, 0.0, 0.0], // ALERTA  → SEGURO 40%, ALERTA 60%
  [0.0, 0.5, 0.5, 0.0], // PELIGRO → ALERTA 50%, PELIGRO 50%
  [0.0, 0.3, 0.0, 0.7]  // FATAL   → ALERTA 30%, FATAL 70%
];

let _markovLastIdx = 0; // índice del último estado Markov registrado

// Ejecuta un paso de la Cadena de Markov y registra la transición.
// Retorna { prevState, newState, changed }
function markovStep(t, ventilated) {
  const G          = gasConcentration(t);
  const currentIdx = GAS_STATES.indexOf(getGasState(G));
  const matrix     = ventilated ? P_ABIERTA : P_CERRADA;
  const row        = matrix[currentIdx];

  const r = Math.random();
  let cumulative = 0, nextIdx = currentIdx;
  for (let i = 0; i < row.length; i++) {
    cumulative += row[i];
    if (r < cumulative) { nextIdx = i; break; }
  }

  const prevName = GAS_STATES[_markovLastIdx];
  const nextName = GAS_STATES[nextIdx];
  const changed  = nextIdx !== _markovLastIdx;
  _markovLastIdx = nextIdx;

  return { prevState: prevName, newState: nextName, changed };
}

// Devuelve el nombre del estado Markov actual
function getMarkovState() {
  return GAS_STATES[_markovLastIdx];
}
