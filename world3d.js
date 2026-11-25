// ══════════════════════════════════════════════════════════════
//  world3d.js — Mundo 3D en primera persona (Three.js r128)
//
//  Construye todo a partir de WORLD (world_map.js) y se comunica con
//  la lógica del juego (game.js) solo a través de funciones públicas:
//    enterRoom, doPick, doUse, doVent, openPuzzleStation, tryDoor,
//    openNpc, canEnterRoom, tryOpenGate …
// ══════════════════════════════════════════════════════════════

const World3D = (() => {
  'use strict';

  // ── Constantes ────────────────────────────────────────────────
  const EYE = 1.62, RADIUS = 0.28, WALK = 3.1, RUN = 5.4, REACH = 2.4;
  const T = () => WORLD.wallThick;
  const EPS = 1e-3;
  const near = (a, b) => Math.abs(a - b) < EPS;

  // Planta (x, y) + altura z  →  Three.js (x, z, -y)
  const V = (x, y, z = 0) => new THREE.Vector3(x, z, -y);
  const FACE_VEC = { N: [0, 1], S: [0, -1], E: [1, 0], W: [-1, 0] };
  const FACE_ROT = { S: 0, N: Math.PI, E: Math.PI / 2, W: -Math.PI / 2 };

  // ── Estado ────────────────────────────────────────────────────
  let renderer, scene, camera, container;
  let raf = 0, lastT = 0, time = 0, running = false, built = false;
  let locked = false, overlay = false, paused = false, mapOpen = false, dragLook = false;
  let dragging = false;
  const keys = Object.create(null);

  const player = { x: 0, y: 0, yaw: 0, pitch: 0, vx: 0, vy: 0, bob: 0, stepAcc: 0 };
  const colliders = [];            // estáticos {x0,y0,x1,y1}
  const interactables = [];        // {id, room?, pos:Vector3, radius, reach, label(), action()}
  const animators = [];            // fn(dt, time)
  const doors = {};                // id → {def, mesh, open, slide, lamps, collider}
  const itemMeshes = new Map();    // 'ROOM|item' → {group, halo, base, inter}
  const stationFx = {};            // pid → fn al resolverse
  const roomLights = {};           // room → {light, base, color}
  let currentRoom = 'ENTRADA';
  const visited = new Set(['ENTRADA']);
  let target = null;

  let flashlight, flashOn = false, windowLight, exitLight, roomShadow;
  let hiddenMat = null, hiddenPos = null;
  let npc = null, npcRoom = null, npcMood = 'COOPERAR', npcAppear = 0;
  let hunter;
  let gasPct = 0, gasState = 'SEGURO', gasFlashT = 0, heartT = 0;
  let particles = null;
  let fogColorSafe, fogColorToxic;
  let mapTimer = 0;
  let hunterAggression = 1;        // la ajusta el director adaptativo (0.75–1.25)
  let hitT = 0, fear = 0;          // efectos de pantalla: daño y persecución
  let flashSway = { x: 0, y: 0, lastYaw: 0, lastPitch: 0 };
  const mixers = [];               // animaciones de los modelos GLTF
  const perf = { t: 0, frames: 0, slow: 0, settled: false };
  const mirrorSurfaces = [];
  const crossedMirrors = new Set();
  let mirrorPulse = 0;
  const mirrorCamera = new THREE.PerspectiveCamera();
  const mirrorDirection = new THREE.Vector3();
  const mirrorClip = new THREE.Plane();
  const mirrorFrustum = new THREE.Frustum();
  const mirrorProjection = new THREE.Matrix4();

  // ── RNG determinista (el mundo siempre luce igual) ────────────
  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // ══════════════════════════════════════════════════════════════
  //  TEXTURAS PROCEDURALES (canvas)
  // ══════════════════════════════════════════════════════════════
  function canvasTex(size, draw, { repeat = true, h = size } = {}) {
    const c = document.createElement('canvas');
    c.width = size; c.height = h;
    const g = c.getContext('2d');
    draw(g, size, h);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    t.userData = { canvas: c, ctx: g };
    return t;
  }

  function speckle(g, w, h, r, n, alpha) {
    for (let i = 0; i < n; i++) {
      const v = Math.floor(r() * 255);
      g.fillStyle = `rgba(${v},${v},${v},${alpha * r()})`;
      g.fillRect(r() * w, r() * h, 1 + r() * 2.5, 1 + r() * 2.5);
    }
  }

  const TEX = {};
  function buildTextures() {
    TEX.concrete = canvasTex(512, (g, s) => {
      const r = rng(11);
      g.fillStyle = '#85837a'; g.fillRect(0, 0, s, s);
      speckle(g, s, s, r, 14000, 0.44);
      for (let i = 0; i < 42; i++) {
        const x = r() * s, y = r() * s;
        const gr = g.createRadialGradient(x, y, 2, x, y, 28 + r() * 80);
        gr.addColorStop(0, i % 3 === 0 ? '#3a32294c' : '#c5b8a129');
        gr.addColorStop(1, '#8b806b00');
        g.fillStyle = gr; g.fillRect(0, 0, s, s);
      }
      for (let i = 0; i < 560; i++) {
        const x = r() * s, y = r() * s, radius = 0.4 + r() * 1.9;
        g.fillStyle = '#d8d1bd68'; g.beginPath(); g.arc(x, y + 0.65, radius, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#332f2a78'; g.beginPath(); g.arc(x, y, radius, 0, Math.PI * 2); g.fill();
      }
      g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 2;
      g.strokeRect(0, 0, s, s);
    });

    TEX.labFloor = canvasTex(256, (g, s) => {
      const r = rng(21);
      const n = 4, c = s / n;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const v = 196 + Math.floor(r() * 18);
        g.fillStyle = `rgb(${v},${v + 6},${v + 8})`;
        g.fillRect(i * c, j * c, c, c);
      }
      speckle(g, s, s, r, 1200, 0.18);
      g.strokeStyle = '#6f7a7e'; g.lineWidth = 3;
      for (let i = 0; i <= n; i++) {
        g.beginPath(); g.moveTo(i * c, 0); g.lineTo(i * c, s); g.stroke();
        g.beginPath(); g.moveTo(0, i * c); g.lineTo(s, i * c); g.stroke();
      }
    });

    TEX.labWall = canvasTex(256, (g, s) => {
      const r = rng(31);
      g.fillStyle = '#aebbc0'; g.fillRect(0, 0, s, s);
      speckle(g, s, s, r, 900, 0.12);
      g.fillStyle = '#8795a0'; g.fillRect(0, s * 0.78, s, s * 0.22);
      g.strokeStyle = 'rgba(40,50,60,0.55)'; g.lineWidth = 3;
      g.strokeRect(2, 2, s - 4, s - 4);
      g.fillStyle = 'rgba(40,50,60,0.6)';
      [[10, 10], [s - 10, 10], [10, s - 10], [s - 10, s - 10]].forEach(([x, y]) => {
        g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill();
      });
    });

    TEX.stoneWall = canvasTex(256, (g, s) => {
      const r = rng(41);
      g.fillStyle = '#2d2722'; g.fillRect(0, 0, s, s);
      const rows = 6, rh = s / rows;
      for (let y = 0; y < rows; y++) {
        const off = (y % 2) * 32;
        for (let x = -64; x < s + 64; x += 64) {
          const v = 88 + Math.floor(r() * 40);
          g.fillStyle = `rgb(${v},${v - 10},${v - 22})`;
          g.fillRect(x + off + 2, y * rh + 2, 60, rh - 4);
        }
      }
      speckle(g, s, s, r, 2500, 0.3);
    });

    TEX.stoneFloor = canvasTex(256, (g, s) => {
      const r = rng(51);
      g.fillStyle = '#231e1a'; g.fillRect(0, 0, s, s);
      const n = 3, c = s / n;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const v = 70 + Math.floor(r() * 30);
        g.fillStyle = `rgb(${v},${v - 6},${v - 14})`;
        g.fillRect(i * c + 3, j * c + 3, c - 6, c - 6);
      }
      speckle(g, s, s, r, 3000, 0.3);
    });

    TEX.woodFloor = canvasTex(256, (g, s) => {
      const r = rng(61);
      const n = 8, c = s / n;
      for (let i = 0; i < n; i++) {
        const v = 90 + Math.floor(r() * 35);
        g.fillStyle = `rgb(${v},${Math.floor(v * 0.62)},${Math.floor(v * 0.38)})`;
        g.fillRect(i * c, 0, c, s);
        g.strokeStyle = 'rgba(30,15,5,0.35)'; g.lineWidth = 1;
        for (let k = 0; k < 6; k++) {
          const x = i * c + r() * c;
          g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + 4, s / 3, x - 4, s * 2 / 3, x, s); g.stroke();
        }
        g.fillStyle = 'rgba(20,10,4,0.8)'; g.fillRect(i * c, 0, 2, s);
        g.fillRect(i * c, Math.floor(r() * s), c, 2);
      }
    });

    TEX.wallpaper = canvasTex(256, (g, s) => {
      const r = rng(71);
      g.fillStyle = '#34402f'; g.fillRect(0, 0, s, s);
      for (let x = 0; x < s; x += 32) {
        g.fillStyle = 'rgba(210,190,120,0.08)'; g.fillRect(x, 0, 12, s);
        g.fillStyle = 'rgba(210,190,120,0.12)';
        for (let y = 16; y < s; y += 32) { g.beginPath(); g.arc(x + 22, y, 3, 0, 7); g.fill(); }
      }
      speckle(g, s, s, r, 1500, 0.15);
    });

    TEX.metalWall = canvasTex(256, (g, s) => {
      const r = rng(81);
      g.fillStyle = '#3b4149'; g.fillRect(0, 0, s, s);
      speckle(g, s, s, r, 2000, 0.18);
      g.strokeStyle = '#1d2126'; g.lineWidth = 4;
      g.strokeRect(0, 0, s, s); g.beginPath(); g.moveTo(0, s / 2); g.lineTo(s, s / 2); g.stroke();
      g.fillStyle = '#6a737d';
      for (let x = 12; x < s; x += 38) [10, s / 2 - 10, s / 2 + 10, s - 10].forEach(y => {
        g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill();
      });
      g.fillStyle = 'rgba(120,60,20,0.2)';
      for (let i = 0; i < 5; i++) g.fillRect(r() * s, r() * s, 4 + r() * 10, 30 + r() * 60);
    });

    TEX.metalFloor = canvasTex(128, (g, s) => {
      g.fillStyle = '#4a4f55'; g.fillRect(0, 0, s, s);
      g.fillStyle = '#6a7078';
      for (let y = 0; y < s; y += 16) for (let x = (y / 16 % 2) * 8; x < s; x += 16) {
        g.save(); g.translate(x + 4, y + 8); g.rotate(0.6); g.fillRect(-5, -1.5, 10, 3); g.restore();
      }
    });

    TEX.hazard = canvasTex(128, (g, s) => {
      g.fillStyle = '#e8b400'; g.fillRect(0, 0, s, s);
      g.fillStyle = '#151515';
      for (let i = -s; i < s * 2; i += 32) {
        g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 16, 0); g.lineTo(i + 16 - s, s); g.lineTo(i - s, s); g.fill();
      }
    });

    TEX.books = canvasTex(256, (g, s) => {
      const r = rng(91);
      g.fillStyle = '#2a1b10'; g.fillRect(0, 0, s, s);
      const shelves = 4, sh = s / shelves;
      for (let k = 0; k < shelves; k++) {
        let x = 4;
        while (x < s - 6) {
          const w = 6 + r() * 12, h = sh * (0.55 + r() * 0.35);
          const hue = Math.floor(r() * 360);
          g.fillStyle = r() < 0.5 ? `hsl(${hue},25%,${22 + r() * 18}%)` : `hsl(40,${20 + r() * 20}%,${55 + r() * 20}%)`;
          g.fillRect(x, (k + 1) * sh - h - 5, w, h);
          x += w + 1;
        }
        g.fillStyle = '#4b301b'; g.fillRect(0, (k + 1) * sh - 5, s, 5);
      }
    });

    TEX.wood = canvasTex(128, (g, s) => {
      const r = rng(101);
      g.fillStyle = '#6b4526'; g.fillRect(0, 0, s, s);
      g.strokeStyle = 'rgba(30,15,5,0.4)';
      for (let i = 0; i < 18; i++) {
        const y = r() * s; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(s / 3, y + 5, s * 2 / 3, y - 5, s, y); g.stroke();
      }
    });

    TEX.rust = canvasTex(128, (g, s) => {
      const r = rng(111);
      g.fillStyle = '#5b3a24'; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 400; i++) {
        g.fillStyle = `rgba(${140 + r() * 60},${60 + r() * 30},${20},${r() * 0.5})`;
        g.fillRect(r() * s, r() * s, 1 + r() * 4, 1 + r() * 4);
      }
    });

    TEX.halo = canvasTex(64, (g, s) => {
      const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      gr.addColorStop(0, 'rgba(255,255,255,0.9)');
      gr.addColorStop(0.3, 'rgba(255,255,255,0.35)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, s, s);
    }, { repeat: false });

    TEX.sky = canvasTex(128, (g, s) => {
      const gr = g.createLinearGradient(0, 0, 0, s);
      gr.addColorStop(0, '#0b1a3a'); gr.addColorStop(1, '#6f95c8');
      g.fillStyle = gr; g.fillRect(0, 0, s, s);
      g.fillStyle = '#fff';
      const r = rng(5);
      for (let i = 0; i < 30; i++) g.fillRect(r() * s, r() * s * 0.6, 1, 1);
    }, { repeat: false });
  }

  // Texto sobre canvas (letreros, pantallas, puzzles)
  function textCanvas(w, h, draw) {
    const t = canvasTex(w, draw, { repeat: false, h });
    return t;
  }
  function redraw(tex, draw) {
    const { canvas, ctx } = tex.userData;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    draw(ctx, canvas.width, canvas.height);
    tex.needsUpdate = true;
  }

  // ══════════════════════════════════════════════════════════════
  //  MATERIALES
  // ══════════════════════════════════════════════════════════════
  const MAT = {};
  // Todo es PBR (MeshStandardMaterial): así las texturas reales de gfx.js
  // (color + normales + rugosidad) pueden sustituir a las procedurales.
  function phong(map, color = 0xffffff, shininess = 8, extra = {}) {
    return new THREE.MeshStandardMaterial(Object.assign({
      map, color, bumpMap: map, bumpScale: 0.02,
      roughness: Math.max(0.3, 0.95 - shininess * 0.012), metalness: 0, envMapIntensity: 0.3
    }, extra));
  }
  const pbr = (color, roughness, metalness, extra = {}) =>
    new THREE.MeshStandardMaterial(Object.assign({ color, roughness, metalness, envMapIntensity: 0.9 }, extra));
  function buildMaterials() {
    const surface = (map, color, roughness, bumpScale, metalness = 0) =>
      new THREE.MeshStandardMaterial({ map, color, roughness, bumpMap: map, bumpScale, metalness, envMapIntensity: 0.3 });
    MAT.concreteWall  = surface(TEX.concrete, 0xe3ded4, 0.91, 0.044);
    MAT.concreteFloor = surface(TEX.concrete, 0xb4afa4, 0.72, 0.025);
    MAT.ceiling       = phong(TEX.concrete, 0x55534f, 2);
    MAT.labFloor      = surface(TEX.labFloor, 0xffffff, 0.36, 0.018);
    MAT.labWall       = phong(TEX.labWall, 0xffffff, 20);
    MAT.stoneWall     = surface(TEX.stoneWall, 0xffffff, 0.92, 0.083);
    MAT.stoneFloor    = phong(TEX.stoneFloor, 0xffffff, 6);
    MAT.stoneCeil     = phong(TEX.stoneWall, 0x6a6a6a, 2);
    MAT.woodFloor     = phong(TEX.woodFloor, 0xffffff, 16);
    MAT.wallpaper     = phong(TEX.wallpaper, 0xffffff, 4);
    MAT.metalWall     = phong(TEX.metalWall, 0xffffff, 30);
    MAT.metalFloor    = surface(TEX.metalFloor, 0xffffff, 0.46, 0.035, 0.27);
    MAT.metalCeil     = phong(TEX.metalWall, 0x777777, 20);
    MAT.hazard        = phong(TEX.hazard, 0xffffff, 10);
    MAT.books         = phong(TEX.books, 0xffffff, 4);
    MAT.wood          = phong(TEX.wood, 0xffffff, 12);
    MAT.rust          = phong(TEX.rust, 0xffffff, 10);
    MAT.darkMetal     = pbr(0x2a2f36, 0.42, 0.85);
    MAT.steel         = pbr(0x9aa3ac, 0.28, 0.95);
    MAT.gold          = pbr(0xe0aa30, 0.25, 1.0, { emissive: 0x2a1a00 });
    MAT.glass         = pbr(0x88ffcc, 0.05, 0.0, { transparent: true, opacity: 0.32, depthWrite: false, envMapIntensity: 1.6 });
    MAT.liquid        = new THREE.MeshBasicMaterial({ color: 0x3cff9a, transparent: true, opacity: 0.55 });
    MAT.cloak         = pbr(0x1f2230, 0.9, 0.0);
    MAT.skin          = pbr(0x9a8c80, 0.7, 0.0);
  }
  const THEME = {
    concrete: { floor: 'concreteFloor', wall: 'concreteWall', ceil: 'ceiling',   tile: 2.5 },
    lab:      { floor: 'labFloor',      wall: 'labWall',      ceil: 'ceiling',   tile: 2 },
    stone:    { floor: 'stoneFloor',    wall: 'stoneWall',    ceil: 'stoneCeil', tile: 2 },
    wood:     { floor: 'woodFloor',     wall: 'wallpaper',    ceil: 'ceiling',   tile: 2 },
    metal:    { floor: 'metalFloor',    wall: 'metalWall',    ceil: 'metalCeil', tile: 2 }
  };

  // ══════════════════════════════════════════════════════════════
  //  GEOMETRÍA BÁSICA
  // ══════════════════════════════════════════════════════════════
  // Ajusta las UV de una caja para que la textura mantenga escala real
  function boxUV(geo, sx, sy, sz, tile) {
    const uv = geo.attributes.uv;
    const dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
    for (let f = 0; f < 6; f++) {
      const [du, dv] = dims[f];
      for (let k = 0; k < 4; k++) {
        const i = f * 4 + k;
        uv.setXY(i, uv.getX(i) * du / tile, uv.getY(i) * dv / tile);
      }
    }
    uv.needsUpdate = true;
  }

  function staticMesh(mesh) {
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    scene.add(mesh);
    return mesh;
  }

  // Caja en coordenadas de planta: x0..x1, y0..y1, z0..z1
  function box(x0, y0, x1, y1, z0, z1, mat, { tile = 2, collide = false, add = true } = {}) {
    const sx = x1 - x0, sy = z1 - z0, sz = y1 - y0;
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    if (mat.map) boxUV(geo, sx, sy, sz, tile);
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(V((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2));
    m.castShadow = !mat.isMeshBasicMaterial && !mat.transparent;
    if (add) staticMesh(m);
    if (collide) colliders.push({ x0, y0, x1, y1 });
    return m;
  }

  function plane(x0, y0, x1, y1, z, mat, tile, down = false) {
    const w = x1 - x0, d = y1 - y0;
    const geo = new THREE.PlaneGeometry(w, d);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / tile, uv.getY(i) * d / tile);
    geo.rotateX(down ? Math.PI / 2 : -Math.PI / 2);
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(V((x0 + x1) / 2, (y0 + y1) / 2, z));
    return staticMesh(m);
  }

  // Panel vertical pegado a una pared (x,y sobre la línea del muro)
  function wallPanel(x, y, z, face, w, h, mat, offset) {
    const [fx, fy] = FACE_VEC[face];
    const off = offset !== undefined ? offset : T() / 2 + 0.015;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.copy(V(x + fx * off, y + fy * off, z));
    m.rotation.y = FACE_ROT[face];
    return staticMesh(m);
  }

  // ══════════════════════════════════════════════════════════════
  //  CONSTRUCCIÓN DEL NIVEL
  // ══════════════════════════════════════════════════════════════
  function specialOpenings(axis, at, lo, hi) {
    const res = [];
    WORLD.stations.forEach(s => {
      if (s.kind === 'exit' && axis === 'y' && near(s.x, at) && s.y > lo && s.y < hi)
        res.push({ a: s.y - 1.2, b: s.y + 1.2, zb: 0, zt: 3.6 });
      if (s.kind === 'window' && axis === 'y' && near(s.x, at) && s.y > lo && s.y < hi)
        res.push({ a: s.y - 0.8, b: s.y + 0.8, zb: 1.3, zt: 2.9 });
    });
    return res;
  }

  function corridorOpenings(axis, at, lo, hi) {
    const res = [];
    WORLD.corridors.forEach(c => {
      if (axis === 'x' && (near(c.y0, at) || near(c.y1, at)) && c.x0 >= lo - EPS && c.x1 <= hi + EPS)
        res.push({ a: c.x0, b: c.x1, zb: 0, zt: WORLD.doorHeight });
      if (axis === 'y' && (near(c.x0, at) || near(c.x1, at)) && c.y0 >= lo - EPS && c.y1 <= hi + EPS)
        res.push({ a: c.y0, b: c.y1, zb: 0, zt: WORLD.doorHeight });
    });
    return res;
  }

  function wallRect(axis, at, a, b) {
    const t = T() / 2;
    return axis === 'x' ? [a, at - t, b, at + t] : [at - t, a, at + t, b];
  }

  // Levanta una pared completa con huecos (puertas/ventanas)
  function wallLine(axis, at, lo, hi, h, openings, mat, tile) {
    openings.sort((p, q) => p.a - q.a);
    let cur = lo;
    const seg = (a, b, z0, z1, collide) => {
      if (b - a < EPS || z1 - z0 < EPS) return;
      const [x0, y0, x1, y1] = wallRect(axis, at, a, b);
      box(x0, y0, x1, y1, z0, z1, mat, { tile, collide });
    };
    openings.forEach(o => {
      seg(cur, o.a, 0, h, true);
      seg(o.a, o.b, o.zt, h, false);                 // dintel
      if (o.zb > 0) seg(o.a, o.b, 0, o.zb, true);    // alféizar
      cur = o.b;
    });
    seg(cur, hi, 0, h, true);
  }

  function buildRooms() {
    const t = T() / 2;
    Object.entries(WORLD.rooms).forEach(([key, r]) => {
      const th = THEME[r.theme];
      const wall = MAT[th.wall];
      plane(r.x0, r.y0, r.x1, r.y1, 0, MAT[th.floor], th.tile);
      plane(r.x0, r.y0, r.x1, r.y1, r.h, MAT[th.ceil], th.tile, true);

      const edges = [
        ['x', r.y0, r.x0 - t, r.x1 + t],
        ['x', r.y1, r.x0 - t, r.x1 + t],
        ['y', r.x0, r.y0 + t, r.y1 - t],
        ['y', r.x1, r.y0 + t, r.y1 - t]
      ];
      edges.forEach(([axis, at, lo, hi]) => {
        const ops = corridorOpenings(axis, at, lo, hi).concat(specialOpenings(axis, at, lo, hi));
        wallLine(axis, at, lo, hi, r.h, ops, wall, th.tile);
      });

      // Zócalo luminoso tenue para leer la geometría en la penumbra
      const trim = new THREE.MeshBasicMaterial({ color: new THREE.Color(r.light).multiplyScalar(0.18) });
      [['x', r.y0 + t + 0.01, 1], ['x', r.y1 - t - 0.01, -1]].forEach(([, y]) =>
        box(r.x0 + t, y - 0.005, r.x1 - t, y + 0.005, 0, 0.06, trim));

      // Lámpara de techo + luz principal
      const [lx, ly] = r.lightPos;
      const light = new THREE.PointLight(r.light, r.intensity, Math.max(r.x1 - r.x0, r.y1 - r.y0) * 1.25, 1.6);
      light.position.copy(V(lx, ly, r.h - 0.45));
      scene.add(light);
      roomLights[key] = { light, base: r.intensity, color: new THREE.Color(r.light) };
      const lampMat = new THREE.MeshBasicMaterial({ color: r.light });
      box(lx - 1.35, ly - 0.3, lx + 1.35, ly + 0.3, r.h - 0.12, r.h, MAT.darkMetal);
      for (const offset of [-0.14, 0.14]) {
        box(lx - 1.2, ly + offset - 0.04, lx + 1.2, ly + offset + 0.04, r.h - 0.145, r.h - 0.12, lampMat);
      }
      for (const y of [r.y0 + 1, r.y1 - 1]) {
        box(r.x0 + t, y - 0.1, r.x1 - t, y + 0.1, r.h - 0.26, r.h, MAT.darkMetal);
      }
      for (const x of [r.x0 + 0.45, r.x0 + 0.64]) {
        const conduit = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, r.y1 - r.y0 - 0.4, 12), MAT.steel);
        conduit.rotation.x = Math.PI / 2;
        conduit.position.copy(V(x, (r.y0 + r.y1) / 2, r.h - 0.36));
        staticMesh(conduit);
      }
    });
  }

  function buildMirrorRoom() {
    const cyan = new THREE.MeshBasicMaterial({ color: 0x74eaff });
    const violet = new THREE.MeshBasicMaterial({ color: 0xc198ff });
    const floor = new THREE.MeshStandardMaterial({ map: TEX.metalFloor, color: 0x566184, roughness: 0.37, metalness: 0.25 });
    const r = WORLD.rooms.ESPEJOS;
    const north = r.y1 - T() / 2 - 0.09;
    const south = r.y0 + T() / 2 + 0.09;
    const panels = [
      { x: -13.3, y: north, face: 'S', trim: cyan },
      { x: -8.7, y: north, face: 'S', trim: violet },
      { x: -11, y: south, face: 'N', trim: cyan, reflection: true }
    ];

    for (const [index, panel] of panels.entries()) {
      const { x, y, face, trim, reflection } = panel;
      panel.target = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.LinearFilter });
      const material = new THREE.ShaderMaterial({
        uniforms: {
          image: { value: panel.target.texture },
          tint: { value: trim.color },
          reflection: { value: reflection ? 1 : 0 }
        },
        vertexShader: `
          varying vec4 screen;
          varying vec2 surface;
          void main() {
            surface = uv;
            screen = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_Position = screen;
          }`,
        fragmentShader: `
          uniform sampler2D image;
          uniform vec3 tint;
          uniform float reflection;
          varying vec4 screen;
          varying vec2 surface;
          void main() {
            vec2 uv = screen.xy / screen.w * 0.5 + 0.5;
            uv.x = mix(uv.x, 1.0 - uv.x, reflection);
            vec3 view = texture2D(image, uv).rgb;
            vec2 edge = min(surface, 1.0 - surface);
            float glow = exp(-18.0 * min(edge.x, edge.y));
            gl_FragColor = vec4(view * 0.85 + tint * (0.035 + glow * 0.35), 1.0);
            #include <encodings_fragment>
          }`
      });
      panel.mesh = wallPanel(x, y, 1.85, face, 2.65, 3.25, material, 0);
      panel.mesh.updateMatrixWorld();
      mirrorSurfaces.push(panel);
      box(x - 1.48, y - 0.04, x + 1.48, y + 0.04, 0.12, 0.24, trim);
      box(x - 1.48, y - 0.04, x + 1.48, y + 0.04, 3.47, 3.55, trim);
      for (const dx of [-1.38, 1.38]) {
        box(x + dx - 0.06, y - 0.04, x + dx + 0.06, y + 0.04, 0.24, 3.47, trim);
      }
      if (reflection) continue;
      const destination = panels[1 - index];
      panel.destination = destination;
      panel.number = String(index + 1).padStart(2, '0');
      interactables.push({
        id: 'MIRROR_' + panel.number, room: 'ESPEJOS', pos: V(x, y, 1.5), radius: 1.15, reach: 1.3,
        label: () => 'Atravesar espejo ' + panel.number,
        action: () => crossMirror(panel)
      });
      const label = textCanvas(256, 64, (g, w, h) => {
        g.fillStyle = '#182231'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#e1f4ff'; g.font = 'bold 30px monospace';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('ESPEJO ' + panel.number, w / 2, h / 2);
      });
      wallPanel(x, y, 3.83, face, 1.7, 0.425, new THREE.MeshBasicMaterial({ map: label }), 0);
    }
    plane(-15.7, 14.3, -6.3, 24.7, 0.008, floor, 1);
    for (const x of [-13.3, -8.7]) {
      box(x - 0.025, 16, x + 0.025, north, 0.011, 0.017, x < -11 ? cyan : violet);
    }
    // Escalera invertida que se hunde en el techo.
    for (let i = 0; i < 11; i++) {
      const y = 16 + i * 0.52, height = 4.55 - i * 0.16;
      box(-12, y, -10, y + 0.53, height, r.h, MAT.darkMetal);
      box(-12, y, -10, y + 0.025, height - 0.02, height + 0.025, violet);
    }
    box(-6.25, 18.61, -6.17, 20.39, 2.42, 2.51, cyan);
  }

  function crossMirror(panel) {
    const { destination } = panel;
    player.x = destination.x - THREE.MathUtils.clamp(player.x - panel.x, -0.9, 0.9);
    player.y = destination.y - 0.68;
    player.yaw += Math.PI;
    player.vx = player.vy = 0;
    target = null;
    mirrorPulse = 1;
    if (hunter && hunter.escapeCooldown <= 0) {
      hunter.brain.forget();
      hunter.lastSeen = null;
      hunter.route = [];
      hunter.scan = 0;
      hunter.concealed = hunter.memory.mirrorEscape();     // cada vez le engaña menos
      hunter.escapeCooldown = 22;
      hunter.investigate = 0;
      if (hunter.memory.mirrorEscapes === 3) UIToast('El asesino empieza a conocer el truco del espejo…', 'warn');
    }
    SFX.ok();
    if (crossedMirrors.has(panel)) return;
    crossedMirrors.add(panel);
    panel.trim.color.setHex(0x77ffae);
    if (crossedMirrors.size === 2) rewardMirrorRoom();
    else UIToast('Espejo registrado · 1 de 2', 'ok');
  }

  function renderMirrorViews() {
    if (currentRoom !== 'ESPEJOS') return;
    camera.updateMatrixWorld();
    mirrorFrustum.setFromProjectionMatrix(mirrorProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    camera.getWorldDirection(mirrorDirection);
    for (const panel of mirrorSurfaces) panel.mesh.visible = false;
    mirrorCamera.projectionMatrix.copy(camera.projectionMatrix);
    mirrorCamera.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    const width = Math.max(1, Math.min(960, container.clientWidth));
    const height = Math.max(1, Math.round(width / camera.aspect));
    for (const panel of mirrorSurfaces) {
      const { x, y, target, destination } = panel;
      const front = destination ? 1 : -1;
      const offset = camera.position.z + y;
      if (front * offset <= 0 || !mirrorFrustum.intersectsObject(panel.mesh)) continue;
      target.setSize(width, height);
      mirrorCamera.position.set(destination ? destination.x - (camera.position.x - x) : camera.position.x,
        camera.position.y, -(destination || panel).y - offset);
      mirrorCamera.lookAt(
        mirrorCamera.position.x + mirrorDirection.x * (destination ? -1 : 1),
        mirrorCamera.position.y + mirrorDirection.y,
        mirrorCamera.position.z - mirrorDirection.z
      );
      mirrorClip.setComponents(0, 0, front, (destination || panel).y * front);
      renderer.clippingPlanes = [mirrorClip];
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(scene, mirrorCamera);
    }
    renderer.setRenderTarget(null);
    renderer.clippingPlanes = [];
    for (const panel of mirrorSurfaces) panel.mesh.visible = true;
  }

  function onRoomEdge(axis, at, lo, hi) {
    return Object.values(WORLD.rooms).some(r =>
      axis === 'x'
        ? (near(r.y0, at) || near(r.y1, at)) && r.x0 <= lo + EPS && r.x1 >= hi - EPS
        : (near(r.x0, at) || near(r.x1, at)) && r.y0 <= lo + EPS && r.y1 >= hi - EPS);
  }

  function buildCorridors() {
    const stripMat = new THREE.MeshBasicMaterial({ color: 0x2a7f95 });
    WORLD.corridors.forEach(c => {
      plane(c.x0, c.y0, c.x1, c.y1, 0, MAT.concreteFloor, 2.5);
      plane(c.x0, c.y0, c.x1, c.y1, c.h, MAT.ceiling, 2.5, true);
      const edges = [
        ['x', c.y0, c.x0, c.x1], ['x', c.y1, c.x0, c.x1],
        ['y', c.x0, c.y0, c.y1], ['y', c.x1, c.y0, c.y1]
      ];
      edges.forEach(([axis, at, lo, hi]) => {
        if (onRoomEdge(axis, at, lo, hi)) return;
        wallLine(axis, at, lo, hi, c.h, [], MAT.concreteWall, 2.5);
      });
      // Tira de luz en el techo que marca el recorrido
      const horiz = (c.x1 - c.x0) > (c.y1 - c.y0);
      const cx = (c.x0 + c.x1) / 2, cy = (c.y0 + c.y1) / 2;
      if (horiz) box(c.x0 + 0.4, cy - 0.04, c.x1 - 0.4, cy + 0.04, c.h - 0.03, c.h, stripMat);
      else       box(cx - 0.04, c.y0 + 0.4, cx + 0.04, c.y1 - 0.4, c.h - 0.03, c.h, stripMat);
    });
  }

  // ── Puertas entre salas ───────────────────────────────────────
  function buildDoors() {
    WORLD.doors.forEach(def => {
      const w = def.until - def.from, h = WORLD.doorHeight, th = 0.1;
      const mid = (def.from + def.until) / 2;
      const x0 = def.axis === 'x' ? def.from : def.at - th / 2;
      const x1 = def.axis === 'x' ? def.until : def.at + th / 2;
      const y0 = def.axis === 'x' ? def.at - th / 2 : def.from;
      const y1 = def.axis === 'x' ? def.at + th / 2 : def.until;

      const mesh = box(x0, y0, x1, y1, 0, h - 0.01, MAT.darkMetal, { add: false });
      mesh.receiveShadow = true;
      const stripe = box(x0 - (def.axis === 'y' ? 0.01 : 0), y0 - (def.axis === 'x' ? 0.01 : 0),
                         x1 + (def.axis === 'y' ? 0.01 : 0), y1 + (def.axis === 'x' ? 0.01 : 0),
                         1.0, 1.25, MAT.hazard, { add: false, tile: 0.5 });
      stripe.position.sub(mesh.position);
      mesh.add(stripe);
      scene.add(mesh);

      // Pilotos de estado a ambos lados, sobre el dintel
      const lampMat = new THREE.MeshBasicMaterial({ color: 0xff2040 });
      const lamps = [-1, 1].map(side => {
        const lx = def.axis === 'x' ? mid : def.at + side * (T() / 2 + 0.02);
        const ly = def.axis === 'x' ? def.at + side * (T() / 2 + 0.02) : mid;
        const l = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), lampMat);
        l.position.copy(V(lx, ly, h + 0.1));
        scene.add(l);
        return l;
      });

      const collider = { x0, y0, x1, y1 };
      const d = { def, mesh, lampMat, open: false, slide: 0, collider, base: mesh.position.clone(), width: w, checkT: 0, allowed: false };
      doors[def.id] = d;
      colliders.push(collider);
      if (def.startOpen) setDoorOpen(d, true, true);

      interactables.push({
        id: def.id, kind: 'door', door: d,
        pos: V(mid * (def.axis === 'x' ? 1 : 0) + (def.axis === 'y' ? def.at : 0),
               mid * (def.axis === 'y' ? 1 : 0) + (def.axis === 'x' ? def.at : 0), 1.3),
        radius: 0.9, reach: 3,
        label() {
          if (d.open) return null;
          const chk = canOpenWorldDoor(def);
          return chk.ok ? `[E] Abrir puerta → ${ROOMS[def.to].label}` : `🔒 ${chk.razon}`;
        },
        action() { tryOpenGate(def.id); }
      });
    });
  }

  function setDoorOpen(d, open, instant = false) {
    d.open = open;
    const i = colliders.indexOf(d.collider);
    if (open && i >= 0) colliders.splice(i, 1);
    if (hunter) hunter.navigation.invalidate();
    if (instant) d.slide = open ? 1 : 0;
    d.lampMat.color.set(open ? 0x00e87a : 0xff2040);
  }

  function updateDoors(dt) {
    Object.values(doors).forEach(d => {
      const goal = d.open ? 1 : 0;
      if (d.slide !== goal) {
        d.slide += Math.sign(goal - d.slide) * dt * 1.6;
        d.slide = Math.max(0, Math.min(1, d.slide));
      }
      const e = d.slide * d.slide * (3 - 2 * d.slide);
      const off = e * (d.width - 0.05);
      d.mesh.position.copy(d.base);
      if (d.def.axis === 'x') d.mesh.position.x += off;
      else d.mesh.position.z -= off;          // +y en planta = −z

      // Apertura automática al acercarse si ya está permitido
      if (!d.open) {
        d.checkT -= dt;
        if (d.checkT <= 0) {
          d.checkT = 0.4;
          d.allowed = canOpenWorldDoor(d.def).ok;
          d.lampMat.color.set(d.allowed ? 0xffc845 : 0xff2040);
        }
        const mid = (d.def.from + d.def.until) / 2;
        const px = d.def.axis === 'x' ? mid : d.def.at;
        const py = d.def.axis === 'x' ? d.def.at : mid;
        if (d.allowed && Math.hypot(player.x - px, player.y - py) < 1.9) tryOpenGate(d.def.id, true);
      }
    });
  }

  // ── Mobiliario ────────────────────────────────────────────────
  function buildProps() {
    WORLD.props.forEach(p => {
      const firstMesh = scene.children.length;
      const { x0, y0, x1, y1, h } = p;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      colliders.push({ x0, y0, x1, y1 });
      switch (p.type) {
        case 'table': case 'desk': {
          const top = p.type === 'desk' ? MAT.wood : MAT.steel;
          box(x0, y0, x1, y1, h - 0.06, h, top, { tile: 1 });
          [[x0 + 0.08, y0 + 0.08], [x1 - 0.08, y0 + 0.08], [x0 + 0.08, y1 - 0.08], [x1 - 0.08, y1 - 0.08]]
            .forEach(([lx, ly]) => box(lx - 0.04, ly - 0.04, lx + 0.04, ly + 0.04, 0, h - 0.06, MAT.darkMetal));
          if (p.type === 'table') {
            // Material de laboratorio: matraces
            const r = rng(Math.floor(cx * 13 + cy * 7));
            for (let i = 0; i < 4; i++) {
              const fx = x0 + 0.4 + r() * (x1 - x0 - 0.8), fy = y0 + 0.3 + r() * (y1 - y0 - 0.6);
              if (Object.values(WORLD.itemSpots).some(s => Math.hypot(s.x - fx, s.y - fy) < 0.6)) continue;
              const fl = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.11, 0.26, 10), MAT.glass);
              fl.position.copy(V(fx, fy, h + 0.13));
              staticMesh(fl);
              const liq = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.1, 0.1, 10),
                new THREE.MeshBasicMaterial({ color: [0x3cff9a, 0xff5a8a, 0x5ab4ff, 0xffd24a][i % 4] }));
              liq.position.copy(V(fx, fy, h + 0.06));
              staticMesh(liq);
            }
          }
          break;
        }
        case 'shelf': {
          box(x0, y0, x1, y1, 0, h, MAT.darkMetal);
          const r = rng(7);
          for (let lvl = 0; lvl < 3; lvl++) {
            const z = 0.5 + lvl * 0.6;
            box(x0, y0 - 0.02, x1, y0 + 0.05, z - 0.03, z, MAT.steel);
            for (let x = x0 + 0.2; x < x1 - 0.2; x += 0.35 + r() * 0.3) {
              if (r() < 0.3) continue;
              const bh = 0.15 + r() * 0.2;
              const b = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, bh, 8),
                new THREE.MeshPhongMaterial({ color: new THREE.Color().setHSL(r(), 0.5, 0.45), transparent: true, opacity: 0.8 }));
              b.position.copy(V(x, y0 - 0.04, z + bh / 2));
              staticMesh(b);
            }
          }
          break;
        }
        case 'bookshelf': {
          const inner = box(x0, y0, x1, y1, 0, h, MAT.books, { tile: 1.6, add: false });
          // Los libros solo en las caras largas; laterales de madera
          inner.material = [MAT.wood, MAT.wood, MAT.wood, MAT.wood, MAT.books, MAT.books];
          staticMesh(inner);
          break;
        }
        case 'tank': {
          const rr = Math.min(x1 - x0, y1 - y0) / 2;
          const g = new THREE.Mesh(new THREE.CylinderGeometry(rr, rr, h, 20, 1, true), MAT.glass);
          g.position.copy(V(cx, cy, h / 2)); staticMesh(g);
          const l = new THREE.Mesh(new THREE.CylinderGeometry(rr * 0.92, rr * 0.92, h * 0.7, 20), MAT.liquid);
          l.position.copy(V(cx, cy, h * 0.35));
          scene.add(l);
          animators.push((dt, tm) => { l.scale.y = 1 + Math.sin(tm * 1.3 + cx) * 0.03; });
          const capGeo = new THREE.CylinderGeometry(rr * 1.05, rr * 1.05, 0.12, 20);
          [0.06, h - 0.06].forEach(z => { const cap = new THREE.Mesh(capGeo, MAT.darkMetal); cap.position.copy(V(cx, cy, z)); staticMesh(cap); });
          break;
        }
        case 'pipe': {
          const rr = Math.min(x1 - x0, y1 - y0) / 2;
          const pm = new THREE.Mesh(new THREE.CylinderGeometry(rr, rr, h, 14), MAT.rust);
          pm.position.copy(V(cx, cy, h / 2)); staticMesh(pm);
          const ring = new THREE.Mesh(new THREE.TorusGeometry(rr + 0.03, 0.035, 6, 20),
            new THREE.MeshBasicMaterial({ color: 0x7cff5a }));
          ring.rotation.x = Math.PI / 2;
          ring.position.copy(V(cx, cy, 0.9)); scene.add(ring);
          animators.push((dt, tm) => { ring.material.color.setHSL(0.3, 1, 0.3 + 0.2 * (0.5 + 0.5 * Math.sin(tm * 3 + cx))); });
          break;
        }
        case 'pillar':
          box(x0, y0, x1, y1, 0, h, MAT.stoneWall, { tile: 1.5 });
          box(x0 - 0.08, y0 - 0.08, x1 + 0.08, y1 + 0.08, 0, 0.3, MAT.stoneWall, { tile: 1.5 });
          break;
        case 'sarcophagus':
          box(x0, y0, x1, y1, 0, h - 0.12, MAT.stoneWall, { tile: 1.2 });
          box(x0 - 0.06, y0 - 0.06, x1 + 0.06, y1 + 0.06, h - 0.12, h, MAT.stoneFloor, { tile: 1.2 });
          break;
        case 'altar':
          box(x0, y0, x1, y1, 0, h, MAT.stoneWall, { tile: 1 });
          [[x0 + 0.15, y1 - 0.15], [x1 - 0.15, y1 - 0.15]].forEach(([vx, vy]) => {
            const c = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 8), new THREE.MeshBasicMaterial({ color: 0xfff1c0 }));
            c.position.copy(V(vx, vy, h + 0.1)); staticMesh(c);
            const fl = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffa030 }));
            fl.position.copy(V(vx, vy, h + 0.23)); scene.add(fl);
            animators.push((dt, tm) => { fl.scale.setScalar(0.8 + 0.4 * Math.abs(Math.sin(tm * 9 + vx * 3))); });
          });
          break;
        case 'chest': {
          box(x0, y0, x1, y1, 0, h - 0.18, MAT.wood, { tile: 1 });
          const lid = new THREE.Group();
          const lidMesh = box(x0, y0, x1, y1, 0, 0.18, MAT.wood, { add: false, tile: 1 });
          lidMesh.position.set(0, 0.09, -(y1 - y0) / 2);          // bisagra en el borde trasero (y0)
          lid.add(lidMesh);
          const band = box(x0 + 0.1, y0 - 0.01, x0 + 0.2, y1 + 0.01, 0, 0.19, MAT.gold, { add: false });
          band.position.set(-(x1 - x0) / 2 + 0.15, 0.095, -(y1 - y0) / 2);
          lid.add(band);
          lid.position.copy(V(cx, y0, h - 0.18));
          scene.add(lid);
          let open = 0, goal = 0;
          stationFx.P3 = () => { goal = 1; };
          animators.push(dt => { if (open !== goal) { open = Math.min(1, open + dt * 1.2); lid.rotation.x = open * 1.9; } });
          break;
        }
        case 'safe': {
          box(x0, y0, x1, y1, 0, h, MAT.darkMetal);
          const doorG = new THREE.Group();
          const dm = box(x0 + 0.08, y0 - 0.06, x1 - 0.08, y0, 0.08, h - 0.08, MAT.steel, { add: false });
          const dw = x1 - x0 - 0.16;
          dm.position.set(dw / 2, 0, 0);
          doorG.add(dm);
          const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.05, 20), MAT.gold);
          dial.rotation.x = Math.PI / 2;
          dial.position.set(dw / 2, 0.1, 0.05);
          doorG.add(dial);
          const hole = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.09, 0.02), new THREE.MeshBasicMaterial({ color: 0x000000 }));
          hole.position.set(dw / 2, -0.15, 0.04);
          doorG.add(hole);
          doorG.position.copy(V(x0 + 0.08, y0 - 0.03, h / 2));
          scene.add(doorG);
          let open = 0, goal = 0;
          stationFx.P2 = () => { goal = 1; };
          animators.push(dt => { if (open !== goal) { open = Math.min(1, open + dt); doorG.rotation.y = -open * 1.8; } });
          break;
        }
        case 'drawer':
          box(x0, y0, x1, y1, 0, h, MAT.darkMetal);
          for (let k = 0; k < 3; k++) box(x1, y0 + 0.1, x1 + 0.01, y1 - 0.1, 0.1 + k * 0.27, 0.32 + k * 0.27, MAT.steel);
          break;
        case 'lockers':
          box(x0, y0, x1, y1, 0, h, MAT.metalWall, { tile: 1 });
          for (let y = y0 + 0.02; y < y1 - 0.1; y += 0.57)
            box(x0 - 0.01, y, x0, y + 0.53, 0.05, h - 0.05, MAT.lockerDoor || (MAT.lockerDoor = pbr(0x4b5a6a, 0.45, 0.7)));
          break;
        case 'console':
          box(x0, y0, x1, y1, 0, h, MAT.darkMetal);
          for (let i = 0; i < 6; i++) {
            const b = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.06),
              new THREE.MeshBasicMaterial({ color: [0xff3b5c, 0x00e87a, 0xffc845][i % 3] }));
            b.position.copy(V(x0 + 0.2 + i * 0.2, y0 + 0.15, h + 0.01)); staticMesh(b);
          }
          break;
        case 'bench':
          box(x0, y0, x1, y1, h - 0.08, h, MAT.wood, { tile: 1 });
          box(x0 + 0.05, y0 + 0.1, x1 - 0.05, y0 + 0.2, 0, h - 0.08, MAT.darkMetal);
          box(x0 + 0.05, y1 - 0.2, x1 - 0.05, y1 - 0.1, 0, h - 0.08, MAT.darkMetal);
          break;
        case 'crate':
          box(x0, y0, x1, y1, 0, h, MAT.wood, { tile: 0.8 });
          break;
        case 'cabinet':
        default:
          box(x0, y0, x1, y1, 0, h, MAT.darkMetal);
      }
      for (const mesh of scene.children.slice(firstMesh)) {
        if (mesh.isMesh && !mesh.material.transparent) mesh.castShadow = true;
      }
    });
  }

  // ── Letreros ──────────────────────────────────────────────────
  function buildSigns() {
    WORLD.signs.forEach(s => {
      const tex = textCanvas(512, 128, (g, w, h) => {
        g.fillStyle = 'rgba(8,10,14,0.92)'; g.fillRect(0, 0, w, h);
        g.strokeStyle = s.color; g.lineWidth = 6; g.strokeRect(6, 6, w - 12, h - 12);
        g.font = 'bold 56px Orbitron, "Share Tech Mono", monospace';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.shadowColor = s.color; g.shadowBlur = 16;
        g.fillStyle = s.color; g.fillText(s.text, w / 2, h / 2 + 2);
      });
      wallPanel(s.x, s.y, s.z, s.face, s.w, s.w / 4, new THREE.MeshBasicMaterial({ map: tex }));
    });

    // Texto oculto (solo visible con linterna en el ARCHIVO)
    const ht = Object.assign({}, WORLD.hiddenText);
    if (typeof PUZZLE_RUN !== 'undefined' && PUZZLE_RUN.hiddenLines) ht.lines = PUZZLE_RUN.hiddenLines;
    const tex = textCanvas(512, 256, (g, w, h) => {
      g.font = 'bold 60px "Share Tech Mono", monospace';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.shadowColor = '#c38bff'; g.shadowBlur = 20;
      g.fillStyle = '#d8b4ff';
      ht.lines.forEach((l, i) => g.fillText(l, w / 2, h / 2 + (i - (ht.lines.length - 1) / 2) * 76));
    });
    hiddenMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false });
    const hm = wallPanel(ht.x, ht.y, ht.z, ht.face, 2.2, 1.1, hiddenMat);
    hiddenPos = hm.position.clone();
  }

  // ── Estaciones de puzzle y objetos especiales ────────────────
  function puzzleById(id) { return PUZZLES.find(p => p.id === id); }

  function stationLabel(id) {
    const p = puzzleById(id);
    if (window._state.solved.includes(id)) return `✔ ${p.title} (resuelto)`;
    if (p.requiresItem && !window._state.inventory.includes(p.requiresItem))
      return `[E] ${p.title} · requiere ${p.requiresItem}`;
    return `[E] ${p.title}${p.required ? '' : ' (bonus)'}`;
  }

  function addStationInteract(s, pos, radius = 0.7, reach = REACH) {
    interactables.push({
      id: s.id, room: s.room, pos, radius, reach,
      label: () => stationLabel(s.id),
      action: () => openPuzzleStation(s.id)
    });
  }

  function buildStations() {
    WORLD.stations.forEach(s => {
      const [fx, fy] = FACE_VEC[s.face];
      switch (s.kind) {
        case 'dials': {
          const draw = solved => (g, w, h) => {
            g.fillStyle = '#20262c'; g.fillRect(0, 0, w, h);
            g.strokeStyle = '#59636d'; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10);
            g.font = 'bold 28px "Share Tech Mono", monospace'; g.fillStyle = '#9fb3c0'; g.textAlign = 'center';
            g.fillText('PANEL DE DIALES', w / 2, 44);
            const show = puzzleById('P1').show;
            const vals = show.values.map(String).concat(solved ? String(show.answer) : '?');
            vals.forEach((v, i) => {
              const cx = w * (0.17 + i * 0.22), cy = h * 0.6;
              g.beginPath(); g.arc(cx, cy, 58, 0, 7); g.fillStyle = '#0c0f12'; g.fill();
              g.lineWidth = 8; g.strokeStyle = i === 3 ? (solved ? '#00e87a' : '#ffc845') : '#8a6a3a'; g.stroke();
              g.font = 'bold 70px Orbitron, monospace'; g.textBaseline = 'middle';
              g.fillStyle = i === 3 ? (solved ? '#00e87a' : '#ffc845') : '#e8d9b8';
              g.fillText(v, cx, cy + 4);
            });
          };
          const tex = textCanvas(512, 256, draw(false));
          wallPanel(s.x, s.y, 1.55, s.face, 1.5, 0.75, new THREE.MeshStandardMaterial({ map: tex, emissive: 0x333333, emissiveMap: tex, roughness: 0.6 }), 0.01);
          stationFx.P1 = () => redraw(tex, draw(true));
          addStationInteract(s, V(s.x + fx * 0.1, s.y, 1.5), 0.8);
          break;
        }
        case 'safe':
          addStationInteract(s, V(s.x, s.y - 0.4, 0.7), 0.6);
          break;
        case 'chest': {
          const draw = solved => (g, w, h) => {
            g.fillStyle = 'rgba(0,0,0,0)'; g.fillRect(0, 0, w, h);
            g.font = 'bold 64px "Times New Roman", serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
            g.fillStyle = 'rgba(20,12,6,0.85)';
            const show = puzzleById('P3').show;
            const series = show.values.join(' · ') + ' · ' + (solved ? show.answer : '?');
            g.fillText(series, w / 2 + 3, h / 2 + 3);
            g.fillStyle = solved ? '#7dffb0' : '#d9b77a';
            g.shadowColor = solved ? '#00e87a' : '#ff9a4a'; g.shadowBlur = 12;
            g.fillText(series, w / 2, h / 2);
          };
          const tex = textCanvas(1024, 128, draw(false));
          wallPanel(s.x, 10, 2.0, 'N', 3.2, 0.4, new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
          const prev = stationFx.P3;
          stationFx.P3 = () => { redraw(tex, draw(true)); if (prev) prev(); };
          addStationInteract(s, V(s.x, s.y, 0.9), 0.9, 2.8);
          break;
        }
        case 'board': {
          const draw = solved => (g, w, h) => {
            g.fillStyle = '#8b6a45'; g.fillRect(0, 0, w, h);
            const r = rng(3);
            for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(60,35,15,${r() * 0.4})`; g.fillRect(r() * w, r() * h, 2, 2); }
            g.strokeStyle = '#3a2413'; g.lineWidth = 16; g.strokeRect(8, 8, w - 16, h - 16);
            g.font = 'bold 26px "Share Tech Mono", monospace'; g.fillStyle = '#2a1a0c'; g.textAlign = 'center';
            g.fillText('TABLERO DE FECHAS', w / 2, 50);
            const show = puzzleById('P4').show;
            const dates = show.dates.concat(solved ? show.answer : '?/?');
            const pts = [];
            dates.forEach((d, i) => {
              const cx = w * (0.14 + i * 0.18), cy = h * (i % 2 ? 0.66 : 0.48);
              pts.push([cx, cy - 34]);
              g.save(); g.translate(cx, cy); g.rotate((r() - 0.5) * 0.12);
              g.fillStyle = i === 4 ? (solved ? '#c8ffd8' : '#fff3a8') : '#f1eadb';
              g.fillRect(-46, -30, 92, 60);
              g.fillStyle = '#1a1a1a'; g.font = 'bold 28px "Share Tech Mono", monospace'; g.textBaseline = 'middle';
              g.fillText(d, 0, 2);
              g.restore();
            });
            g.strokeStyle = '#c0262d'; g.lineWidth = 3; g.beginPath();
            pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
            pts.forEach(([x, y]) => { g.beginPath(); g.arc(x, y, 7, 0, 7); g.fillStyle = '#d23a2a'; g.fill(); });
          };
          const tex = textCanvas(768, 384, draw(false));
          wallPanel(30, s.y, 1.65, s.face, 2.2, 1.1, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
          stationFx.P4 = () => redraw(tex, draw(true));
          addStationInteract(s, V(s.x - 0.1, s.y, 1.6), 1.0);
          break;
        }
        case 'terminal': {
          let cursor = true;
          const draw = solved => (g, w, h) => {
            g.fillStyle = '#031208'; g.fillRect(0, 0, w, h);
            for (let y = 0; y < h; y += 4) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, y, w, 2); }
            g.font = '30px "Share Tech Mono", monospace'; g.fillStyle = '#33ff88'; g.textAlign = 'left';
            g.shadowColor = '#33ff88'; g.shadowBlur = 8;
            const lines = solved
              ? ['> COMPARTIMENTO SECRETO', '> ACCESO CONCEDIDO', '> +60 s AÑADIDOS ✔']
              : ['> COMPARTIMENTO SECRETO', '> "EL PRIMO MÁS CERCANO', `   A ${puzzleById('P5').show.n} LO DESBLOQUEA"`, '> _' + (cursor ? '█' : '')];
            lines.forEach((l, i) => g.fillText(l, 24, 56 + i * 44));
          };
          const tex = textCanvas(512, 256, draw(false));
          const mat = new THREE.MeshBasicMaterial({ map: tex });
          wallPanel(s.x, 42, 1.75, 'S', 1.5, 0.75, mat);
          let solvedT = false, acc = 0;
          animators.push(dt => {
            if (solvedT) return;
            acc += dt;
            if (acc > 0.5) { acc = 0; cursor = !cursor; redraw(tex, draw(false)); }
          });
          stationFx.P5 = () => { solvedT = true; redraw(tex, draw(true)); };
          addStationInteract(s, V(s.x, s.y - 0.3, 1.3), 0.8);
          break;
        }
        case 'window': {
          // Cielo exterior tras la ventana
          const sky = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), new THREE.MeshBasicMaterial({ map: TEX.sky }));
          sky.position.copy(V(s.x + 0.12, s.y, 2.1)); sky.rotation.y = -Math.PI / 2; staticMesh(sky);
          // Barrotes
          for (let k = -2; k <= 2; k++) {
            const b = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.6, 6), MAT.darkMetal);
            b.position.copy(V(s.x, s.y + k * 0.3, 2.1)); staticMesh(b);
          }
          // Contraventanas (se abren hacia dentro)
          const shutters = [-1, 1].map(side => {
            const g = new THREE.Group();
            const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.6, 0.8), MAT.rust);
            m.position.set(0, 0, side * 0.4);
            g.add(m);
            g.position.copy(V(s.x - T() / 2 - 0.03, s.y + side * 0.8, 2.1));
            scene.add(g);
            return { g, side };
          });
          let open = 0, goal = 0;
          stationFx.VENT = () => { goal = 1; };
          animators.push(dt => {
            if (open === goal) return;
            open = Math.min(1, open + dt * 0.9);
            shutters.forEach(({ g, side }) => { g.rotation.y = -side * open * 1.7; });
            windowLight.intensity = open * 1.1;
          });
          windowLight = new THREE.PointLight(0x9cc4ff, 0, 9, 1.6);
          windowLight.position.copy(V(s.x - 1.2, s.y, 2.3));
          scene.add(windowLight);
          interactables.push({
            id: 'VENT', room: s.room, pos: V(s.x - 0.2, s.y, 2.0), radius: 0.9, reach: 2.8,
            label: () => window._state.ventilated ? '✔ Ventana abierta' : '[E] Abrir ventana (reduce el gas)',
            action: () => { if (!window._state.ventilated) doVent(); }
          });
          break;
        }
        case 'exit': {
          const halves = [-1, 1].map(side => {
            const m = box(s.x - 0.06, s.y + (side < 0 ? -1.2 : 0), s.x + 0.06, s.y + (side < 0 ? 0 : 1.2), 0, 3.6, MAT.metalWall, { add: false, tile: 1.2 });
            const st = box(s.x + 0.061, s.y + (side < 0 ? -1.2 : 0), s.x + 0.07, s.y + (side < 0 ? 0 : 1.2), 0.2, 0.5, MAT.hazard, { add: false, tile: 0.5 });
            st.position.sub(m.position); m.add(st);
            scene.add(m);
            return { m, side, base: m.position.clone() };
          });
          const outside = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 3.6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
          outside.position.copy(V(s.x - 0.16, s.y, 1.8)); outside.rotation.y = Math.PI / 2; staticMesh(outside);
          // Teclado numérico
          const kp = textCanvas(128, 192, (g, w, h) => {
            g.fillStyle = '#15191e'; g.fillRect(0, 0, w, h);
            g.fillStyle = '#ff3b5c'; g.fillRect(14, 12, w - 28, 26);
            g.font = 'bold 26px monospace'; g.fillStyle = '#9fb3c0'; g.textAlign = 'center'; g.textBaseline = 'middle';
            ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].forEach((k, i) =>
              g.fillText(k, 26 + (i % 3) * 38, 64 + Math.floor(i / 3) * 34));
          });
          wallPanel(s.x, s.y + 1.75, 1.35, 'E', 0.3, 0.45, new THREE.MeshBasicMaterial({ map: kp }));
          let open = 0, goal = 0;
          animators.push(dt => {
            if (open === goal) return;
            open = Math.min(1, open + dt * 0.7);
            halves.forEach(({ m, side, base }) => { m.position.copy(base); m.position.z -= side * open * 1.15; });
            exitLight.intensity = open * 3;
          });
          exitLight = new THREE.PointLight(0xffffff, 0, 12, 1.4);
          exitLight.position.copy(V(s.x + 1, s.y, 2));
          scene.add(exitLight);
          stationFx.EXIT = () => { goal = 1; };
          interactables.push({
            id: 'EXIT', room: s.room, pos: V(s.x + 0.2, s.y, 1.6), radius: 1.3, reach: 3,
            label: () => '[E] Abrir la puerta de salida',
            action: () => tryDoor()
          });
          break;
        }
        case 'sealed': {
          box(s.x - 0.9, s.y + T() / 2, s.x + 0.9, s.y + T() / 2 + 0.08, 0, 2.3, MAT.rust, { tile: 1 });
          box(s.x - 0.95, s.y + T() / 2 + 0.08, s.x + 0.95, s.y + T() / 2 + 0.1, 1.0, 1.3, MAT.hazard, { tile: 0.5 });
          [-1, 1].forEach(k => {
            const chain = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.025, 6, 30, Math.PI), MAT.steel);
            chain.position.copy(V(s.x, s.y + 0.3, 1.2 + k * 0.4));
            chain.rotation.z = k > 0 ? 0 : Math.PI;
            chain.scale.y = 0.35;
            staticMesh(chain);
          });
          interactables.push({
            id: 'SEALED', room: s.room, pos: V(s.x, s.y + 0.3, 1.2), radius: 1, reach: 2.6,
            label: () => '[E] Puerta de entrada',
            action: () => { addLog('La puerta por donde entraste está sellada. No hay vuelta atrás.', 'warn'); UIToast('🔒 Sellada desde fuera', 'err'); SFX.locked(); }
          });
          break;
        }
      }
    });
  }

  // ── Objetos recogibles ───────────────────────────────────────
  function itemModel(item) {
    const g = new THREE.Group();
    const add = (geo, mat, x = 0, y = 0, z = 0, rx = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.x = rx; m.rotation.z = rz; g.add(m); return m;
    };
    switch (item) {
      case 'linterna':
        add(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 12), new THREE.MeshPhongMaterial({ color: 0x222222 }), 0, 0, 0, 0, Math.PI / 2);
        add(new THREE.CylinderGeometry(0.055, 0.04, 0.07, 12), new THREE.MeshPhongMaterial({ color: 0xffc845, shininess: 80 }), 0.13, 0, 0, 0, Math.PI / 2);
        add(new THREE.CircleGeometry(0.045, 12), new THREE.MeshBasicMaterial({ color: 0xfff8d0 }), 0.166, 0, 0, 0, 0).rotation.y = Math.PI / 2;
        break;
      case 'cuaderno_cifrado':
        add(new THREE.BoxGeometry(0.22, 0.035, 0.3), new THREE.MeshPhongMaterial({ color: 0x5a2d16 }));
        add(new THREE.BoxGeometry(0.2, 0.03, 0.28), new THREE.MeshPhongMaterial({ color: 0xf0e6cc }), 0.012, 0, 0);
        add(new THREE.BoxGeometry(0.05, 0.037, 0.05), new THREE.MeshBasicMaterial({ color: 0x9b6dff }), -0.03, 0, -0.05);
        break;
      case 'llave_oxidada':
      case 'llave_maestra': {
        const mat = item === 'llave_maestra' ? MAT.gold : MAT.rust;
        add(new THREE.TorusGeometry(0.05, 0.016, 8, 16), mat, -0.09, 0, 0);
        add(new THREE.BoxGeometry(0.16, 0.022, 0.022), mat, 0.03, 0, 0);
        add(new THREE.BoxGeometry(0.02, 0.05, 0.022), mat, 0.09, -0.03, 0);
        add(new THREE.BoxGeometry(0.02, 0.035, 0.022), mat, 0.055, -0.025, 0);
        break;
      }
      case 'vendas':
        add(new THREE.CylinderGeometry(0.06, 0.06, 0.09, 14), new THREE.MeshPhongMaterial({ color: 0xf4f1ea }));
        add(new THREE.CylinderGeometry(0.02, 0.02, 0.092, 8), new THREE.MeshPhongMaterial({ color: 0xbbbbbb }));
        break;
      case 'mascara_gas':
        add(new THREE.SphereGeometry(0.1, 14, 10, 0, Math.PI * 2, 0, Math.PI / 1.6), new THREE.MeshPhongMaterial({ color: 0x3e5a2e }), 0, 0, 0, -Math.PI / 2);
        add(new THREE.CylinderGeometry(0.045, 0.05, 0.07, 12), new THREE.MeshPhongMaterial({ color: 0x222222 }), 0, -0.02, 0.1, Math.PI / 2);
        [-1, 1].forEach(k => add(new THREE.CircleGeometry(0.03, 12), new THREE.MeshBasicMaterial({ color: 0x9fd8ff }), k * 0.045, 0.04, 0.095));
        break;
      case 'catalizador':
        add(new THREE.CylinderGeometry(0.045, 0.045, 0.2, 12), MAT.glass);
        add(new THREE.CylinderGeometry(0.038, 0.038, 0.14, 12), new THREE.MeshBasicMaterial({ color: 0x00d4f5 }), 0, -0.02, 0);
        add(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 12), MAT.darkMetal, 0, 0.11, 0);
        break;
      default:
        add(new THREE.BoxGeometry(0.12, 0.12, 0.12), MAT.steel);
    }
    return g;
  }

  function itemSpot(item, room) {
    return WORLD.itemSpots[item + '_' + room.toLowerCase()] || WORLD.itemSpots[item];
  }

  // Sincroniza los objetos visibles con ITEMS_IN_ROOMS / inventario
  function syncItems() {
    const want = new Set();
    Object.entries(ITEMS_IN_ROOMS).forEach(([room, list]) => list.forEach(item => {
      if (!window._state.inventory.includes(item) && itemSpot(item, room)) want.add(room + '|' + item);
    }));
    itemMeshes.forEach((o, key) => {
      if (want.has(key)) return;
      scene.remove(o.group); scene.remove(o.halo);
      const i = interactables.indexOf(o.inter); if (i >= 0) interactables.splice(i, 1);
      itemMeshes.delete(key);
    });
    want.forEach(key => {
      if (itemMeshes.has(key)) return;
      const [room, item] = key.split('|');
      const sp = itemSpot(item, room);
      const group = itemModel(item);
      const base = V(sp.x, sp.y, sp.z + 0.12);
      group.position.copy(base);
      scene.add(group);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: TEX.halo, color: item === 'llave_maestra' ? 0xffd24a : 0x7fe8ff,
        transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending
      }));
      halo.scale.setScalar(0.55);
      halo.position.copy(base);
      scene.add(halo);
      const inter = {
        id: key, room, pos: base, radius: 0.35, reach: REACH, item: true,
        label: () => `[E] Recoger ${item} — ${ITEM_INFO[item]?.desc || ''}`,
        action: () => doPick(item, room)
      };
      interactables.push(inter);
      itemMeshes.set(key, { group, halo, base, inter, seed: Math.random() * 6 });
    });
  }

  function updateItems(tm) {
    itemMeshes.forEach(o => {
      o.group.rotation.y = tm * 1.2 + o.seed;
      o.group.position.y = o.base.y + Math.sin(tm * 2 + o.seed) * 0.04;
      o.halo.material.opacity = 0.35 + 0.25 * Math.sin(tm * 3 + o.seed);
    });
  }

  // ── Modelos GLTF animados (solo con servidor; si no, figuras simples) ──
  function loadModel(file, onLoad) {
    if (!THREE.GLTFLoader) return;
    const keep = () => { /* se queda la figura simple */ };
    // Versión publicada: los modelos van incrustados en base64 (models-data.js)
    const packed = window.MODEL_DATA && window.MODEL_DATA[file];
    if (packed) {
      const bytes = Uint8Array.from(atob(packed), c => c.charCodeAt(0));
      return new THREE.GLTFLoader().parse(bytes.buffer, '', onLoad, keep);
    }
    if (!location.protocol.startsWith('http')) return;
    new THREE.GLTFLoader().load('assets/models/' + file, onLoad, undefined, keep);
  }

  function fitModel(model, height) {
    const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
    model.scale.multiplyScalar(height / size.y);
    model.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
    });
  }

  // ── NPC (M-7, robot de mantenimiento) ─────────────────────────
  function buildNpc() {
    const g = new THREE.Group();
    const proc = new THREE.Group();        // figura simple de respaldo
    g.add(proc);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.32, 1.25, 14), MAT.cloak);
    body.position.y = 0.62; proc.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), MAT.skin);
    head.position.y = 1.43; proc.add(head);
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), MAT.cloak);
    hood.position.y = 1.46; hood.rotation.x = -0.25; proc.add(hood);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x00e87a });
    [-1, 1].forEach(k => {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.027, 8, 6), eyeMat);
      e.position.set(k * 0.065, 1.45, 0.15); proc.add(e);
    });
    proc.traverse(o => { if (o.isMesh) o.castShadow = true; });
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x00e87a, transparent: true, opacity: 0.6 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.015, 6, 32), ringMat);
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.03; g.add(ring);
    const glow = new THREE.PointLight(0x00e87a, 0.4, 3.0, 1.6);     // se le ve en la penumbra
    glow.position.set(0, 1.1, 0.35); g.add(glow);

    const tagTex = textCanvas(256, 64, (c, w, h) => {
      c.font = 'bold 34px Orbitron, monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = '#c8dde8'; c.shadowColor = '#000'; c.shadowBlur = 8; c.fillText('M-7', w / 2, h / 2);
    });
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tagTex, transparent: true, depthWrite: false }));
    tag.scale.set(0.5, 0.125, 1); tag.position.y = 1.62; g.add(tag);

    scene.add(g);
    npc = { group: g, eyeMat, ringMat, glow, x: 0, y: 0, collider: { x0: 0, y0: 0, x1: 0, y1: 0 }, greeted: false, play: null };
    colliders.push(npc.collider);
    interactables.push({
      id: 'NPC', npc: true, pos: new THREE.Vector3(), radius: 0.5, reach: 2.8,
      get room() { return npcRoom; },
      label: () => '[E] Hablar con M-7 (Teoría de Juegos)',
      action: () => openNpc()
    });
    placeNpc(currentRoom, true);

    loadModel('RobotExpressive.glb', gltf => {
      const model = gltf.scene;
      fitModel(model, 1.3);
      model.traverse(o => {            // robot viejo: menos saturado y más mate
        if (!o.isMesh) return;
        o.material = o.material.clone();
        o.material.color.multiplyScalar(0.62);
        o.material.roughness = 0.6; o.material.metalness = 0.55; o.material.envMapIntensity = 0.8;
      });
      proc.visible = false;
      g.add(model);
      const mixer = new THREE.AnimationMixer(model);
      mixers.push(mixer);
      const actions = {};
      gltf.animations.forEach(clip => { actions[clip.name] = mixer.clipAction(clip); });
      let current = actions.Idle;
      current.play();
      const fadeTo = (next, time = 0.3) => {
        if (next === current) return;
        next.reset().play();
        current.crossFadeTo(next, time, false);
        current = next;
      };
      mixer.addEventListener('finished', () => fadeTo(actions.Idle, 0.4));
      // Gesto de una sola vez: 'Wave' | 'Yes' | 'No' | 'ThumbsUp' | 'Punch' | 'Jump'
      npc.play = name => {
        const action = actions[name];
        if (!action) return;
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        fadeTo(action, 0.2);
      };
    });
  }

  function placeNpc(room, instant = false) {
    const sp = WORLD.npcSpots[room];
    if (!sp || !npc) return;
    npcRoom = room;
    npc.x = sp.x; npc.y = sp.y;
    npc.greeted = false;
    npc.group.position.copy(V(sp.x, sp.y, 0));
    const c = npc.collider;
    c.x0 = sp.x - 0.3; c.x1 = sp.x + 0.3; c.y0 = sp.y - 0.3; c.y1 = sp.y + 0.3;
    const inter = interactables.find(i => i.id === 'NPC');
    inter.pos.copy(V(sp.x, sp.y, 1.2));
    npcAppear = instant ? 1 : 0;
  }

  function hunterBlocked(x, y, radius = 0.22) {
    return colliders.some(c => c !== npc?.collider &&
      x > c.x0 - radius && x < c.x1 + radius && y > c.y0 - radius && y < c.y1 + radius);
  }

  function hunterClearLine(from, to, radius) {
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 0.16));
    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      if (hunterBlocked(from.x + (to.x - from.x) * f, from.y + (to.y - from.y) * f, radius)) return false;
    }
    return true;
  }

  function onFloor(x, y) {
    return Object.values(WORLD.rooms).concat(WORLD.corridors)
      .some(a => x > a.x0 && x < a.x1 && y > a.y0 && y < a.y1);
  }

  // ── Asesino ───────────────────────────────────────────────────
  const HUNTER_MODEL_YAW = Math.PI;   // el modelo mira hacia −Z; el asesino avanza hacia +Z local
  function buildHunter() {
    const group = new THREE.Group();
    const proc = new THREE.Group();        // figura simple de respaldo
    const cloak = new THREE.MeshStandardMaterial({ color: 0x241a20, roughness: 0.86 });
    const mask = new THREE.MeshStandardMaterial({ color: 0xd2c5af, roughness: 0.7 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.36, 1.36, 12), cloak);
    body.position.y = 0.68;
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), cloak);
    hood.position.y = 1.52;
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), mask);
    face.scale.set(0.8, 1.15, 0.4);
    face.position.set(0, 1.5, 0.2);
    proc.add(body, hood, face);
    const eye = new THREE.MeshBasicMaterial({ color: 0xff4e42 });
    for (const x of [-0.055, 0.055]) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.021, 8, 6), eye);
      mesh.position.set(x, 1.54, 0.266);
      proc.add(mesh);
    }
    proc.traverse(o => { if (o.isMesh) o.castShadow = true; });
    group.add(proc);
    const glow = new THREE.PointLight(0xff2a1a, 0.7, 3.4, 1.7);      // resplandor rojo del visor
    glow.position.set(0, 1.7, 0.3);
    group.add(glow);
    group.visible = false;
    scene.add(group);
    hunter = {
      group, proc, x: 5, y: 2.2, arrival: 26 + Math.random() * 15, scan: 0,
      brain: createHunterBrain(), memory: createHunterMemory(), navigation: createHunterNavigation(
        Object.values(WORLD.rooms).concat(WORLD.corridors), hunterBlocked
      ),
      route: [], goal: null, lastSeen: null, speed: 1.7, concealed: 0,
      escapeCooldown: 0, retreat: 0, warning: 0,
      state: 'patrol', investigate: 0, stepAcc: 0, moving: false, catches: 0, setAnim: null
    };

    loadModel('Soldier.glb', gltf => {
      const model = gltf.scene;
      fitModel(model, 1.96);
      model.rotation.y = HUNTER_MODEL_YAW;
      model.traverse(o => {
        if (!o.isMesh) return;
        o.material = o.material.clone();
        if (/visor/i.test(o.name) || /visor/i.test(o.material.name)) {
          o.material.color.setHex(0x120000);
          o.material.emissive = new THREE.Color(0xff1a0a);
          o.material.emissiveIntensity = 2.2;
        } else {
          o.material.color.setHex(0x2b282c);       // uniforme oscurecido
          o.material.roughness = 0.82; o.material.metalness = 0.15; o.material.envMapIntensity = 0.3;
        }
      });
      proc.visible = false;
      group.add(model);
      const mixer = new THREE.AnimationMixer(model);
      mixers.push(mixer);
      const actions = {};
      gltf.animations.forEach(clip => { actions[clip.name] = mixer.clipAction(clip); });
      let current = actions.Idle;
      current.play();
      hunter.setAnim = (name, timeScale = 1) => {
        const next = actions[name];
        if (!next) return;
        next.timeScale = timeScale;
        if (next === current) return;
        next.reset().play();
        current.crossFadeTo(next, 0.3, false);
        current = next;
      };
    });
  }

  function updateHunter(dt) {
    const h = hunter;
    h.arrival -= dt;
    if (h.arrival > 0) return;
    if (!h.group.visible) {
      if (Math.hypot(player.x - h.x, player.y - h.y) < 7) {
        h.x = 6; h.y = 19.5;
      }
      h.group.position.copy(V(h.x, h.y));
      h.group.visible = true;
      UIToast('El asesino ha entrado. Correr, las puertas y los fallos hacen ruido.', 'warn');
    }
    h.memory.dwell(currentRoom, dt);
    h.concealed -= dt;
    h.escapeCooldown -= dt;
    h.warning -= dt;
    h.investigate = Math.max(0, h.investigate - dt);
    h.retreat = Math.max(0, h.retreat - dt);
    const distance = Math.hypot(player.x - h.x, player.y - h.y);
    if (!h.retreat && distance < 0.73 && hunterClearLine(h, player, 0)) {
      hunterCaughtPlayer();
      SFX.caught();
      hitT = 1;
      h.catches++;
      h.brain.forget();
      h.lastSeen = null;
      h.retreat = 9;
      h.goal = null;
      h.scan = 0;
      h.investigate = 0;
      h.state = 'patrol';
    }
    h.scan -= dt;
    if (h.scan <= 0) {
      const interval = (0.6 + Math.random() * 0.4) / hunterAggression;
      h.scan = interval;
      const hidden = h.concealed > 0 || h.retreat > 0;
      const visible = distance < 13 && hunterClearLine(h, player, 0);
      let state = h.brain.observe({
        distance, visible, sprinting: Math.hypot(player.vx, player.vy) > 3.6,
        concealed: hidden, lit: flashOn, aggression: hunterAggression
      });
      const chaseSpeed = 3.8 * hunterAggression;
      if (state === 'detect') {
        // Intercepción: va hacia donde el jugador ESTARÁ, no hacia donde está
        h.lastSeen = hunterIntercept(h, player, chaseSpeed, (x, y) => onFloor(x, y) && !hunterBlocked(x, y));
        h.investigate = 0;
        if (h.warning <= 0) {
          UIToast('¡El asesino te ha detectado!', 'err');
          SFX.stinger();
          h.warning = 12;
        }
      } else {
        // Oído: puertas, objetos y alarmas le dan un punto que investigar
        const noise = h.memory.heard(h.x, h.y, interval);
        if (noise && !hidden) {
          h.lastSeen = { x: noise.x, y: noise.y };
          h.investigate = 9;
        }
        if (state === 'patrol' && h.investigate > 0) state = 'search';
      }
      // Llegó al último punto conocido y no hay nadie: deja de investigar
      if (state !== 'detect' && h.lastSeen && Math.hypot(h.lastSeen.x - h.x, h.lastSeen.y - h.y) < 0.8) {
        h.lastSeen = null; h.investigate = 0; h.goal = null;
      }
      if (state === 'patrol') h.lastSeen = null;
      if (!h.goal || (!h.route.length && !h.lastSeen)) {
        // Patrulla: prefiere las salas donde el jugador pasa más tiempo
        const here = roomAt(h.x, h.y);
        const options = Object.entries(WORLD.rooms).filter(([id, room]) =>
          id !== here && canEnterRoom(id).ok &&
          (!h.retreat || Math.hypot(room.lightPos[0] - player.x, room.lightPos[1] - player.y) > 9)).map(([id]) => id);
        const room = WORLD.rooms[h.memory.choosePatrol(options)] || WORLD.rooms.ENTRADA;
        h.goal = { x: room.lightPos[0], y: room.lightPos[1] };
      }
      const goal = h.lastSeen || h.goal;
      h.state = state;
      h.speed = (state === 'detect' ? 3.8 : state === 'search' ? 2.5 : 1.7) * hunterAggression;
      h.route = hunterClearLine(h, goal, 0.22) ? [goal] : h.navigation.route(h, goal);
    }

    // Sonido 3D: respiración continua + pasos
    const level = h.state === 'detect' ? 1 : h.state === 'search' ? 0.7 : 0.4;
    SFX.setHunter(h.x, 1.5, -h.y, level);

    const next = h.route[0];
    const dx = next ? next.x - h.x : 0, dy = next ? next.y - h.y : 0;
    const length = Math.hypot(dx, dy);
    if (!next || length <= 0.025) {
      if (next) h.route.shift();
      if (!h.route.length) { h.moving = false; if (h.setAnim) h.setAnim('Idle'); }
      return;
    }
    const factor = Math.min(1, dt * h.speed / length);
    h.x += dx * factor;
    h.y += dy * factor;
    h.moving = true;
    const running = h.speed >= 3;
    if (h.setAnim) h.setAnim(running ? 'Run' : 'Walk', running ? h.speed / 3.9 : h.speed / 1.75);
    h.group.position.copy(V(h.x, h.y, h.setAnim ? 0 : Math.sin(time * h.speed * 4) * 0.025));
    // Giro suave hacia la dirección de marcha
    const want = Math.atan2(dx, -dy);
    let turn = want - h.group.rotation.y;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    h.group.rotation.y += turn * Math.min(1, dt * 9);
    h.stepAcc += length * factor;
    if (h.stepAcc > (running ? 1.15 : 0.8)) { h.stepAcc = 0; SFX.hunterStep(h.x, 0.1, -h.y, running); }
  }

  function updateNpc(dt, tm) {
    if (!npc) return;
    npcAppear = Math.min(1, npcAppear + dt * 1.5);
    const s = 0.2 + 0.8 * npcAppear;
    npc.group.scale.set(s, s, s);
    npc.group.position.y = npc.play ? 0 : Math.sin(tm * 1.6) * 0.03;
    const dx = player.x - npc.x, dy = player.y - npc.y;
    const want = Math.atan2(dx, -dy);           // mira al jugador
    let cur = npc.group.rotation.y, d = want - cur;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    npc.group.rotation.y = cur + d * Math.min(1, dt * 4);
    npc.ringMat.opacity = 0.35 + 0.25 * Math.sin(tm * 3);
    // Saluda la primera vez que te acercas en cada sala
    if (!npc.greeted && npcRoom === currentRoom && Math.hypot(dx, dy) < 4.2) {
      npc.greeted = true;
      if (npc.play) npc.play('Wave');
      SFX.talk(npcMood === 'COOPERAR');
    }
  }

  // ── Partículas de gas ─────────────────────────────────────────
  function buildParticles() {
    const N = 260;
    const pos = new Float32Array(N * 3);
    const r = rng(99);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (r() - 0.5) * 14;
      pos[i * 3 + 1] = r() * 3.2;
      pos[i * 3 + 2] = (r() - 0.5) * 14;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      map: TEX.halo, color: 0x8dff5a, size: 0.5, transparent: true, opacity: 0,
      depthWrite: false, sizeAttenuation: true
    });
    particles = new THREE.Points(geo, mat);
    particles.frustumCulled = false;
    scene.add(particles);
  }

  function updateParticles(dt) {
    if (!particles) return;
    const arr = particles.geometry.attributes.position.array;
    const cx = player.x, cz = -player.y;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i + 1] += dt * (0.08 + (i % 7) * 0.01);
      arr[i] += Math.sin(time * 0.3 + i) * dt * 0.05;
      if (arr[i + 1] > 3.2) arr[i + 1] = 0;
      // Mantener la nube alrededor del jugador (envoltura toroidal)
      if (arr[i] - cx > 7) arr[i] -= 14; else if (arr[i] - cx < -7) arr[i] += 14;
      if (arr[i + 2] - cz > 7) arr[i + 2] -= 14; else if (arr[i + 2] - cz < -7) arr[i + 2] += 14;
    }
    particles.geometry.attributes.position.needsUpdate = true;
    particles.material.opacity = Math.min(0.5, gasPct * 0.55);
  }

  // ══════════════════════════════════════════════════════════════
  //  JUGADOR: movimiento y colisiones
  // ══════════════════════════════════════════════════════════════
  function collide(axis) {
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      if (player.x > c.x0 - RADIUS && player.x < c.x1 + RADIUS &&
          player.y > c.y0 - RADIUS && player.y < c.y1 + RADIUS) {
        if (axis === 'x') {
          player.x = (player.x - (c.x0 + c.x1) / 2) > 0 ? c.x1 + RADIUS + 1e-4 : c.x0 - RADIUS - 1e-4;
          player.vx = 0;
        } else {
          player.y = (player.y - (c.y0 + c.y1) / 2) > 0 ? c.y1 + RADIUS + 1e-4 : c.y0 - RADIUS - 1e-4;
          player.vy = 0;
        }
      }
    }
  }

  function updatePlayer(dt) {
    let f = 0, s = 0;
    if (keys.KeyW || keys.ArrowUp) f += 1;
    if (keys.KeyS || keys.ArrowDown) f -= 1;
    if (keys.KeyD || keys.ArrowRight) s += 1;
    if (keys.KeyA || keys.ArrowLeft) s -= 1;
    const len = Math.hypot(f, s) || 1;
    f /= len; s /= len;
    const speed = (keys.ShiftLeft || keys.ShiftRight) ? RUN : WALK;
    const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
    // adelante = (−sin, cos) · derecha = (cos, sin)   (en planta)
    const tx = (-sy * f + cy * s) * speed;
    const ty = (cy * f + sy * s) * speed;
    const k = Math.min(1, dt * 12);
    player.vx += (tx - player.vx) * k;
    player.vy += (ty - player.vy) * k;

    // Sub-pasos para evitar atravesar paredes con dt grandes
    const steps = Math.ceil(Math.hypot(player.vx, player.vy) * dt / 0.1) || 1;
    for (let i = 0; i < steps; i++) {
      player.x += player.vx * dt / steps; collide('x');
      const previousY = player.y;
      player.y += player.vy * dt / steps;
      if (currentRoom === 'ESPEJOS' && player.y > previousY) {
        const portal = mirrorSurfaces.find(panel => panel.destination && Math.abs(player.x - panel.x) < 1.05 &&
          previousY < panel.y - T() / 2 - RADIUS && player.y >= panel.y - T() / 2 - RADIUS);
        if (portal) {
          crossMirror(portal);
          break;
        }
      }
      collide('y');
    }

    const moving = Math.hypot(player.vx, player.vy);
    if (moving > 0.3) {
      player.bob += dt * moving * 2.4;
      player.stepAcc += dt * moving;
      if (player.stepAcc > 1.35) { player.stepAcc = 0; SFX.step(); }
    } else {
      player.bob += (Math.round(player.bob / Math.PI) * Math.PI - player.bob) * Math.min(1, dt * 6);
    }
  }

  function roomAt(x, y) {
    for (const [key, r] of Object.entries(WORLD.rooms))
      if (x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1) return key;
    return null;
  }

  function updateRoom() {
    const r = roomAt(player.x, player.y);
    if (r && r !== currentRoom) {
      currentRoom = r;
      const first = !visited.has(r);
      visited.add(r);
      enterRoom(r, first);
      placeNpc(r);
      aimRoomShadow(r);
      applyRoomAcoustics(r);
    }
  }

  function applyRoomAcoustics(room) {
    const r = WORLD.rooms[room];
    const volume = (r.x1 - r.x0) * (r.y1 - r.y0) * r.h;
    SFX.setRoom(r.theme === 'wood' || volume < 200 ? 'small' : volume < 560 ? 'medium' : 'large');
  }

  function aimRoomShadow(room) {
    const { light, lightPos: [x, y], h, x0, x1, y0, y1 } = WORLD.rooms[room];
    roomShadow.color.setHex(light);
    roomShadow.position.copy(V(THREE.MathUtils.clamp(x - 1.4, x0 + 1, x1 - 1),
      THREE.MathUtils.clamp(y - 1.1, y0 + 1, y1 - 1), h - 0.3));
    roomShadow.target.position.copy(V(x + 0.75, y + 0.65, 0));
    roomShadow.shadow.needsUpdate = true;
  }

  function updateCamera() {
    camera.position.set(player.x, EYE + Math.sin(player.bob * 2) * 0.035, -player.y);
    camera.rotation.set(player.pitch, player.yaw, Math.sin(mirrorPulse * Math.PI) * 0.045, 'YXZ');
  }

  // ── Selección de objetivo (lo que miras) ─────────────────────
  const _fwd = new THREE.Vector3(), _to = new THREE.Vector3();
  function updateTarget() {
    camera.getWorldDirection(_fwd);
    let best = null, bestScore = -Infinity;
    for (const it of interactables) {
      if (it.room && it.room !== currentRoom) continue;
      _to.subVectors(it.pos, camera.position);
      const dist = _to.length();
      if (dist > it.reach + it.radius) continue;
      _to.divideScalar(dist || 1);
      const ang = Math.acos(Math.max(-1, Math.min(1, _fwd.dot(_to))));
      const allowed = Math.atan2(it.radius, dist) + 0.1;
      if (ang > allowed) continue;
      const score = -ang - dist * 0.05;
      if (score > bestScore) { bestScore = score; best = it; }
    }
    target = best;
    const label = best ? best.label() : null;
    UISetPrompt(label);
  }

  function interact() {
    if (!target) return;
    const lbl = target.label();
    if (!lbl) return;
    target.action();
  }

  // ══════════════════════════════════════════════════════════════
  //  LUCES, GAS Y LINTERNA
  // ══════════════════════════════════════════════════════════════
  const _red = new THREE.Color(0xff1a1a), _tmp = new THREE.Color();
  function updateLights(tm) {
    const alarm = gasState === 'PELIGRO' || gasState === 'FATAL';
    Object.entries(roomLights).forEach(([key, L]) => {
      let k = 1;
      if (key === 'CRIPTA') k = 0.85 + 0.15 * Math.sin(tm * 11) * Math.sin(tm * 7.3);
      if (key === 'ENTRADA' && Math.sin(tm * 0.7) > 0.97) k = 0.3 + Math.random() * 0.4;
      L.light.intensity = L.base * k;
      if (alarm) {
        const p = 0.5 + 0.5 * Math.sin(tm * 5);
        L.light.color.copy(L.color).lerp(_red, 0.35 + 0.35 * p);
      } else L.light.color.copy(L.color);
    });

    // Niebla tóxica: densidad y color según el gas
    _tmp.copy(fogColorSafe).lerp(fogColorToxic, Math.min(1, gasPct * 1.2));
    scene.fog.color.copy(_tmp);
    renderer.setClearColor(_tmp);
    const fogGoal = 0.018 + gasPct * 0.1 + gasFlashT * 0.12;
    scene.fog.density += (fogGoal - scene.fog.density) * 0.05;
    gasFlashT = Math.max(0, gasFlashT - 0.016);

    // Texto oculto: aparece bajo el haz de la linterna
    if (hiddenMat) {
      let goal = 0;
      if (flashOn && currentRoom === 'ARCHIVO') {
        _to.subVectors(hiddenPos, camera.position);
        const dist = _to.length();
        camera.getWorldDirection(_fwd);
        const ang = _fwd.angleTo(_to);
        if (dist < 10 && ang < 0.5) goal = 1 - ang / 0.5 * 0.6;
      }
      hiddenMat.opacity += (goal - hiddenMat.opacity) * 0.1;
    }
  }

  function setFlashlight(on) {
    flashOn = on;
    flashlight.intensity = on ? 1.9 : 0;
    UISetFlashIcon(on);
    SFX.click();
  }

  // ══════════════════════════════════════════════════════════════
  //  MINIMAPA (misma fuente de datos que el 3D → vista cenital)
  // ══════════════════════════════════════════════════════════════
  const THEME_COLOR = { concrete: '#5d5b57', lab: '#6e8a96', stone: '#6b5846', wood: '#5b4630', metal: '#4b5360' };

  function drawMap(ctx, W, H, opt) {
    const { cx, cy, scale, full } = opt;
    const X = x => W / 2 + (x - cx) * scale;
    const Y = y => H / 2 - (y - cy) * scale;
    const R = (x0, y0, x1, y1) => [X(x0), Y(y1), (x1 - x0) * scale, (y1 - y0) * scale];
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(5,8,12,0.88)'; ctx.fillRect(0, 0, W, H);

    const known = key => visited.has(key);
    WORLD.corridors.forEach(c => { ctx.fillStyle = '#3b3f45'; ctx.fillRect(...R(c.x0, c.y0, c.x1, c.y1)); });
    Object.entries(WORLD.rooms).forEach(([key, r]) => {
      if (known(key)) {
        ctx.fillStyle = THEME_COLOR[r.theme]; ctx.fillRect(...R(r.x0, r.y0, r.x1, r.y1));
        ctx.strokeStyle = '#c8dde8'; ctx.lineWidth = Math.max(1, scale * 0.12); ctx.setLineDash([]);
      } else {
        ctx.strokeStyle = 'rgba(200,221,232,0.35)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      }
      ctx.strokeRect(...R(r.x0, r.y0, r.x1, r.y1));
      ctx.setLineDash([]);
      if (full || scale > 5) {
        ctx.fillStyle = known(key) ? '#e8f6ff' : 'rgba(200,221,232,0.4)';
        ctx.font = `bold ${Math.max(9, Math.min(15, scale * 0.9))}px "Share Tech Mono", monospace`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(known(key) ? ROOMS[key].label : '???', X((r.x0 + r.x1) / 2), Y(r.y1) + 12);
      }
    });
    // Mobiliario de salas conocidas
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    WORLD.props.forEach(p => { if (known(p.room)) ctx.fillRect(...R(p.x0, p.y0, p.x1, p.y1)); });
    // Puertas
    Object.values(doors).forEach(d => {
      const { def } = d;
      ctx.strokeStyle = d.open ? '#00e87a' : (d.allowed ? '#ffc845' : '#ff3b5c');
      ctx.lineWidth = Math.max(2, scale * 0.35);
      ctx.beginPath();
      if (def.axis === 'x') { ctx.moveTo(X(def.from), Y(def.at)); ctx.lineTo(X(def.until), Y(def.at)); }
      else { ctx.moveTo(X(def.at), Y(def.from)); ctx.lineTo(X(def.at), Y(def.until)); }
      ctx.stroke();
    });
    // Estaciones
    WORLD.stations.forEach(s => {
      if (!known(s.room)) return;
      let col = '#9fb3c0';
      if (/^P\d/.test(s.id)) col = window._state.solved.includes(s.id) ? '#00e87a' : '#ffc845';
      if (s.id === 'VENT') col = window._state.ventilated ? '#00e87a' : '#7fb8ff';
      if (s.id === 'EXIT') col = '#ff6a80';
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(X(s.x), Y(s.y), Math.max(3, scale * 0.3), 0, 7); ctx.fill();
      if (full) {
        ctx.fillStyle = '#e8f6ff'; ctx.font = '11px "Share Tech Mono", monospace';
        ctx.fillText(s.id, X(s.x), Y(s.y) - 12);
      }
    });
    // Objetos
    itemMeshes.forEach((o, key) => {
      const [room, item] = key.split('|');
      if (!known(room)) return;
      const sp = itemSpot(item, room);
      ctx.fillStyle = '#7fe8ff';
      ctx.fillRect(X(sp.x) - 2.5, Y(sp.y) - 2.5, 5, 5);
    });
    // NPC
    if (npc && npcRoom) {
      ctx.fillStyle = npcMood === 'COOPERAR' ? '#00e87a' : '#ff8a3c';
      ctx.beginPath(); ctx.arc(X(npc.x), Y(npc.y), Math.max(3, scale * 0.35), 0, 7); ctx.fill();
    }
    // Jugador (flecha orientada)
    const px = X(player.x), py = Y(player.y);
    const dx = -Math.sin(player.yaw), dy = Math.cos(player.yaw);
    const sz = Math.max(6, scale * 0.8);
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#00d4f5'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px + dx * sz, py - dy * sz);
    ctx.lineTo(px - dx * sz * 0.6 + dy * sz * 0.55, py + dy * sz * 0.6 + dx * sz * 0.55);
    ctx.lineTo(px - dx * sz * 0.6 - dy * sz * 0.55, py + dy * sz * 0.6 - dx * sz * 0.55);
    ctx.closePath(); ctx.fill(); ctx.stroke();

    if (full) {
      // Escala y norte
      ctx.fillStyle = '#c8dde8'; ctx.font = '12px "Share Tech Mono", monospace'; ctx.textAlign = 'left';
      ctx.fillRect(20, H - 30, 5 * scale, 3);
      ctx.fillText('5 m', 20, H - 40);
      ctx.textAlign = 'center';
      ctx.fillText('N ▲', W - 40, 30);
    }
  }

  function drawMinimap(dt) {
    mapTimer -= dt;
    if (mapTimer > 0) return;
    mapTimer = 0.08;
    const mini = document.getElementById('minimap');
    if (mini) drawMap(mini.getContext('2d'), mini.width, mini.height, { cx: player.x, cy: player.y, scale: 5.5, full: false });
    if (mapOpen) {
      const big = document.getElementById('bigmap-canvas');
      const b = WORLD_BOUNDS;
      const scale = Math.min((big.width - 80) / (b.x1 - b.x0), (big.height - 80) / (b.y1 - b.y0));
      drawMap(big.getContext('2d'), big.width, big.height, { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, scale, full: true });
    }
  }

  let WORLD_BOUNDS = null;
  function computeBounds() {
    const all = Object.values(WORLD.rooms).concat(WORLD.corridors);
    WORLD_BOUNDS = {
      x0: Math.min(...all.map(r => r.x0)), y0: Math.min(...all.map(r => r.y0)),
      x1: Math.max(...all.map(r => r.x1)), y1: Math.max(...all.map(r => r.y1))
    };
  }

  function toggleMap(force) {
    mapOpen = force !== undefined ? force : !mapOpen;
    const el = document.getElementById('bigmap');
    el.classList.toggle('hidden', !mapOpen);
    if (mapOpen) {
      const c = document.getElementById('bigmap-canvas');
      c.width = Math.floor(window.innerWidth * 0.8);
      c.height = Math.floor(window.innerHeight * 0.8);
      mapTimer = 0;
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  ENTRADA (teclado / ratón / pointer lock)
  // ══════════════════════════════════════════════════════════════
  let lockFails = 0, lockFromGesture = false;
  function requestLock(fromGesture = false) {
    if (!running) return;
    if (dragLook) { setPaused(false); return; }
    lockFromGesture = fromGesture;
    const el = renderer.domElement;
    try {
      const p = el.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* se reintenta con clic */ }
  }

  function setPaused(p) {
    paused = p;
    document.getElementById('pause').classList.toggle('hidden', !p);
    if (p) pauseClock(); else resumeClock();
  }

  function onLockChange() {
    locked = document.pointerLockElement === renderer.domElement;
    if (!running) return;
    if (locked) { lockFails = 0; setPaused(false); SFX.resume(); }
    else if (!overlay) setPaused(true);
  }

  function onKeyDown(e) {
    if (!running) return;
    if (overlay) {
      if (e.code === 'Escape') { e.preventDefault(); goStep('step-menu'); }
      return;
    }
    if (paused) return;
    keys[e.code] = true;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    if (e.code === 'KeyE') interact();
    else if (e.code === 'KeyF') {
      if (window._state.inventory.includes('linterna')) setFlashlight(!flashOn);
      else UIToast('Necesitas la linterna (LABORATORIO)', 'warn');
    }
    else if (e.code === 'KeyM' || e.code === 'Tab') toggleMap();
    else if (e.code === 'KeyV') UIToast('Voz del Vigilante: ' + (Director.toggleVoice() ? 'ACTIVADA' : 'DESACTIVADA'), 'info');
    else if (e.code === 'KeyG') UIToast('Calidad gráfica: ' + GFX.nextQuality().toUpperCase(), 'info');
    else if (/^Digit[1-9]$/.test(e.code)) {
      const item = window._state.inventory[parseInt(e.code.slice(5), 10) - 1];
      if (item) useItemKey(item);
    }
  }

  function useItemKey(item) {
    doUse(item);
    if (item === 'linterna' && !flashOn) setFlashlight(true);
  }

  function onKeyUp(e) { keys[e.code] = false; }

  function onMouseMove(e) {
    if (!running || overlay || paused) return;
    if (!locked && !(dragLook && dragging)) return;
    const s = 0.0022;
    // Chrome a veces entrega saltos enormes al capturar el ratón: se recortan
    const mx = Math.max(-150, Math.min(150, e.movementX || 0));
    const my = Math.max(-150, Math.min(150, e.movementY || 0));
    player.yaw -= mx * s;
    player.pitch -= my * s;
    player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch));
  }

  function onResize() {
    if (!renderer) return;
    const w = container.clientWidth, h = container.clientHeight;
    GFX.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (mapOpen) toggleMap(true);
  }

  // ══════════════════════════════════════════════════════════════
  //  BUCLE
  // ══════════════════════════════════════════════════════════════
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0, (now - lastT) / 1000));
    lastT = now;
    step(dt);
  }

  function step(dt) {
    time += dt;
    mirrorPulse = Math.max(0, mirrorPulse - dt * 2.8);

    const active = (locked || dragLook) && !overlay && !paused;
    if (active) updatePlayer(dt);
    else { player.vx = 0; player.vy = 0; Object.keys(keys).forEach(k => { keys[k] = false; }); }

    for (let i = 0; i < mixers.length; i++) mixers[i].update(dt);
    updateCamera();
    updateFlashlight(dt);
    updateRoom();
    updateDoors(dt);
    if (active) updateHunter(dt);
    updateItems(time);
    updateNpc(dt, time);
    updateParticles(dt);
    updateLights(time);
    for (let i = 0; i < animators.length; i++) animators[i](dt, time);
    if (active) updateTarget(); else UISetPrompt(null);
    drawMinimap(dt);

    if (gasPct > 0.6 && !paused) {
      heartT -= dt;
      if (heartT <= 0) { SFX.heart(); heartT = 1.3 - (gasPct - 0.6) * 1.5; }
    }
    // Miedo: sube si el asesino te persigue o está muy cerca (tinte, viñeta y música)
    let fearGoal = 0;
    if (hunter && hunter.group.visible) {
      const d = Math.hypot(player.x - hunter.x, player.y - hunter.y);
      fearGoal = hunter.state === 'detect' ? 1 : hunter.state === 'search' ? 0.45 : d < 6 ? 0.3 : 0;
    }
    fear += (fearGoal - fear) * Math.min(1, dt * (fearGoal > fear ? 2.5 : 0.6));
    hitT = Math.max(0, hitT - dt * 1.1);
    SFX.setTension(paused || overlay ? 0 : fear);
    camera.getWorldDirection(_fwd);
    SFX.setListener(camera.position.x, camera.position.y, camera.position.z, _fwd.x, _fwd.y, _fwd.z);

    renderMirrorViews();
    GFX.render(dt, { time, gas: gasPct, hit: Math.max(hitT, gasFlashT * 0.6), fear, flash: flashOn });
    if (active) watchPerformance(dt);
  }

  // La linterna va con un pequeño retraso respecto a la vista, como en la mano
  function updateFlashlight(dt) {
    const s = flashSway;
    s.x += (player.yaw - s.lastYaw) * 0.85;
    s.y -= (player.pitch - s.lastPitch) * 0.85;
    s.lastYaw = player.yaw; s.lastPitch = player.pitch;
    const k = Math.exp(-dt * 7);
    s.x = THREE.MathUtils.clamp(s.x * k, -0.3, 0.3);
    s.y = THREE.MathUtils.clamp(s.y * k, -0.3, 0.3);
    flashlight.target.position.set(s.x + Math.sin(player.bob) * 0.012, s.y + Math.sin(player.bob * 2) * 0.01, -1);
  }

  // Si el equipo no puede con la calidad elegida, se baja sola (una vez por nivel)
  function watchPerformance(dt) {
    if (perf.settled) return;
    perf.t += dt; perf.frames++;
    if (perf.t < 5) return;
    const fps = perf.frames / perf.t;
    perf.t = 0; perf.frames = 0;
    if (fps < 27 && GFX.lowerQuality()) UIToast('Calidad gráfica reducida a ' + GFX.quality.toUpperCase() + ' para ir más fluido (G para cambiar)', 'warn');
    else perf.settled = true;
  }

  // ══════════════════════════════════════════════════════════════
  //  API PÚBLICA
  // ══════════════════════════════════════════════════════════════
  function init(el) {
    if (built) return;
    container = el;
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    fogColorSafe = new THREE.Color(0x07090c);
    fogColorToxic = new THREE.Color(0x24401a);
    scene.fog = new THREE.FogExp2(fogColorSafe.getHex(), 0.02);
    scene.add(new THREE.HemisphereLight(0x8aa0b8, 0x2a2018, 0.24));
    scene.add(new THREE.AmbientLight(0x404650, 0.14));
    roomShadow = new THREE.SpotLight(0xffffff, 2.3, 14, 1.02, 0.75, 1.45);
    roomShadow.castShadow = true;
    roomShadow.shadow.mapSize.set(1024, 1024);
    roomShadow.shadow.camera.near = 0.15;
    roomShadow.shadow.bias = -0.0004;
    roomShadow.shadow.normalBias = 0.025;
    roomShadow.shadow.autoUpdate = false;
    scene.add(roomShadow, roomShadow.target);
    aimRoomShadow(currentRoom);

    camera = new THREE.PerspectiveCamera(72, 1, 0.05, 80);
    scene.add(camera);
    // Linterna: foco real que proyecta sombras (también la silueta del asesino)
    flashlight = new THREE.SpotLight(0xfff1d6, 0, 26, 0.5, 0.6, 1.3);
    flashlight.position.set(0.18, -0.16, 0.05);
    flashlight.target.position.set(0, 0, -1);
    flashlight.shadow.camera.near = 0.25;
    flashlight.shadow.camera.far = 26;
    flashlight.shadow.bias = -0.0007;
    flashlight.shadow.normalBias = 0.03;
    camera.add(flashlight);
    camera.add(flashlight.target);

    GFX.init(renderer, scene, camera);
    GFX.onQuality(preset => {
      flashlight.castShadow = preset.flashShadow > 0;
      if (preset.flashShadow && flashlight.shadow.mapSize.x !== preset.flashShadow) {
        flashlight.shadow.mapSize.set(preset.flashShadow, preset.flashShadow);
        if (flashlight.shadow.map) { flashlight.shadow.map.dispose(); flashlight.shadow.map = null; }
      }
      roomShadow.shadow.autoUpdate = preset.roomShadowLive;   // sombras vivas del asesino y del robot
      roomShadow.shadow.needsUpdate = true;
    });

    buildTextures();
    const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    for (const texture of Object.values(TEX)) texture.anisotropy = anisotropy;
    buildMaterials();
    GFX.buildEnvironment();
    GFX.loadPBR(MAT, () => { roomShadow.shadow.needsUpdate = true; });
    buildRooms();
    buildCorridors();
    buildMirrorRoom();
    buildDoors();
    buildProps();
    buildSigns();
    buildStations();
    buildNpc();
    buildHunter();
    buildParticles();
    computeBounds();
    GFX.buildFog(WORLD_BOUNDS);
    GFX.buildDust();
    syncItems();
    applyRoomAcoustics(currentRoom);

    player.x = WORLD.spawn.x; player.y = WORLD.spawn.y; player.yaw = WORLD.spawn.yaw;

    document.addEventListener('pointerlockchange', onLockChange);
    document.addEventListener('pointerlockerror', () => {
      if (!running || overlay || dragLook) return;
      // Dos fallos seguidos tras un clic real → el navegador no permite
      // capturar el ratón (p. ej. dentro de un iframe): mirar arrastrando
      if (lockFromGesture && ++lockFails >= 2) {
        dragLook = true; setPaused(false);
        UIToast('Modo alternativo: mantén pulsado el ratón para mirar', 'warn');
      } else setPaused(true);
    });
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('mousemove', onMouseMove);
    renderer.domElement.addEventListener('mousedown', () => {
      if (!running || overlay) return;
      if (dragLook) dragging = true; else if (!locked) requestLock(true);
    });
    document.addEventListener('mouseup', () => { dragging = false; });
    document.getElementById('pause').addEventListener('click', () => { SFX.resume(); requestLock(true); });
    window.addEventListener('resize', onResize);
    window.addEventListener('blur', () => Object.keys(keys).forEach(k => { keys[k] = false; }));
    onResize();
    GFX.applyQuality();
    built = true;
  }

  function start() {
    running = true;
    lastT = performance.now();
    raf = requestAnimationFrame(frame);
    requestLock(true);
    lockWatchdog();
  }

  // Si tras pedir el ratón no se obtuvo, mostrar la pausa (clic para seguir)
  function lockWatchdog() {
    setTimeout(() => {
      if (running && !locked && !overlay && !dragLook && !paused) setPaused(true);
    }, 350);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
    setPaused(false);
    if (document.pointerLockElement) document.exitPointerLock();
    UISetPrompt(null);
  }

  function openOverlay() {
    overlay = true;
    UISetPrompt(null);
    if (document.pointerLockElement) document.exitPointerLock();
  }

  function closeOverlay() {
    overlay = false;
    requestLock();
    lockWatchdog();
  }

  function tryOpenGate(id, silentIfLocked = false) {
    const d = doors[id];
    if (!d || d.open) return;
    const chk = canOpenWorldDoor(d.def);
    if (!chk.ok) {
      if (!silentIfLocked) { addLog('🔒 Puerta bloqueada: ' + chk.razon, 'err'); UIToast('🔒 ' + chk.razon, 'err'); SFX.locked(); }
      return;
    }
    setDoorOpen(d, true);
    {
      const mid = (d.def.from + d.def.until) / 2;
      makeNoise(d.def.axis === 'x' ? mid : d.def.at, d.def.axis === 'x' ? d.def.at : mid, 13);
    }
    recordEvent('Puerta abierta → ' + ROOMS[d.def.to].label, elapsed());
    addLog('La puerta hacia ' + ROOMS[d.def.to].label + ' se abre.', 'ok');
    SFX.door();
  }

  // Ruido que el asesino puede oír (puertas, objetos, alarmas)
  function makeNoise(x, y, radius) {
    if (hunter && hunter.group.visible) hunter.memory.noise(x, y, radius);
  }

  return {
    // ── IA y efectos (director.js / game.js) ──
    makeNoise(radius) { makeNoise(player.x, player.y, radius); },
    setHunterAggression(a) { hunterAggression = Math.max(0.75, Math.min(1.25, a)); },
    npcReact(name, friendly = true) { if (npc && npc.play) npc.play(name); SFX.talk(friendly); },
    hit() { hitT = 1; },
    hunterInfo() {
      if (!hunter || !hunter.group.visible) return { present: false, state: 'ausente', distance: Infinity, catches: 0 };
      return {
        present: true, state: hunter.state, catches: hunter.catches,
        distance: Math.hypot(player.x - hunter.x, player.y - hunter.y), aggression: hunterAggression
      };
    },
    init, start, stop, openOverlay, closeOverlay, syncItems, tryOpenGate, toggleMap,
    isFlashOn: () => flashOn,
    onPuzzleSolved(pid) { if (stationFx[pid]) stationFx[pid](); syncItems(); },
    openWindow() { if (stationFx.VENT) stationFx.VENT(); SFX.wind(); },
    openExit() { if (stationFx.EXIT) stationFx.EXIT(); SFX.door(); },
    setGas(pct, state) { gasPct = pct; gasState = state; SFX.setGas(pct); },
    gasHit() { gasFlashT = 1; hitT = 0.8; },
    setNpcMood(m) {
      npcMood = m;
      if (!npc) return;
      const c = m === 'COOPERAR' ? 0x00e87a : 0xff8a3c;
      npc.eyeMat.color.set(c); npc.ringMat.color.set(c); npc.glow.color.set(c);
    },
    getRoom: () => currentRoom,
    // Gancho de pruebas (consola): World3D.debug.tp(x, y, yaw)
    debug: {
      tp(x, y, yaw = player.yaw, pitch = 0) { player.x = x; player.y = y; player.yaw = yaw; player.pitch = pitch; },
      free() { dragLook = true; setPaused(false); },
      target: () => (target ? target.label() : null),
      interact,
      player,
      hunter: () => hunter,
      tick(n = 1) { for (let i = 0; i < n; i++) step(1 / 60); },
      info: () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles, programs: renderer.info.programs.length })
    }
  };
})();
