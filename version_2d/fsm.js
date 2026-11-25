// ══════════════════════════════════════════════════════════════
//  fsm.js — Paradigma 2: Máquina de Estados Finitos (FSM)
//
//  Estados y transiciones válidas del agente jugador:
//
//  EXPLORANDO  → RECOGIENDO | RESOLVIENDO | ESCAPANDO | MUERTO
//  RECOGIENDO  → EXPLORANDO | USANDO | MUERTO
//  USANDO      → EXPLORANDO | ESCAPANDO | MUERTO
//  RESOLVIENDO → EXPLORANDO | RECOGIENDO | MUERTO
//  ESCAPANDO   → LIBRE | EXPLORANDO | MUERTO
//  LIBRE / MUERTO → (estados finales)
// ══════════════════════════════════════════════════════════════

const FSM = {
  estado: "EXPLORANDO",
  historial: []
};

const FSM_TRANSICIONES = {
  "EXPLORANDO":  ["RECOGIENDO","RESOLVIENDO","ESCAPANDO","MUERTO"],
  "RECOGIENDO":  ["EXPLORANDO","USANDO","MUERTO"],
  "USANDO":      ["EXPLORANDO","ESCAPANDO","MUERTO"],
  "RESOLVIENDO": ["EXPLORANDO","RECOGIENDO","MUERTO"],
  "ESCAPANDO":   ["LIBRE","EXPLORANDO","MUERTO"],
  "MUERTO": [],
  "LIBRE":  []
};

// Intenta una transición. Retorna true si fue válida.
function fsmTransition(nuevoEstado, t) {
  const validos = FSM_TRANSICIONES[FSM.estado] || [];
  if (!validos.includes(nuevoEstado)) return false;
  FSM.historial.push({ de: FSM.estado, a: nuevoEstado, t });
  FSM.estado = nuevoEstado;
  return true;
}