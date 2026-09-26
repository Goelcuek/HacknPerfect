// Jointed humanoid rig + small geometry/material helpers + pose blending.
// Joints are plain Groups; animation code fills a pose table each frame and
// the rig eases every joint toward it, so state changes blend smoothly.

import * as THREE from 'three';

// ------------------------------------------------------------ shared geometry
const geoCache = new Map();
function cached(key, make) {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
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

function joint(parent, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

export const JOINTS = ['hips', 'spine', 'chest', 'neck', 'head', 'armL', 'foreL', 'handL', 'armR', 'foreR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];

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
    for (const n of JOINTS) this.pose[n] = [0, 0, 0];
    this.pose.bodyY = 0;
    this.pose.body = [0, 0, 0];
    this.pose.hipsY = 0;
  }

  // Reset the pose table to neutral before animation code writes into it.
  resetPose() {
    const p = this.pose;
    for (const n of JOINTS) {
      const a = p[n];
      a[0] = a[1] = a[2] = 0;
    }
    p.body[0] = p.body[1] = p.body[2] = 0;
    p.bodyY = 0;
  }

  // Ease every joint toward the pose table. k in 0..1 (1 = snap).
  apply(k, snapBodyY = false) {
    const p = this.pose;
    for (const n of JOINTS) {
      const r = this.j[n].rotation;
      const t = p[n];
      r.x += (t[0] - r.x) * k;
      r.y += (t[1] - r.y) * k;
      r.z += (t[2] - r.z) * k;
    }
    const b = this.body.rotation;
    b.x += (p.body[0] - b.x) * k;
    b.y += (p.body[1] - b.y) * k;
    b.z += (p.body[2] - b.z) * k;
    const by = this.o.hipH + p.bodyY;
    this.body.position.y += (by - this.body.position.y) * (snapBodyY ? 1 : k);
  }

  // Standard walk / run cycle written into the pose table.
  // phase: radians, amp: 0..1.3 (0 = standing)
  locomotion(phase, amp, armSwing = 1) {
    const p = this.pose;
    const s = Math.sin(phase);
    const c = Math.cos(phase);
    p.thighL[0] = -s * 0.85 * amp;
    p.thighR[0] = s * 0.85 * amp;
    p.shinL[0] = amp * (0.2 + 1.15 * Math.max(0, c));
    p.shinR[0] = amp * (0.2 + 1.15 * Math.max(0, -c));
    p.footL[0] = -p.thighL[0] * 0.35 - 0.25 * amp * Math.max(0, -c);
    p.footR[0] = -p.thighR[0] * 0.35 - 0.25 * amp * Math.max(0, c);
    p.armL[0] = s * 0.7 * amp * armSwing;
    p.armR[0] = -s * 0.7 * amp * armSwing;
    p.foreL[0] = -0.35 - Math.max(0, -s) * 0.6 * amp * armSwing;
    p.foreR[0] = -0.35 - Math.max(0, s) * 0.6 * amp * armSwing;
    p.chest[1] = s * 0.18 * amp;
    p.hips[1] = -s * 0.14 * amp;
    p.body[0] = 0.1 * amp;
    p.bodyY = -0.05 * amp + Math.abs(c) * 0.07 * amp;
  }

  // Gentle breathing idle.
  idle(t, amt = 1) {
    const p = this.pose;
    const b = Math.sin(t * 2.2) * amt;
    p.chest[0] += b * 0.025;
    p.neck[0] -= b * 0.02;
    p.armL[2] += 0.1 + b * 0.02;
    p.armR[2] -= 0.1 + b * 0.02;
    p.foreL[0] += -0.15;
    p.foreR[0] += -0.15;
    p.thighL[2] += 0.04;
    p.thighR[2] -= 0.04;
    p.bodyY += b * 0.008;
  }
}

// Build a humanoid body (skin + clothes) onto a rig.
// m: { skin, cloth, cloth2, boots, glove? }  opts: { headR, torsoW, torsoD, limbR, belly }
export function buildHumanBody(rig, m, opts = {}) {
  const o = { headR: 0.15, torsoW: 0.36, torsoD: 0.22, limbR: 0.07, legR: 0.085, belly: 0, neck: true, ...opts };
  const j = rig.j;
  const r = rig.o;
  const parts = {};
  // pelvis + abdomen + chest
  parts.pelvis = part(j.hips, G.sphere(1, 12, 8), m.cloth2, [0, -0.02, 0], null, [o.torsoW * 0.52, 0.14, o.torsoD * 0.62]);
  parts.abdomen = part(j.spine, G.cyl(o.torsoW * 0.42, o.torsoW * 0.47, r.abdomen + 0.08, 12), m.cloth, [0, r.abdomen / 2, 0], null, [1, 1, o.torsoD / o.torsoW + 0.12]);
  parts.chest = part(j.chest, G.sphere(1, 14, 10), m.cloth, [0, r.chestH * 0.52, 0], null, [o.torsoW * 0.6, r.chestH * 0.62, o.torsoD * 0.66]);
  if (o.belly) parts.belly = part(j.spine, G.sphere(1, 12, 9), m.skin, [0, r.abdomen * 0.5, o.torsoD * 0.25], null, [o.torsoW * 0.55 * o.belly, r.abdomen * 0.9 * o.belly, o.torsoD * 0.7 * o.belly]);
  if (o.neck) parts.neck = part(j.neck, G.cyl(0.055, 0.065, 0.12, 8), m.skin, [0, 0.02, 0]);
  parts.head = part(j.head, G.sphere(o.headR, 14, 11), m.skin, [0, o.headR * 0.95, 0.01], null, [1, 1.08, 1.04]);
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? 1 : -1;
    parts['shoulder' + side] = part(j['arm' + side], G.sphere(o.limbR * 1.35, 10, 8), m.cloth, [0, -0.02, 0]);
    parts['upper' + side] = part(j['arm' + side], G.capsule(o.limbR, r.upper - o.limbR * 1.2, 8), m.cloth, [0, -r.upper / 2, 0]);
    parts['fore' + side] = part(j['fore' + side], G.capsule(o.limbR * 0.88, r.fore - o.limbR * 1.2, 8), m.glove || m.skin, [0, -r.fore / 2, 0]);
    parts['hand' + side] = part(j['hand' + side], G.sphere(o.limbR * 1.05, 10, 8), m.glove || m.skin, [0, -0.03, 0.01], null, [1, 1.15, 0.9]);
    parts['thigh' + side] = part(j['thigh' + side], G.capsule(o.legR, r.thigh - o.legR * 1.3, 8), m.cloth2, [0, -r.thigh / 2, 0]);
    parts['shin' + side] = part(j['shin' + side], G.capsule(o.legR * 0.82, r.shin - o.legR * 1.2, 8), m.boots, [0, -r.shin / 2, 0]);
    parts['foot' + side] = part(j['foot' + side], G.capsule(o.legR * 0.62, 0.12, 6), m.boots, [0, -0.02, 0.05], [Math.PI / 2, 0, 0], [1.1, 1, 0.75]);
    void s;
  }
  return parts;
}

// Face details: eyes + brows + nose. Eyes sit on the head sphere's front.
export function buildFace(rig, m, o = {}) {
  const hr = o.headR ?? 0.15;
  const head = rig.j.head;
  const y = hr * 1.0;
  const eyeMat = o.eyeMat || m.eye;
  const out = {};
  for (const s of [1, -1]) {
    out['eye' + s] = part(head, G.sphere(hr * 0.13, 8, 6), eyeMat, [s * hr * 0.36, y + (o.eyeY ?? 0.02), hr * 0.93], null, [1, o.eyeSquash ?? 0.8, 0.6]);
    if (m.brow) part(head, G.box(hr * 0.42, hr * 0.09, hr * 0.12), m.brow, [s * hr * 0.36, y + hr * 0.22, hr * 0.92], [0, 0, s * (o.browTilt ?? 0.12)]);
  }
  if (o.nose !== false) part(head, G.cone(hr * 0.12, hr * (o.noseLen ?? 0.35), 6), o.noseMat || m.skin, [0, y - hr * 0.1, hr * 1.02], [Math.PI / 2, 0, 0]);
  return out;
}
