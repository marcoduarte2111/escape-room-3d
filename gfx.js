// ══════════════════════════════════════════════════════════════
//  gfx.js — Calidad visual del mundo 3D
//
//  · Postprocesado: bloom, aberración cromática, viñeta, grano de
//    película, distorsión por gas y antialias FXAA.
//  · Materiales PBR reales (color + normales + rugosidad/metal) que
//    sustituyen a las texturas procedurales cuando hay servidor.
//  · Reflejos de entorno, niebla tóxica a ras de suelo y polvo en el
//    haz de la linterna.
//
//  Calidad: 'baja' | 'media' | 'alta'  (tecla G, se recuerda).
// ══════════════════════════════════════════════════════════════

const GFX = (() => {
  'use strict';

  const LEVELS = ['baja', 'media', 'alta'];
  const BLOOM = 0.42;
  const PRESET = {
    baja:  { post: false, fxaa: false, pixelRatio: 1,    flashShadow: 0,    roomShadowLive: false, dust: 0,   fog: 1 },
    media: { post: true,  fxaa: false, pixelRatio: 1.25, flashShadow: 512,  roomShadowLive: true,  dust: 300, fog: 2 },
    alta:  { post: true,  fxaa: true,  pixelRatio: 1.5,  flashShadow: 1024, roomShadowLive: true,  dust: 600, fog: 3 }
  };

  let renderer, scene, camera;
  let composer = null, bloomPass = null, finalPass = null, fxaaPass = null;
  let quality = 'media';
  let width = 1, height = 1;
  let fogLayers = [], fogMaterial = null, dust = null;
  const listeners = [];
  const canPost = () => !!(THREE.EffectComposer && THREE.RenderPass && THREE.ShaderPass && THREE.UnrealBloomPass);

  try {
    const saved = localStorage.getItem('escape3d.quality');
    if (LEVELS.includes(saved)) quality = saved;
  } catch (e) { /* almacenamiento no disponible */ }

  // ── Pase final: gradación de color + lente ──────────────────
  const FinalShader = {
    uniforms: {
      tDiffuse: { value: null }, time: { value: 0 }, gas: { value: 0 }, hit: { value: 0 },
      fear: { value: 0 }, grain: { value: 0.055 }, vignette: { value: 0.85 }
    },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform float time, gas, hit, fear, grain, vignette;
      varying vec2 vUv;
      void main() {
        vec2 c = vUv - 0.5;
        float r2 = dot(c, c);
        // El gas marea: la imagen ondula
        vec2 uv = vUv + gas * gas * 0.006 * vec2(sin(vUv.y * 17.0 + time * 1.7), cos(vUv.x * 13.0 + time * 1.3));
        // Aberración cromática: leve siempre, fuerte con gas o al recibir daño
        float ca = (0.0010 + gas * 0.007 + hit * 0.016 + fear * 0.004) * (0.35 + r2 * 3.2);
        vec3 col = vec3(texture2D(tDiffuse, uv + c * ca).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - c * ca).b);
        // Gradación: sombras frías, tinte tóxico con el gas, rojo si te persiguen
        float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(vec3(l), col, 1.10 - fear * 0.25);
        col *= mix(vec3(0.96, 1.0, 1.05), vec3(1.0), smoothstep(0.0, 0.35, l));
        col = mix(col, col * vec3(0.80, 1.10, 0.74), gas * 0.6);
        col = mix(col, col * vec3(1.18, 0.86, 0.84), fear * 0.45);
        // Viñeta (se cierra con el gas y el miedo)
        col *= 1.0 - vignette * smoothstep(0.10, 0.60, r2) * (1.0 + gas * 0.5 + fear * 0.5);
        // Lineal → sRGB
        col = pow(max(col, 0.0), vec3(1.0 / 2.2));
        // Grano de película
        float n = fract(sin(dot(gl_FragCoord.xy + mod(time, 10.0) * 61.7, vec2(12.9898, 78.233))) * 43758.5453);
        col += (n - 0.5) * grain * (1.0 + gas);
        gl_FragColor = vec4(col, 1.0);
      }`
  };

  function buildComposer() {
    if (!canPost()) return;
    const float = renderer.capabilities.isWebGL2;
    const target = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat,
      type: float ? THREE.HalfFloatType : THREE.UnsignedByteType     // sin bandas en la penumbra
    });
    composer = new THREE.EffectComposer(renderer, target);
    composer.addPass(new THREE.RenderPass(scene, camera));
    bloomPass = new THREE.UnrealBloomPass(new THREE.Vector2(width, height), BLOOM, 0.5, 0.86);
    composer.addPass(bloomPass);
    finalPass = new THREE.ShaderPass(FinalShader);
    composer.addPass(finalPass);
    if (THREE.FXAAShader) {
      fxaaPass = new THREE.ShaderPass(THREE.FXAAShader);
      composer.addPass(fxaaPass);
    }
  }

  function applyQuality() {
    const p = PRESET[quality];
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, p.pixelRatio));
    // Sin postprocesado el renderer convierte a sRGB; con él lo hace el pase final
    renderer.outputEncoding = p.post && composer ? THREE.LinearEncoding : THREE.sRGBEncoding;
    if (fxaaPass) fxaaPass.enabled = p.fxaa;
    if (dust) dust.geometry.setDrawRange(0, p.dust);
    fogLayers.forEach((layer, i) => { layer.visible = i < p.fog; });
    // Los materiales compilan la codificación de salida: hay que recompilarlos
    scene.traverse(o => {
      const m = o.material;
      if (!m) return;
      (Array.isArray(m) ? m : [m]).forEach(x => { x.needsUpdate = true; });
    });
    setSize(width, height);
    listeners.forEach(fn => fn(p, quality));
  }

  function init(r, s, c) {
    renderer = r; scene = s; camera = c;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    buildComposer();
    if (!composer && quality !== 'baja') quality = 'baja';
  }

  function setSize(w, h) {
    width = Math.max(1, w); height = Math.max(1, h);
    renderer.setSize(width, height, false);
    if (!composer) return;
    const pr = renderer.getPixelRatio();
    composer.setPixelRatio(pr);
    composer.setSize(width, height);
    if (fxaaPass) fxaaPass.material.uniforms.resolution.value.set(1 / (width * pr), 1 / (height * pr));
  }

  // state: { time, gas (0..1), hit (0..1), fear (0..1) }
  function render(dt, state) {
    if (fogMaterial) {
      fogMaterial.uniforms.time.value = state.time;
      fogMaterial.uniforms.gas.value = state.gas;
    }
    if (dust) {
      const u = dust.material.uniforms;
      u.time.value = state.time;
      u.eye.value.copy(camera.position);
      camera.getWorldDirection(u.forward.value);
      u.beam.value += ((state.flash ? 1 : 0) - u.beam.value) * Math.min(1, dt * 8);
      u.gas.value = state.gas;
    }
    if (PRESET[quality].post && composer) {
      const u = finalPass.uniforms;
      u.time.value = state.time; u.gas.value = state.gas; u.hit.value = state.hit; u.fear.value = state.fear;
      bloomPass.strength = BLOOM + state.gas * 0.4;
      composer.render(dt);
    } else {
      renderer.render(scene, camera);
    }
  }

  function setQuality(q) {
    if (!LEVELS.includes(q)) return quality;
    if (q !== 'baja' && !composer) q = 'baja';
    quality = q;
    try { localStorage.setItem('escape3d.quality', q); } catch (e) { /* sin almacenamiento */ }
    if (renderer) applyQuality();
    return quality;
  }

  // ── Reflejos de entorno (para metales y suelos pulidos) ─────
  function buildEnvironment() {
    const env = new THREE.Scene();
    const room = new THREE.Mesh(new THREE.BoxGeometry(12, 6, 12),
      new THREE.MeshBasicMaterial({ color: 0x0b0d10, side: THREE.BackSide }));
    env.add(room);
    const panel = (color, x, y, z, w, h, ry) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
      m.position.set(x, y, z); m.rotation.y = ry; env.add(m);
    };
    panel(0xfff0d0, 0, 2.9, 0, 5, 1.2, 0);                 // lámparas de techo
    env.children[env.children.length - 1].rotation.x = Math.PI / 2;
    panel(0x3a5f7a, -5.9, 0.5, 0, 6, 2.5, Math.PI / 2);    // rebote frío
    panel(0x7a4a2a, 5.9, 0.2, 0, 6, 2, Math.PI / 2);       // rebote cálido
    panel(0x20262c, 0, -2.9, 0, 12, 12, 0);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const savedTone = renderer.toneMapping;
    renderer.toneMapping = THREE.NoToneMapping;
    scene.environment = pmrem.fromScene(env, 0.05).texture;
    renderer.toneMapping = savedTone;
    pmrem.dispose();
  }

  // ── Materiales PBR reales ───────────────────────────────────
  //  slots: material → [juego de texturas, repeticiones, color, intensidad de reflejo]
  const PBR_SLOTS = {
    concreteWall:  ['concreteWall', 1.0, 0xdcd8d0, 0.25],
    concreteFloor: ['concreteFloor', 1.0, 0xbdb9b0, 0.35],
    ceiling:       ['concreteFloor', 1.0, 0x6d6b66, 0.15],
    labFloor:      ['labFloor', 1.0, 0xe6ecee, 0.6],
    labWall:       ['labWall', 1.0, 0xc9d6da, 0.3],
    stoneWall:     ['stoneWall', 1.6, 0x8f8f92, 0.2],
    stoneFloor:    ['stoneFloor', 1.0, 0x8c8a88, 0.25],
    stoneCeil:     ['stoneWall', 1.6, 0x4a4a4e, 0.1],
    woodFloor:     ['woodFloor', 1.0, 0xc9a886, 0.4],
    wallpaper:     ['wallpaper', 1.0, 0x9aa68c, 0.15],
    metalWall:     ['metalWall', 1.0, 0x9aa3ad, 0.7],
    metalFloor:    ['metalFloor', 1.0, 0xa8b0b8, 0.8],
    metalCeil:     ['metalWall', 1.0, 0x5a6068, 0.5],
    rust:          ['rust', 0.6, 0xffffff, 0.5]
  };

  function loadPBR(MAT, onDone) {
    if (!location.protocol.startsWith('http')) return false;    // file:// no puede cargar imágenes en WebGL
    const loader = new THREE.TextureLoader();
    const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const cache = {};
    const load = (set, kind) => new Promise(resolve => {
      const key = set + '_' + kind;
      if (cache[key]) return resolve(cache[key]);
      loader.load(`assets/textures/${key}.jpg`, tex => {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = aniso;
        if (kind === 'diff') tex.encoding = THREE.sRGBEncoding;
        cache[key] = tex;
        resolve(tex);
      }, undefined, () => resolve(null));
    });
    const jobs = Object.entries(PBR_SLOTS).map(async ([name, [set, repeat, color, envIntensity]]) => {
      const mat = MAT[name];
      if (!mat || !mat.isMeshStandardMaterial) return;
      const [diff, nor, arm] = await Promise.all([load(set, 'diff'), load(set, 'nor'), load(set, 'arm')]);
      if (!diff || !nor || !arm) return;
      const own = t => { const c = t.clone(); c.repeat.set(repeat, repeat); c.needsUpdate = true; return c; };
      mat.map = own(diff);
      mat.normalMap = own(nor);
      mat.roughnessMap = mat.metalnessMap = own(arm);   // ARM: G = rugosidad, B = metal
      mat.bumpMap = null;
      mat.roughness = 1; mat.metalness = 1;
      mat.color.setHex(color);
      mat.envMapIntensity = envIntensity;
      mat.needsUpdate = true;
    });
    Promise.all(jobs).then(() => onDone && onDone());
    return true;
  }

  // ── Niebla tóxica a ras de suelo ────────────────────────────
  function buildFog(bounds) {
    fogMaterial = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { time: { value: 0 }, gas: { value: 0 }, layer: { value: 0 } },
      vertexShader: `
        varying vec3 world;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          world = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: `
        uniform float time, gas, layer;
        varying vec3 world;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
        }
        float fbm(vec2 p) {
          float v = 0.0, a = 0.5;
          for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 7.1; a *= 0.5; }
          return v;
        }
        void main() {
          vec2 p = world.xz * 0.42 + vec2(time * 0.035, -time * 0.022) * (1.0 + layer * 0.6) + layer * 13.7;
          float n = fbm(p + fbm(p * 1.7 - time * 0.03));
          float density = smoothstep(0.38 - gas * 0.22, 0.85, n);
          // Se desvanece cerca de la cámara para que no "corte" la vista
          float near = smoothstep(0.6, 2.4, distance(world, cameraPosition));
          float alpha = density * near * (0.05 + gas * 0.6) / (1.0 + layer * 0.5);
          vec3 color = mix(vec3(0.030, 0.036, 0.042), vec3(0.09, 0.19, 0.05), min(1.0, gas * 1.3));
          gl_FragColor = vec4(color, alpha);
        }`
    });
    const w = bounds.x1 - bounds.x0 + 4, d = bounds.y1 - bounds.y0 + 4;
    [0.16, 0.42, 0.74].forEach((y, i) => {
      const mat = i ? fogMaterial.clone() : fogMaterial;
      mat.uniforms.layer.value = i;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set((bounds.x0 + bounds.x1) / 2, y, -(bounds.y0 + bounds.y1) / 2);
      mesh.renderOrder = 5 + i;
      mesh.onBeforeRender = () => {       // los clones comparten reloj y gas
        mat.uniforms.time.value = fogMaterial.uniforms.time.value;
        mat.uniforms.gas.value = fogMaterial.uniforms.gas.value;
      };
      scene.add(mesh);
      fogLayers.push(mesh);
    });
  }

  // ── Polvo en suspensión (brilla dentro del haz de la linterna) ──
  function buildDust() {
    const N = 600, SIZE = 9;
    const pos = new Float32Array(N * 3), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = Math.random() * SIZE; pos[i * 3 + 1] = Math.random() * 3; pos[i * 3 + 2] = Math.random() * SIZE;
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {
        time: { value: 0 }, eye: { value: new THREE.Vector3() }, forward: { value: new THREE.Vector3(0, 0, -1) },
        beam: { value: 0 }, gas: { value: 0 }, size: { value: SIZE }
      },
      vertexShader: `
        attribute float seed;
        uniform float time, beam, size, gas;
        uniform vec3 eye, forward;
        varying float glow;
        void main() {
          vec3 p = position;
          p.x += sin(time * 0.21 + seed * 40.0) * 0.35;
          p.y += time * (0.012 + seed * 0.02);
          p.z += cos(time * 0.17 + seed * 31.0) * 0.35;
          // Caja que acompaña a la cámara (envoltura toroidal)
          vec3 box = vec3(size, 3.0, size);
          vec3 origin = vec3(eye.x - size * 0.5, 0.05, eye.z - size * 0.5);
          p = mod(p - origin, box) + origin;
          vec3 to = p - eye;
          float dist = length(to);
          float cone = smoothstep(0.86, 0.985, dot(to / max(dist, 0.001), forward));
          glow = (0.03 + gas * 0.08 + beam * cone * 0.85) * smoothstep(0.25, 0.9, dist) * (1.0 - smoothstep(3.5, 4.5, dist));
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (1.0 + seed * 1.6) * (7.0 / max(0.5, -mv.z));
        }`,
      fragmentShader: `
        varying float glow;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d) * glow;
          gl_FragColor = vec4(vec3(1.0, 0.95, 0.82) * a, a);
        }`
    });
    dust = new THREE.Points(geo, mat);
    dust.frustumCulled = false;
    dust.renderOrder = 9;
    scene.add(dust);
  }

  return {
    init, setSize, render, setQuality, applyQuality, buildEnvironment, loadPBR, buildFog, buildDust,
    LEVELS,
    get quality() { return quality; },
    preset: () => PRESET[quality],
    onQuality(fn) { listeners.push(fn); },
    nextQuality() { return setQuality(LEVELS[(LEVELS.indexOf(quality) + 1) % LEVELS.length]); },
    lowerQuality() { const i = LEVELS.indexOf(quality); return i > 0 ? setQuality(LEVELS[i - 1]) : null; }
  };
})();
