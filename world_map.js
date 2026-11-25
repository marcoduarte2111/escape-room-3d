// ══════════════════════════════════════════════════════════════
//  world_map.js — Geografía del búnker (fuente única del mapa)
//
//  PLANO VISTO DESDE ARRIBA · unidades en METROS
//    x → Este      y → Norte      origen (0,0) = esquina SO de la ENTRADA
//  El motor 3D convierte (x, y) → (x, -z). La altura (h) es solo 3D.
//  Todo lo que se ve en 3D sale de aquí, así que este archivo sirve
//  también como referencia exacta para dibujar el mapa a mano.
//
//  Desvios: Laboratorio - Bombas - Cisternas - Cripta; Cripta - Reles - Observatorio - Archivo.
// ══════════════════════════════════════════════════════════════

const WORLD = {
  wallThick: 0.3,
  doorHeight: 2.4,

  // ── Salas (rectángulos) ─────────────────────────────────────
  // theme: material de suelo/pared · light: color de la luz principal
  rooms: {
    BOMBAS:       { x0: 11, y0: 1,  x1: 18, y1: 8,  h: 3.2, theme: 'metal', light: 0x62d7ce, lightPos: [14, 4], intensity: 1.3 },
    CISTERNAS:    { x0: 21, y0: 1,  x1: 29, y1: 7,  h: 3.6, theme: 'concrete', light: 0xffbf70, lightPos: [25, 4], intensity: 1.3 },
    RELES:        { x0: 34, y0: 11, x1: 43, y1: 21, h: 3.3, theme: 'lab', light: 0xb99aff, lightPos: [38, 16], intensity: 1.3 },
    OBSERVATORIO: { x0: 34, y0: 29, x1: 43, y1: 39, h: 4.4, theme: 'metal', light: 0x8abaff, lightPos: [38, 34], intensity: 1.4 },
    ESPEJOS:      { x0: -16, y0: 14, x1: -6, y1: 25, h: 4.8, theme: 'metal', light: 0x96adff, lightPos: [-11, 19], intensity: 1.8 },
    ENTRADA:      { x0: 0,  y0: 0,  x1: 10, y1: 8,  h: 3.0, theme: 'concrete', light: 0xffc98a, lightPos: [5, 4],   intensity: 1.1 },
    LABORATORIO:  { x0: -2, y0: 12, x1: 14, y1: 22, h: 3.4, theme: 'lab',      light: 0xd8f4ff, lightPos: [6, 17],  intensity: 1.4 },
    CRIPTA:       { x0: 20, y0: 10, x1: 30, y1: 24, h: 4.2, theme: 'stone',    light: 0xff9a4a, lightPos: [25, 17], intensity: 1.2 },
    ARCHIVO:      { x0: 16, y0: 30, x1: 30, y1: 40, h: 3.2, theme: 'wood',     light: 0xffe0a8, lightPos: [23, 35], intensity: 0.75 },
    CAMARA_FINAL: { x0: -2, y0: 28, x1: 8,  y1: 42, h: 5.0, theme: 'metal',    light: 0xff4060, lightPos: [3, 35],  intensity: 1.3 }
  },

  // ── Pasillos (rectángulos de 1.6 m de ancho) ────────────────
  corridors: [
    { id: 'C6', x0: 11.6, y0: 8,    x1: 13.2, y1: 12,   h: 2.6 },
    { id: 'C7', x0: 18,   y0: 3.2,  x1: 21,   y1: 4.8,  h: 2.6 },
    { id: 'C8', x0: 21.5, y0: 7,    x1: 23.1, y1: 10,   h: 2.6 },
    { id: 'C9', x0: 30,   y0: 14.3, x1: 34,   y1: 15.9, h: 2.6 },
    { id: 'C10',x0: 37,   y0: 21,   x1: 38.6, y1: 29,   h: 2.6 },
    { id: 'C11',x0: 30,   y0: 34.8, x1: 34,   y1: 36.4, h: 2.6 },
    { id: 'C5', x0: -6, y0: 18.6, x1: -2, y1: 20.4, h: 2.6 },
    { id: 'C1', x0: 4.2, y0: 8,    x1: 5.8,  y1: 12,   h: 2.6 }, // ENTRADA → LABORATORIO
    { id: 'C2', x0: 14,  y0: 16.2, x1: 20,   y1: 17.8, h: 2.6 }, // LABORATORIO → CRIPTA
    { id: 'C3', x0: 24.2, y0: 24,  x1: 25.8, y1: 30,   h: 2.6 }, // CRIPTA → ARCHIVO
    { id: 'C4', x0: 8,   y0: 34.2, x1: 16,   y1: 35.8, h: 2.6 }  // ARCHIVO → CÁMARA FINAL
  ],

  // ── Puertas entre salas (en la pared de la sala destino) ────
  // axis 'x': la puerta ocupa un tramo en x sobre la línea y = at
  // axis 'y': la puerta ocupa un tramo en y sobre la línea x = at
  doors: [
    { id: 'D1', to: 'LABORATORIO',  axis: 'x', at: 12, from: 4.2,  until: 5.8,  startOpen: true },
    { id: 'D2', to: 'CRIPTA',       axis: 'y', at: 14, from: 16.2, until: 17.8, detour: 'Bombas, al sur del laboratorio' },
    { id: 'D3', to: 'ARCHIVO',      axis: 'x', at: 24, from: 24.2, until: 25.8, detour: 'Relés, al este de la cripta' },
    { id: 'D5', to: 'CRIPTA',       axis: 'x', at: 10, from: 21.5, until: 23.1 },
    { id: 'D6', to: 'ARCHIVO',      axis: 'y', at: 30, from: 34.8, until: 36.4 },
    { id: 'D4', to: 'CAMARA_FINAL', axis: 'y', at: 8,  from: 34.2, until: 35.8 }
  ],

  // ── Posición inicial del jugador ────────────────────────────
  spawn: { x: 5, y: 2.2, yaw: 0 },   // yaw 0 = mirando al Norte

  // ── Puntos de interés con función de juego ──────────────────
  // face: hacia dónde mira el objeto ('N','S','E','W')
  stations: [
    { id: 'P1',    room: 'LABORATORIO',  kind: 'dials',   x: -1.85, y: 17,    face: 'E' },
    { id: 'P2',    room: 'LABORATORIO',  kind: 'safe',    x: 10,    y: 21.45, face: 'S' },
    { id: 'P3',    room: 'CRIPTA',       kind: 'chest',   x: 25,    y: 11.2,  face: 'N' },
    { id: 'P4',    room: 'ARCHIVO',      kind: 'board',   x: 29.85, y: 34,    face: 'W' },
    { id: 'P5',    room: 'CAMARA_FINAL', kind: 'terminal',x: 3,     y: 41.55, face: 'S' },
    { id: 'VENT',  room: 'CRIPTA',       kind: 'window',  x: 30,    y: 17,    face: 'W' },
    { id: 'EXIT',  room: 'CAMARA_FINAL', kind: 'exit',    x: -2,    y: 35,    face: 'E' },
    { id: 'SEALED',room: 'ENTRADA',      kind: 'sealed',  x: 5,     y: 0,     face: 'N' }
  ],

  // ── Dónde aparece cada objeto (original o recompensa) ───────
  itemSpots: {
    linterna:         { room: 'LABORATORIO',  x: 2.2,   y: 16,    z: 0.95 },
    cuaderno_cifrado: { room: 'LABORATORIO',  x: 8.6,   y: 16.2,  z: 0.95 },
    llave_oxidada:    { room: 'LABORATORIO',  x: -1.35, y: 16.1,  z: 0.95 }, // cajón bajo los diales (recompensa P1)
    llave_maestra:    { room: 'LABORATORIO',  x: 10,    y: 21.45, z: 1.15 }, // dentro de la caja fuerte (P2)
    vendas:           { room: 'CRIPTA',       x: 21.2,  y: 22.7,  z: 0.6  },
    mascara_gas:      { room: 'CRIPTA',       x: 25,    y: 10.9,  z: 0.8  }, // cofre (P3)
    catalizador:      { room: 'ARCHIVO',      x: 29.5,  y: 32.3,  z: 1.0  }, // repisa del tablero (P4)
    llave_oxidada_archivo: { room: 'ARCHIVO', x: 27.2,  y: 31.5,  z: 0.8  }  // copia en el escritorio del archivo
  },

  // ── Dónde se sitúa el NPC en cada sala ──────────────────────
  npcSpots: {
    ENTRADA:      { x: 7.8,  y: 5.6 },
    LABORATORIO:  { x: 12.4, y: 13.6 },
    CRIPTA:       { x: 28.4, y: 22.4 },
    ARCHIVO:      { x: 21,   y: 35 },
    CAMARA_FINAL: { x: 5.6,  y: 30.6 }
  },

  // ── Mobiliario (sólido: bloquea el paso) ────────────────────
  // x0..x1, y0..y1 en planta · h = altura · type = aspecto
  props: [
    { room: 'BOMBAS', type: 'pipe', x0: 14.3, y0: 2, x1: 15.3, y1: 5.8, h: 3.2 },
    { room: 'CISTERNAS', type: 'tank', x0: 24, y0: 3.5, x1: 27.2, y1: 5.7, h: 3.2 },
    { room: 'RELES', type: 'cabinet', x0: 35.3, y0: 16.5, x1: 39.5, y1: 17.4, h: 2.1 },
    { room: 'OBSERVATORIO', type: 'console', x0: 35.5, y0: 32, x1: 40.1, y1: 33.4, h: 1.1 },
    // ENTRADA
    { room: 'ENTRADA', type: 'bench',    x0: 0.25, y0: 2,    x1: 0.85, y1: 5.5,  h: 0.5 },
    { room: 'ENTRADA', type: 'lockers',  x0: 9.3,  y0: 0.8,  x1: 9.85, y1: 4.2,  h: 2.0 },
    { room: 'ENTRADA', type: 'crate',    x0: 1.2,  y0: 6.6,  x1: 2.2,  y1: 7.6,  h: 0.9 },
    { room: 'ENTRADA', type: 'crate',    x0: 2.4,  y0: 6.9,  x1: 3.1,  y1: 7.6,  h: 0.7 },
    // LABORATORIO
    { room: 'LABORATORIO', type: 'table',   x0: 1,    y0: 15,   x1: 5,    y1: 17,   h: 0.9 },
    { room: 'LABORATORIO', type: 'table',   x0: 7,    y0: 15,   x1: 11,   y1: 17,   h: 0.9 },
    { room: 'LABORATORIO', type: 'shelf',   x0: -1.8, y0: 21.35,x1: 6,    y1: 21.85,h: 2.2 },
    { room: 'LABORATORIO', type: 'safe',    x0: 9.4,  y0: 21.1, x1: 10.6, y1: 21.85,h: 1.1 },
    { room: 'LABORATORIO', type: 'drawer',  x0: -1.85,y0: 15.7, x1: -1.1, y1: 18.3, h: 0.9 },
    { room: 'LABORATORIO', type: 'tank',    x0: 12.6, y0: 20.2, x1: 13.8, y1: 21.4, h: 2.4 },
    { room: 'LABORATORIO', type: 'tank',    x0: -1.7, y0: 12.3, x1: -0.7, y1: 13.3, h: 2.0 },
    // CRIPTA
    { room: 'CRIPTA', type: 'pillar',   x0: 22.1, y0: 13.1, x1: 22.9, y1: 13.9, h: 4.2 },
    { room: 'CRIPTA', type: 'pillar',   x0: 27.1, y0: 13.1, x1: 27.9, y1: 13.9, h: 4.2 },
    { room: 'CRIPTA', type: 'pillar',   x0: 22.1, y0: 20.1, x1: 22.9, y1: 20.9, h: 4.2 },
    { room: 'CRIPTA', type: 'pillar',   x0: 27.1, y0: 20.1, x1: 27.9, y1: 20.9, h: 4.2 },
    { room: 'CRIPTA', type: 'sarcophagus', x0: 24, y0: 16.1, x1: 26,  y1: 17.9, h: 0.95 },
    { room: 'CRIPTA', type: 'chest',    x0: 24.3, y0: 10.5, x1: 25.7, y1: 11.3, h: 0.75 },
    { room: 'CRIPTA', type: 'altar',    x0: 20.6, y0: 22.2, x1: 21.8, y1: 23.2, h: 0.55 },
    // ARCHIVO
    { room: 'ARCHIVO', type: 'bookshelf', x0: 18,   y0: 31.4, x1: 23,   y1: 32,   h: 2.4 },
    { room: 'ARCHIVO', type: 'bookshelf', x0: 18,   y0: 38.2, x1: 23,   y1: 38.8, h: 2.4 },
    { room: 'ARCHIVO', type: 'bookshelf', x0: 26.5, y0: 36.6, x1: 29.6, y1: 37.2, h: 2.4 },
    { room: 'ARCHIVO', type: 'bookshelf', x0: 26.5, y0: 38.9, x1: 29.6, y1: 39.5, h: 2.4 },
    { room: 'ARCHIVO', type: 'desk',      x0: 26.2, y0: 30.9, x1: 28.4, y1: 32,   h: 0.78 },
    { room: 'ARCHIVO', type: 'cabinet',   x0: 16.2, y0: 30.2, x1: 17.2, y1: 31,   h: 1.3 },
    { room: 'ARCHIVO', type: 'cabinet',   x0: 29.1, y0: 31.8, x1: 29.85,y1: 32.8, h: 0.95 },
    // CÁMARA FINAL
    { room: 'CAMARA_FINAL', type: 'pipe',   x0: -1.8, y0: 29.2, x1: -1.0, y1: 30,   h: 5.0 },
    { room: 'CAMARA_FINAL', type: 'pipe',   x0: -1.8, y0: 40,   x1: -1.0, y1: 40.8, h: 5.0 },
    { room: 'CAMARA_FINAL', type: 'pipe',   x0: 7,    y0: 28.2, x1: 7.8,  y1: 29,   h: 5.0 },
    { room: 'CAMARA_FINAL', type: 'pipe',   x0: 7,    y0: 41,   x1: 7.8,  y1: 41.8, h: 5.0 },
    { room: 'CAMARA_FINAL', type: 'console',x0: 2.3,  y0: 41.3, x1: 3.7,  y1: 41.85,h: 1.1 }
  ],

  // ── Letreros y textos en las paredes ────────────────────────
  // x,y sobre la línea de la pared (el motor los despega de ella) · z altura del centro · face: hacia dónde mira
  signs: [
    { text: 'BOMBAS',        x: 12.4, y: 12, z: 2.8, face: 'N', w: 2.2, color: '#62d7ce' },
    { text: 'CISTERNAS',     x: 18, y: 4, z: 2.8, face: 'W', w: 2.2, color: '#ffbf70' },
    { text: 'CRIPTA',        x: 22.3, y: 7, z: 2.8, face: 'S', w: 2.2, color: '#ffb070' },
    { text: 'RELÉS',         x: 30, y: 15.1, z: 3.15, face: 'W', w: 1.8, color: '#b99aff' },
    { text: 'OBSERVATORIO',  x: 37.8, y: 21, z: 2.8, face: 'S', w: 2.5, color: '#8abaff' },
    { text: 'ARCHIVO',       x: 34, y: 35.6, z: 2.8, face: 'E', w: 2.2, color: '#ffe0a8' },
    { text: 'SALA DE ESPEJOS', x: -2, y: 19.5, z: 2.95, face: 'E', w: 2.2, color: '#abbaff' },
    { text: 'LABORATORIO ▲',   x: 5,     y: 8,     z: 2.55, face: 'S', w: 1.8, color: '#7fe8ff' },
    { text: '⚠ ÁREA SELLADA',  x: 7.8,   y: 0,     z: 1.9,  face: 'N', w: 1.8, color: '#ffc845' },
    { text: 'ATAJO A CRIPTA',  x: 14,    y: 17,    z: 2.8,  face: 'W', w: 2.6, color: '#ffb070' },
    { text: 'ATAJO A ARCHIVO', x: 25,    y: 24,    z: 2.8,  face: 'S', w: 2.6, color: '#ffe0a8' },
    { text: '◀ CÁMARA FINAL',  x: 16,    y: 35,    z: 2.75, face: 'E', w: 1.8, color: '#ff6a80' },
    { text: 'SALIDA',          x: -2,    y: 35,    z: 4.25, face: 'E', w: 1.8, color: '#00e87a' }
  ],

  // Texto oculto que solo aparece con la linterna encendida (ARCHIVO)
  hiddenText: { x: 24.75, y: 40, z: 1.7, face: 'S', lines: ['LOS DÍAS SUBEN', 'DE 2 EN 2'] }
};
