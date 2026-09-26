// Builds the player character for a class and dresses it from equipment:
// the weapon model, armor pieces by rarity tier and the charm all show on the body.

import * as THREE from 'three';
import { Rig, G, mat, part, buildHumanBody, buildFace } from './rig.js';
import { CLASSES } from './classes.js';
import { buildWeapon } from './gear.js';

const BODY = {
  knight: { rig: { shoulderW: 0.27 }, body: { torsoW: 0.4, torsoD: 0.24, limbR: 0.077, legR: 0.09 } },
  ranger: { rig: {}, body: { torsoW: 0.34, torsoD: 0.21, limbR: 0.066, legR: 0.08 } },
  mage: { rig: { shoulderW: 0.24 }, body: { torsoW: 0.33, torsoD: 0.21, limbR: 0.064, legR: 0.078 } },
  rogue: { rig: { shoulderW: 0.24 }, body: { torsoW: 0.32, torsoD: 0.2, limbR: 0.064, legR: 0.078 } },
};
const HEAD_R = 0.15;

const hairGeo = new THREE.SphereGeometry(0.155, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.56);
// open-faced hood shell (front left open)
const hoodGeo = new THREE.SphereGeometry(0.18, 14, 10, Math.PI / 2 + 0.62, Math.PI * 2 - 1.24, 0, Math.PI * 0.64);

export function buildHero(clsId) {
  const cls = CLASSES[clsId];
  const pal = cls.palette;
  const spec = BODY[clsId];
  const rig = new Rig(spec.rig);
  const mats = {
    skin: mat(pal.skin, { rough: 0.85 }),
    hair: mat(pal.hair, { rough: 0.95 }),
    cloth: mat(pal.cloth),
    cloth2: mat(pal.cloth2),
    leather: mat(pal.leather, { rough: 0.9 }),
    boots: mat(new THREE.Color(pal.leather).multiplyScalar(0.7), { rough: 0.9 }),
    metal: mat(pal.metal, { metal: 0.5, rough: 0.35 }),
    trim: mat(pal.trim, { metal: 0.6, rough: 0.3 }),
    glow: mat(0xffffff, { emissive: 0xffffff, ei: 1.5 }),
    eye: mat(pal.eye, { rough: 0.3 }),
    dark: mat(0x1c1c22, { rough: 0.8 }),
    cape: mat(clsId === 'knight' ? 0x9a2a2a : clsId === 'mage' ? 0x3a2560 : clsId === 'ranger' ? 0x3a4a2a : 0x8a2a2a, { side: THREE.DoubleSide }),
  };
  mats.brow = mats.hair;
  mats.glove = clsId === 'mage' ? mats.skin : mats.leather;
  const parts = buildHumanBody(rig, { skin: mats.skin, cloth: mats.cloth, cloth2: mats.cloth2, boots: mats.boots, glove: mats.glove }, { headR: HEAD_R, ...spec.body });
  const face = buildFace(rig, mats, { headR: HEAD_R });

  const hero = { cls, clsId, rig, mats, parts, face, mesh: rig.root, slots: {}, weapon: null, cape: null, orbit: null, tier: -1 };
  const j = rig.j;
  const slotDefs = { head: j.head, chest: j.chest, hips: j.hips, armL: j.armL, armR: j.armR, foreL: j.foreL, foreR: j.foreR, shinL: j.shinL, shinR: j.shinR, handL: j.handL, handR: j.handR };
  for (const k in slotDefs) {
    const g = new THREE.Group();
    slotDefs[k].add(g);
    hero.slots[k] = g;
  }
  // weapon mounts: model +Y points out of the fist
  for (const k of ['handL', 'handR']) {
    const m = new THREE.Group();
    m.rotation.x = Math.PI / 2;
    m.position.set(0, -0.05, 0.02);
    j[k].add(m);
    hero.slots[k + 'Mount'] = m;
  }
  hero.body = spec.body;
  return hero;
}

function clearSlot(g) {
  for (let i = g.children.length - 1; i >= 0; i--) {
    const c = g.children[i];
    c.traverse((o) => {
      if (o.userData.ownGeo && o.geometry) o.geometry.dispose();
    });
    g.remove(c);
  }
}

// Recolour the base materials so better armor visibly changes the outfit.
function tintOutfit(hero, armor) {
  const pal = hero.cls.palette;
  const m = hero.mats;
  const t = armor ? armor.rarity.tier : -1;
  const hex = armor ? armor.rarity.hex : 0xffffff;
  const k = [0, 0.12, 0.2, 0.26, 0.3, 0.32][t + 1];
  m.cloth.color.setHex(pal.cloth).lerp(new THREE.Color(hex), k * 0.6);
  if (armor && armor.visual) m.cloth.color.offsetHSL((armor.visual.hue - 0.5) * 0.12, 0, 0);
  m.metal.color.setHex(pal.metal).lerp(new THREE.Color(hex), [0, 0.05, 0.12, 0.18, 0.24, 0.28][t + 1]);
  m.metal.emissive.setHex(t >= 3 ? hex : 0x000000);
  m.metal.emissiveIntensity = t >= 3 ? 0.08 : 1;
  m.trim.color.setHex(t >= 3 ? hex : pal.trim).lerp(new THREE.Color(pal.trim), 0.5);
  m.glow.color.setHex(hex);
  m.glow.emissive.setHex(hex);
  m.cape.color.setHex(hero.clsId === 'knight' ? 0x9a2a2a : hero.clsId === 'mage' ? 0x3a2560 : hero.clsId === 'ranger' ? 0x3a4a2a : 0x8a2a2a);
  if (t >= 2) m.cape.color.lerp(new THREE.Color(hex), 0.35);
  m.cape.emissive.setHex(t >= 4 ? hex : 0x000000);
  m.cape.emissiveIntensity = 0.2;
  // eyes glow on the best sets
  m.eye.emissive.setHex(t >= 3 ? hex : 0x000000);
  m.eye.color.setHex(t >= 3 ? hex : hero.cls.palette.eye);
}

// Curved two-segment cape: a slice of an open cylinder wrapped around the back.
const capeGeos = new Map();
function capeGeo(width, seg, r) {
  const key = `${width}|${seg}|${r}`;
  if (!capeGeos.has(key)) {
    const arc = Math.min(2.2, width / r);
    const g = new THREE.CylinderGeometry(r, r * 1.08, seg, 10, 2, true, Math.PI - arc / 2, arc);
    g.translate(0, -seg / 2, r - 0.02);
    capeGeos.set(key, g);
  }
  return capeGeos.get(key);
}

function addCape(hero, len, width, mat_, y, z) {
  const top = new THREE.Group();
  top.position.set(0, y, z);
  hero.rig.j.chest.add(top);
  const seg = len / 2;
  const r = Math.max(0.12, width * 0.75);
  part(top, capeGeo(width, seg, r), mat_);
  const bottom = new THREE.Group();
  bottom.position.y = -seg;
  top.add(bottom);
  part(bottom, capeGeo(width * 1.08, seg, r * 1.08), mat_, [0, 0, -(r * 0.08)]);
  hero.cape = [top, bottom];
  return top;
}

// ------------------------------------------------------------------- hair
function hair(hero) {
  const h = hero.slots.head;
  const m = hero.mats;
  const g = new THREE.Group();
  h.add(g);
  // skull cap tilted back so the forehead and face stay clear
  const cap = part(g, hairGeo, m.hair, [0, 0.148, -0.006], [-0.42, 0, 0], [1.06, 1.1, 1.08]);
  cap.userData.hair = true;
  if (hero.clsId === 'knight') {
    part(g, G.box(0.2, 0.08, 0.07), m.hair, [0, 0.03, 0.12]);
    part(g, G.box(0.12, 0.025, 0.03), m.hair, [0, 0.085, 0.155]);
  } else if (hero.clsId === 'ranger') {
    part(g, G.capsule(0.045, 0.2, 6), m.hair, [0, 0.12, -0.16], [0.55, 0, 0]);
  } else if (hero.clsId === 'mage') {
    part(g, G.box(0.27, 0.3, 0.07), m.hair, [0, 0.04, -0.12]);
    part(g, G.cone(0.1, 0.4, 8), m.hair, [0, -0.1, 0.11], [Math.PI + 0.25, 0, 0]);
    part(g, G.box(0.14, 0.03, 0.03), m.hair, [0, 0.085, 0.155]);
  } else {
    for (let i = 0; i < 6; i++) {
      const a = -0.9 + i * 0.36;
      part(g, G.cone(0.04, 0.11, 4), m.hair, [Math.sin(a) * 0.09, 0.28, Math.cos(a) * 0.05 - 0.04], [-0.6, 0, -a * 0.6]);
    }
  }
  return g;
}

// ------------------------------------------------------------ class outfits
function knightOutfit(hero, t) {
  const { slots: s, mats: m, rig } = hero;
  const b = hero.body;
  const ch = rig.o.chestH;
  // tabard + belt
  part(s.hips, G.box(0.24, 0.4, 0.02), m.cape, [0, -0.14, b.torsoD * 0.6]);
  part(s.hips, G.box(0.24, 0.4, 0.02), m.cape, [0, -0.14, -b.torsoD * 0.6]);
  part(s.hips, G.cyl(b.torsoW * 0.5, b.torsoW * 0.5, 0.07, 14), m.leather, [0, 0.04, 0], null, [1, 1, b.torsoD / b.torsoW + 0.15]);
  part(s.hips, G.box(0.08, 0.07, 0.03), m.trim, [0, 0.04, b.torsoD * 0.64]);
  if (t >= 0) {
    part(s.chest, G.sphere(1, 14, 10), m.metal, [0, ch * 0.52, 0.012], null, [b.torsoW * 0.64, ch * 0.62, b.torsoD * 0.72]);
    part(s.chest, G.cyl(0.085, 0.1, 0.08, 10), m.metal, [0, ch * 0.98, 0]);
  }
  if (t >= 1) {
    for (const [slot, sg] of [
      ['armL', 1],
      ['armR', -1],
    ]) {
      part(s[slot], G.hemi(0.14, 12), m.metal, [sg * 0.03, 0.0, 0], [0, 0, -sg * 0.45], [1.1, 0.85, 1.15]);
      if (t >= 2) part(s[slot], G.torus(0.14, 0.014, Math.PI * 2, 4, 16), m.trim, [sg * 0.03, 0.0, 0], [Math.PI / 2, 0, -sg * 0.45], [1.1, 1.15, 1]);
      if (t >= 3) for (let i = 0; i < 3; i++) part(s[slot], G.cone(0.03, 0.14, 5), m.metal, [sg * (0.07 + i * 0.03), 0.09 - i * 0.03, -0.05 + i * 0.05], [0, 0, -sg * 0.9]);
    }
    for (const slot of ['foreL', 'foreR']) part(s[slot], G.cyl(0.078, 0.07, 0.16, 10), m.metal, [0, -0.17, 0]);
    for (const slot of ['shinL', 'shinR']) {
      part(s[slot], G.cyl(0.088, 0.078, 0.26, 10), m.metal, [0, -0.2, 0.005]);
      part(s[slot], G.sphere(0.06, 8, 6), m.metal, [0, 0, 0.05]);
    }
  }
  // helmets
  if (t === 1) {
    part(s.head, G.hemi(0.172, 14), m.metal, [0, 0.15, 0]);
    part(s.head, G.cyl(0.174, 0.174, 0.04, 14), m.trim, [0, 0.15, 0]);
    part(s.head, G.box(0.03, 0.12, 0.02), m.metal, [0, 0.12, 0.17]);
  } else if (t >= 2) {
    part(s.head, G.cyl(0.172, 0.165, 0.27, 14), m.metal, [0, 0.14, 0]);
    part(s.head, G.hemi(0.172, 14), m.metal, [0, 0.275, 0]);
    part(s.head, G.box(0.22, 0.026, 0.02), t >= 3 ? m.glow : m.dark, [0, 0.16, 0.168]);
    part(s.head, G.box(0.02, 0.12, 0.02), m.trim, [0, 0.2, 0.172]);
    part(s.head, G.cyl(0.176, 0.176, 0.03, 14), m.trim, [0, 0.03, 0]);
    if (t === 2) part(s.head, G.cone(0.05, 0.34, 6), m.cape, [0, 0.46, -0.08], [-0.9, 0, 0]);
    if (t >= 3)
      for (const sg of [1, -1]) {
        part(s.head, G.cone(0.04, 0.26, 6), m.dark, [sg * 0.2, 0.32, 0], [0, 0, -sg * 0.9]);
        part(s.head, G.cone(0.028, 0.16, 6), m.dark, [sg * 0.3, 0.44, 0], [0, 0, -sg * 0.2]);
      }
    if (t >= 4) part(s.head, G.torus(0.2, 0.018, Math.PI * 2, 5, 24), m.glow, [0, 0.56, 0], [Math.PI / 2, 0, 0]);
  }
  addCape(hero, t >= 3 ? 0.9 : 0.78, 0.42, m.cape, ch * 0.92, -b.torsoD * 0.66);
  return t < 1; // hair visible
}

function knightShield(hero, t) {
  const s = hero.slots.foreL;
  const m = hero.mats;
  const g = new THREE.Group();
  g.position.set(0.11, -0.15, 0.02);
  g.rotation.set(0, Math.PI / 2, 0);
  s.add(g);
  if (t <= 0) {
    // round wooden buckler
    const wood = t < 0 ? m.leather : m.cape;
    part(g, G.cyl(0.25, 0.25, 0.04, 16), wood, [0, 0, 0], [Math.PI / 2, 0, 0]);
    part(g, G.torus(0.25, 0.02, Math.PI * 2, 4, 20), m.metal);
    part(g, G.sphere(0.06, 10, 6), m.metal, [0, 0, 0.03], null, [1, 1, 0.6]);
    return;
  }
  const shape = new THREE.Shape();
  const w = 0.22 + t * 0.012;
  const h = 0.26 + t * 0.015;
  shape.moveTo(-w, h);
  shape.lineTo(w, h);
  shape.lineTo(w, 0);
  shape.quadraticCurveTo(w * 0.9, -h * 0.9, 0, -h * 1.45);
  shape.quadraticCurveTo(-w * 0.9, -h * 0.9, -w, 0);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 1 });
  geo.translate(0, 0, -0.02);
  const face = part(g, geo, m.cape);
  face.userData.ownGeo = true;
  const rim = part(g, geo, m.metal, [0, 0, -0.012], null, [1.08, 1.06, 1]);
  void rim;
  part(g, G.box(0.05, h * 1.9, 0.02), m.trim, [0, -0.05, 0.035]);
  part(g, G.box(w * 1.6, 0.05, 0.02), m.trim, [0, 0.12, 0.035]);
  if (t >= 3) {
    part(g, G.octa(0.05), m.glow, [0, 0.12, 0.05]);
    for (const sg of [1, -1]) part(g, G.cone(0.03, 0.12, 5), m.metal, [sg * w * 1.02, h * 1.02, 0], [0, 0, -sg * 0.8]);
  }
  if (t >= 4) part(g, G.torus(0.11, 0.012, Math.PI * 2, 4, 20), m.glow, [0, 0.12, 0.045]);
}

function rangerOutfit(hero, t) {
  const { slots: s, mats: m, rig } = hero;
  const b = hero.body;
  const ch = rig.o.chestH;
  part(s.hips, G.cyl(b.torsoW * 0.5, b.torsoW * 0.78, 0.34, 12, true), m.cloth, [0, -0.15, 0], null, [1, 1, 0.8]);
  part(s.hips, G.cyl(b.torsoW * 0.5, b.torsoW * 0.5, 0.06, 14), m.leather, [0, 0.04, 0], null, [1, 1, 0.8]);
  part(s.hips, G.box(0.06, 0.06, 0.03), m.trim, [0, 0.04, b.torsoD * 0.6]);
  // quiver
  const q = new THREE.Group();
  q.position.set(0.08, ch * 0.5, -b.torsoD * 0.75);
  q.rotation.set(0.25, 0, -0.35);
  s.chest.add(q);
  part(q, G.cyl(0.06, 0.05, 0.5, 8), m.leather);
  for (let i = 0; i < 5; i++) part(q, G.box(0.012, 0.08, 0.04), m.cloth2, [(i - 2) * 0.022, 0.3, (i % 2) * 0.02], [0, i, 0]);
  part(s.chest, G.box(0.05, 0.62, 0.02), m.leather, [0, ch * 0.5, 0], [0, 0, 0.7], [1, 1, b.torsoD * 7.2]);
  part(s.foreL, G.cyl(0.07, 0.064, 0.15, 10), m.leather, [0, -0.17, 0]);
  if (t >= 0) {
    part(s.chest, G.sphere(1, 14, 10), m.leather, [0, ch * 0.5, 0.01], null, [b.torsoW * 0.63, ch * 0.6, b.torsoD * 0.72]);
    part(s.armL, G.hemi(0.11, 10), m.leather, [0.02, 0, 0], [0, 0, -0.5], [1.1, 0.8, 1.1]);
  }
  if (t >= 1) {
    part(s.head, hoodGeo, m.cloth, [0, 0.14, -0.012], null, [1, 1.12, 1.08]);
    part(s.head, G.cone(0.12, 0.3, 8), m.cloth, [0, 0.12, -0.17], [-2.2, 0, 0]);
    part(s.chest, G.cyl(0.16, b.torsoW * 0.72, 0.18, 12, true), m.cloth, [0, ch * 0.9, -0.01]);
    for (const slot of ['shinL', 'shinR']) part(s[slot], G.cyl(0.082, 0.072, 0.24, 10), m.leather, [0, -0.2, 0]);
  }
  if (t >= 2) {
    part(s.head, G.cyl(0.14, 0.13, 0.09, 12, true), m.cloth2, [0, 0.07, 0.015]);
    part(s.armR, G.hemi(0.11, 10), m.metal, [-0.02, 0, 0], [0, 0, 0.5], [1.1, 0.8, 1.1]);
  }
  if (t >= 3)
    for (let i = 0; i < 7; i++) {
      const a = -1.3 + i * 0.43;
      part(s.chest, G.cone(0.035, 0.24, 4), i % 2 ? m.glow : m.cloth2, [Math.sin(a) * 0.2, ch * 0.92, Math.cos(a) * 0.1 - 0.05], [-0.6 + Math.abs(a) * 0.3, 0, -a * 0.9]);
    }
  if (t >= 4)
    for (const sg of [1, -1]) {
      part(s.head, G.cone(0.02, 0.24, 5), m.glow, [sg * 0.12, 0.34, -0.02], [0, 0, -sg * 0.45]);
      part(s.head, G.cone(0.015, 0.12, 5), m.glow, [sg * 0.19, 0.4, -0.02], [0, 0, -sg * 1.2]);
    }
  addCape(hero, t >= 2 ? 0.75 : 0.6, 0.42, m.cape, ch * 0.9, -b.torsoD * 0.72);
  return t < 1;
}

function mageOutfit(hero, t) {
  const { slots: s, mats: m, rig } = hero;
  const b = hero.body;
  const ch = rig.o.chestH;
  part(s.hips, G.cyl(b.torsoW * 0.5, 0.36, 0.78, 14, true), m.cloth, [0, -0.36, 0]);
  part(s.hips, G.torus(b.torsoW * 0.5, 0.025, Math.PI * 2, 5, 18), m.trim, [0, 0.03, 0], [Math.PI / 2, 0, 0], [1, 0.75, 1]);
  part(s.hips, G.box(0.06, 0.34, 0.02), m.trim, [0.06, -0.14, b.torsoD * 0.58], [0.1, 0, 0]);
  for (const slot of ['foreL', 'foreR']) part(s[slot], G.cyl(0.07, 0.13, 0.2, 10, true), m.cloth, [0, -0.12, 0]);
  if (t >= 0) {
    part(s.chest, G.cyl(0.14, b.torsoW * 0.66, 0.22, 12, true), m.cloth2, [0, ch * 0.88, -0.01]);
    part(s.hips, G.torus(0.36, 0.02, Math.PI * 2, 5, 22), m.trim, [0, -0.74, 0], [Math.PI / 2, 0, 0]);
  }
  if (t >= 1) {
    part(s.head, G.cyl(0.3, 0.3, 0.02, 20), m.cloth, [0, 0.25, 0]);
    part(s.head, G.cone(0.17, 0.36, 14), m.cloth, [0, 0.43, -0.01], [-0.12, 0, 0]);
    part(s.head, G.cone(0.08, 0.26, 10), m.cloth, [0, 0.66, -0.1], [-0.9, 0, 0]);
    part(s.head, G.torus(0.165, 0.02, Math.PI * 2, 4, 18), t >= 2 ? m.trim : m.cloth2, [0, 0.28, 0], [Math.PI / 2, 0, 0]);
  }
  if (t >= 2) {
    part(s.head, G.octa(0.04), m.glow, [0, 0.3, 0.17]);
    for (const slot of ['armL', 'armR']) part(s[slot], G.sphere(0.1, 10, 8), m.cloth2, [0, 0, 0], null, [1.2, 0.8, 1.2]);
  }
  if (t >= 3) for (const [slot, sg] of [['armL', 1], ['armR', -1]]) part(s[slot], G.octa(0.05), m.glow, [sg * 0.08, 0.08, 0]);
  if (t >= 4) {
    part(s.head, G.torus(0.26, 0.012, Math.PI * 2, 4, 28), m.glow, [0, 0.8, -0.1], [Math.PI / 2 - 0.2, 0, 0]);
  }
  addCape(hero, t >= 2 ? 1.05 : 0.95, 0.46, m.cape, ch * 0.9, -b.torsoD * 0.72);
  return t < 1;
}

function rogueOutfit(hero, t) {
  const { slots: s, mats: m, rig } = hero;
  const b = hero.body;
  const ch = rig.o.chestH;
  // cross belts, pouches, scarf
  part(s.chest, G.box(0.045, 0.6, 0.02), m.leather, [0, ch * 0.5, 0], [0, 0, 0.62], [1, 1, b.torsoD * 7.4]);
  part(s.chest, G.box(0.045, 0.6, 0.02), m.leather, [0, ch * 0.5, 0], [0, 0, -0.62], [1, 1, b.torsoD * 7.4]);
  part(s.hips, G.cyl(b.torsoW * 0.5, b.torsoW * 0.5, 0.06, 14), m.leather, [0, 0.04, 0], null, [1, 1, 0.8]);
  for (const x of [-0.12, 0.12]) part(s.hips, G.box(0.08, 0.09, 0.06), m.leather, [x, -0.02, b.torsoD * 0.55]);
  part(s.chest, G.torus(0.12, 0.04, Math.PI * 2, 6, 14), m.trim, [0, ch * 0.95, 0], [Math.PI / 2, 0, 0]);
  if (t >= 0) part(s.chest, G.sphere(1, 14, 10), m.leather, [0, ch * 0.5, 0.01], null, [b.torsoW * 0.63, ch * 0.6, b.torsoD * 0.72]);
  if (t >= 1) {
    part(s.head, hoodGeo, m.cloth, [0, 0.14, -0.012], null, [1, 1.1, 1.06]);
    part(s.head, G.cyl(0.152, 0.145, 0.1, 12, true), m.dark, [0, 0.075, 0.012]);
  }
  if (t >= 2) {
    part(s.armR, G.hemi(0.11, 10), m.leather, [-0.02, 0, 0], [0, 0, 0.5], [1.15, 0.8, 1.15]);
    for (let i = 0; i < 3; i++) part(s.armR, G.sphere(0.018, 6, 4), m.metal, [-0.07 + i * 0.03, 0.05, 0.06]);
    for (const slot of ['shinL', 'shinR']) part(s[slot], G.sphere(0.055, 8, 6), m.leather, [0, 0, 0.05]);
  }
  if (t >= 3)
    for (const sg of [1, -1]) part(s.head, G.cone(0.035, 0.2, 5), m.dark, [sg * 0.12, 0.33, -0.02], [-0.3, 0, -sg * 0.5]);
  addCape(hero, 0.62, 0.14, m.cape, ch * 0.95, -b.torsoD * 0.55);
  return t < 1;
}

// ------------------------------------------------------------------ dress
export function dressHero(hero, equipment) {
  for (const k in hero.slots) clearSlot(hero.slots[k]);
  if (hero.cape) {
    hero.cape[0].parent.remove(hero.cape[0]);
    hero.cape = null;
  }
  if (hero.weapon) {
    hero.weapon.dispose();
    hero.weapon = null;
  }
  if (hero.orbit) {
    hero.orbit.parent.remove(hero.orbit);
    hero.orbit = null;
  }
  if (hero.charmMat) {
    hero.charmMat.dispose();
    hero.charmMat = null;
  }
  const armor = equipment.armor;
  const t = armor ? armor.rarity.tier : -1;
  hero.tier = t;
  tintOutfit(hero, armor);

  const hairGroup = hair(hero);
  let showHair = true;
  if (hero.clsId === 'knight') showHair = knightOutfit(hero, t);
  else if (hero.clsId === 'ranger') showHair = rangerOutfit(hero, t);
  else if (hero.clsId === 'mage') showHair = mageOutfit(hero, t);
  else showHair = rogueOutfit(hero, t);
  // helmets/hoods cover the hair cap but a mage keeps the beard
  hairGroup.children.forEach((c, i) => (c.visible = showHair || (hero.clsId === 'mage' && i > 1) || (hero.clsId === 'knight' && i > 0 && t < 2)));

  if (hero.clsId === 'knight') knightShield(hero, t);

  // weapon
  const w = equipment.weapon;
  if (w) {
    const built = buildWeapon(w);
    hero.weapon = built;
    if (built.main) hero.slots.handRMount.add(built.main);
    if (built.off) hero.slots.handLMount.add(built.off);
  }

  // charm: amulet on the chest, plus an orbiting gem for epic+
  const c = equipment.charm;
  if (c) {
    const ch = hero.rig.o.chestH;
    const b = hero.body;
    const gm = mat(c.rarity.hex, { emissive: c.rarity.hex, ei: 1.3 });
    const gold = hero.mats.trim;
    part(hero.slots.chest, G.torus(0.11, 0.008, Math.PI * 2, 4, 18), gold, [0, ch * 0.9, 0.03], [Math.PI / 2 - 0.35, 0, 0], [1, 1.2, 1]);
    part(hero.slots.chest, G.octa(0.035), gm, [0, ch * 0.72, b.torsoD * 0.76], null, [1, 1.3, 1]);
    hero.charmMat = gm;
    if (c.rarity.tier >= 3) {
      const orb = new THREE.Group();
      part(orb, G.octa(0.07), gm, [0, 0, 0], null, [1, 1.4, 1]);
      hero.rig.root.add(orb);
      hero.orbit = orb;
    }
  }
}
