// Jointed humanoid rig + geometry/material helpers + spring-driven pose
// blending. Animation code fills a pose table each frame; every joint then
// chases its target with a damped spring, which gives weight, overshoot and
// follow-through instead of robotic linear easing.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ------------------------------------------------------------ shared geometry
const geoCache = new Map();
function cached(key, make) {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    g.userData.shared = true;
    geoCache.set(key, g);
  }
  return g;
}
// Surface of revolution from [radius, y] pairs.
function latheGeo(key, pts, seg = 12) {
  return cached('lathe' + key, () => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(0.0001, r), y)), seg));
}
export const G = {
  capsule: (r, len, seg = 8) => cached(`cap${r}|${len}|${seg}`, () => new THREE.CapsuleGeometry(r, len, 3, seg)),
  sphere: (r, w = 12, h = 9) => cached(`sph${r}|${w}|${h}`, () => new THREE.SphereGeometry(r, w, h)),
  hemi: (r, w = 12) => cached(`hemi${r}|${w}`, () => new THREE.SphereGeometry(r, w, 6, 0, Math.PI * 2, 0, Math.PI / 2)),
  box: (w, h, d) => cached(`box${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d)),
  cyl: (rt, rb, h, seg = 10, open = false) => cached(`cyl${rt}|${rb}|${h}|${seg}|${open}`, () => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open)),
  cone: (r, h, seg = 8) => cached(`cone${r}|${h}|${seg}`, () => new THREE.ConeGeometry(r, h, seg)),
  torus: (r, t, arc = Math.PI * 2, rs = 6, ts = 18) => cached(`tor${r}|${t}|${arc}|${rs}|${ts}`, () => new THREE.TorusGeometry(r, t, rs, ts, arc)),
  octa: (r) => cached(`oct${r}`, () => new THREE.OctahedronGeometry(r)),
  ico: (r, d = 0) => cached(`ico${r}|${d}`, () => new THREE.IcosahedronGeometry(r, d)),
  dodeca: (r) => cached(`dod${r}`, () => new THREE.DodecahedronGeometry(r)),
  lathe: (key, pts, seg) => latheGeo(key, pts, seg),
  // flat double-edged blade: diamond cross-section tapering to a point, base at y=0
  blade: (len, w, thick = 0.25) =>
    cached(`blade${len}|${w}|${thick}`, () => {
      const g = new THREE.CylinderGeometry(0.004, w, len, 4, 1);
      g.rotateY(Math.PI / 4);
      g.scale(1, 1, thick);
      g.translate(0, len / 2, 0);
      return g;
    }),
  plane: (w, h) => cached(`pl${w}|${h}`, () => new THREE.PlaneGeometry(w, h)),
};

export function mat(color, o = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: o.rough ?? 0.78,
    metalness: o.metal ?? 0,
    emissive: o.emissive ?? 0x000000,
    emissiveIntensity: o.ei ?? 1,
    flatShading: o.flat ?? false,
    transparent: o.transparent ?? false,
    opacity: o.opacity ?? 1,
    side: o.side ?? THREE.FrontSide,
  });
}

// Add a mesh to `parent`. p = position, r = rotation, s = scale (number or [x,y,z]).
export function part(parent, geo, material, p = [0, 0, 0], r = null, s = null) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(p[0], p[1], p[2]);
  if (r) m.rotation.set(r[0], r[1], r[2]);
  if (s !== null && s !== undefined) {
    if (typeof s === 'number') m.scale.setScalar(s);
    else m.scale.set(s[0], s[1], s[2]);
  }
  parent.add(m);
  return m;
}

// Merge sibling meshes that share a material into one mesh per material
// (per group), keeping joint hierarchy intact. Meshes flagged
// userData.keep, hidden meshes and meshes with children are left alone.
export function mergeStatic(root, { recursive = true, castShadow = false } = {}) {
  const groups = [];
  root.traverse((o) => {
    if (!o.isMesh && o.children.length) groups.push(o);
  });
  if (!recursive) groups.length = 1;
  for (const g of groups) {
    const byMat = new Map();
    for (const c of g.children) {
      if (!c.isMesh || c.isInstancedMesh || c.children.length || c.userData.keep || !c.visible || Array.isArray(c.material)) continue;
      const list = byMat.get(c.material) || [];
      list.push(c);
      byMat.set(c.material, list);
    }
    for (const [m, list] of byMat) {
      if (list.length < 2) continue;
      const geos = [];
      for (const c of list) {
        c.updateMatrix();
        let geo = c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone();
        for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') geo.deleteAttribute(k);
        if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
        if (!geo.attributes.normal) geo.computeVertexNormals();
        geo.applyMatrix4(c.matrix);
        geo.morphAttributes = {};
        geos.push(geo);
      }
      const merged = mergeGeometries(geos, false);
      for (const geo of geos) geo.dispose();
      if (!merged) continue;
      for (const c of list) {
        g.remove(c);
        if (c.userData.ownGeo) c.geometry.dispose();
      }
      const mesh = new THREE.Mesh(merged, m);
      mesh.userData.ownGeo = true;
      mesh.castShadow = castShadow;
      g.add(mesh);
    }
  }
}

function joint(parent, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

export const JOINTS = ['hips', 'spine', 'chest', 'neck', 'head', 'armL', 'foreL', 'handL', 'armR', 'foreR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Proportions are in metres for a ~1.8m hero; `scale` scales the whole rig.
export class Rig {
  constructor(opts = {}) {
    const o = {
      scale: 1,
      hipH: 0.94,
      thigh: 0.44,
      shin: 0.42,
      upper: 0.3,
      fore: 0.27,
      abdomen: 0.2,
      chestH: 0.34,
      shoulderW: 0.25,
      hipW: 0.11,
      ...opts,
    };
    this.o = o;
    this.root = new THREE.Group();
    this.scaler = joint(this.root, 0, 0, 0);
    this.scaler.scale.setScalar(o.scale);
    this.body = joint(this.scaler, 0, o.hipH, 0); // whole-body lean / flips pivot here
    const j = {};
    j.hips = joint(this.body, 0, 0, 0);
    j.spine = joint(j.hips, 0, 0.06, 0);
    j.chest = joint(j.spine, 0, o.abdomen, 0);
    j.neck = joint(j.chest, 0, o.chestH, 0);
    j.head = joint(j.neck, 0, 0.07, 0);
    for (const [side, s] of [
      ['L', 1],
      ['R', -1],
    ]) {
      // +x is the character's left (model faces +z)
      j['arm' + side] = joint(j.chest, s * o.shoulderW, o.chestH * 0.82, 0);
      j['fore' + side] = joint(j['arm' + side], 0, -o.upper, 0);
      j['hand' + side] = joint(j['fore' + side], 0, -o.fore, 0);
      j['thigh' + side] = joint(j.hips, s * o.hipW, -0.03, 0);
      j['shin' + side] = joint(j['thigh' + side], 0, -o.thigh, 0);
      j['foot' + side] = joint(j['shin' + side], 0, -o.shin, 0);
    }
    this.j = j;
    this.pose = {};
    this.vel = {};
    for (const n of JOINTS) {
      this.pose[n] = [0, 0, 0];
      this.vel[n] = [0, 0, 0];
    }
    this.pose.body = [0, 0, 0];
    this.vel.body = [0, 0, 0];
    this.pose.off = [0, 0, 0]; // body translation offset (x sway, y bob, z)
    this.vel.off = [0, 0, 0];
    this.pose.bodyY = 0;
  }

  resetPose() {
    const p = this.pose;
    for (const n of JOINTS) {
      const a = p[n];
      a[0] = a[1] = a[2] = 0;
    }
    p.body[0] = p.body[1] = p.body[2] = 0;
    p.off[0] = p.off[1] = p.off[2] = 0;
    p.bodyY = 0;
  }

  // Legacy exponential blend (used for death falls, where overshoot looks wrong).
  apply(k) {
    const p = this.pose;
    for (const n of JOINTS) {
      const r = this.j[n].rotation;
      const t = p[n];
      r.x += (t[0] - r.x) * k;
      r.y += (t[1] - r.y) * k;
      r.z += (t[2] - r.z) * k;
      const v = this.vel[n];
      v[0] = v[1] = v[2] = 0;
    }
    const b = this.body.rotation;
    b.x += (p.body[0] - b.x) * k;
    b.y += (p.body[1] - b.y) * k;
    b.z += (p.body[2] - b.z) * k;
    const bp = this.body.position;
    bp.x += (p.off[0] - bp.x) * k;
    bp.y += (this.o.hipH + p.bodyY + p.off[1] - bp.y) * k;
    bp.z += (p.off[2] - bp.z) * k;
  }

  // Damped-spring blend: w = stiffness (rad/s), zeta < 1 overshoots slightly.
  spring(dt, w = 22, zeta = 0.7, limbs = null) {
    const steps = Math.max(1, Math.ceil(dt / 0.012));
    const h = dt / steps;
    const p = this.pose;
    const drive = (obj, key, target, v, i, ww) => {
      const x = obj[key];
      const a = ww * ww * (target - x) - 2 * zeta * ww * v[i];
      v[i] += a * h;
      obj[key] = x + v[i] * h;
    };
    for (let s = 0; s < steps; s++) {
      for (const n of JOINTS) {
        const r = this.j[n].rotation;
        const t = p[n];
        const v = this.vel[n];
        // extremities are a touch looser than the core: natural follow-through
        const ww = limbs && limbs[n] ? limbs[n] * w : w;
        drive(r, 'x', t[0], v, 0, ww);
        drive(r, 'y', t[1], v, 1, ww);
        drive(r, 'z', t[2], v, 2, ww);
      }
      const b = this.body.rotation;
      drive(b, 'x', p.body[0], this.vel.body, 0, w);
      drive(b, 'y', p.body[1], this.vel.body, 1, w);
      drive(b, 'z', p.body[2], this.vel.body, 2, w);
      const bp = this.body.position;
      drive(bp, 'x', p.off[0], this.vel.off, 0, w * 1.2);
      drive(bp, 'y', this.o.hipH + p.bodyY + p.off[1], this.vel.off, 1, w * 1.4);
      drive(bp, 'z', p.off[2], this.vel.off, 2, w * 1.2);
    }
  }

  // Walk → run cycle. phase in radians (advanced by distance travelled),
  // s = normalised speed (0 idle, ~1 full run).
  locomotion(phase, s, armSwing = 1) {
    if (s <= 0.001) return;
    const p = this.pose;
    const run = clamp((s - 0.35) / 0.45, 0, 1);
    const amp = clamp(s * 1.6, 0, 1);
    const sn = Math.sin(phase);
    const cs = Math.cos(phase);
    const thighA = (0.45 + 0.5 * run) * amp;
    p.thighL[0] = -sn * thighA;
    p.thighR[0] = sn * thighA;
    // knee folds during the forward swing, more when running
    const kneeA = (0.55 + 1.15 * run) * amp;
    p.shinL[0] = 0.12 * amp + kneeA * Math.max(0, cs) ** 1.3;
    p.shinR[0] = 0.12 * amp + kneeA * Math.max(0, -cs) ** 1.3;
    // heel strike / toe off
    p.footL[0] = -p.thighL[0] * 0.45 - 0.35 * amp * Math.max(0, -cs) * (sn > 0 ? 0.3 : 1);
    p.footR[0] = -p.thighR[0] * 0.45 - 0.35 * amp * Math.max(0, cs) * (sn < 0 ? 0.3 : 1);
    // arms counter-swing; elbows bend into a pump when running
    const armA = (0.35 + 0.45 * run) * amp * armSwing;
    p.armL[0] = sn * armA;
    p.armR[0] = -sn * armA;
    p.armL[2] += 0.06 + 0.1 * run;
    p.armR[2] -= 0.06 + 0.1 * run;
    p.foreL[0] = -0.25 - 1.05 * run * amp - Math.max(0, -sn) * 0.35 * amp;
    p.foreR[0] = -0.25 - 1.05 * run * amp - Math.max(0, sn) * 0.35 * amp;
    // torso: counter-rotation between hips and chest, forward lean, bounce, sway
    p.hips[1] = -sn * (0.1 + 0.1 * run) * amp;
    p.chest[1] = sn * (0.12 + 0.14 * run) * amp;
    p.head[1] = -p.chest[1] * 0.7;
    p.hips[2] = cs * 0.05 * amp;
    p.chest[2] = -cs * 0.04 * amp;
    p.body[0] = (0.04 + 0.2 * run) * amp;
    p.chest[0] += 0.05 * run * amp;
    p.head[0] -= 0.1 * run * amp;
    p.bodyY = -0.03 * amp - 0.04 * run + Math.abs(cs) * (0.03 + 0.07 * run) * amp;
    p.off[0] = cs * 0.025 * amp * (1 - run * 0.5);
  }

  // Breathing, weight shift and contrapposto while standing.
  idle(t, amt = 1) {
    if (amt <= 0.001) return;
    const p = this.pose;
    const b = Math.sin(t * 1.9) * amt;
    const shift = Math.sin(t * 0.45) * amt;
    p.chest[0] += b * 0.035;
    p.neck[0] -= b * 0.025;
    p.armL[2] += (0.1 + b * 0.025) * amt;
    p.armR[2] -= (0.1 + b * 0.025) * amt;
    p.foreL[0] += -0.18 * amt;
    p.foreR[0] += -0.18 * amt;
    p.hips[2] += shift * 0.05;
    p.chest[2] -= shift * 0.035;
    p.head[2] -= shift * 0.02;
    p.off[0] += shift * 0.03;
    // relax the leg that is not carrying the weight
    p.thighL[0] += -Math.max(0, shift) * 0.1;
    p.shinL[0] += Math.max(0, shift) * 0.2;
    p.thighR[0] += -Math.max(0, -shift) * 0.1;
    p.shinR[0] += Math.max(0, -shift) * 0.2;
    p.thighL[2] += 0.045 * amt;
    p.thighR[2] -= 0.045 * amt;
    p.bodyY += (b * 0.006 - Math.abs(shift) * 0.012) * amt;
  }
}

// ------------------------------------------------------------- body pieces
const f = (n) => Math.round(n * 1000) / 1000;

// Build a sculpted humanoid body (skin + clothes) onto a rig.
// m: { skin, cloth, cloth2, boots, glove? }  opts: { headR, torsoW, torsoD, limbR, legR, belly, boots }
export function buildHumanBody(rig, m, opts = {}) {
  const o = { headR: 0.15, torsoW: 0.36, torsoD: 0.22, limbR: 0.07, legR: 0.085, belly: 0, neck: true, boots: true, ears: true, trap: true, ...opts };
  const j = rig.j;
  const r = rig.o;
  const parts = {};
  const w = o.torsoW * 0.5;
  const H = r.chestH;
  const A = r.abdomen;
  const dz = o.torsoD / o.torsoW;
  const key = `${f(w)}|${f(H)}|${f(A)}`;
  parts.pelvis = part(j.hips, G.lathe('pel' + key, [[0.001, -0.17], [0.55 * w, -0.16], [0.9 * w, -0.09], [0.97 * w, 0], [0.9 * w, 0.09], [0.001, 0.1]], 14), m.cloth2, [0, 0, 0], null, [1, 1, dz * 1.05]);
  parts.abdomen = part(j.spine, G.lathe('abd' + key, [[0.001, -0.04], [0.9 * w, -0.04], [0.86 * w, A * 0.5], [0.84 * w, A + 0.03], [0.001, A + 0.04]], 14), m.cloth, [0, 0, 0], null, [1, 1, dz * 1.05]);
  parts.chest = part(
    j.chest,
    G.lathe('chest' + key, [[0.001, -0.02], [0.84 * w, -0.02], [0.93 * w, H * 0.22], [1.02 * w, H * 0.52], [1.07 * w, H * 0.76], [0.98 * w, H * 0.9], [0.62 * w, H * 0.99], [0.3 * w, H * 1.03], [0.001, H * 1.04]], 16),
    m.cloth,
    [0, 0, 0],
    null,
    [1, 1, dz],
  );
  if (o.belly)
    parts.belly = part(j.spine, G.sphere(1, 14, 10), m.skin, [0, A * 0.5, o.torsoD * 0.25], null, [o.torsoW * 0.55 * o.belly, A * 0.9 * o.belly, o.torsoD * 0.7 * o.belly]);
  if (o.neck) {
    parts.neck = part(j.neck, G.cyl(0.056, 0.066, 0.13, 10), m.skin, [0, 0.02, 0]);
    if (o.trap) part(j.chest, G.cone(w * 0.62, 0.1, 12), m.cloth, [0, H * 0.99, 0], null, [1, 1, dz * 0.9]); // trapezius slope
  }
  // head: egg-shaped lathe with a jaw, ears, cheeks
  const R = o.headR;
  parts.head = part(
    j.head,
    G.lathe('head' + f(R), [[0.001, 0], [0.42 * R, 0.03 * R], [0.74 * R, 0.32 * R], [0.94 * R, 0.78 * R], [1.0 * R, 1.2 * R], [0.9 * R, 1.62 * R], [0.6 * R, 1.95 * R], [0.001, 2.08 * R]], 16),
    m.skin,
    [0, 0, 0.005],
    null,
    [1, 1, 1.1],
  );
  parts.jaw = part(j.head, G.sphere(R * 0.62, 12, 8), m.skin, [0, R * 0.32, R * 0.32], null, [1, 0.7, 0.9]);
  if (o.ears) for (const s of [1, -1]) part(j.head, G.sphere(R * 0.2, 8, 6), m.skin, [s * R * 0.97, R * 0.98, -R * 0.05], null, [0.45, 1.1, 0.8]);

  const lr = o.limbR;
  const LR = o.legR;
  const lk = `${f(lr)}|${f(r.upper)}|${f(r.fore)}`;
  const kk = `${f(LR)}|${f(r.thigh)}|${f(r.shin)}`;
  const upperGeo = G.lathe('up' + lk, [[0.001, 0.07], [0.9 * lr, 0.05], [1.18 * lr, -0.03], [1.05 * lr, -0.12], [0.94 * lr, -r.upper * 0.7], [0.82 * lr, -r.upper + 0.01], [0.001, -r.upper - 0.04]], 10);
  const foreGeo = G.lathe('fo' + lk, [[0.001, 0.035], [0.84 * lr, 0.015], [0.98 * lr, -0.07], [0.72 * lr, -r.fore + 0.03], [0.64 * lr, -r.fore + 0.005], [0.001, -r.fore - 0.01]], 10);
  const thighGeo = G.lathe('th' + kk, [[0.001, 0.06], [1.02 * LR, 0.03], [1.12 * LR, -0.09], [0.96 * LR, -r.thigh * 0.62], [0.78 * LR, -r.thigh + 0.02], [0.001, -r.thigh - 0.05]], 10);
  const shinGeo = G.lathe('sh' + kk, [[0.001, 0.03], [0.8 * LR, 0.01], [0.92 * LR, -0.12], [0.62 * LR, -r.shin + 0.05], [0.56 * LR, -r.shin + 0.01], [0.001, -r.shin - 0.02]], 10);
  const hand = m.glove || m.skin;
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? 1 : -1;
    parts['shoulder' + side] = part(j['arm' + side], G.sphere(lr * 1.28, 10, 8), m.cloth, [s * 0.01, -0.01, 0]);
    parts['upper' + side] = part(j['arm' + side], upperGeo, m.cloth);
    parts['fore' + side] = part(j['fore' + side], foreGeo, o.bareArms ? m.skin : hand);
    // mitten hand: palm, curled fingers and a thumb
    const hj = j['hand' + side];
    parts['hand' + side] = part(hj, G.sphere(lr * 0.95, 10, 8), hand, [0, -0.04, 0.005], null, [0.95, 1.15, 0.62]);
    part(hj, G.capsule(lr * 0.36, lr * 0.95, 6), hand, [0, -0.1, 0.018], [0, 0, Math.PI / 2], [1, 1, 1.25]);
    part(hj, G.capsule(lr * 0.26, lr * 0.55, 6), hand, [-s * lr * 0.62, -0.05, 0.035], [0.5, 0, s * 0.6]);
    parts['thigh' + side] = part(j['thigh' + side], thighGeo, m.cloth2);
    parts['knee' + side] = part(j['shin' + side], G.sphere(LR * 0.78, 8, 6), m.cloth2, [0, 0, 0.015]);
    parts['shin' + side] = part(j['shin' + side], shinGeo, o.boots ? m.cloth2 : m.boots);
    const fj = j['foot' + side];
    if (o.boots) {
      // boot shaft with a folded cuff
      part(j['shin' + side], G.cyl(LR * 0.76, LR * 0.66, r.shin * 0.55, 10), m.boots, [0, -r.shin * 0.72, 0]);
      part(j['shin' + side], G.torus(LR * 0.8, LR * 0.14, Math.PI * 2, 5, 12), m.boots, [0, -r.shin * 0.44, 0], [Math.PI / 2, 0, 0]);
    }
    parts['foot' + side] = part(fj, G.capsule(LR * 0.6, 0.12, 6), m.boots, [0, -0.025, 0.045], [Math.PI / 2, 0, 0], [1.1, 1, 0.72]);
    part(fj, G.sphere(LR * 0.62, 8, 6), m.boots, [0, -0.035, 0.13], null, [1.05, 0.62, 1.1]);
    part(fj, G.box(LR * 1.3, 0.025, 0.26), m.sole || m.boots, [0, -0.07, 0.05]);
  }
  return parts;
}

// Shared eye materials
let EYE = null;
function eyeMats() {
  if (!EYE) EYE = { white: mat(0xf2ede4, { rough: 0.3 }), mouth: mat(0x3a1a18, { rough: 0.9 }) };
  return EYE;
}

// Face: eyes with whites + irises and blinking lids, brows, nose, lips.
export function buildFace(rig, m, o = {}) {
  const R = o.headR ?? 0.15;
  const head = rig.j.head;
  const y = R * 1.08;
  const E = eyeMats();
  const irisMat = o.eyeMat || m.eye;
  const out = { eyes: [] };
  for (const s of [1, -1]) {
    const eye = new THREE.Group();
    eye.position.set(s * R * 0.36, y + (o.eyeY ?? 0), R * 0.9);
    eye.userData.keep = true;
    head.add(eye);
    part(eye, G.sphere(R * 0.15, 10, 8), E.white, [0, 0, 0], null, [1, 0.85, 0.7]);
    part(eye, G.sphere(R * 0.085, 8, 6), irisMat, [0, 0, R * 0.09], null, [1, 1, 0.5]);
    // upper lid (skin) that drops when blinking
    const lid = part(eye, G.hemi(R * 0.165, 10), m.skin, [0, 0, 0.004], [-0.3, 0, 0], [1, 0.35, 0.85]);
    lid.userData.keep = true;
    out.eyes.push(eye);
    out['lid' + s] = lid;
    if (m.brow) part(head, G.box(R * 0.44, R * 0.085, R * 0.12), m.brow, [s * R * 0.37, y + R * 0.26, R * 0.9], [0.15, 0, s * (o.browTilt ?? 0.1)]);
  }
  if (o.nose !== false) {
    part(head, G.cone(R * 0.13, R * (o.noseLen ?? 0.38), 4), o.noseMat || m.skin, [0, y - R * 0.18, R * 1.02], [Math.PI / 2 - 0.25, Math.PI / 4, 0], [1, 1, 0.9]);
    part(head, G.sphere(R * 0.09, 8, 6), o.noseMat || m.skin, [0, y - R * 0.3, R * 1.08]);
  }
  if (o.mouth !== false) part(head, G.box(R * 0.42, R * 0.045, R * 0.05), E.mouth, [0, R * 0.52, R * 0.98], [0, 0, 0]);
  return out;
}
