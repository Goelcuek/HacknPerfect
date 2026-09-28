// Procedural, tileable surface textures: colour (albedo), normal and roughness
// maps generated on canvases at startup. Albedo is mostly neutral so a theme
// colour can tint it per instance.

import * as THREE from 'three';
import { makeRng } from './utils.js';

const cache = new Map();

// Tileable value noise with `octaves` layers; period is in lattice cells.
function noiseField(S, period, octaves, seed) {
  const r = makeRng(seed);
  const out = new Float32Array(S * S);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const P = period << o;
    const grid = new Float32Array(P * P);
    for (let i = 0; i < grid.length; i++) grid[i] = r.next();
    for (let y = 0; y < S; y++) {
      const gy = (y / S) * P;
      const y0 = Math.floor(gy);
      const fy = gy - y0;
      const sy = fy * fy * (3 - 2 * fy);
      for (let x = 0; x < S; x++) {
        const gx = (x / S) * P;
        const x0 = Math.floor(gx);
        const fx = gx - x0;
        const sx = fx * fx * (3 - 2 * fx);
        const a = grid[(y0 % P) * P + (x0 % P)];
        const b = grid[(y0 % P) * P + ((x0 + 1) % P)];
        const c = grid[((y0 + 1) % P) * P + (x0 % P)];
        const d = grid[((y0 + 1) % P) * P + ((x0 + 1) % P)];
        out[y * S + x] += amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy);
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function canvas(S) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  return c;
}

function toTexture(c, srgb) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// Build albedo/normal/roughness canvases from per-pixel functions.
function bake(S, height, color, rough, strength) {
  const cA = canvas(S);
  const cN = canvas(S);
  const cR = canvas(S);
  const A = cA.getContext('2d').createImageData(S, S);
  const N = cN.getContext('2d').createImageData(S, S);
  const R = cR.getContext('2d').createImageData(S, S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const hL = height[y * S + ((x - 1 + S) % S)];
      const hR = height[y * S + ((x + 1) % S)];
      const hU = height[((y - 1 + S) % S) * S + x];
      const hD = height[((y + 1) % S) * S + x];
      let nx = (hL - hR) * strength;
      let ny = (hD - hU) * strength;
      const nz = 1;
      const l = Math.hypot(nx, ny, nz);
      N.data[i * 4] = ((nx / l) * 0.5 + 0.5) * 255;
      N.data[i * 4 + 1] = ((ny / l) * 0.5 + 0.5) * 255;
      N.data[i * 4 + 2] = ((nz / l) * 0.5 + 0.5) * 255;
      N.data[i * 4 + 3] = 255;
      const [r, g, b] = color(i, x, y);
      A.data[i * 4] = r;
      A.data[i * 4 + 1] = g;
      A.data[i * 4 + 2] = b;
      A.data[i * 4 + 3] = 255;
      const rv = rough(i) * 255;
      R.data[i * 4] = R.data[i * 4 + 1] = R.data[i * 4 + 2] = rv;
      R.data[i * 4 + 3] = 255;
    }
  cA.getContext('2d').putImageData(A, 0, 0);
  cN.getContext('2d').putImageData(N, 0, 0);
  cR.getContext('2d').putImageData(R, 0, 0);
  return { map: toTexture(cA, true), normalMap: toTexture(cN, false), roughnessMap: toTexture(cR, false) };
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Running-bond stone bricks with chipped, worn edges, per-brick tone and
// cracks. One texture tile covers 2m x 2m of wall (8 courses of bricks).
export function brickTextures() {
  if (cache.has('brick')) return cache.get('brick');
  const S = 512;
  const r = makeRng(71);
  const n1 = noiseField(S, 16, 4, 3);
  const n2 = noiseField(S, 8, 3, 9);
  const n3 = noiseField(S, 64, 2, 13);
  const h = new Float32Array(S * S);
  const shade = new Float32Array(S * S);
  const warm = new Float32Array(S * S);
  const rows = 8;
  const rowH = S / rows;
  const brickW = S / 3;
  const shades = [];
  const warms = [];
  const jit = [];
  for (let i = 0; i < 96; i++) {
    shades.push(0.7 + r.next() * 0.4);
    warms.push((r.next() - 0.5) * 0.12);
    jit.push((r.next() - 0.5) * brickW * 0.35);
  }
  for (let y = 0; y < S; y++) {
    const row = Math.floor(y / rowH);
    for (let x = 0; x < S; x++) {
      const off = (row % 2 ? brickW / 2 : 0) + jit[row * 7 % 96];
      const xx = (((x + off) % S) + S) % S;
      const col = Math.floor(xx / brickW);
      const lx = xx - col * brickW;
      const ly = y - row * rowH;
      const edge = Math.min(lx, brickW - lx, ly, rowH - ly);
      const i = y * S + x;
      const chip = n2[i] * 9;
      const mortar = clamp01((edge - 3 - chip * 0.7) / 5);
      const bevel = clamp01(edge / 14);
      const id = (row * 5 + col * 3) % 96;
      // rounded bulge per brick + fine pitting
      h[i] = mortar * (0.5 + 0.35 * Math.sqrt(bevel) + n1[i] * 0.25 - n3[i] * 0.08);
      shade[i] = mortar > 0 ? shades[id] : 0.38;
      warm[i] = mortar > 0 ? warms[id] : 0;
    }
  }
  for (let k = 0; k < 14; k++) {
    let x = r.next() * S;
    let y = r.next() * S;
    let a = r.next() * Math.PI * 2;
    for (let st = 0; st < 60; st++) {
      a += (r.next() - 0.5) * 0.9;
      x = (x + Math.cos(a) * 1.5 + S) % S;
      y = (y + Math.sin(a) * 1.5 + S) % S;
      const i = (Math.floor(y) % S) * S + (Math.floor(x) % S);
      h[i] *= 0.25;
      h[(i + 1) % (S * S)] *= 0.6;
    }
  }
  const out = bake(
    S,
    h,
    (i) => {
      const v = shade[i] * (0.78 + n1[i] * 0.4) * (0.5 + h[i] * 0.5) - n3[i] * 0.06;
      const g = clamp01(v) * 228;
      return [g * (1.02 + warm[i]), g, g * (0.97 - warm[i] * 0.5)];
    },
    (i) => 0.7 + (1 - h[i]) * 0.25 + n2[i] * 0.05,
    9,
  );
  cache.set('brick', out);
  return out;
}

// Large, soft grey noise used to break up tiling with stains and grime.
export function grimeTexture() {
  if (cache.has('grime')) return cache.get('grime');
  const S = 128;
  const n = noiseField(S, 4, 5, 77);
  const c = canvas(S);
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const v = clamp01((n[i] - 0.5) * 1.8 + 0.5) * 255;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = toTexture(c, false);
  cache.set('grime', t);
  return t;
}

// Irregular flagstones: a 2x2 grid of offset slabs per tile.
export function flagstoneTextures() {
  if (cache.has('flag')) return cache.get('flag');
  const S = 256;
  const r = makeRng(33);
  const n1 = noiseField(S, 8, 4, 5);
  const n2 = noiseField(S, 16, 2, 8);
  const h = new Float32Array(S * S);
  const shade = new Float32Array(S * S);
  // jittered split lines
  const vx = [0, S * (0.48 + r.next() * 0.06)];
  const hy = [0, S * (0.46 + r.next() * 0.08)];
  const slabShade = [0.85 + r.next() * 0.2, 0.8 + r.next() * 0.25, 0.85 + r.next() * 0.2, 0.78 + r.next() * 0.25];
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const wob = (n2[i] - 0.5) * 10;
      const dx = Math.min(Math.abs(x - vx[1] + wob), x + wob * 0.3, S - x - wob * 0.3);
      const dy = Math.min(Math.abs(y - hy[1] - wob), y - wob * 0.3, S - y + wob * 0.3);
      const edge = Math.max(0, Math.min(dx, dy));
      const groove = clamp01((edge - 2) / 5);
      h[i] = groove * (0.7 + n1[i] * 0.3);
      const q = (x > vx[1] ? 1 : 0) + (y > hy[1] ? 2 : 0);
      shade[i] = groove > 0 ? slabShade[q] : 0.4;
    }
  const out = bake(
    S,
    h,
    (i) => {
      const v = clamp01(shade[i] * (0.72 + n1[i] * 0.45)) * 210;
      return [v, v * 0.99, v * 0.97];
    },
    (i) => 0.82 + (1 - h[i]) * 0.15,
    5,
  );
  cache.set('flag', out);
  return out;
}

// Weathered wooden planks (crates, tables, beams).
export function woodTextures() {
  if (cache.has('wood')) return cache.get('wood');
  const S = 128;
  const n1 = noiseField(S, 4, 3, 21);
  const grain = noiseField(S, 32, 2, 22);
  const h = new Float32Array(S * S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const plank = x % 32;
      const gap = clamp01(Math.min(plank, 32 - plank) / 2.5);
      h[i] = gap * (0.7 + grain[(y % S) * S + ((x * 4) % S)] * 0.3);
    }
  const out = bake(
    S,
    h,
    (i, x, y) => {
      const g = grain[y * S + ((x * 4) % S)];
      const v = (0.55 + g * 0.35 + n1[i] * 0.2) * (0.5 + h[i] * 0.5);
      return [clamp01(v) * 150, clamp01(v) * 100, clamp01(v) * 62];
    },
    () => 0.85,
    3,
  );
  cache.set('wood', out);
  return out;
}

// Woven rug with a border and diamond pattern.
export function rugTexture(hue) {
  const key = 'rug' + hue;
  if (cache.has(key)) return cache.get(key);
  const S = 128;
  const c = canvas(S);
  // read back below: keep this canvas on the CPU (GPU readback stalls for seconds on some devices)
  const g = c.getContext('2d', { willReadFrequently: true });
  const base = new THREE.Color().setHSL(hue, 0.55, 0.28);
  const dark = new THREE.Color().setHSL(hue, 0.5, 0.16);
  const gold = new THREE.Color().setHSL(0.11, 0.6, 0.5);
  g.fillStyle = base.getStyle();
  g.fillRect(0, 0, S, S);
  g.fillStyle = dark.getStyle();
  g.fillRect(0, 0, S, 14);
  g.fillRect(0, S - 14, S, 14);
  g.fillStyle = gold.getStyle();
  g.fillRect(0, 16, S, 3);
  g.fillRect(0, S - 19, S, 3);
  g.strokeStyle = gold.getStyle();
  g.lineWidth = 3;
  for (let i = 0; i < 2; i++) {
    const cx = S / 2;
    const cy = S / 2;
    const r = 30 - i * 14;
    g.beginPath();
    g.moveTo(cx, cy - r);
    g.lineTo(cx + r, cy);
    g.lineTo(cx, cy + r);
    g.lineTo(cx - r, cy);
    g.closePath();
    g.stroke();
  }
  const img = g.getImageData(0, 0, S, S);
  const r = makeRng(hue * 1000);
  for (let i = 0; i < img.data.length; i += 4) {
    const k = 0.85 + r.next() * 0.3;
    img.data[i] *= k;
    img.data[i + 1] *= k;
    img.data[i + 2] *= k;
  }
  g.putImageData(img, 0, 0);
  const t = toTexture(c, true);
  cache.set(key, t);
  return t;
}

// Soft radial glow sprite (torches, braziers, crystals).
export function glowTexture() {
  if (cache.has('glow')) return cache.get('glow');
  const S = 64;
  const c = canvas(S);
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  cache.set('glow', t);
  return t;
}

// Grey cobweb decal with alpha.
export function cobwebTexture() {
  if (cache.has('web')) return cache.get('web');
  const S = 128;
  const c = canvas(S);
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(220,220,230,0.55)';
  g.lineWidth = 1;
  const spokes = 7;
  for (let i = 0; i < spokes; i++) {
    const a = (i / (spokes - 1)) * (Math.PI / 2);
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(Math.cos(a) * S, Math.sin(a) * S);
    g.stroke();
  }
  for (let r = 14; r < S; r += 14) {
    g.beginPath();
    for (let i = 0; i < spokes; i++) {
      const a = (i / (spokes - 1)) * (Math.PI / 2);
      const rr = r * (0.9 + (i % 2) * 0.1);
      if (i === 0) g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else g.quadraticCurveTo(Math.cos(a - 0.12) * rr * 0.9, Math.sin(a - 0.12) * rr * 0.9, Math.cos(a) * rr, Math.sin(a) * rr);
    }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  cache.set('web', t);
  return t;
}

// ------------------------------------------------------ character surfaces
// Small tileable normal + roughness maps that give costumes and creatures
// fine surface detail: woven cloth, grained leather, brushed metal, skin, bone.
function surfaceSet(key, S, heightFn, roughFn, strength, repeat) {
  if (cache.has(key)) return cache.get(key);
  const h = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) h[y * S + x] = heightFn(x, y, y * S + x);
  const out = bake(S, h, () => [255, 255, 255], (i) => roughFn(i, h[i]), strength);
  for (const t of [out.normalMap, out.roughnessMap]) t.repeat.set(repeat[0], repeat[1]);
  out.map.dispose();
  delete out.map;
  cache.set(key, out);
  return out;
}

export function clothSurface() {
  const n = noiseField(128, 8, 3, 101);
  return surfaceSet(
    'cloth',
    128,
    (x, y, i) => {
      // plain weave: alternating over/under threads
      const wx = Math.sin((x / 128) * Math.PI * 2 * 32);
      const wy = Math.sin((y / 128) * Math.PI * 2 * 32);
      const over = (Math.floor(x / 2) + Math.floor(y / 2)) % 2 ? wx : wy;
      return 0.5 + over * 0.25 + n[i] * 0.3;
    },
    (i, h) => 0.85 + (1 - h) * 0.1,
    3,
    [4, 4],
  );
}

export function leatherSurface() {
  const n1 = noiseField(128, 16, 3, 111);
  const n2 = noiseField(128, 4, 2, 112);
  return surfaceSet(
    'leather',
    128,
    (x, y, i) => {
      const cell = Math.abs(n1[i] - 0.5) < 0.04 ? 0.2 : 1; // grain creases
      return (0.6 + n2[i] * 0.4) * cell;
    },
    (i, h) => 0.6 + (1 - h) * 0.3,
    4,
    [3, 3],
  );
}

export function metalSurface() {
  const r = makeRng(121);
  const n = noiseField(128, 4, 3, 122);
  const h0 = new Float32Array(128 * 128);
  // brushed streaks
  for (let y = 0; y < 128; y++) {
    const streak = r.next() * 0.25;
    for (let x = 0; x < 128; x++) h0[y * 128 + x] = 0.6 + streak + n[y * 128 + x] * 0.15;
  }
  // scratches and dents
  for (let k = 0; k < 40; k++) {
    let x = r.next() * 128;
    let y = r.next() * 128;
    const a = r.next() * Math.PI;
    const len = 6 + r.next() * 20;
    for (let s = 0; s < len; s++) {
      const i = (Math.floor(y + Math.sin(a) * s) & 127) * 128 + (Math.floor(x + Math.cos(a) * s) & 127);
      h0[i] -= 0.35;
    }
  }
  return surfaceSet(
    'metal',
    128,
    (x, y, i) => h0[i],
    (i, h) => 0.25 + (1 - h) * 0.45 + n[i] * 0.1,
    3,
    [2, 2],
  );
}

export function skinSurface() {
  const n1 = noiseField(128, 16, 3, 131);
  const n2 = noiseField(128, 32, 1, 132);
  return surfaceSet('skin', 128, (x, y, i) => 0.6 + n1[i] * 0.3 + n2[i] * 0.15, (i, h) => 0.65 + (1 - h) * 0.25, 2, [2, 2]);
}

export function boneSurface() {
  const r = makeRng(141);
  const n = noiseField(128, 8, 4, 142);
  const h0 = new Float32Array(128 * 128);
  for (let i = 0; i < h0.length; i++) h0[i] = 0.5 + n[i] * 0.4;
  for (let k = 0; k < 16; k++) {
    let x = r.next() * 128;
    let y = r.next() * 128;
    let a = r.next() * 6.28;
    for (let s = 0; s < 30; s++) {
      a += (r.next() - 0.5) * 0.8;
      x += Math.cos(a);
      y += Math.sin(a);
      h0[(Math.floor(y) & 127) * 128 + (Math.floor(x) & 127)] *= 0.3;
    }
  }
  return surfaceSet('bone', 128, (x, y, i) => h0[i], (i, h) => 0.55 + (1 - h) * 0.35, 4, [2, 3]);
}

// Give a standard material one of the surface sets above.
export function applySurface(material, set, strength = 0.8) {
  material.normalMap = set.normalMap;
  material.roughnessMap = set.roughnessMap;
  material.normalScale.set(strength, strength);
  material.roughness = Math.max(material.roughness, 0.9);
  material.needsUpdate = true;
  return material;
}
