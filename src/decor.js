// Environment builder: textured floors and walls plus thousands of detail
// pieces (plinths, cornices, pilasters, banners, shelves, chains, cobwebs,
// moss, vines, lava cracks, crystals, furniture, statues...) merged into a few
// chunked meshes per material. Also animated fire, glow sprites, drifting
// ambient particles and light shafts.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G } from './rig.js';
import { brickTextures, flagstoneTextures, woodTextures, rugTexture, glowTexture, cobwebTexture, grimeTexture } from './textures.js';
import { makeRng } from './utils.js';
import { T, WALL_H, BLOCK_H, TILE } from './tiles.js';

const CHUNK = T * 12;
const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

// ------------------------------------------------------------------ batching
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _l = new THREE.Matrix4();
const _w = new THREE.Matrix4();
const _c = new THREE.Color();

class Batch {
  constructor() {
    this.lists = new Map();
  }
  add(geo, key, matrix, color, wx, wz) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    const n = g.attributes.position.count;
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    g.applyMatrix4(matrix);
    _c.set(color ?? 0xffffff);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = _c.r;
      col[i * 3 + 1] = _c.g;
      col[i * 3 + 2] = _c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const ck = `${key}|${Math.floor(wx / CHUNK)},${Math.floor(wz / CHUNK)}`;
    let list = this.lists.get(ck);
    if (!list) this.lists.set(ck, (list = []));
    list.push(g);
  }
  build(mats, parent, casters) {
    for (const [ck, list] of this.lists) {
      const key = ck.split('|')[0];
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mats[key]);
      mesh.receiveShadow = true;
      mesh.castShadow = casters.has(key);
      mesh.userData.ownGeo = true;
      mesh.userData.caster = mesh.castShadow;
      parent.add(mesh);
    }
    this.lists.clear();
  }
}

// A placement frame: world origin (x, y, z) rotated by `ang` around Y.
function frame(x, y, z, ang) {
  return { m: new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ang, 0)), new THREE.Vector3(1, 1, 1)), x, z };
}
function put(b, F, geo, key, p = [0, 0, 0], r = null, s = 1, color) {
  _p.set(p[0], p[1], p[2]);
  _e.set(r ? r[0] : 0, r ? r[1] : 0, r ? r[2] : 0);
  _q.setFromEuler(_e);
  if (typeof s === 'number') _s.set(s, s, s);
  else _s.set(s[0], s[1], s[2]);
  _l.compose(_p, _q, _s);
  _w.multiplyMatrices(F.m, _l);
  b.add(geo, key, _w, color, F.x, F.z);
}

// ---------------------------------------------------------- world shading
// Patch a standard material so its textures map by world position (no visible
// per-tile repetition), large-scale grime breaks up the pattern, and a baked
// ambient-occlusion map darkens floors near walls and the bases of walls.
function worldify(material, env, o = {}) {
  const scale = o.scale ?? 0.5;
  material.onBeforeCompile = (sh) => {
    sh.uniforms.uAO = { value: env.aoTex };
    sh.uniforms.uAOSize = { value: env.aoSize };
    sh.uniforms.uGrime = { value: env.grime };
    sh.uniforms.uTint = { value: env.grimeTint };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWN;')
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
        #ifdef USE_INSTANCING
          mat4 wm = modelMatrix * instanceMatrix;
        #else
          mat4 wm = modelMatrix;
        #endif
        vec4 wp4 = wm * vec4(position, 1.0);
        vWPos = wp4.xyz;
        vWN = normalize(mat3(wm) * normal);
        vec2 wuv = abs(vWN.y) > 0.5 ? wp4.xz : (abs(vWN.x) > 0.5 ? vec2(wp4.z, wp4.y) : vec2(wp4.x, wp4.y));
        wuv *= ${scale.toFixed(3)};
        #ifdef USE_MAP
          vMapUv = wuv;
        #endif
        #ifdef USE_NORMALMAP
          vNormalMapUv = wuv;
        #endif
        #ifdef USE_ROUGHNESSMAP
          vRoughnessMapUv = wuv;
        #endif`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWN;\nuniform sampler2D uAO;\nuniform vec2 uAOSize;\nuniform sampler2D uGrime;\nuniform vec3 uTint;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float gA = texture2D(uGrime, vWPos.xz * 0.035 + vWPos.y * 0.015).r;
        float gB = texture2D(uGrime, vWPos.xz * 0.11 + vec2(vWPos.y * 0.08, 0.3)).r;
        diffuseColor.rgb *= mix(0.72, 1.12, gA) * mix(0.9, 1.05, gB);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * uTint, smoothstep(0.55, 0.85, gA) * (1.0 - smoothstep(0.3, 2.5, vWPos.y)));
        // occlusion sampled just in front of the surface
        vec2 aoP = (vWPos.xz + vWN.xz * 0.6) / uAOSize;
        float ao = texture2D(uAO, aoP).r;
        float low = 1.0 - smoothstep(0.0, 2.2, vWPos.y);
        diffuseColor.rgb *= mix(1.0, mix(0.38, 1.0, ao), max(low, step(0.9, vWN.y)));
        // soot toward the top of walls
        diffuseColor.rgb *= 1.0 - smoothstep(2.6, 4.2, vWPos.y) * 0.3 * (1.0 - abs(vWN.y));`,
      );
  };
  material.customProgramCacheKey = () => 'world' + scale;
  return material;
}

// Blurred occupancy map of the level: 1 = open floor, 0 = wall.
function bakeAO(dg) {
  const R = 4;
  const W = dg.w * R;
  const H = dg.h * R;
  let a = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const t = dg.get(Math.floor(x / R), Math.floor(y / R));
      a[y * W + x] = t === TILE.WALL || t === TILE.PILLAR ? 0 : t === TILE.PROP ? 0.35 : 1;
    }
  const blur = (src, rad) => {
    const tmp = new Float32Array(W * H);
    const out = new Float32Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let s = 0;
        let n = 0;
        for (let k = -rad; k <= rad; k++) {
          const xx = x + k;
          if (xx < 0 || xx >= W) continue;
          s += src[y * W + xx];
          n++;
        }
        tmp[y * W + x] = s / n;
      }
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let s = 0;
        let n = 0;
        for (let k = -rad; k <= rad; k++) {
          const yy = y + k;
          if (yy < 0 || yy >= H) continue;
          s += tmp[yy * W + x];
          n++;
        }
        out[y * W + x] = s / n;
      }
    return out;
  };
  a = blur(blur(a, 3), 2);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    const v = Math.min(1, a[i] * 1.25) * 255;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.flipY = false;
  return tex;
}

// ----------------------------------------------------------------- materials
function makeMaterials(theme) {
  const bt = brickTextures();
  const ft = flagstoneTextures();
  const wt = woodTextures();
  const std = (o) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, ...o });
  const accent = new THREE.Color(theme.accent);
  return {
    stone: std({ map: ft.map, normalMap: ft.normalMap, roughnessMap: ft.roughnessMap }),
    brick: std({ map: bt.map, normalMap: bt.normalMap, roughnessMap: bt.roughnessMap }),
    wood: std({ map: wt.map, normalMap: wt.normalMap, roughness: 0.8 }),
    metal: std({ color: 0x8a8e98, metalness: 0.75, roughness: 0.38 }),
    gold: std({ color: 0xe0b84e, metalness: 0.85, roughness: 0.28 }),
    cloth: std({ roughness: 0.95, side: THREE.DoubleSide }),
    plain: std({ roughness: 0.8 }),
    bone: std({ color: 0xe8dfc8, roughness: 0.7 }),
    wax: std({ color: 0xf0e6cc, roughness: 0.55, emissive: 0x2a1c08 }),
    moss: std({ color: 0x5a8a32, roughness: 1 }),
    dark: std({ color: 0x151518, roughness: 0.9 }),
    water: std({ color: 0x3a4a58, roughness: 0.12, metalness: 0, transparent: true, opacity: 0.45, depthWrite: false, envMapIntensity: 0.25 }),
    crystal: std({ color: accent, emissive: accent, emissiveIntensity: 0.9, roughness: 0.15, flatShading: true }),
    lava: std({ color: 0xff6a1a, emissive: 0xff4a10, emissiveIntensity: 2.2, roughness: 0.6 }),
    fungus: std({ color: 0x5affd8, emissive: 0x2affc0, emissiveIntensity: 1.2, roughness: 0.5 }),
    coal: std({ color: 0x2a1a14, emissive: 0xff3a00, emissiveIntensity: 0.8, roughness: 1 }),
    web: new THREE.MeshBasicMaterial({ map: cobwebTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0.75 }),
    rune: new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, vertexColors: true }),
    shaft: new THREE.MeshBasicMaterial({ color: accent.clone().lerp(new THREE.Color(0xffffff), 0.6), transparent: true, opacity: 0.011, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  };
}

// ------------------------------------------------------------------- shaders
// Flickering flames: merged cones with per-vertex seed/size/colour.
function fireMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float seed;
      attribute float size;
      attribute vec3 tint;
      attribute vec3 base;
      uniform float uTime;
      varying float vH;
      varying vec3 vTint;
      void main() {
        vH = uv.y;
        vTint = tint;
        vec3 p = position - base;
        float h = uv.y;
        float flick = 1.0 + 0.28 * sin(uTime * 13.0 + seed * 7.0) + 0.12 * sin(uTime * 23.0 + seed * 3.0);
        p.y *= flick;
        p.x += sin(uTime * 7.0 + seed * 5.0 + h * 3.0) * 0.12 * size * h * h;
        p.z += cos(uTime * 6.0 + seed * 3.0 + h * 2.0) * 0.12 * size * h * h;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(base + p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying float vH;
      varying vec3 vTint;
      void main() {
        vec3 core = vec3(1.0, 0.95, 0.75);
        vec3 col = mix(core, vTint, smoothstep(0.0, 0.55, vH));
        col = mix(col, vTint * 0.6, smoothstep(0.55, 1.0, vH));
        float a = (1.0 - vH) * 0.95;
        gl_FragColor = vec4(col * 1.6, a);
      }`,
  });
}

// Soft glow billboards with flicker.
function glowMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uMap: { value: glowTexture() }, uScale: { value: 400 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float size;
      attribute float seed;
      attribute vec3 tint;
      uniform float uTime;
      uniform float uScale;
      varying vec3 vTint;
      varying float vA;
      void main() {
        vTint = tint;
        vA = 0.8 + 0.2 * sin(uTime * 9.0 + seed * 11.0);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * uScale / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      varying vec3 vTint;
      varying float vA;
      void main() {
        float a = texture2D(uMap, gl_PointCoord).a;
        gl_FragColor = vec4(vTint * a * vA * 0.55, 1.0);
      }`,
  });
}

// Ambient motes that wrap around the camera so they always surround the player.
function moteMaterial(color, rising) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uMap: { value: glowTexture() }, uColor: { value: new THREE.Color(color) }, uScale: { value: 400 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float seed;
      uniform float uTime;
      uniform vec3 uCenter;
      uniform float uScale;
      varying float vA;
      const vec3 BOX = vec3(28.0, 7.0, 28.0);
      void main() {
        vec3 p = position * BOX;
        p.x += sin(uTime * 0.3 + seed * 6.0) * 1.5;
        p.z += cos(uTime * 0.25 + seed * 4.0) * 1.5;
        p.y += ${rising ? 'uTime * (0.5 + seed * 0.6)' : 'sin(uTime * 0.2 + seed * 5.0) * 0.8'};
        vec3 w = uCenter + mod(p - uCenter, BOX) - BOX * 0.5;
        w.y = mod(p.y, BOX.y) + 0.2;
        vA = (0.5 + 0.5 * sin(uTime * 2.0 + seed * 20.0)) * smoothstep(0.0, 1.0, w.y) * (1.0 - smoothstep(5.0, 7.0, w.y));
        vec4 mv = modelViewMatrix * vec4(w, 1.0);
        gl_PointSize = (0.06 + seed * 0.08) * uScale / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 uColor;
      varying float vA;
      void main() {
        float a = texture2D(uMap, gl_PointCoord).a * vA;
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
  });
}

// ---------------------------------------------------------- shape helpers
const BARREL = [[0.001, 0], [0.3, 0], [0.36, 0.18], [0.39, 0.45], [0.36, 0.72], [0.3, 0.9], [0.001, 0.9]];
const URN = [[0.001, 0], [0.16, 0], [0.26, 0.15], [0.3, 0.32], [0.24, 0.52], [0.13, 0.62], [0.12, 0.7], [0.17, 0.74], [0.001, 0.74]];
const BOWL = [[0.001, 0], [0.18, 0], [0.42, 0.12], [0.55, 0.3], [0.5, 0.32], [0.3, 0.2], [0.001, 0.18]];

function skull(b, F, p, rot = 0, s = 1, color) {
  put(b, F, G.sphere(0.11, 10, 8), 'bone', [p[0], p[1] + 0.1 * s, p[2]], [0, rot, 0], [s, 0.92 * s, 1.1 * s], color);
  put(b, F, G.box(0.14, 0.06, 0.12), 'bone', [p[0], p[1] + 0.03 * s, p[2]], [0, rot, 0], s, color);
  for (const e of [-1, 1]) put(b, F, G.sphere(0.03, 6, 4), 'dark', [p[0] + Math.cos(rot) * 0.045 * e * s + Math.sin(rot) * 0.09 * s, p[1] + 0.11 * s, p[2] - Math.sin(rot) * 0.045 * e * s + Math.cos(rot) * 0.09 * s]);
}

function candle(b, fires, F, lx, y, lz, h = 0.22, tint = 0xff9a3a) {
  put(b, F, G.cyl(0.035, 0.042, h, 8), 'wax', [lx, y + h / 2, lz]);
  put(b, F, G.cyl(0.05, 0.06, 0.04, 8), 'wax', [lx, y + 0.02, lz]);
  const w = new THREE.Vector3(lx, y + h, lz).applyMatrix4(F.m);
  fires.push({ x: w.x, y: w.y, z: w.z, size: 0.12, tint, glow: 0.9 });
}

// ------------------------------------------------------------ wall details
const WALL_DETAILS = {
  crypt: { banner: 3, niche: 4, shelf: 2, chains: 2, cracks: 3, moss: 1, web: 0 },
  moss: { vines: 5, moss: 4, cracks: 2, mushrooms: 3, banner: 1, chains: 1 },
  ember: { chains: 4, weapons: 3, lava: 4, banner: 2, cracks: 2, shelf: 1 },
  void: { crystals: 5, banner: 3, shelf: 2, runes: 3, cracks: 1 },
};

function pickWeighted(r, table) {
  let total = 0;
  for (const k in table) total += table[k];
  let x = r.next() * total;
  for (const k in table) {
    x -= table[k];
    if (x <= 0) return k;
  }
  return Object.keys(table)[0];
}

function wallDetail(kind, b, fires, F, r, theme, glows) {
  const accent = theme.accent;
  switch (kind) {
    case 'banner': {
      put(b, F, G.cyl(0.03, 0.03, 1.0, 6), 'metal', [0, 3.2, 0.12], [0, 0, Math.PI / 2]);
      for (const s of [-1, 1]) put(b, F, G.sphere(0.05, 6, 4), 'gold', [s * 0.52, 3.2, 0.12]);
      put(b, F, new THREE.PlaneGeometry(0.8, 1.7, 1, 6), 'cloth', [0, 2.33, 0.1], null, 1, theme.banner);
      put(b, F, G.cone(0.4, 0.3, 4), 'cloth', [0, 1.35, 0.1], [Math.PI, Math.PI / 4, 0], [1.4, 1, 0.02], theme.banner);
      put(b, F, G.box(0.66, 0.04, 0.01), 'gold', [0, 3.05, 0.115]);
      put(b, F, G.box(0.66, 0.04, 0.01), 'gold', [0, 1.52, 0.115]);
      put(b, F, G.octa(0.16), 'gold', [0, 2.45, 0.12], null, [1, 1.3, 0.1]);
      put(b, F, G.box(0.03, 0.5, 0.012), 'gold', [0, 2.45, 0.12]);
      break;
    }
    case 'niche': {
      put(b, F, G.box(1.1, 0.75, 0.1), 'dark', [0, 1.35, 0.02]);
      put(b, F, G.box(1.3, 0.1, 0.3), 'stone', [0, 0.95, 0.12], null, 1, 0xb0b0b8);
      put(b, F, G.box(1.3, 0.12, 0.2), 'stone', [0, 1.78, 0.08], null, 1, 0xb0b0b8);
      const n = 2 + r.int(0, 1);
      for (let i = 0; i < n; i++) skull(b, F, [-0.35 + i * 0.35, 1.0, 0.14], (r.next() - 0.5) * 0.6);
      candle(b, fires, F, 0.55, 1.0, 0.18, 0.18);
      break;
    }
    case 'shelf': {
      for (const y of [1.4, 2.1]) {
        put(b, F, G.box(1.4, 0.06, 0.32), 'wood', [0, y, 0.17]);
        for (const s of [-0.55, 0.55]) put(b, F, G.box(0.05, 0.22, 0.05), 'metal', [s, y - 0.12, 0.05], [0.6, 0, 0]);
        let x = -0.62;
        while (x < 0.55) {
          const kind2 = r.next();
          if (kind2 < 0.65) {
            const w = 0.05 + r.next() * 0.05;
            const h = 0.2 + r.next() * 0.14;
            const col = new THREE.Color().setHSL(r.next(), 0.45, 0.25 + r.next() * 0.2).getHex();
            put(b, F, G.box(w, h, 0.2), 'plain', [x + w / 2, y + 0.03 + h / 2, 0.17], [0, 0, x > 0.3 && r.next() < 0.3 ? 0.3 : 0], 1, col);
            x += w + 0.01;
          } else if (kind2 < 0.8) {
            put(b, F, G.lathe('jar', [[0.001, 0], [0.06, 0], [0.07, 0.1], [0.04, 0.16], [0.05, 0.18], [0.001, 0.18]], 8), 'plain', [x + 0.08, y + 0.03, 0.17], null, 1, 0x6a8a9a);
            x += 0.16;
          } else {
            candle(b, fires, F, x + 0.06, y + 0.03, 0.2, 0.14);
            x += 0.14;
          }
        }
      }
      break;
    }
    case 'chains': {
      for (const sx of [-0.4, 0.35]) {
        const len = 6 + r.int(0, 6);
        put(b, F, G.box(0.14, 0.14, 0.08), 'metal', [sx, 3.4, 0.05]);
        for (let i = 0; i < len; i++) put(b, F, G.torus(0.05, 0.014, Math.PI * 2, 4, 8), 'metal', [sx, 3.33 - i * 0.085, 0.1], [0, i % 2 ? Math.PI / 2 : 0, Math.PI / 2]);
        const endY = 3.33 - len * 0.085;
        if (r.next() < 0.6) put(b, F, G.torus(0.09, 0.022, Math.PI * 2, 5, 12), 'metal', [sx, endY - 0.06, 0.1], [0, 0, 0]);
        else put(b, F, G.cone(0.07, 0.15, 6), 'metal', [sx, endY - 0.06, 0.1], [Math.PI, 0, 0]);
      }
      break;
    }
    case 'cracks': {
      for (let k = 0; k < 3; k++) {
        let x = (r.next() - 0.5) * 1.4;
        let y = 0.6 + r.next() * 2.4;
        let a = r.next() * Math.PI;
        for (let s = 0; s < 5; s++) {
          const len = 0.12 + r.next() * 0.2;
          put(b, F, G.box(len, 0.025, 0.02), 'dark', [x, y, 0.005], [0, 0, a]);
          x += Math.cos(a) * len * 0.5;
          y += Math.sin(a) * len * 0.5;
          a += (r.next() - 0.5) * 1.2;
        }
      }
      for (let k = 0; k < 2; k++) put(b, F, G.box(0.3, 0.14, 0.06), 'dark', [(r.next() - 0.5) * 1.4, 0.8 + r.next() * 2.2, 0.0]);
      for (let k = 0; k < 3; k++) put(b, F, G.dodeca(0.08 + r.next() * 0.06), 'stone', [(r.next() - 0.5) * 1.6, 0.05, 0.25 + r.next() * 0.3], [r.next(), r.next(), 0], 1, 0x9a9aa0);
      break;
    }
    case 'moss': {
      for (let k = 0; k < 6; k++) put(b, F, G.sphere(0.2 + r.next() * 0.2, 8, 6), 'moss', [(r.next() - 0.5) * 1.8, r.next() < 0.5 ? 0.34 : r.next() * 1.2, 0.02], null, [1, 0.6 + r.next() * 0.5, 0.18], new THREE.Color(0x6a9a3a).offsetHSL(0, 0, (r.next() - 0.5) * 0.15).getHex());
      break;
    }
    case 'vines': {
      const n = 3 + r.int(0, 3);
      for (let k = 0; k < n; k++) {
        const x = (r.next() - 0.5) * 1.7;
        const len = 1.2 + r.next() * 2.0;
        put(b, F, G.cyl(0.018, 0.012, len, 4), 'moss', [x, WALL_H - 0.45 - len / 2, 0.06], [0, 0, (r.next() - 0.5) * 0.08], 1, 0x3a6a2a);
        for (let i = 0; i < len * 5; i++) put(b, F, G.sphere(0.06, 5, 4), 'moss', [x + (r.next() - 0.5) * 0.1, WALL_H - 0.5 - i * 0.2 - r.next() * 0.1, 0.07], [0, 0, r.next() * 3], [1, 0.5, 0.25], 0x5a9a3a);
      }
      break;
    }
    case 'mushrooms': {
      for (let k = 0; k < 4; k++) {
        const x = (r.next() - 0.5) * 1.5;
        const h = 0.1 + r.next() * 0.2;
        put(b, F, G.cyl(0.025, 0.035, h, 6), 'plain', [x, 0.34 + h / 2, 0.16], null, 1, 0xd8d0c0);
        put(b, F, G.hemi(0.08 + r.next() * 0.05, 8), 'fungus', [x, 0.34 + h, 0.16], null, [1, 0.6, 1]);
      }
      const w = new THREE.Vector3(0, 0.6, 0.3).applyMatrix4(F.m);
      glows.push({ x: w.x, y: w.y, z: w.z, size: 1.4, tint: 0x2affc0 });
      break;
    }
    case 'weapons': {
      put(b, F, G.cyl(0.36, 0.36, 0.05, 12), 'wood', [0, 2.4, 0.06], [Math.PI / 2, 0, 0]);
      put(b, F, G.torus(0.36, 0.03, Math.PI * 2, 4, 16), 'metal', [0, 2.4, 0.08]);
      put(b, F, G.sphere(0.08, 8, 6), 'metal', [0, 2.4, 0.1]);
      for (const s of [-1, 1]) {
        put(b, F, G.blade(1.0, 0.05, 0.22), 'metal', [s * 0.35, 1.9, 0.04], [0, 0, s * 0.7]);
        put(b, F, G.box(0.2, 0.04, 0.05), 'gold', [s * 0.35, 1.9, 0.04], [0, 0, s * 0.7]);
      }
      break;
    }
    case 'lava': {
      let x = (r.next() - 0.5) * 1.2;
      let y = 0.35;
      for (let s = 0; s < 6; s++) {
        const len = 0.2 + r.next() * 0.25;
        const a = Math.PI / 2 + (r.next() - 0.5) * 1.2;
        put(b, F, G.box(0.05, len, 0.03), 'lava', [x, y + len / 2, 0.01], [0, 0, a - Math.PI / 2]);
        x += Math.cos(a) * len;
        y += Math.sin(a) * len * 0.9;
      }
      const w = new THREE.Vector3(0, 0.9, 0.3).applyMatrix4(F.m);
      glows.push({ x: w.x, y: w.y, z: w.z, size: 1.6, tint: 0xff5a1a });
      break;
    }
    case 'crystals': {
      const n = 3 + r.int(0, 3);
      for (let k = 0; k < n; k++) {
        const h = 0.35 + r.next() * 0.7;
        put(b, F, G.octa(0.14), 'crystal', [(r.next() - 0.5) * 1.2, 0.34 + h * 0.35, 0.2], [(r.next() - 0.5) * 0.7, r.next() * 3, (r.next() - 0.5) * 0.7], [0.7, h * 3, 0.7]);
      }
      const w = new THREE.Vector3(0, 0.8, 0.4).applyMatrix4(F.m);
      glows.push({ x: w.x, y: w.y, z: w.z, size: 2.0, tint: accent });
      break;
    }
    case 'runes': {
      for (let k = 0; k < 5; k++) {
        const y = 1.2 + k * 0.35;
        put(b, F, G.box(0.08 + r.next() * 0.2, 0.04, 0.01), 'rune', [(r.next() - 0.5) * 0.4, y, 0.01]);
        put(b, F, G.box(0.04, 0.16, 0.01), 'rune', [(r.next() - 0.5) * 0.3, y, 0.01]);
      }
      put(b, F, G.torus(0.3, 0.02, Math.PI * 2, 3, 24), 'rune', [0, 2.8, 0.01]);
      break;
    }
    default:
      break;
  }
}

// ------------------------------------------------------------- solid props
function propBarrels(b, F, r) {
  const n = 1 + r.int(0, 2);
  for (let i = 0; i < n; i++) {
    const lx = (i - (n - 1) / 2) * 0.72 + (r.next() - 0.5) * 0.1;
    const lz = (r.next() - 0.5) * 0.3 - 0.2;
    const tint = new THREE.Color(0xffffff).offsetHSL(0, 0, (r.next() - 0.5) * 0.2).getHex();
    put(b, F, G.lathe('barrel', BARREL, 12), 'wood', [lx, 0, lz], [0, r.next() * 6, 0], 1, tint);
    for (const y of [0.15, 0.75]) put(b, F, G.torus(0.365, 0.02, Math.PI * 2, 4, 16), 'metal', [lx, y, lz], [Math.PI / 2, 0, 0]);
    put(b, F, G.cyl(0.3, 0.3, 0.02, 12), 'wood', [lx, 0.905, lz], null, 1, 0x8a8078);
  }
  if (r.next() < 0.5) {
    put(b, F, G.lathe('barrel', BARREL, 12), 'wood', [0.1, 0.39, 0.55], [Math.PI / 2, 0, 1.4], 1, 0xd0c8c0);
  }
}

function propCrates(b, F, r) {
  const put1 = (x, y, z, s, rot) => {
    put(b, F, G.box(s, s, s), 'wood', [x, y + s / 2, z], [0, rot, 0], 1, new THREE.Color(0xffffff).offsetHSL(0, 0, (r.next() - 0.5) * 0.2).getHex());
    for (const e of [-1, 1]) {
      put(b, F, G.box(s + 0.02, 0.06, 0.06), 'wood', [x, y + s / 2 + e * (s / 2 - 0.03), z + Math.cos(rot) * (s / 2) * 1.0], [0, rot, 0], 1, 0x806850);
    }
    put(b, F, G.box(s * 1.35, 0.06, 0.02), 'wood', [x + Math.sin(rot) * (s / 2 + 0.01), y + s / 2, z + Math.cos(rot) * (s / 2 + 0.01)], [0, rot, Math.PI / 4], 1, 0x806850);
  };
  put1(-0.35, 0, -0.1, 0.8, r.next() * 0.3);
  put1(0.45, 0, 0.05, 0.62, r.next() * 0.5);
  if (r.next() < 0.7) put1(-0.3, 0.8, -0.1, 0.55, r.next());
}

function propShelf(b, fires, F, r) {
  const z = -0.62;
  put(b, F, G.box(1.8, 2.6, 0.08), 'wood', [0, 1.3, z - 0.2], null, 1, 0x806050);
  for (const s of [-1, 1]) put(b, F, G.box(0.08, 2.6, 0.5), 'wood', [s * 0.86, 1.3, z]);
  put(b, F, G.box(1.84, 0.1, 0.56), 'wood', [0, 2.62, z]);
  for (const y of [0.1, 0.72, 1.34, 1.96]) {
    put(b, F, G.box(1.66, 0.05, 0.46), 'wood', [0, y, z]);
    let x = -0.78;
    while (x < 0.72) {
      if (r.next() < 0.15) {
        x += 0.12;
        continue;
      }
      const w = 0.05 + r.next() * 0.05;
      const h = 0.3 + r.next() * 0.2;
      const lean = x > 0.5 && r.next() < 0.4 ? -0.35 : 0;
      put(b, F, G.box(w, h, 0.32), 'plain', [x + w / 2, y + 0.03 + h / 2, z + 0.02], [0, 0, lean], 1, new THREE.Color().setHSL(r.next(), 0.5, 0.18 + r.next() * 0.2).getHex());
      x += w + 0.008;
    }
  }
  if (r.next() < 0.6) candle(b, fires, F, 0.6, 2.67, z, 0.2);
  skull(b, F, [-0.55, 2.67, z], 0.3);
}

function propTable(b, fires, F, r) {
  put(b, F, G.box(1.5, 0.08, 0.9), 'wood', [0, 0.82, 0]);
  for (const sx of [-0.65, 0.65]) for (const sz of [-0.35, 0.35]) put(b, F, G.box(0.08, 0.8, 0.08), 'wood', [sx, 0.4, sz], null, 1, 0x806050);
  put(b, F, G.box(1.3, 0.05, 0.05), 'wood', [0, 0.25, 0], null, 1, 0x806050);
  // items
  candle(b, fires, F, -0.45, 0.86, 0.2, 0.26);
  candle(b, fires, F, -0.35, 0.86, 0.28, 0.16);
  put(b, F, G.box(0.4, 0.03, 0.3), 'plain', [0.2, 0.875, 0.05], [0, 0.3, 0], 1, 0xd8ccb0); // open book
  put(b, F, G.box(0.02, 0.05, 0.3), 'plain', [0.2, 0.9, 0.05], [0, 0.3, 0], 1, 0x5a2a20);
  put(b, F, G.lathe('mug', [[0.001, 0], [0.06, 0], [0.065, 0.14], [0.001, 0.14]], 8), 'metal', [0.55, 0.86, -0.25]);
  put(b, F, G.lathe('bottle', [[0.001, 0], [0.07, 0], [0.075, 0.18], [0.03, 0.26], [0.025, 0.33], [0.001, 0.33]], 8), 'plain', [-0.1, 0.86, -0.28], null, 1, 0x2a6a4a);
  put(b, F, G.cyl(0.14, 0.12, 0.03, 12), 'metal', [0.5, 0.875, 0.2]);
  for (const sx of [-0.5, 0.5]) {
    put(b, F, G.cyl(0.2, 0.2, 0.06, 10), 'wood', [sx, 0.48, -0.85]);
    for (let k = 0; k < 3; k++) put(b, F, G.cyl(0.025, 0.025, 0.48, 5), 'wood', [sx + Math.cos(k * 2.1) * 0.13, 0.24, -0.85 + Math.sin(k * 2.1) * 0.13], null, 1, 0x806050);
  }
}

function propRack(b, F, r) {
  const z = -0.55;
  for (const s of [-1, 1]) put(b, F, G.box(0.1, 1.9, 0.1), 'wood', [s * 0.8, 0.95, z]);
  for (const y of [0.4, 1.6]) put(b, F, G.box(1.7, 0.08, 0.14), 'wood', [0, y, z]);
  for (let i = 0; i < 5; i++) {
    const x = -0.6 + i * 0.3;
    const kind = r.int(0, 2);
    if (kind === 0) {
      put(b, F, G.cyl(0.02, 0.02, 2.0, 5), 'wood', [x, 1.0, z + 0.1]);
      put(b, F, G.cone(0.05, 0.25, 4), 'metal', [x, 2.1, z + 0.1]);
    } else if (kind === 1) {
      put(b, F, G.blade(1.0, 0.05, 0.22), 'metal', [x, 0.5, z + 0.1]);
      put(b, F, G.box(0.22, 0.04, 0.05), 'gold', [x, 0.5, z + 0.1]);
      put(b, F, G.cyl(0.02, 0.02, 0.2, 5), 'plain', [x, 0.38, z + 0.1], null, 1, 0x3a2a1a);
    } else {
      put(b, F, G.cyl(0.022, 0.022, 1.6, 5), 'wood', [x, 0.8, z + 0.1]);
      put(b, F, G.box(0.28, 0.2, 0.03), 'metal', [x + 0.12, 1.5, z + 0.1]);
    }
  }
  put(b, F, G.cyl(0.35, 0.35, 0.05, 12), 'wood', [0.95, 0.4, 0.1], [0.2, 0, Math.PI / 2 - 0.2]);
}

function propStatue(b, F, r, theme) {
  const tint = new THREE.Color(0xc8c8d0).lerp(new THREE.Color(theme.wall), 0.3).getHex();
  put(b, F, G.box(1.2, 0.5, 1.2), 'stone', [0, 0.25, 0], null, 1, tint);
  put(b, F, G.box(1.0, 0.15, 1.0), 'stone', [0, 0.57, 0], null, 1, tint);
  const y0 = 0.64;
  // armored figure leaning on a greatsword
  for (const s of [-1, 1]) {
    put(b, F, G.cyl(0.1, 0.08, 0.85, 8), 'stone', [s * 0.14, y0 + 0.43, 0], null, 1, tint);
    put(b, F, G.box(0.16, 0.1, 0.26), 'stone', [s * 0.14, y0 + 0.05, 0.05], null, 1, tint);
  }
  put(b, F, G.lathe('statTorso', [[0.001, 0], [0.22, 0], [0.26, 0.3], [0.3, 0.55], [0.22, 0.68], [0.001, 0.7]], 10), 'stone', [0, y0 + 0.85, 0], null, [1, 1, 0.7], tint);
  put(b, F, G.cyl(0.26, 0.3, 0.3, 10), 'stone', [0, y0 + 0.8, 0], null, [1, 1, 0.75], tint);
  put(b, F, G.cyl(0.13, 0.12, 0.26, 10), 'stone', [0, y0 + 1.67, 0], null, 1, tint);
  put(b, F, G.hemi(0.13, 10), 'stone', [0, y0 + 1.8, 0], null, 1, tint);
  put(b, F, G.box(0.16, 0.02, 0.02), 'dark', [0, y0 + 1.7, 0.13]);
  for (const s of [-1, 1]) {
    put(b, F, G.hemi(0.14, 8), 'stone', [s * 0.3, y0 + 1.48, 0], [0, 0, -s * 0.5], 1, tint);
    put(b, F, G.cyl(0.07, 0.06, 0.55, 8), 'stone', [s * 0.3, y0 + 1.2, 0.1], [0.45, 0, 0], 1, tint);
  }
  put(b, F, G.blade(1.1, 0.07, 0.25), 'stone', [0, y0 + 0.05, 0.38], null, 1, tint);
  put(b, F, G.box(0.36, 0.06, 0.08), 'stone', [0, y0 + 1.15, 0.38], null, 1, tint);
  put(b, F, G.cyl(0.03, 0.03, 0.25, 6), 'stone', [0, y0 + 1.3, 0.38], null, 1, tint);
  if (theme.id === 'moss') for (let k = 0; k < 5; k++) put(b, F, G.sphere(0.15, 6, 5), 'moss', [(r.next() - 0.5) * 0.9, 0.5 + r.next() * 0.2, (r.next() - 0.5) * 0.9], null, [1, 0.4, 1]);
}

function propSarcophagus(b, fires, F, r, theme) {
  const tint = new THREE.Color(0xb8b8c0).lerp(new THREE.Color(theme.wall), 0.3).getHex();
  put(b, F, G.box(0.95, 0.7, 1.9), 'stone', [0, 0.35, 0], null, 1, tint);
  put(b, F, G.box(1.05, 0.1, 2.0), 'stone', [0, 0.05, 0], null, 1, tint);
  put(b, F, G.box(1.02, 0.14, 1.97), 'stone', [0, 0.77, 0], null, 1, tint);
  // carved effigy on the lid
  put(b, F, G.sphere(0.13, 10, 8), 'stone', [0, 0.92, 0.62], null, [1, 0.8, 1], tint);
  put(b, F, G.capsule(0.2, 0.9, 8), 'stone', [0, 0.9, -0.05], [Math.PI / 2, 0, 0], [1, 1, 0.5], tint);
  put(b, F, G.blade(0.9, 0.05, 0.25), 'stone', [0, 0.97, -0.4], [Math.PI / 2, 0, 0], 1, tint);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) candle(b, fires, F, sx * 0.62, 0, sz * 1.05, 0.3 + r.next() * 0.2);
}

function propAltar(b, fires, F, r, theme) {
  const tint = new THREE.Color(0xa8a8b0).lerp(new THREE.Color(theme.wall), 0.3).getHex();
  put(b, F, G.box(1.6, 0.9, 0.8), 'stone', [0, 0.45, 0], null, 1, tint);
  put(b, F, G.box(1.75, 0.1, 0.9), 'stone', [0, 0.95, 0], null, 1, tint);
  put(b, F, G.box(0.5, 0.012, 0.92), 'cloth', [0, 1.0, 0], null, 1, theme.banner);
  put(b, F, G.box(0.5, 0.6, 0.012), 'cloth', [0, 0.7, 0.456], null, 1, theme.banner);
  put(b, F, G.lathe('chalice', [[0.001, 0], [0.09, 0], [0.03, 0.03], [0.02, 0.12], [0.08, 0.2], [0.09, 0.26], [0.001, 0.2]], 10), 'gold', [0, 1.0, 0]);
  skull(b, F, [0.45, 1.0, -0.1], -0.3);
  for (const x of [-0.7, -0.55, 0.68]) candle(b, fires, F, x, 1.0, 0.15 + r.next() * 0.2, 0.15 + r.next() * 0.25, theme.id === 'void' ? 0xb080ff : 0xff9a3a);
  if (theme.id === 'void') put(b, F, G.torus(0.6, 0.02, Math.PI * 2, 3, 30), 'rune', [0, 0.02, 0.9], [Math.PI / 2, 0, 0]);
}

function propBrazier(b, fires, F, r, theme) {
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    put(b, F, G.cyl(0.035, 0.035, 1.0, 5), 'metal', [Math.cos(a) * 0.28, 0.48, Math.sin(a) * 0.28], [Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3], 1, 0x505058);
  }
  put(b, F, G.lathe('bowl', BOWL, 12), 'metal', [0, 0.9, 0], null, 1, 0x505058);
  put(b, F, G.torus(0.52, 0.03, Math.PI * 2, 4, 16), 'metal', [0, 1.21, 0], [Math.PI / 2, 0, 0], 1, 0x505058);
  for (let k = 0; k < 7; k++) put(b, F, G.dodeca(0.1), 'coal', [(r.next() - 0.5) * 0.5, 1.12, (r.next() - 0.5) * 0.5], [r.next(), r.next(), 0]);
  const w = new THREE.Vector3(0, 1.1, 0).applyMatrix4(F.m);
  const tint = theme.id === 'void' ? 0xa060ff : 0xff7a2a;
  fires.push({ x: w.x, y: w.y, z: w.z, size: 0.75, tint, glow: 3.2, light: true });
  fires.push({ x: w.x + 0.15, y: w.y, z: w.z - 0.1, size: 0.5, tint });
  fires.push({ x: w.x - 0.15, y: w.y, z: w.z + 0.1, size: 0.55, tint });
}

function propSacks(b, F, r) {
  for (let i = 0; i < 4; i++) {
    const x = (r.next() - 0.5) * 1.1;
    const z = (r.next() - 0.5) * 0.8;
    const y = i === 3 ? 0.45 : 0;
    put(b, F, G.sphere(0.34, 10, 8), 'cloth', [x, y + 0.28, z], [r.next() * 0.3, r.next() * 3, 0], [1, 0.85, 0.8], 0xb09a70);
    put(b, F, G.cyl(0.06, 0.12, 0.14, 6), 'cloth', [x, y + 0.6, z], null, 1, 0x9a8460);
  }
}

function propAnvil(b, F, r) {
  put(b, F, G.cyl(0.3, 0.36, 0.5, 8), 'wood', [0, 0.25, 0]);
  put(b, F, G.box(0.26, 0.18, 0.2), 'metal', [0, 0.59, 0], null, 1, 0x40404a);
  put(b, F, G.box(0.7, 0.16, 0.26), 'metal', [0.05, 0.75, 0], null, 1, 0x40404a);
  put(b, F, G.cone(0.13, 0.35, 4), 'metal', [0.55, 0.76, 0], [0, 0, -Math.PI / 2], [1, 1, 0.8], 0x40404a);
  put(b, F, G.cyl(0.025, 0.025, 0.4, 5), 'wood', [-0.1, 0.87, 0.05], [0, 0.4, Math.PI / 2]);
  put(b, F, G.box(0.14, 0.09, 0.09), 'metal', [0.1, 0.87, -0.03], [0, 0.4, 0], 1, 0x30303a);
  put(b, F, G.lathe('barrel', BARREL, 12), 'wood', [-0.6, 0, 0.5], null, [0.8, 0.8, 0.8]);
  put(b, F, G.cyl(0.27, 0.27, 0.02, 12), 'water', [-0.6, 0.66, 0.5], null, 1, 0x40607a);
}

function propCrystals(b, F, r, glows, theme) {
  for (let k = 0; k < 7; k++) {
    const h = 0.6 + r.next() * 1.6;
    const x = (r.next() - 0.5) * 1.1;
    const z = (r.next() - 0.5) * 1.1;
    put(b, F, G.octa(0.2), 'crystal', [x, h * 0.4, z], [(r.next() - 0.5) * 0.6, r.next() * 3, (r.next() - 0.5) * 0.6], [0.8, h * 2.6, 0.8]);
  }
  for (let k = 0; k < 5; k++) put(b, F, G.dodeca(0.2), 'stone', [(r.next() - 0.5) * 1.3, 0.08, (r.next() - 0.5) * 1.3], [r.next(), r.next(), 0], 1, 0x8a8aa0);
  const w = new THREE.Vector3(0, 1.2, 0).applyMatrix4(F.m);
  glows.push({ x: w.x, y: w.y, z: w.z, size: 4.5, tint: theme.accent, light: true });
}

function propMushrooms(b, F, r, glows) {
  for (let k = 0; k < 4; k++) {
    const x = (r.next() - 0.5) * 1.1;
    const z = (r.next() - 0.5) * 1.1;
    const h = 0.4 + r.next() * 1.1;
    put(b, F, G.cyl(0.06 + h * 0.04, 0.09 + h * 0.05, h, 8), 'plain', [x, h / 2, z], [(r.next() - 0.5) * 0.3, 0, (r.next() - 0.5) * 0.3], 1, 0xd8d0c0);
    put(b, F, G.hemi(0.2 + h * 0.18, 12), 'fungus', [x, h, z], null, [1, 0.55, 1]);
    put(b, F, G.cyl(0.18 + h * 0.16, 0.05, 0.05, 12), 'plain', [x, h - 0.02, z], null, 1, 0xb0e8d8);
  }
  const w = new THREE.Vector3(0, 1.0, 0).applyMatrix4(F.m);
  glows.push({ x: w.x, y: w.y, z: w.z, size: 4, tint: 0x2affc0, light: true });
}

function propBones(b, F, r) {
  for (let k = 0; k < 14; k++) put(b, F, G.capsule(0.035, 0.35 + r.next() * 0.2, 4), 'bone', [(r.next() - 0.5) * 1.2, 0.05 + r.next() * 0.3, (r.next() - 0.5) * 1.2], [Math.PI / 2 + (r.next() - 0.5), r.next() * 6, (r.next() - 0.5)]);
  for (let k = 0; k < 4; k++) skull(b, F, [(r.next() - 0.5) * 1.0, 0.15 + r.next() * 0.3, (r.next() - 0.5) * 1.0], r.next() * 6, 1.1);
  put(b, F, G.sphere(0.6, 10, 6), 'bone', [0, 0, 0], null, [1, 0.35, 1], 0xa09a88);
}

function propUrns(b, F, r) {
  for (let i = 0; i < 3; i++) {
    const s = 0.9 + r.next() * 0.6;
    const x = (i - 1) * 0.6 + (r.next() - 0.5) * 0.15;
    const z = (r.next() - 0.5) * 0.4;
    const col = new THREE.Color().setHSL(0.06 + r.next() * 0.04, 0.35, 0.3 + r.next() * 0.15).getHex();
    put(b, F, G.lathe('urn', URN, 12), 'plain', [x, 0, z], null, s, col);
    put(b, F, G.torus(0.28 * s, 0.015 * s, Math.PI * 2, 4, 14), 'gold', [x, 0.32 * s, z], [Math.PI / 2, 0, 0]);
  }
}

const PROP_BUILDERS = {
  barrels: (b, f, F, r) => propBarrels(b, F, r),
  crates: (b, f, F, r) => propCrates(b, F, r),
  shelf: (b, f, F, r) => propShelf(b, f, F, r),
  table: (b, f, F, r) => propTable(b, f, F, r),
  rack: (b, f, F, r) => propRack(b, F, r),
  statue: (b, f, F, r, g, th) => propStatue(b, F, r, th),
  sarcophagus: (b, f, F, r, g, th) => propSarcophagus(b, f, F, r, th),
  altar: (b, f, F, r, g, th) => propAltar(b, f, F, r, th),
  brazier: (b, f, F, r, g, th) => propBrazier(b, f, F, r, th),
  sacks: (b, f, F, r) => propSacks(b, F, r),
  anvil: (b, f, F, r) => propAnvil(b, F, r),
  crystals: (b, f, F, r, g, th) => propCrystals(b, F, r, g, th),
  mushrooms: (b, f, F, r, g) => propMushrooms(b, F, r, g),
  bones: (b, f, F, r) => propBones(b, F, r),
  urns: (b, f, F, r) => propUrns(b, F, r),
};

export const PROP_WEIGHTS = {
  crypt: { sarcophagus: 3, urns: 2, altar: 2, bones: 2, statue: 2, shelf: 1, barrels: 1, crates: 1, table: 1 },
  moss: { mushrooms: 4, crates: 2, barrels: 2, bones: 1, statue: 1, sacks: 2, table: 1 },
  ember: { brazier: 3, anvil: 2, rack: 2, barrels: 2, crates: 2, sacks: 1, table: 1 },
  void: { crystals: 4, altar: 2, statue: 2, shelf: 2, urns: 1, brazier: 1 },
};

// ------------------------------------------------------------------- build
export function buildEnvironment(dg, quality = 'high') {
  const th = dg.theme;
  const r = makeRng(dg.floor * 7919 + 17);
  const group = new THREE.Group();
  const mats = makeMaterials(th);
  const b = new Batch();
  const fires = [];
  const glows = [];
  const torchSpots = [];
  const detailRate = quality === 'low' ? 0.5 : 1;
  const W = dg.w;
  const H = dg.h;
  const m4 = new THREE.Matrix4();
  const color = new THREE.Color();

  // ---- instanced floor / walls / crates / pillars
  const floorTiles = [];
  const woodTiles = [];
  const wallTiles = [];
  const blockTiles = [];
  const pillarTiles = [];
  const woodRooms = new Set(dg.rooms.filter((rm) => !rm.boss && rm !== dg.startRoom && r.next() < 0.18));
  const roomOf = (x, z) => dg.rooms.find((rm) => x >= rm.x && x < rm.x + rm.w && z >= rm.z && z < rm.z + rm.h);
  const solidWall = (x, z) => {
    const t = dg.get(x, z);
    return t === TILE.WALL;
  };
  for (let z = 0; z < H; z++)
    for (let x = 0; x < W; x++) {
      const t = dg.get(x, z);
      if (t === TILE.WALL) {
        let adj = false;
        for (let dz = -1; dz <= 1 && !adj; dz++) for (let dx = -1; dx <= 1; dx++) if (dg.get(x + dx, z + dz) !== TILE.WALL) adj = true;
        if (adj) wallTiles.push([x, z]);
      } else {
        const rm = roomOf(x, z);
        if (rm && woodRooms.has(rm)) woodTiles.push([x, z]);
        else floorTiles.push([x, z]);
        if (t === TILE.BLOCK) blockTiles.push([x, z]);
        if (t === TILE.PILLAR) pillarTiles.push([x, z]);
      }
    }
  const shadeEnv = {
    aoTex: bakeAO(dg),
    aoSize: new THREE.Vector2(W * T, H * T),
    grime: grimeTexture(),
    grimeTint: new THREE.Color(th.id === 'moss' ? 0x6a9a4a : th.id === 'ember' ? 0x5a3020 : th.id === 'void' ? 0x6a5a9a : 0x6a6a5a),
  };
  const surf = (tex, o = {}, scale = 0.5) => worldify(new THREE.MeshStandardMaterial({ map: tex.map, normalMap: tex.normalMap, roughnessMap: tex.roughnessMap, roughness: 1, normalScale: new THREE.Vector2(1.3, 1.3), ...o }), shadeEnv, { scale });
  const bt = brickTextures();
  const ft = flagstoneTextures();
  const wt = woodTextures();
  mats.floorI = surf(ft);
  mats.woodI = surf(wt, {}, 0.5);
  mats.wallI = surf(bt);
  mats.pillarI = surf(bt);
  const makeInst = (geo, material, list, y, jitter, baseColor, cast = false) => {
    if (!list.length) return null;
    const mesh = new THREE.InstancedMesh(geo, material, list.length);
    list.forEach(([x, z], i) => {
      m4.makeTranslation((x + 0.5) * T, y + (geo.userData.rot ? (r.next() - 0.5) * 0.025 : 0), (z + 0.5) * T);
      if (geo.userData.rot) m4.multiply(new THREE.Matrix4().makeRotationY(((x * 7 + z * 13) % 4) * (Math.PI / 2)));
      mesh.setMatrixAt(i, m4);
      color.setHex(baseColor).offsetHSL(0, 0, (r.next() - 0.5) * jitter);
      mesh.setColorAt(i, color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.receiveShadow = true;
    mesh.castShadow = cast;
    mesh.userData.caster = cast;
    group.add(mesh);
    return mesh;
  };
  const floorGeo = new THREE.BoxGeometry(T, 0.4, T);
  floorGeo.userData.rot = true;
  makeInst(floorGeo, mats.floorI, floorTiles, -0.2, 0.08, th.floor);
  makeInst(floorGeo, mats.woodI, woodTiles, -0.2, 0.06, 0x9a7a5a);
  const wallGeo = new THREE.BoxGeometry(T, WALL_H, T);
  const uv = wallGeo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * (WALL_H / T));
  makeInst(wallGeo, mats.wallI, wallTiles, WALL_H / 2, 0.1, th.wall);
  const blockGeo = new THREE.BoxGeometry(T * 0.98, BLOCK_H, T * 0.98);
  makeInst(blockGeo, mats.woodI, blockTiles, BLOCK_H / 2, 0.1, 0xa08060, true);
  const pillarGeo = new THREE.CylinderGeometry(T * 0.36, T * 0.4, WALL_H, 12);
  makeInst(pillarGeo, mats.pillarI, pillarTiles, WALL_H / 2, 0.08, th.wall, true);
  // broken, uneven wall tops: a few capstones per tile at varied heights
  const capTint = new THREE.Color(th.wall).offsetHSL(0, 0, 0.04).getHex();
  for (const [x, z] of wallTiles) {
    const F = frame((x + 0.5) * T, WALL_H, (z + 0.5) * T, 0);
    const k = (x * 31 + z * 17) % 5;
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < 2; j++) {
        const hh = 0.08 + ((k + i * 2 + j * 3) % 4) * 0.09 + r.next() * 0.05;
        put(b, F, G.box(T / 2 + 0.02, hh * 2, T / 2 + 0.02), 'stone', [(i - 0.5) * (T / 2), hh - 0.02, (j - 0.5) * (T / 2)], [0, 0, (r.next() - 0.5) * 0.06], 1, capTint);
      }
    if (r.next() < 0.25) put(b, F, G.dodeca(0.25 + r.next() * 0.2), 'stone', [(r.next() - 0.5) * 1.2, 0.35, (r.next() - 0.5) * 1.2], [r.next(), r.next(), 0], [1, 0.6, 1], capTint);
  }
  // crate trims and pillar bases/capitals
  for (const [x, z] of blockTiles) {
    const F = frame((x + 0.5) * T, 0, (z + 0.5) * T, 0);
    for (const y of [0.06, BLOCK_H - 0.06]) for (const [dx, dz, w, d] of [[0, 0.98, 2, 0.06], [0, -0.98, 2, 0.06], [0.98, 0, 0.06, 2], [-0.98, 0, 0.06, 2]]) put(b, F, G.box(w, 0.12, d), 'metal', [dx, y, dz], null, 1, 0x707078);
  }
  for (const [x, z] of pillarTiles) {
    const F = frame((x + 0.5) * T, 0, (z + 0.5) * T, 0);
    put(b, F, G.cyl(0.95, 1.0, 0.4, 12), 'stone', [0, 0.2, 0], null, 1, th.wall);
    put(b, F, G.cyl(1.0, 0.85, 0.35, 12), 'stone', [0, WALL_H - 0.4, 0], null, 1, th.wall);
    put(b, F, G.torus(0.78, 0.06, Math.PI * 2, 4, 20), 'stone', [0, 0.45, 0], [Math.PI / 2, 0, 0], 1, th.wall);
    if (th.id === 'moss' || r.next() < 0.3) for (let k = 0; k < 4; k++) put(b, F, G.sphere(0.3, 6, 5), 'moss', [Math.cos(k * 1.7) * 0.75, 0.3 + r.next() * 1.5, Math.sin(k * 1.7) * 0.75], null, [1, 0.8, 0.3], 0x6a9a3a);
  }

  // ---- wall faces: plinth, cornice, pilasters, sconces and detail
  let faceIdx = 0;
  const details = WALL_DETAILS[th.id];
  const wallTint = new THREE.Color(th.wall).offsetHSL(0, -0.05, 0.05).getHex();
  for (const [x, z] of wallTiles) {
    for (const [dx, dz] of DIRS) {
      const n = dg.get(x + dx, z + dz);
      if (n === TILE.WALL || n === TILE.PILLAR) continue;
      faceIdx++;
      const ang = Math.atan2(dx, dz);
      const F = frame((x + 0.5 + dx * 0.5) * T, 0, (z + 0.5 + dz * 0.5) * T, ang);
      put(b, F, G.box(T + 0.04, 0.34, 0.18), 'stone', [0, 0.17, 0.09], null, 1, wallTint);
      put(b, F, G.box(T + 0.04, 0.06, 0.22), 'stone', [0, 0.35, 0.11], null, 1, wallTint);
      put(b, F, G.box(T + 0.04, 0.2, 0.22), 'stone', [0, WALL_H - 0.5, 0.11], null, 1, wallTint);
      put(b, F, G.box(T + 0.04, 0.12, 0.32), 'stone', [0, WALL_H - 0.34, 0.16], null, 1, wallTint);
      const hash = (x * 73856093) ^ (z * 19349663) ^ (dx * 83492791 + dz * 29);
      if (Math.abs(hash) % 3 === 0) {
        const px = -T / 2 + 0.31; // inside this face so it never juts into an opening
        put(b, F, G.box(0.46, WALL_H - 0.9, 0.2), 'stone', [px, 0.36 + (WALL_H - 0.9) / 2, 0.1], null, 1, wallTint);
        put(b, F, G.box(0.6, 0.22, 0.3), 'stone', [px, WALL_H - 0.66, 0.15], null, 1, wallTint);
        put(b, F, G.box(0.6, 0.3, 0.3), 'stone', [px, 0.2, 0.15], null, 1, wallTint);
      }
      // stones jutting out of the brickwork, aligned to the courses
      const nStones = 2 + (Math.abs(hash) % 4);
      for (let k = 0; k < nStones; k++) {
        const course = 2 + Math.floor(r.next() * 12);
        const w = 0.3 + r.next() * 0.35;
        put(b, F, G.box(w, 0.22, 0.12), 'stone', [(r.next() - 0.5) * (T - w - 0.1), course * 0.25 + 0.125, 0.03 + r.next() * 0.03], [0, 0, (r.next() - 0.5) * 0.04], 1, new THREE.Color(wallTint).offsetHSL(0, 0, (r.next() - 0.5) * 0.12).getHex());
      }
      // quoins where the wall turns an outside corner
      for (const side of [-1, 1]) {
        // neighbour along the wall on this side (local +x is world (dz, -dx))
        const nb = dg.get(x + side * dz, z - side * dx);
        if (nb !== TILE.WALL && nb !== TILE.PILLAR) {
          const lx = side * (T / 2 - 0.2);
          for (let q = 0; q < 7; q++) put(b, F, G.box(q % 2 ? 0.34 : 0.5, 0.46, 0.14), 'stone', [lx + (q % 2 ? side * 0.08 : 0), 0.5 + q * 0.5, 0.05], null, 1, new THREE.Color(wallTint).offsetHSL(0, 0, 0.05 - (q % 2) * 0.05).getHex());
        }
      }
      // timber framing in some rooms and corridors
      if (th.id !== 'void' && Math.abs(hash >> 3) % 7 === 0 && n === TILE.FLOOR) {
        put(b, F, G.box(0.26, WALL_H - 0.5, 0.2), 'wood', [0.62, (WALL_H - 0.5) / 2, 0.1], null, 1, 0x8a6a4a);
        put(b, F, G.box(T + 0.02, 0.24, 0.2), 'wood', [0, WALL_H - 0.75, 0.1], null, 1, 0x8a6a4a);
        put(b, F, G.box(0.14, 1.3, 0.14), 'wood', [0.2, WALL_H - 1.25, 0.12], [0, 0, -0.75], 1, 0x7a5a3a);
        for (const y of [1.2, WALL_H - 0.75]) put(b, F, G.sphere(0.035, 6, 4), 'metal', [0.62, y, 0.21], null, 1, 0x404048);
      }
      // torches every few faces, otherwise a themed detail
      if (faceIdx % 6 === 0 && n === TILE.FLOOR) {
        put(b, F, G.box(0.14, 0.44, 0.08), 'metal', [0, 2.15, 0.04], null, 1, 0x444450);
        put(b, F, G.box(0.06, 0.06, 0.42), 'metal', [0, 2.0, 0.24], [0.35, 0, 0], 1, 0x444450);
        put(b, F, G.lathe('sconce', [[0.001, 0], [0.05, 0], [0.16, 0.14], [0.14, 0.16], [0.001, 0.1]], 8), 'metal', [0, 2.3, 0.45], null, 1, 0x444450);
        put(b, F, G.cyl(0.05, 0.06, 0.25, 6), 'wood', [0, 2.35, 0.45]);
        const w = new THREE.Vector3(0, 2.55, 0.45).applyMatrix4(F.m);
        fires.push({ x: w.x, y: w.y, z: w.z, size: 0.42, tint: 0xff7a2a, glow: 2.4, light: true });
        torchSpots.push([w.x, w.z]);
      } else if (r.next() < 0.42 * detailRate && n === TILE.FLOOR) {
        wallDetail(pickWeighted(r, details), b, fires, F, r, th, glows);
      }
    }
  }

  // ---- door-frame columns where corridors open into rooms
  const column = (wx, wz) => {
    const F = frame(wx, 0, wz, 0);
    put(b, F, G.box(0.62, WALL_H - 0.3, 0.62), 'stone', [0, (WALL_H - 0.3) / 2, 0], null, 1, wallTint);
    put(b, F, G.box(0.8, 0.34, 0.8), 'stone', [0, 0.17, 0], null, 1, wallTint);
    put(b, F, G.box(0.84, 0.24, 0.84), 'stone', [0, WALL_H - 0.4, 0], null, 1, wallTint);
    put(b, F, G.box(0.7, 0.1, 0.7), 'stone', [0, WALL_H - 0.24, 0], null, 1, wallTint);
    for (const y of [1.2, 2.4]) put(b, F, G.box(0.66, 0.06, 0.66), 'stone', [0, y, 0], null, 1, new THREE.Color(wallTint).offsetHSL(0, 0, -0.08).getHex());
  };
  for (const rm of dg.rooms) {
    const edges = [];
    for (let x = rm.x; x < rm.x + rm.w; x++) {
      edges.push([x, rm.z - 1, 1, 0, x * T, rm.z * T]);
      edges.push([x, rm.z + rm.h, 1, 0, x * T, (rm.z + rm.h) * T]);
    }
    for (let z = rm.z; z < rm.z + rm.h; z++) {
      edges.push([rm.x - 1, z, 0, 1, rm.x * T, z * T]);
      edges.push([rm.x + rm.w, z, 0, 1, (rm.x + rm.w) * T, z * T]);
    }
    for (const [ox, oz, ax, az, wx, wz] of edges) {
      if (dg.get(ox, oz) === TILE.WALL) continue;
      // shift columns into the wall so they frame the opening without narrowing it
      if (dg.get(ox - ax, oz - az) === TILE.WALL) column(wx - ax * 0.3, wz - az * 0.3);
      if (dg.get(ox + ax, oz + az) === TILE.WALL) column(wx + ax * (T + 0.3), wz + az * (T + 0.3));
    }
  }

  // ---- cobwebs in room corners (upper) and floor clutter
  const webRate = th.id === 'crypt' ? 0.55 : th.id === 'moss' ? 0.3 : 0.15;
  for (let z = 0; z < H; z++)
    for (let x = 0; x < W; x++) {
      if (dg.get(x, z) !== TILE.FLOOR) continue;
      for (const [cx, cz] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ]) {
        if (!solidWall(x + cx, z) || !solidWall(x, z + cz) || r.next() > webRate * detailRate) continue;
        const px = (x + 0.5 + cx * 0.5) * T;
        const pz = (z + 0.5 + cz * 0.5) * T;
        const F = frame(px, 0, pz, Math.atan2(-cx, -cz));
        const s = 1.0 + r.next() * 0.8;
        put(b, F, new THREE.PlaneGeometry(s, s), 'web', [0, WALL_H - 0.55 - s * 0.35, s * 0.35], [0.6, Math.PI, Math.PI / 4 + Math.PI], 1);
      }
    }

  // floor-level clutter per room
  for (const rm of dg.rooms) {
    const rr = makeRng(rm.x * 131 + rm.z * 17 + dg.floor);
    const cx = (rm.x + rm.w / 2) * T;
    const cz = (rm.z + rm.h / 2) * T;
    const F0 = frame(cx, 0, cz, 0);
    // centerpiece
    if (!rm.boss && rm !== dg.startRoom && !woodRooms.has(rm) && rr.next() < 0.3) {
      group.add(rugMesh(rm, rr, cx, cz));
    } else if (th.id === 'void' || (rm.boss && th.id !== 'ember')) {
      const R = Math.min(rm.w, rm.h) * 0.35;
      put(b, F0, G.torus(R, 0.05, Math.PI * 2, 3, 48), 'rune', [0, 0.03, 0], [Math.PI / 2, 0, 0]);
      put(b, F0, G.torus(R * 0.8, 0.03, Math.PI * 2, 3, 40), 'rune', [0, 0.03, 0], [Math.PI / 2, 0, 0]);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        put(b, F0, G.box(0.3, 0.02, 0.08), 'rune', [Math.cos(a) * R * 0.9, 0.03, Math.sin(a) * R * 0.9], [0, -a, 0]);
      }
    } else if (th.id === 'ember' && rr.next() < 0.6) {
      // glowing grate over lava
      put(b, F0, G.box(1.6, 0.02, 1.6), 'lava', [0, 0.005, 0]);
      for (let k = -3; k <= 3; k++) {
        put(b, F0, G.box(0.06, 0.08, 1.7), 'metal', [k * 0.25, 0.04, 0], null, 1, 0x303038);
        put(b, F0, G.box(1.7, 0.08, 0.06), 'metal', [0, 0.04, k * 0.25], null, 1, 0x303038);
      }
      glows.push({ x: cx, y: 0.4, z: cz, size: 5, tint: 0xff5a1a });
    }
    // scattered details
    const nClutter = Math.round((rm.w * rm.h) / 7 * detailRate);
    for (let i = 0; i < nClutter; i++) {
      const tx = rm.x + rr.int(0, rm.w - 1);
      const tz = rm.z + rr.int(0, rm.h - 1);
      if (dg.get(tx, tz) !== TILE.FLOOR) continue;
      const px = (tx + 0.1 + rr.next() * 0.8) * T;
      const pz = (tz + 0.1 + rr.next() * 0.8) * T;
      const F = frame(px, 0, pz, rr.next() * 6.28);
      const roll = rr.next();
      if (roll < 0.25) put(b, F, G.dodeca(0.12 + rr.next() * 0.12), 'stone', [0, 0.04, 0], [rr.next(), rr.next(), 0], [1, 0.6, 1], wallTint);
      else if (roll < 0.4) put(b, F, G.capsule(0.03, 0.3, 4), 'bone', [0, 0.04, 0], [Math.PI / 2, 0, rr.next()]);
      else if (roll < 0.47) skull(b, F, [0, 0, 0], 0);
      else if (roll < 0.62 && (th.id === 'moss' || th.id === 'crypt')) {
        put(b, F, G.cyl(0.5 + rr.next() * 0.5, 0.5, 0.01, 14), 'water', [0, 0.012, 0], null, [1, 1, 0.6 + rr.next() * 0.4], 0x506070);
      } else if (roll < 0.75 && th.id === 'moss') put(b, F, G.sphere(0.5, 8, 5), 'moss', [0, 0, 0], null, [1 + rr.next(), 0.08, 0.8 + rr.next()], 0x5a8a32);
      else if (roll < 0.75 && th.id === 'ember') {
        let lx = 0;
        let lz = 0;
        let a = rr.next() * 6;
        for (let s = 0; s < 5; s++) {
          const len = 0.3 + rr.next() * 0.3;
          put(b, F, G.box(len, 0.02, 0.05), 'lava', [lx, 0.008, lz], [0, a, 0]);
          lx += Math.cos(a) * len * 0.9;
          lz -= Math.sin(a) * len * 0.9;
          a += (rr.next() - 0.5) * 1.4;
        }
      } else if (roll < 0.82 && th.id !== 'ember') {
        const k = 2 + rr.int(0, 3);
        for (let c = 0; c < k; c++) candle(b, fires, F, (rr.next() - 0.5) * 0.4, 0, (rr.next() - 0.5) * 0.4, 0.1 + rr.next() * 0.25, th.id === 'void' ? 0xb080ff : 0xff9a3a);
      } else if (roll < 0.9) {
        // cracked, tilted floor slab
        put(b, F, G.box(0.9, 0.06, 0.7), 'stone', [0, 0.02, 0], [0.04, 0, 0.05], 1, th.floor);
      }
    }
    // light shafts from cracks in the ceiling
    if (quality !== 'low' && rr.next() < 0.35 && th.id !== 'ember') {
      const F = frame(cx + (rr.next() - 0.5) * rm.w, 0, cz + (rr.next() - 0.5) * rm.h, rr.next() * 6);
      put(b, F, G.cyl(0.6, 1.6, 12, 12, true), 'shaft', [0, 6, 0], [0.18, 0, 0.1]);
      put(b, F, G.cyl(1.2, 1.2, 0.01, 16), 'shaft', [0.9, 0.02, 0.4], [0, 0, 0], [1, 1, 0.7]);
    }
  }

  // ---- solid props planned by the generator
  for (const pr of dg.props) {
    const F = frame((pr.tx + 0.5) * T, 0, (pr.tz + 0.5) * T, pr.angle);
    const pb = PROP_BUILDERS[pr.type];
    if (pb) pb(b, fires, F, makeRng(pr.tx * 991 + pr.tz * 37), glows, th);
  }

  worldify(mats.stone, shadeEnv, { scale: 0.5 });
  worldify(mats.brick, shadeEnv, { scale: 0.5 });
  group.userData.aoTex = shadeEnv.aoTex;
  const casters = new Set(quality === 'high' ? ['wood', 'metal', 'plain', 'bone', 'gold', 'crystal', 'fungus', 'wax'] : []);
  b.build(mats, group, casters);

  // ---- fire + glow + motes
  const extras = buildFireAndGlow(fires, glows, group);
  const moteColor = { crypt: 0xb8c8ff, moss: 0x9dffb0, ember: 0xffa050, void: 0xd8a0ff }[th.id];
  let motes = null;
  if (quality !== 'low') {
    const n = quality === 'high' ? 420 : 200;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = r.next();
      pos[i * 3 + 1] = r.next();
      pos[i * 3 + 2] = r.next();
      seed[i] = r.next();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    motes = new THREE.Points(geo, moteMaterial(moteColor, th.id === 'ember'));
    motes.frustumCulled = false;
    group.add(motes);
  }

  const lightSpots = [...torchSpots.map((s) => ({ x: s[0], z: s[1], y: 2.6, color: 0xff9a4a })), ...fires.filter((f) => f.light && !torchSpots.some((s) => s[0] === f.x && s[1] === f.z)).map((f) => ({ x: f.x, z: f.z, y: f.y + 0.6, color: f.tint })), ...glows.filter((g) => g.light).map((g) => ({ x: g.x, z: g.z, y: g.y + 0.5, color: g.tint }))];

  const materials = Object.values(mats);
  return {
    group,
    torchSpots,
    lightSpots,
    update(t, center, scale) {
      for (const m of extras.mats) {
        m.uniforms.uTime.value = t;
        if (m.uniforms.uScale) m.uniforms.uScale.value = scale;
      }
      if (motes) {
        motes.material.uniforms.uTime.value = t;
        motes.material.uniforms.uCenter.value.copy(center);
        motes.material.uniforms.uScale.value = scale;
      }
    },
    dispose() {
      shadeEnv.aoTex.dispose();
      for (const m of materials) m.dispose();
      for (const m of extras.mats) m.dispose();
      if (motes) motes.material.dispose();
    },
  };
}

function rugMesh(rm, rr, cx, cz) {
  const w = Math.max(2, (rm.w - 4) * T * 0.6);
  const h = Math.max(2, (rm.h - 4) * T * 0.45);
  const m = new THREE.MeshStandardMaterial({ map: rugTexture(Math.floor(rr.next() * 8) / 8), roughness: 1 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.z = rr.next() < 0.5 ? 0 : Math.PI / 2;
  mesh.position.set(cx, 0.015, cz);
  mesh.receiveShadow = true;
  mesh.userData.ownGeo = true;
  mesh.userData.ownMat = true;
  return mesh;
}

function buildFireAndGlow(fires, glows, group) {
  const mats = [];
  if (fires.length) {
    const geos = [];
    for (const f of fires) {
      for (const [sx, s, hgt] of [
        [0, 1, 1],
        [0.3, 0.6, 0.7],
        [-0.3, 0.55, 0.65],
      ]) {
        if (f.size < 0.2 && s < 1) continue;
        const g = new THREE.ConeGeometry(f.size * 0.35 * s, f.size * 1.4 * hgt, 7, 3, true).toNonIndexed();
        g.translate(f.x + sx * f.size * 0.3, f.y + (f.size * 1.4 * hgt) / 2, f.z + sx * f.size * 0.15);
        const n = g.attributes.position.count;
        const seed = new Float32Array(n).fill(Math.random() * 10);
        const size = new Float32Array(n).fill(f.size);
        const tint = new Float32Array(n * 3);
        const base = new Float32Array(n * 3);
        const c = new THREE.Color(f.tint);
        for (let i = 0; i < n; i++) {
          tint.set([c.r, c.g, c.b], i * 3);
          base.set([f.x, f.y, f.z], i * 3);
        }
        g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
        g.setAttribute('size', new THREE.BufferAttribute(size, 1));
        g.setAttribute('tint', new THREE.BufferAttribute(tint, 3));
        g.setAttribute('base', new THREE.BufferAttribute(base, 3));
        g.deleteAttribute('normal');
        geos.push(g);
      }
      if (f.glow) glows.push({ x: f.x, y: f.y + f.size * 0.5, z: f.z, size: f.glow, tint: f.tint });
    }
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    const fm = fireMaterial();
    mats.push(fm);
    const mesh = new THREE.Mesh(merged, fm);
    mesh.frustumCulled = false;
    mesh.userData.ownGeo = true;
    group.add(mesh);
  }
  if (glows.length) {
    const n = glows.length;
    const pos = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const seed = new Float32Array(n);
    const tint = new Float32Array(n * 3);
    const c = new THREE.Color();
    glows.forEach((g, i) => {
      pos.set([g.x, g.y, g.z], i * 3);
      size[i] = g.size;
      seed[i] = Math.random();
      c.set(g.tint);
      tint.set([c.r, c.g, c.b], i * 3);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    geo.setAttribute('tint', new THREE.BufferAttribute(tint, 3));
    const gm = glowMaterial();
    mats.push(gm);
    const pts = new THREE.Points(geo, gm);
    pts.frustumCulled = false;
    pts.userData.ownGeo = true;
    group.add(pts);
  }
  return { mats };
}
