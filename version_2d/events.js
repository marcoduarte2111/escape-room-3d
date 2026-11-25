// ══════════════════════════════════════════════════════════════
//  events.js — Paradigma 1: Eventos Discretos
//
//  Todos los eventos del juego se registran con timestamp real.
//  Los reintentos de puerta siguen un proceso de Poisson:
//    T ~ Exp(λ),  λ = 1/8  →  T = -ln(U)/λ
// ══════════════════════════════════════════════════════════════

const EVENT_LOG = [];

// Registra un evento y lo muestra en el panel lateral
function recordEvent(nombre, t) {
  EVENT_LOG.push({ nombre, t });

  const container = document.getElementById('log-lines');
  const entry     = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `
    <span class="log-time">[${t.toFixed(1)}s]</span>
    <span class="log-msg evt">${nombre}</span>
  `;
  container.appendChild(entry);
  container.scrollTop = container.scrollHeight;
}

// Genera el tiempo de reintento de puerta (distribución de Poisson)
function poissonDoorRetry(t) {
  const lambda = 1 / 8;                            // 1 reintento cada ~8s
  const dt     = -Math.log(Math.random()) / lambda; // inversa de CDF exponencial
  recordEvent(`Reintento de puerta en ${dt.toFixed(1)}s (Poisson λ=1/8)`, t);
  return dt;
}