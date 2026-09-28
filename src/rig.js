// Shared geometry/material helpers for procedural pieces (effects, props,
// pickups, the wisp). Characters are rigged glTF models (see assets.js).

import * as THREE from 'three';

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
