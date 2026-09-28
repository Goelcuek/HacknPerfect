// 3D models for weapons and loot drops. Shape varies with the item's variant;
// materials and ornaments (gold trim, glowing fuller, gems) scale with rarity tier.

import * as THREE from 'three';
import { G, mat, part } from './rig.js';
import { applySurface, metalSurface, leatherSurface } from './textures.js';
import { gearModel } from './assets.js';

export function gearMats(tier, hex) {
  const metal = new THREE.Color(0xb4bac4).lerp(new THREE.Color(hex), [0.02, 0.22, 0.35, 0.45, 0.55][tier]);
  const M = {
    metal: mat(metal, { metal: 0.55, rough: 0.3, emissive: tier >= 3 ? hex : 0x000000, ei: 0.22 }),
    glow: mat(hex, { emissive: hex, ei: 1.6 }),
    grip: mat(tier >= 3 ? 0x2a1a2e : 0x4a2e1a, { rough: 0.9 }),
    gold: mat(0xe8c14a, { metal: 0.65, rough: 0.3 }),
    wood: mat(tier >= 2 ? 0x3a2418 : 0x6e4a2a, { rough: 0.8 }),
    dark: mat(0x2a2a30, { metal: 0.4, rough: 0.5 }),
    string: mat(0xefe8d8, { rough: 1 }),
  };
  applySurface(M.metal, metalSurface(), 0.5);
  applySurface(M.gold, metalSurface(), 0.4);
  applySurface(M.grip, leatherSurface(), 1);
  return M;
}

// ------------------------------------------------------------------ weapons
function sword(variant, tier, M) {
  const g = new THREE.Group();
  const trim = tier >= 2 ? M.gold : M.metal;
  part(g, G.cyl(0.024, 0.028, 0.2, 8), M.grip);
  part(g, G.sphere(0.042, 8, 6), trim, [0, -0.12, 0]);
  if (variant === 0) part(g, G.box(0.3, 0.045, 0.065), trim, [0, 0.12, 0]);
  else if (variant === 1) part(g, G.torus(0.13, 0.022, Math.PI, 6, 12), trim, [0, 0.25, 0], [0, 0, Math.PI]);
  else {
    part(g, G.cone(0.035, 0.22, 5), trim, [0.1, 0.16, 0], [0, 0, -1.1]);
    part(g, G.cone(0.035, 0.22, 5), trim, [-0.1, 0.16, 0], [0, 0, 1.1]);
    part(g, G.box(0.1, 0.05, 0.06), trim, [0, 0.12, 0]);
  }
  const len = [0.84, 0.76, 0.98][variant] + tier * 0.04;
  const w = [0.06, 0.092, 0.05][variant];
  part(g, G.blade(len, w, 0.22), M.metal, [0, 0.14, 0]);
  if (tier >= 2) part(g, G.box(0.014, len * 0.72, 0.03), M.glow, [0, 0.14 + len * 0.4, 0]);
  if (tier >= 3) {
    part(g, G.octa(0.034), M.glow, [0, 0.12, 0.036]);
    part(g, G.octa(0.034), M.glow, [0, 0.12, -0.036]);
  }
  const tip = new THREE.Object3D();
  tip.position.y = 0.14 + len;
  g.add(tip);
  g.userData.tip = tip;
  return g;
}

function dagger(variant, tier, M) {
  const g = new THREE.Group();
  const trim = tier >= 2 ? M.gold : M.dark;
  part(g, G.cyl(0.02, 0.024, 0.13, 8), M.grip);
  part(g, G.sphere(0.03, 8, 6), trim, [0, -0.08, 0]);
  part(g, G.box(0.13, 0.03, 0.045), trim, [0, 0.075, 0]);
  const len = 0.34 + tier * 0.025;
  part(g, G.blade(len, variant === 2 ? 0.055 : 0.042, 0.25), M.metal, [0, 0.09, 0]);
  if (variant === 1) part(g, G.cone(0.02, 0.12, 4), M.metal, [0, 0.14, -0.04], [-2.3, 0, 0]);
  if (variant === 2) for (let i = 0; i < 3; i++) part(g, G.cone(0.012, 0.04, 4), M.metal, [0.035, 0.14 + i * 0.07, 0], [0, 0, -1.2]);
  if (tier >= 3) part(g, G.box(0.01, len * 0.6, 0.02), M.glow, [0, 0.09 + len * 0.35, 0]);
  const tip = new THREE.Object3D();
  tip.position.y = 0.09 + len;
  g.add(tip);
  g.userData.tip = tip;
  return g;
}

function staff(variant, tier, M) {
  const g = new THREE.Group();
  part(g, G.cyl(0.028, 0.034, 1.72, 8), M.wood, [0, 0.29, 0]);
  const bands = tier >= 2 ? M.gold : M.dark;
  for (const y of [-0.52, 0.12, 0.9]) part(g, G.cyl(0.04, 0.04, 0.05, 8), bands, [0, y, 0]);
  const top = 1.16;
  if (variant === 0) {
    // crystal cradled by prongs
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      part(g, G.cone(0.025, 0.24, 5), bands, [Math.cos(a) * 0.06, top + 0.08, Math.sin(a) * 0.06], [Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35]);
    }
    part(g, G.octa(0.09), M.glow, [0, top + 0.2, 0], null, [1, 1.7, 1]);
  } else if (variant === 1) {
    part(g, G.sphere(0.1, 12, 10), M.glow, [0, top + 0.12, 0]);
    part(g, G.torus(0.15, 0.015, Math.PI * 2, 5, 18), bands, [0, top + 0.12, 0], [Math.PI / 2, 0, 0]);
    part(g, G.torus(0.15, 0.015, Math.PI * 2, 5, 18), bands, [0, top + 0.12, 0], [0, 0, 0]);
  } else {
    part(g, G.torus(0.16, 0.03, Math.PI * 1.4, 6, 14), M.wood, [0, top + 0.12, 0], [0, 0, -Math.PI * 0.2]);
    part(g, G.octa(0.07), M.glow, [0, top + 0.12, 0]);
  }
  if (tier >= 3) part(g, G.octa(0.04), M.glow, [0, top - 0.2, 0.04]);
  const tip = new THREE.Object3D();
  tip.position.y = top + 0.2;
  g.add(tip);
  g.userData.tip = tip;
  return g;
}

function bow(variant, tier, M) {
  const g = new THREE.Group();
  const H = [0.7, 0.6, 0.64][variant];
  const pts =
    variant === 1
      ? [[0, -H, -0.06], [0, -H * 0.84, -0.2], [0, -H * 0.45, -0.1], [0, 0, 0.03], [0, H * 0.45, -0.1], [0, H * 0.84, -0.2], [0, H, -0.06]]
      : [[0, -H, -0.22], [0, -H * 0.5, -0.06], [0, 0, 0.03], [0, H * 0.5, -0.06], [0, H, -0.22]];
  const curve = new THREE.CatmullRomCurve3(pts.map((v) => new THREE.Vector3(...v)));
  const limbGeo = new THREE.TubeGeometry(curve, 28, 0.022 + tier * 0.003, 6);
  g.add(new THREE.Mesh(limbGeo, tier >= 3 ? M.metal : M.wood));
  part(g, G.cyl(0.034, 0.034, 0.18, 8), M.grip);
  if (tier >= 2) for (const y of [-0.3, 0.3]) part(g, G.cyl(0.032, 0.032, 0.04, 8), M.gold, [0, y, -0.05]);
  const tipTop = pts[pts.length - 1];
  const tipBot = pts[0];
  if (variant === 2 || tier >= 3) {
    part(g, G.cone(0.03, 0.1, 5), tier >= 3 ? M.glow : M.gold, [tipTop[0], tipTop[1] + 0.04, tipTop[2]]);
    part(g, G.cone(0.03, 0.1, 5), tier >= 3 ? M.glow : M.gold, [tipBot[0], tipBot[1] - 0.04, tipBot[2]], [Math.PI, 0, 0]);
  }
  // string halves + nocked arrow
  const s1 = part(g, G.cyl(0.006, 0.006, 1, 4), M.string);
  const s2 = part(g, G.cyl(0.006, 0.006, 1, 4), M.string);
  s1.userData.keep = s2.userData.keep = true;
  const arrow = new THREE.Group();
  part(arrow, G.cyl(0.01, 0.01, 0.75, 5), M.wood, [0, 0, 0.37], [Math.PI / 2, 0, 0]);
  part(arrow, G.cone(0.025, 0.08, 5), M.metal, [0, 0, 0.78], [Math.PI / 2, 0, 0]);
  part(arrow, G.box(0.004, 0.05, 0.1), M.glow, [0, 0.02, 0.05]);
  part(arrow, G.box(0.05, 0.004, 0.1), M.glow, [0.02, 0, 0.05]);
  g.add(arrow);
  const up = new THREE.Vector3(0, 1, 0);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const nock = new THREE.Vector3();
  const place = (m, p, q) => {
    a.set(p[0], p[1], p[2]);
    b.subVectors(q, a);
    const len = b.length();
    m.position.copy(a).addScaledVector(b, 0.5);
    m.quaternion.setFromUnitVectors(up, b.normalize());
    m.scale.set(1, len, 1);
  };
  g.userData.restZ = tipTop[2];
  g.userData.setNockZ = (z, showArrow) => {
    nock.set(0, 0, z);
    place(s1, tipTop, nock);
    place(s2, tipBot, nock);
    arrow.visible = showArrow;
    arrow.position.copy(nock);
  };
  g.userData.setDraw = (d, showArrow) => g.userData.setNockZ(tipTop[2] - d * 0.52, showArrow);
  g.userData.setDraw(0, false);
  g.userData.ownGeos = [limbGeo];
  return g;
}

// Returns { main, off, bow } — groups to mount in the right hand, left hand.
export function buildWeapon(item) {
  const tier = item.rarity.tier ?? 0;
  // common staffs still glow with plain arcane blue
  const hex = tier === 0 && item.wtype === 'staff' ? 0x7ab8ff : item.rarity.hex;
  const variant = item.visual?.variant ?? 0;
  const M = gearMats(tier, hex);
  const out = { main: null, off: null, bow: null, tips: [], mats: M, ownGeos: [] };
  if (item.wtype === 'bow') {
    out.off = bow(variant, tier, M);
    out.bow = out.off;
    out.ownGeos = out.off.userData.ownGeos;
    out.tips.push(out.off);
  } else if (item.wtype === 'staff') {
    out.main = staff(variant, tier, M);
    out.tips.push(out.main.userData.tip);
  } else if (item.wtype === 'daggers') {
    out.main = dagger(variant, tier, M);
    out.off = dagger(variant, tier, M);
    out.tips.push(out.main.userData.tip, out.off.userData.tip);
  } else {
    out.main = sword(variant, tier, M);
    out.tips.push(out.main.userData.tip);
  }
  out.dispose = () => {
    for (const k in M) M[k].dispose();
    for (const geo of out.ownGeos) geo.dispose();
  };
  return out;
}

// ------------------------------------------------------------- ground drops
export function buildDropModel(item) {
  const tier = item.rarity.tier ?? 0;
  const hex = item.rarity.hex;
  const g = new THREE.Group();
  if (item.slot === 'weapon') {
    // the same KayKit weapon the hero will hold, glowing with its rarity
    const name = { sword: tier >= 2 ? 'sword_2handed_color' : 'sword_1handed', axe: 'axe_2handed', staff: 'staff', daggers: 'dagger', bow: 'crossbow_2handed' }[item.wtype];
    const m = name && gearModel(name);
    if (m) {
      const scale = { sword: 0.75, axe: 0.75, staff: 0.6, daggers: 0.9, bow: 0.8 }[item.wtype];
      m.scale.setScalar(scale);
      m.position.y = item.wtype === 'bow' ? 0 : -0.45 * scale;
      const mats = [];
      m.traverse((o) => {
        if (!o.isMesh) return;
        mats.push(o.material);
        if (tier >= 1) {
          o.material.emissive.setHex(hex);
          o.material.emissiveIntensity = [0, 0.12, 0.25, 0.45, 0.7][tier];
        }
      });
      g.add(m);
      g.rotation.z = item.wtype === 'bow' ? 0 : 0.35;
      g.userData.dispose = () => mats.forEach((mt) => mt.dispose());
      return g;
    }
    const w = buildWeapon(item);
    const wm = w.main || w.off;
    g.add(wm);
    g.userData.dispose = w.dispose;
    return g;
  }
  const M = gearMats(tier, hex);
  if (item.slot === 'armor') {
    const cloth = mat(new THREE.Color(0x5a6070).lerp(new THREE.Color(hex), 0.4), { rough: 0.7 });
    M.cloth = cloth;
    part(g, G.sphere(1, 12, 9), cloth, [0, 0, 0], null, [0.24, 0.26, 0.15]);
    part(g, G.sphere(1, 12, 9), M.metal, [0, 0.03, 0.02], null, [0.22, 0.22, 0.15]);
    if (tier >= 1) for (const s of [1, -1]) part(g, G.hemi(0.11), M.metal, [s * 0.24, 0.16, 0], [0, 0, -s * 0.5]);
    if (tier >= 2) part(g, G.torus(0.2, 0.02, Math.PI * 2, 5, 16), M.gold, [0, -0.18, 0], [Math.PI / 2, 0, 0], [1, 0.7, 1]);
    if (tier >= 3) part(g, G.octa(0.05), M.glow, [0, 0.08, 0.17]);
  } else {
    part(g, G.torus(0.12, 0.012, Math.PI * 2, 4, 16), M.gold, [0, 0.1, 0]);
    part(g, G.octa(0.09), M.glow, [0, -0.04, 0], null, [1, 1.3, 1]);
  }
  g.userData.dispose = () => {
    for (const k in M) M[k].dispose();
  };
  return g;
}
