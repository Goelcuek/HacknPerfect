// Enemy archetypes, rigged models with pose animation, status effects and a
// small state-machine AI (idle → chase → windup → attack → recover).

import * as THREE from 'three';
import { clamp, angleDiff, rng } from './utils.js';
import { sfx } from './audio.js';
import { Rig, G, mat, part, buildHumanBody } from './rig.js';
import { buildWeapon } from './gear.js';

export const ENEMY_TYPES = {
  grunt: { name: 'Goblin', hp: 34, dmg: 9, speed: 4.4, radius: 0.5, height: 1.3, range: 1.8, windup: 0.42, recover: 0.55, color: 0x6fae4a, gold: [2, 6] },
  archer: { name: 'Skeleton Archer', hp: 24, dmg: 8, speed: 3.6, radius: 0.45, height: 1.8, range: 13, keep: 7, windup: 0.65, recover: 1.3, color: 0xe3dccb, gold: [3, 7], ranged: true },
  brute: { name: 'Ogre', hp: 115, dmg: 20, speed: 2.8, radius: 0.9, height: 2.4, range: 3.0, windup: 0.85, recover: 1.1, color: 0x9a6a54, gold: [8, 15], heavy: true },
  wisp: { name: 'Wisp', hp: 18, dmg: 7, speed: 6.5, radius: 0.4, height: 0.8, hover: 1.3, range: 2.2, windup: 0.3, recover: 0.6, color: 0xa98bff, gold: [2, 5] },
  boss: { name: 'Dungeon Warden', hp: 1000, dmg: 22, speed: 3.6, radius: 1.5, height: 3.8, range: 3.8, windup: 0.8, recover: 0.9, color: 0x5a2a6a, gold: [120, 180], heavy: true, boss: true },
};

const ease = (t) => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));

// shared (never-flashing) materials
const SH = {};
function shared() {
  if (SH.ready) return SH;
  SH.ready = true;
  SH.dark = mat(0x222226, { rough: 0.8 });
  SH.wood = mat(0x6b4a2b, { rough: 0.85 });
  SH.leather = mat(0x5a4030, { rough: 0.9 });
  SH.fur = mat(0x5a3a22, { rough: 1 });
  SH.bone = mat(0xf0ead8, { rough: 0.7 });
  SH.iron = mat(0x6a6e78, { metal: 0.5, rough: 0.4 });
  SH.gold = mat(0xe8c14a, { metal: 0.6, rough: 0.3, emissive: 0x332200 });
  SH.yellowEye = mat(0xffdd33, { emissive: 0xffcc22, ei: 1.2 });
  SH.blueEye = mat(0x66ccff, { emissive: 0x44bbff, ei: 1.5 });
  SH.redEye = mat(0xff3355, { emissive: 0xff2244, ei: 1.5 });
  SH.cloak = mat(0x2a2530, { rough: 0.95, side: THREE.DoubleSide });
  SH.bossCape = mat(0x5a1020, { rough: 0.9, side: THREE.DoubleSide });
  SH.ice = new THREE.MeshStandardMaterial({ color: 0xaee8ff, transparent: true, opacity: 0.45, roughness: 0.1, metalness: 0.1, emissive: 0x2266aa, emissiveIntensity: 0.3 });
  SH.star = new THREE.MeshBasicMaterial({ color: 0xffe066 });
  SH.hbBg = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6, depthTest: false });
  SH.hbRed = new THREE.MeshBasicMaterial({ color: 0xff4040, depthTest: false });
  SH.hbGold = new THREE.MeshBasicMaterial({ color: 0xffc94a, depthTest: false });
  SH.aura = new THREE.MeshBasicMaterial({ color: 0xffc94a, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false });
  return SH;
}
const fillGeo = (() => {
  const g = new THREE.PlaneGeometry(1, 0.12);
  g.translate(0.5, 0, 0);
  return g;
})();

export class Enemy {
  constructor(game, type, x, z, floor, elite = false) {
    const def = ENEMY_TYPES[type];
    this.game = game;
    this.type = type;
    this.def = def;
    this.elite = elite;
    const fm = floor - 1;
    const hpMul = (1 + 0.32 * fm + 0.025 * fm * fm) * (elite ? 2.6 : 1);
    this.dmgMul = (1 + 0.13 * fm) * (elite ? 1.4 : 1);
    this.maxHp = def.hp * hpMul;
    this.hp = this.maxHp;
    this.scale = elite ? 1.25 : 1;
    this.radius = def.radius * this.scale;
    this.height = def.height * this.scale;
    this.x = x;
    this.z = z;
    this.y = def.hover || 0;
    this.vy = 0;
    this.kx = 0;
    this.kz = 0;
    this.heading = rng.next() * Math.PI * 2;
    this.state = 'idle';
    this.stateT = rng.next();
    this.aggro = false;
    this.freeze = 0;
    this.stun = 0;
    this.flash = 0;
    this.flinch = 0;
    this.alive = true;
    this.burn = 0;
    this.poison = 0;
    this.slowT = 0;
    this.slowF = 1;
    this.blind = 0;
    this.animT = rng.next() * 10;
    this.phase = rng.next() * 6;
    this.speedNow = 0;
    this.strafe = rng.next() < 0.5 ? 1 : -1;
    this.bossMove = 0;
    this.buildMesh();
  }

  // ---------------------------------------------------------------- status
  status(s) {
    const boss = this.def.boss;
    if (s.stun) this.stun = Math.max(this.stun, boss ? s.stun * 0.3 : s.stun);
    if (s.freeze) this.freeze = Math.max(this.freeze, boss ? Math.min(0.8, s.freeze) : s.freeze);
    if (s.slow) {
      this.slowT = Math.max(this.slowT, s.slow[0]);
      this.slowF = Math.min(this.slowT > 0 ? this.slowF : 1, s.slow[1]);
    }
    if (s.burn) {
      this.burn = Math.max(this.burn, s.burn[0]);
      this.burnDmg = Math.max(this.burnDmg || 0, s.burn[1]);
    }
    if (s.poison) {
      this.poison = Math.max(this.poison, s.poison[0]);
      this.poisonDmg = Math.max(this.poisonDmg || 0, s.poison[1]);
    }
    if (s.blind) this.blind = Math.max(this.blind, boss ? s.blind * 0.3 : s.blind);
  }

  // --------------------------------------------------------------- visuals
  buildMesh() {
    const S = shared();
    const d = this.def;
    const root = new THREE.Group();
    this.bodyMat = mat(d.color, { rough: this.type === 'boss' ? 0.4 : 0.8, metal: this.type === 'boss' ? 0.45 : 0 });
    this.baseEmissive = this.elite ? 0x553300 : 0x000000;
    this.ownMats = [this.bodyMat];
    this.rig = null;
    const B = this.bodyMat;

    if (this.type === 'grunt') {
      const rig = new Rig({ scale: 0.74, hipH: 0.8, thigh: 0.36, shin: 0.36, upper: 0.3, fore: 0.28, abdomen: 0.18, chestH: 0.3, shoulderW: 0.25 });
      const p = buildHumanBody(rig, { skin: B, cloth: S.leather, cloth2: S.fur, boots: B }, { headR: 0.21, torsoW: 0.38, torsoD: 0.27, limbR: 0.07, legR: 0.078, belly: 1.0 });
      const h = rig.j.head;
      for (const s of [1, -1]) {
        part(h, G.cone(0.075, 0.34, 5), B, [s * 0.24, 0.24, -0.02], [0, 0, -s * 1.25]);
        part(h, G.sphere(0.035, 8, 6), S.yellowEye, [s * 0.08, 0.24, 0.19]);
        part(h, G.box(0.1, 0.03, 0.04), S.dark, [s * 0.08, 0.29, 0.19], [0, 0, s * 0.35]);
        part(h, G.cone(0.018, 0.06, 4), S.bone, [s * 0.05, 0.1, 0.19], [0.2, 0, 0]);
      }
      part(h, G.cone(0.045, 0.2, 6), B, [0, 0.19, 0.25], [Math.PI / 2 - 0.3, 0, 0]);
      part(h, G.box(0.14, 0.02, 0.02), S.dark, [0, 0.12, 0.2]);
      part(rig.j.hips, G.box(0.22, 0.26, 0.03), S.fur, [0, -0.12, 0.17]);
      const club = new THREE.Group();
      club.rotation.x = Math.PI / 2;
      club.position.set(0, -0.05, 0.02);
      rig.j.handR.add(club);
      part(club, G.cyl(0.04, 0.075, 0.72, 7), S.wood, [0, 0.28, 0]);
      part(club, G.sphere(0.1, 8, 6), S.wood, [0, 0.62, 0]);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        part(club, G.cone(0.025, 0.1, 4), S.iron, [Math.cos(a) * 0.1, 0.58 + (i % 2) * 0.07, Math.sin(a) * 0.1], [Math.sin(a) * 1.4, 0, -Math.cos(a) * 1.4]);
      }
      if (this.elite) part(rig.j.head, G.torus(0.19, 0.025, Math.PI * 2, 4, 14), S.gold, [0, 0.34, 0], [Math.PI / 2, 0, 0]);
      this.rig = rig;
      void p;
    } else if (this.type === 'archer') {
      const rig = new Rig({ scale: 0.98, hipH: 0.93 });
      const p = buildHumanBody(rig, { skin: B, cloth: B, cloth2: B, boots: B }, { headR: 0.14, torsoW: 0.3, torsoD: 0.2, limbR: 0.034, legR: 0.04, neck: true });
      p.chest.visible = false;
      p.abdomen.visible = false;
      p.pelvis.scale.set(0.12, 0.08, 0.08);
      const ch = rig.o.chestH;
      part(rig.j.spine, G.cyl(0.03, 0.03, rig.o.abdomen + 0.1, 6), B, [0, rig.o.abdomen / 2, -0.04]);
      for (let i = 0; i < 4; i++) part(rig.j.chest, G.torus(0.14 - i * 0.012, 0.018, Math.PI * 1.5, 4, 12), B, [0, ch * 0.3 + i * 0.075, 0], [Math.PI / 2, 0, Math.PI * 1.25], [1, 0.75, 1]);
      part(rig.j.chest, G.cyl(0.025, 0.025, ch, 6), B, [0, ch / 2, -0.09]);
      part(rig.j.chest, G.box(0.36, 0.03, 0.04), B, [0, ch * 0.85, -0.02]);
      const h = rig.j.head;
      for (const s of [1, -1]) {
        part(h, G.sphere(0.045, 8, 6), S.dark, [s * 0.055, 0.15, 0.115]);
        part(h, G.sphere(0.018, 6, 4), S.blueEye, [s * 0.055, 0.15, 0.14]);
      }
      part(h, G.box(0.16, 0.06, 0.12), B, [0, 0.03, 0.06]);
      part(h, G.cone(0.02, 0.05, 3), S.dark, [0, 0.1, 0.145], [Math.PI / 2, 0, 0]);
      // tattered hood + shoulder cloak
      part(h, G.hemi(0.165, 12), S.cloak, [0, 0.16, -0.025], [-0.2, 0, 0], [1, 1.1, 1.05]);
      part(rig.j.chest, G.cyl(0.14, 0.3, 0.22, 10, true), S.cloak, [0, ch * 0.88, -0.02]);
      const q = new THREE.Group();
      q.position.set(0.08, ch * 0.5, -0.14);
      q.rotation.set(0.25, 0, -0.35);
      rig.j.chest.add(q);
      part(q, G.cyl(0.05, 0.045, 0.45, 7), S.leather);
      this.bowGear = buildWeapon({ wtype: 'bow', rarity: { tier: this.elite ? 2 : 0, hex: this.elite ? 0xffc94a : 0x8a6a4a }, visual: { variant: this.elite ? 1 : 0 } });
      const mount = new THREE.Group();
      mount.rotation.x = Math.PI / 2;
      mount.position.set(0, -0.05, 0.02);
      rig.j.handL.add(mount);
      mount.add(this.bowGear.off);
      this.rig = rig;
    } else if (this.type === 'brute') {
      const rig = new Rig({ scale: 1.35, hipH: 0.78, thigh: 0.36, shin: 0.36, upper: 0.4, fore: 0.38, abdomen: 0.26, chestH: 0.42, shoulderW: 0.42, hipW: 0.17 });
      buildHumanBody(rig, { skin: B, cloth: B, cloth2: S.fur, boots: B }, { headR: 0.16, torsoW: 0.62, torsoD: 0.44, limbR: 0.12, legR: 0.14, belly: 1.25 });
      rig.j.neck.position.set(0, rig.o.chestH * 0.86, 0.1);
      const h = rig.j.head;
      for (const s of [1, -1]) {
        part(h, G.sphere(0.03, 6, 5), S.redEye, [s * 0.06, 0.17, 0.14]);
        part(h, G.cone(0.025, 0.12, 5), S.bone, [s * 0.06, 0.06, 0.13], [-0.25, 0, s * 0.2]);
        part(h, G.sphere(0.05, 6, 5), B, [s * 0.16, 0.14, 0], null, [0.5, 1, 0.8]);
      }
      part(h, G.box(0.2, 0.05, 0.05), S.dark, [0, 0.22, 0.13], [0.25, 0, 0]);
      part(h, G.sphere(0.05, 8, 6), B, [0, 0.12, 0.16], null, [1.2, 0.8, 0.8]);
      part(rig.j.hips, G.cyl(0.33, 0.4, 0.3, 10, true), S.fur, [0, -0.13, 0], null, [1, 1, 0.75]);
      part(rig.j.hips, G.torus(0.33, 0.035, Math.PI * 2, 4, 16), S.leather, [0, 0.02, 0], [Math.PI / 2, 0, 0], [1, 0.75, 1]);
      part(rig.j.armL, G.hemi(0.18, 10), S.leather, [0.04, 0, 0], [0, 0, -0.5], [1.1, 0.8, 1.1]);
      for (let i = 0; i < 3; i++) part(rig.j.armL, G.cone(0.04, 0.16, 5), S.iron, [0.1 + i * 0.03, 0.1 - i * 0.04, -0.06 + i * 0.06], [0, 0, -0.9]);
      const club = new THREE.Group();
      club.rotation.x = Math.PI / 2;
      club.position.set(0, -0.08, 0.03);
      rig.j.handR.add(club);
      part(club, G.cyl(0.06, 0.13, 1.25, 8), S.wood, [0, 0.45, 0]);
      for (let i = 0; i < 6; i++) {
        const a = i * 2.1;
        part(club, G.cone(0.03, 0.12, 4), S.iron, [Math.cos(a) * 0.12, 0.7 + i * 0.06, Math.sin(a) * 0.12], [Math.sin(a) * 1.4, 0, -Math.cos(a) * 1.4]);
      }
      if (this.elite) part(rig.j.chest, G.torus(0.2, 0.04, Math.PI * 2, 5, 14), S.gold, [0, rig.o.chestH * 0.95, 0.06], [Math.PI / 2, 0, 0]);
      this.rig = rig;
    } else if (this.type === 'wisp') {
      this.bodyMat.emissive = new THREE.Color(d.color);
      this.bodyMat.emissiveIntensity = 0.7;
      this.baseEmissive = this.elite ? 0xffaa33 : d.color;
      const g = new THREE.Group();
      g.position.y = 0;
      part(g, G.ico(0.3, 1), B);
      const shellMat = new THREE.MeshBasicMaterial({ color: d.color, wireframe: true, transparent: true, opacity: 0.45 });
      this.ownMats.push(shellMat);
      this.shell = part(g, G.ico(0.52, 0), shellMat);
      this.shards = [];
      for (let i = 0; i < 4; i++) this.shards.push(part(g, G.octa(0.08), B, [0, 0, 0], null, [1, 1.8, 1]));
      for (const s of [1, -1]) part(g, G.sphere(0.05, 6, 5), S.yellowEye, [s * 0.1, 0.05, 0.27]);
      this.wispBody = g;
      root.add(g);
    } else if (this.type === 'boss') {
      const rig = new Rig({ scale: 1.9, shoulderW: 0.3 });
      const skin = mat(0x3a3440, { rough: 0.8 });
      this.ownMats.push(skin);
      buildHumanBody(rig, { skin, cloth: B, cloth2: S.dark, boots: S.iron, glove: B }, { headR: 0.15, torsoW: 0.44, torsoD: 0.28, limbR: 0.085, legR: 0.1 });
      const ch = rig.o.chestH;
      part(rig.j.chest, G.sphere(1, 12, 9), B, [0, ch * 0.52, 0.02], null, [0.3, ch * 0.64, 0.21]);
      for (const [j, s] of [
        [rig.j.armL, 1],
        [rig.j.armR, -1],
      ]) {
        part(j, G.hemi(0.2, 12), B, [s * 0.04, 0.02, 0], [0, 0, -s * 0.5], [1.1, 0.9, 1.2]);
        for (let i = 0; i < 3; i++) part(j, G.cone(0.045, 0.22, 5), S.dark, [s * (0.09 + i * 0.04), 0.14 - i * 0.04, -0.08 + i * 0.08], [0, 0, -s * 0.8]);
      }
      const h = rig.j.head;
      part(h, G.cyl(0.18, 0.17, 0.3, 12), B, [0, 0.15, 0]);
      part(h, G.hemi(0.18, 12), B, [0, 0.3, 0]);
      part(h, G.box(0.24, 0.035, 0.03), S.redEye, [0, 0.17, 0.17]);
      for (const s of [1, -1]) {
        part(h, G.cone(0.06, 0.4, 6), S.dark, [s * 0.24, 0.36, 0], [0, 0, -s * 1.0]);
        part(h, G.cone(0.04, 0.26, 6), S.dark, [s * 0.4, 0.56, 0], [0, 0, -s * 0.15]);
      }
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        part(rig.j.hips, G.box(0.14, 0.34, 0.03), i % 2 ? B : S.dark, [Math.sin(a) * 0.24, -0.16, Math.cos(a) * 0.18], [0.15, a, 0]);
      }
      const cape = new THREE.Group();
      cape.position.set(0, ch * 0.9, -0.2);
      rig.j.chest.add(cape);
      part(cape, G.plane(0.6, 1.2), S.bossCape, [0, -0.6, 0]);
      this.cape = cape;
      const hammer = new THREE.Group();
      hammer.rotation.x = Math.PI / 2;
      hammer.position.set(0, -0.05, 0.02);
      rig.j.handR.add(hammer);
      part(hammer, G.cyl(0.04, 0.045, 1.7, 8), S.dark, [0, 0.35, 0]);
      part(hammer, G.box(0.5, 0.34, 0.34), S.iron, [0, 1.2, 0]);
      part(hammer, G.box(0.52, 0.06, 0.36), S.redEye, [0, 1.2, 0]);
      for (const s of [1, -1]) part(hammer, G.cone(0.08, 0.2, 5), S.dark, [s * 0.34, 1.2, 0], [0, 0, -s * Math.PI / 2]);
      this.rig = rig;
    }

    if (this.rig) {
      this.rig.scaler.scale.multiplyScalar(this.scale);
      root.add(this.rig.root);
    } else if (this.wispBody) this.wispBody.scale.setScalar(this.scale);

    if (this.elite) {
      const aura = new THREE.Mesh(G.torus(1, 0.04, Math.PI * 2, 4, 32), S.aura);
      aura.rotation.x = -Math.PI / 2;
      aura.position.y = 0.06 - (d.hover || 0);
      aura.scale.setScalar(this.radius * 1.5);
      root.add(aura);
      this.aura = aura;
      this.bodyMat.emissive.setHex(this.baseEmissive);
      this.bodyMat.emissiveIntensity = 1;
    }

    if (!d.boss) {
      const bar = new THREE.Group();
      const bg = new THREE.Mesh(G.plane(1, 0.12), S.hbBg);
      const fill = new THREE.Mesh(fillGeo, this.elite ? S.hbGold : S.hbRed);
      fill.position.set(-0.5, 0, 0.001);
      bar.add(bg, fill);
      bg.renderOrder = 10;
      fill.renderOrder = 11;
      bar.position.y = this.height + 0.45 - (d.hover || 0);
      bar.visible = false;
      root.add(bar);
      this.hpBar = bar;
      this.hpFill = fill;
    }
    this.mesh = root;
    root.position.set(this.x, this.y, this.z);
  }

  // --------------------------------------------------------------- update
  update(dt, game) {
    const p = game.player;
    const dg = game.dungeon;
    const def = this.def;
    this.animT += dt;
    this.flash = Math.max(0, this.flash - dt);
    this.flinch = Math.max(0, this.flinch - dt);
    this.stun = Math.max(0, this.stun - dt);
    this.blind = Math.max(0, this.blind - dt);
    if (this.slowT > 0) {
      this.slowT -= dt;
      if (this.slowT <= 0) this.slowF = 1;
    }
    for (const [k, dk, col] of [
      ['burn', 'burnDmg', 'dot'],
      ['poison', 'poisonDmg', 'poison'],
    ]) {
      if (this[k] <= 0) continue;
      this[k] -= dt;
      this[k + 'Tick'] = (this[k + 'Tick'] || 0) - dt;
      if (this[k + 'Tick'] <= 0) {
        this[k + 'Tick'] = 0.35;
        game.damageEnemy(this, { amount: this[dk] || 3, crit: false, knock: 0, silent: true, dot: col }, this.x, this.z);
        if (!this.alive) return;
      }
      if (Math.random() < 0.2) game.effects.puff(this.x + (Math.random() - 0.5) * 0.6, this.y + this.height * (0.3 + Math.random() * 0.6), this.z + (Math.random() - 0.5) * 0.6, k === 'burn' ? 0xff7a2e : 0x7adf4a, 0.18, 0.4);
    }

    // knockback + vertical launch
    if (Math.abs(this.kx) + Math.abs(this.kz) > 0.05) {
      dg.move(this, this.kx * dt, this.kz * dt, false);
      const decay = Math.exp(-(def.heavy ? 10 : 7) * dt);
      this.kx *= decay;
      this.kz *= decay;
    }
    const baseY = def.hover || 0;
    if (this.y > baseY || this.vy > 0) {
      this.vy -= 26 * dt;
      this.y += this.vy * dt;
      if (this.y <= baseY) {
        this.y = baseY;
        this.vy = 0;
      }
    }

    const dx = p.x - this.x;
    const dz = p.z - this.z;
    const dist = Math.hypot(dx, dz);
    const toPlayer = Math.atan2(dx, dz);
    this.mesh.visible = dist < 44;
    this.speedNow = 0;

    if (this.freeze > 0) {
      this.freeze -= dt;
      this.render(dt, true);
      return;
    }
    if (!this.aggro) {
      if (dist < 15 && dg.lineOfSight(this.x, this.z, p.x, p.z)) this.aggro = true;
      this.render(dt);
      if (this.aggro) game.alertNearby(this);
      return;
    }
    if (this.stun > 0 || p.dead) {
      if (this.state === 'windup') this.state = 'recover';
      this.render(dt);
      return;
    }
    if (this.blind > 0) {
      // dazed: stagger around aimlessly
      if (this.state === 'windup' || this.state === 'bosswind') this.state = 'recover';
      this.heading += Math.sin(this.animT * 1.7) * dt * 2;
      const sp = def.speed * 0.35;
      dg.move(this, Math.sin(this.heading) * sp * dt, Math.cos(this.heading) * sp * dt, false);
      this.speedNow = sp;
      this.render(dt);
      return;
    }

    if (def.boss && this.bossUpdate(dt, game)) return;

    let moveSpeed = 0;
    let mvx = 0;
    let mvz = 0;
    this.stateT += dt;
    const los = dist < 20 && dg.lineOfSight(this.x, this.z, p.x, p.z);
    const dy = p.y - (this.y - (def.hover || 0));

    switch (this.state) {
      case 'idle':
        this.state = 'chase';
        this.stateT = 0;
        break;
      case 'chase': {
        if (def.boss) return this.bossChase(dt, game, dist, toPlayer, los);
        let dirx = 0;
        let dirz = 0;
        if (los) {
          dirx = dx / (dist || 1);
          dirz = dz / (dist || 1);
        } else {
          const fd = dg.flowDir(this.x, this.z);
          if (fd) {
            dirx = fd.x;
            dirz = fd.z;
          }
        }
        if (def.ranged) {
          if (los && dist < def.range) {
            if (dist < def.keep - 1.5) {
              dirx = -dirx;
              dirz = -dirz;
            } else {
              const sx = -dirz * this.strafe;
              const sz = dirx * this.strafe;
              dirx = sx * 0.6;
              dirz = sz * 0.6;
            }
            if (this.stateT > 0.8) this.beginWindup(toPlayer);
          }
        } else if (dist < def.range + this.radius * 0.3 && Math.abs(dy) < 2 && los) {
          this.beginWindup(toPlayer);
          break;
        }
        if (this.type === 'wisp') {
          const wob = Math.sin(this.animT * 5) * 0.6;
          const sx = dirx - dirz * wob;
          const sz = dirz + dirx * wob;
          dirx = sx;
          dirz = sz;
        }
        moveSpeed = def.speed * this.slowF;
        mvx = dirx;
        mvz = dirz;
        if (mvx || mvz) this.turnTo(Math.atan2(mvx, mvz), dt, 8);
        if (def.ranged && los) this.turnTo(toPlayer, dt, 10);
        break;
      }
      case 'windup': {
        if (!def.heavy) this.turnTo(toPlayer, dt, 3);
        if (this.stateT >= def.windup) {
          this.performAttack(game, dist);
          this.state = 'attack';
          this.stateT = 0;
        }
        break;
      }
      case 'attack': {
        if (this.lunge > 0) {
          this.lunge -= dt;
          moveSpeed = this.type === 'wisp' ? 16 : 9;
          mvx = Math.sin(this.heading);
          mvz = Math.cos(this.heading);
          if (!this.lungeHit && this.lunge > 0) this.checkLungeHit(game);
        }
        if (this.stateT > 0.25) {
          this.state = 'recover';
          this.stateT = 0;
        }
        break;
      }
      case 'recover':
        if (this.stateT > this.def.recover * (this.elite ? 0.8 : 1)) {
          this.state = 'chase';
          this.stateT = 0;
          if (rng.next() < 0.3) this.strafe *= -1;
        }
        break;
      default:
        break;
    }

    if (moveSpeed > 0) {
      dg.move(this, mvx * moveSpeed * dt, mvz * moveSpeed * dt, false);
      this.speedNow = moveSpeed * Math.min(1, Math.hypot(mvx, mvz));
    }
    this.render(dt);
  }

  turnTo(h, dt, rate) {
    this.heading += angleDiff(this.heading, h) * Math.min(1, dt * rate);
  }

  beginWindup(toPlayer) {
    this.state = 'windup';
    this.stateT = 0;
    this.heading = toPlayer;
    if (this.type === 'brute') {
      const fx = this.x + Math.sin(this.heading) * 1.6 * this.scale;
      const fz = this.z + Math.cos(this.heading) * 1.6 * this.scale;
      this.slamAt = { x: fx, z: fz, r: 3.2 * this.scale };
      this.game.effects.telegraph(fx, fz, this.slamAt.r, this.def.windup);
    }
  }

  performAttack(game, dist) {
    const p = game.player;
    const dmg = this.def.dmg * this.dmgMul;
    if (this.type === 'grunt') {
      this.lunge = 0.12;
      this.lungeHit = false;
      sfx.swing();
    } else if (this.type === 'wisp') {
      this.lunge = 0.18;
      this.lungeHit = false;
    } else if (this.type === 'archer') {
      const t = dist / 16;
      const tx = p.x + p.vx * t * 0.5;
      const tz = p.z + p.vz * t * 0.5;
      const h = Math.atan2(tx - this.x, tz - this.z);
      this.heading = h;
      game.spawnEnemyProjectile(this.x, 1.3, this.z, h, 16, dmg, 'arrow');
      if (this.elite) {
        game.spawnEnemyProjectile(this.x, 1.3, this.z, h + 0.2, 16, dmg, 'arrow');
        game.spawnEnemyProjectile(this.x, 1.3, this.z, h - 0.2, 16, dmg, 'arrow');
      }
      sfx.arrow();
    } else if (this.type === 'brute') {
      const s = this.slamAt;
      game.shockwave(s.x, s.z, s.r, dmg, this);
    }
  }

  checkLungeHit(game) {
    const p = game.player;
    const reach = this.def.range + this.radius;
    const dx = p.x - this.x;
    const dz = p.z - this.z;
    const d = Math.hypot(dx, dz);
    if (d > reach || Math.abs(p.y - (this.y - (this.def.hover || 0))) > 1.6) return;
    const dot = (dx * Math.sin(this.heading) + dz * Math.cos(this.heading)) / (d || 1);
    if (dot < 0.2 && d > this.radius + p.radius + 0.2) return;
    this.lungeHit = true;
    if (p.takeDamage(this.def.dmg * this.dmgMul, this, true)) {
      p.vx += (dx / (d || 1)) * 6;
      p.vz += (dz / (d || 1)) * 6;
    }
  }

  // ------------------------------------------------------------------- boss
  bossChase(dt, game, dist, toPlayer, los) {
    const dg = game.dungeon;
    const enraged = this.hp < this.maxHp * 0.5;
    this.bossMove -= dt;
    this.turnTo(toPlayer, dt, 4);
    if (this.bossMove <= 0 && this.stateT > (enraged ? 0.6 : 1.1)) {
      const moves = ['slam', 'volley', 'charge'];
      if (enraged) moves.push('nova', 'summon');
      let m = rng.pick(moves);
      if (dist < 5 && rng.next() < 0.5) m = 'slam';
      this.bossAttack = m;
      this.state = 'bosswind';
      this.stateT = 0;
      this.bossWind = m === 'charge' ? 0.7 : m === 'volley' ? 0.6 : m === 'summon' ? 0.8 : 1.0;
      if (enraged) this.bossWind *= 0.75;
      if (m === 'slam') {
        const fx = this.x + Math.sin(toPlayer) * 2.5;
        const fz = this.z + Math.cos(toPlayer) * 2.5;
        this.slamAt = { x: fx, z: fz, r: 6.5 };
        game.effects.telegraph(fx, fz, 6.5, this.bossWind);
      } else if (m === 'nova') {
        game.effects.telegraph(this.x, this.z, 9, this.bossWind, 0xaa44ff);
      }
      this.heading = toPlayer;
      return this.render(dt);
    }
    const dir = los ? { x: Math.sin(toPlayer), z: Math.cos(toPlayer) } : dg.flowDir(this.x, this.z);
    const sp = this.def.speed * (enraged ? 1.25 : 1) * this.slowF;
    if (dir && dist > 3) {
      dg.move(this, dir.x * sp * dt, dir.z * sp * dt, false);
      this.speedNow = sp;
    }
    this.render(dt);
  }

  bossUpdate(dt, game) {
    const p = game.player;
    const dmg = this.def.dmg * this.dmgMul;
    if (this.state === 'bosswind') {
      this.stateT += dt;
      if (this.bossAttack === 'charge') this.turnTo(Math.atan2(p.x - this.x, p.z - this.z), dt, 6);
      if (this.stateT >= this.bossWind) {
        const m = this.bossAttack;
        this.state = 'bossact';
        this.stateT = 0;
        if (m === 'slam') {
          game.shockwave(this.slamAt.x, this.slamAt.z, this.slamAt.r, dmg * 1.2, this, true);
        } else if (m === 'nova') {
          game.shockwave(this.x, this.z, 9, dmg, this, true);
        } else if (m === 'volley') {
          const n = this.hp < this.maxHp * 0.5 ? 11 : 7;
          for (let i = 0; i < n; i++) game.spawnEnemyProjectile(this.x, 1.6, this.z, this.heading + (i - (n - 1) / 2) * 0.17, 11, dmg * 0.7, 'orb');
          sfx.fire();
        } else if (m === 'charge') {
          this.chargeT = 0.75;
          this.lungeHit = false;
          sfx.dash();
        } else if (m === 'summon') {
          for (let i = 0; i < 2; i++) game.spawnEnemy(rng.next() < 0.5 ? 'grunt' : 'wisp', this.x + (rng.next() - 0.5) * 6, this.z + (rng.next() - 0.5) * 6, true);
          game.effects.ring(this.x, this.z, 5, 0xaa44ff, 0.5);
        }
      }
      this.render(dt);
      return true;
    }
    if (this.state === 'bossact') {
      this.stateT += dt;
      if (this.chargeT > 0) {
        this.chargeT -= dt;
        const hit = game.dungeon.move(this, Math.sin(this.heading) * 20 * dt, Math.cos(this.heading) * 20 * dt, false);
        this.speedNow = 20;
        game.effects.puff(this.x, 0.5, this.z, 0x886699, 0.6, 0.3);
        const d = Math.hypot(p.x - this.x, p.z - this.z);
        if (!this.lungeHit && d < this.radius + 1 && p.y < 2.2) {
          this.lungeHit = true;
          if (p.takeDamage(dmg, this, true)) {
            p.vx += Math.sin(this.heading) * 14;
            p.vz += Math.cos(this.heading) * 14;
            p.vy = 6;
          }
        }
        if (hit) {
          this.chargeT = 0;
          game.effects.shake(0.4);
          sfx.slam();
          this.stun = 0.8;
        }
      }
      if (this.stateT > (this.hp < this.maxHp * 0.5 ? 0.5 : 0.9) && !(this.chargeT > 0)) {
        this.state = 'chase';
        this.stateT = 0;
      }
      this.render(dt);
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------- animation
  render(dt, frozen = false) {
    const m = this.mesh;
    m.position.set(this.x, this.y, this.z);
    m.rotation.y = this.heading;
    const t = this.animT;

    // tint: hit flash > freeze > burn/poison > base
    const mat_ = this.bodyMat;
    if (this.flash > 0) mat_.emissive.setHex(0xffffff);
    else if (this.freeze > 0) mat_.emissive.setHex(0x2266aa);
    else if (this.burn > 0) mat_.emissive.setHex(0x662200);
    else if (this.poison > 0) mat_.emissive.setHex(0x1f5a10);
    else mat_.emissive.setHex(this.baseEmissive);

    this.updateIce();
    this.updateStars(dt);
    if (this.aura) this.aura.rotation.z = t;
    if (this.hpBar) {
      this.hpBar.visible = this.hp < this.maxHp;
      this.hpFill.scale.x = clamp(this.hp / this.maxHp, 0, 1);
      this.hpBar.quaternion.copy(m.quaternion).invert().multiply(this.game.camera.quaternion);
    }
    if (frozen) return; // hold the pose while encased in ice

    if (this.type === 'wisp') return this.animateWisp(dt);
    const rig = this.rig;
    const P = rig.pose;
    rig.resetPose();
    const amp = clamp(this.speedNow / 4, 0, 1.3);
    this.phase += dt * (3 + this.speedNow * 1.5);
    const heavy = this.type === 'brute' || this.type === 'boss';
    rig.locomotion(this.phase, amp, heavy ? 0.6 : 1);
    rig.idle(t, 1 - Math.min(1, amp));
    let k = 1 - Math.exp(-dt * 14);
    const s = this.state;
    const wind = s === 'windup' ? ease(this.stateT / this.def.windup) : s === 'bosswind' ? ease(this.stateT / this.bossWind) : 0;
    const act = s === 'attack' || s === 'bossact';
    const rec = s === 'recover' ? clamp(1 - this.stateT / 0.35, 0, 1) : 0;
    if (s === 'windup' || act || s === 'bosswind') k = 1 - Math.exp(-dt * 26);

    if (this.type === 'grunt') {
      P.armR = [-0.5 + P.armR[0] * 0.4, 0, -0.2];
      P.foreR[0] = -0.8;
      P.handR[0] = -0.4;
      if (s === 'windup') {
        P.armR = [-0.5 - 2.4 * wind, 0, -0.35];
        P.foreR[0] = -0.8 + 0.2 * wind;
        P.chest[0] = -0.25 * wind;
        P.chest[1] = -0.35 * wind;
        P.armL = [-0.6 * wind, 0, 0.4];
      } else if (act || rec > 0) {
        const r = act ? 1 : rec;
        P.armR = [-0.5 * r - 0.3, 0, -0.1];
        P.foreR[0] = -0.2;
        P.handR[0] = 0.8 * r;
        P.body[0] = 0.35 * r;
        P.chest[1] = 0.35 * r;
        P.thighL[0] = -0.6 * r;
        P.shinL[0] = 0.5 * r;
      }
    } else if (this.type === 'archer') {
      let draw = 0;
      if (s === 'windup' || act || (s === 'chase' && this.aggro)) {
        draw = s === 'windup' ? wind : 0;
        P.chest[1] = -0.55;
        P.head[1] = 0.5;
        P.armL = [-1.55, 0.55, 0];
        P.foreL = [0, 0, 0];
        P.armR = [-1.55 + 0.1 * draw, -0.1 - 0.5 * draw, -0.35 * draw];
        P.foreR = [-0.4 - 1.7 * draw, 0, 0];
        if (s === 'chase') {
          P.armL = [-0.9, 0.3, 0.1];
          P.armR[0] = -0.6;
        }
      } else {
        P.armL = [-0.2 + P.armL[0] * 0.4, 0, 0.15];
        P.foreL[0] = -0.5;
      }
      this.bowGear.bow.userData.setDraw(draw, s === 'windup');
    } else if (this.type === 'brute') {
      P.armR = [-0.35 + P.armR[0] * 0.5, 0, -0.25];
      P.armL[2] = 0.3;
      P.foreR[0] = -0.5;
      P.handR[0] = 0.3;
      P.body[0] += 0.12;
      if (s === 'windup') {
        P.armR = [-0.4 - 2.6 * wind, 0, 0.1];
        P.armL = [-0.4 - 2.6 * wind, 0, -0.1];
        P.foreR[0] = -0.3;
        P.foreL[0] = -0.3;
        P.handR[0] = 0.4;
        P.body[0] = -0.3 * wind;
        P.head[0] = -0.3 * wind;
      } else if (act || rec > 0) {
        const r = act ? 1 : rec;
        P.armR = [-0.6, 0, 0.1];
        P.armL = [-0.6, 0, -0.1];
        P.handR[0] = 1.2 * r;
        P.body[0] = 0.6 * r;
        P.bodyY = -0.25 * r;
        P.thighL[0] = -0.9 * r;
        P.shinL[0] = 1.1 * r;
        P.thighR[0] = 0.3 * r;
        P.shinR[0] = 0.8 * r;
      }
    } else if (this.type === 'boss') {
      // two-handed hammer hold
      P.armR = [-0.5 + P.armR[0] * 0.3, 0, -0.1];
      P.armL = [-0.7, -0.4, 0.3];
      P.foreR[0] = -0.9;
      P.foreL[0] = -1.1;
      P.handR[0] = -0.2;
      const m2 = this.bossAttack;
      if (s === 'bosswind') {
        if (m2 === 'slam') {
          P.armR = [-0.5 - 2.5 * wind, 0, 0.15];
          P.armL = [-0.5 - 2.5 * wind, 0, -0.15];
          P.foreR[0] = -0.3;
          P.foreL[0] = -0.3;
          P.handR[0] = 0.4;
          P.body[0] = -0.3 * wind;
        } else if (m2 === 'volley') {
          P.armL = [-1.5, 0, 0.1];
          P.foreL[0] = 0;
          P.chest[1] = -0.3;
        } else if (m2 === 'charge') {
          P.body[0] = 0.45 * wind;
          P.armR = [0.4, 0, -0.3];
          P.handR[0] = 1;
          P.thighL[0] = -0.6 * wind;
          P.shinL[0] = 0.8 * wind;
        } else {
          P.armR = [-0.4 - 2.4 * wind, 0, -0.6];
          P.armL = [-0.4 - 2.4 * wind, 0, 0.6];
          P.chest[0] = -0.3 * wind;
          P.head[0] = -0.3 * wind;
        }
      } else if (s === 'bossact') {
        if (m2 === 'slam' || m2 === 'nova') {
          P.armR = [-0.6, 0, 0];
          P.armL = [-0.6, 0, 0];
          P.handR[0] = 1.3;
          P.body[0] = 0.55;
          P.bodyY = -0.3;
          P.thighL[0] = -0.9;
          P.shinL[0] = 1.2;
          P.thighR[0] = 0.3;
          P.shinR[0] = 0.8;
        } else if (m2 === 'charge') {
          P.body[0] = 0.5;
          P.armR = [0.4, 0, -0.3];
        } else if (m2 === 'volley') {
          P.armL = [-1.6, 0, -0.2];
        }
      }
      if (this.cape) this.cape.rotation.x += (0.15 + Math.min(1, this.speedNow * 0.06) - this.cape.rotation.x) * Math.min(1, dt * 6);
    }

    if (this.flinch > 0) {
      const f = this.flinch / 0.2;
      P.chest[0] -= 0.4 * f;
      P.head[0] -= 0.3 * f;
      P.body[0] -= 0.12 * f;
    }
    if (this.stun > 0 || this.blind > 0) {
      P.head[2] = Math.sin(t * 7) * 0.3;
      P.chest[2] = Math.sin(t * 7 + 1) * 0.1;
      P.armL[2] += 0.3;
      P.armR[2] -= 0.3;
    }
    if (this.y > (this.def.hover || 0) + 0.3) {
      P.body[0] = -0.5;
      P.armL[2] = 1.1;
      P.armR[2] = -1.1;
      P.thighL[0] = -0.6;
      P.shinL[0] = 0.8;
    }
    rig.apply(k);
  }

  animateWisp(dt) {
    const g = this.wispBody;
    const t = this.animT;
    g.position.y = Math.sin(t * 3) * 0.15;
    this.shell.rotation.y = t * 2;
    this.shell.rotation.x = t * 1.3;
    this.shards.forEach((s, i) => {
      const a = t * 2.5 + (i / this.shards.length) * Math.PI * 2;
      s.position.set(Math.cos(a) * 0.55, Math.sin(a * 1.3) * 0.2, Math.sin(a) * 0.55);
      s.rotation.y = a;
    });
    const w = this.state === 'windup' ? this.stateT / this.def.windup : 0;
    g.scale.setScalar(this.scale * (1 + w * 0.5 + (this.flinch > 0 ? -0.2 : 0)));
    if (Math.random() < 0.3) this.game.effects.puff(this.x, this.y + g.position.y, this.z, this.def.color, 0.18, 0.4);
    void dt;
  }

  updateIce() {
    if (this.freeze > 0) {
      if (!this.ice) {
        const r = this.radius * 1.1;
        this.ice = part(this.mesh, G.ico(1, 0), shared().ice, [0, this.height * 0.5 - (this.def.hover || 0) * 0, 0], null, [r, this.height * 0.62, r]);
      }
      this.ice.visible = true;
    } else if (this.ice) this.ice.visible = false;
  }

  updateStars(dt) {
    const on = (this.stun > 0.15 && !this.def.boss) || this.blind > 0;
    if (on && !this.stars) {
      this.stars = new THREE.Group();
      for (let i = 0; i < 3; i++) part(this.stars, G.octa(0.07), shared().star, [Math.cos((i / 3) * Math.PI * 2) * 0.3, 0, Math.sin((i / 3) * Math.PI * 2) * 0.3]);
      this.stars.position.y = this.height + 0.15 - (this.def.hover || 0);
      this.mesh.add(this.stars);
    }
    if (this.stars) {
      this.stars.visible = on;
      this.stars.rotation.y += dt * 5;
    }
  }

  // ----------------------------------------------------------------- death
  startDeath(fromX, fromZ) {
    this.dying = true;
    this.deathT = 0;
    this.fallDir = Math.atan2(this.x - fromX, this.z - fromZ);
    if (this.hpBar) this.hpBar.visible = false;
    if (this.stars) this.stars.visible = false;
    if (this.ice) this.ice.visible = false;
    if (this.aura) this.aura.visible = false;
    this.bodyMat.emissive.setHex(0x000000);
  }

  // Returns false once the corpse is gone.
  updateDeath(dt) {
    this.deathT += dt;
    const t = this.deathT;
    if (this.type === 'wisp') {
      this.wispBody.scale.setScalar(Math.max(0.01, this.scale * (1 - t * 3)));
      return t < 0.35;
    }
    const rig = this.rig;
    const P = rig.pose;
    rig.resetPose();
    // topple away from the killing blow
    this.heading += angleDiff(this.heading, this.fallDir + Math.PI) * Math.min(1, dt * 10);
    this.mesh.rotation.y = this.heading;
    const f = ease(t / 0.45);
    P.body[0] = -1.45 * f;
    P.bodyY = -rig.o.hipH * 0.72 * f;
    P.armL = [-0.6 * f, 0, 1.3 * f];
    P.armR = [-0.6 * f, 0, -1.3 * f];
    P.thighL[0] = -0.5 * f;
    P.thighR[0] = -0.2 * f;
    P.shinL[0] = 0.6 * f;
    P.head[0] = -0.4 * f;
    rig.apply(1 - Math.exp(-dt * 18));
    if (t > 0.9) this.mesh.position.y = this.y - (t - 0.9) * 1.2 * this.scale;
    return t < 1.6;
  }

  dispose() {
    for (const m of this.ownMats) m.dispose();
    if (this.bowGear) this.bowGear.dispose();
  }
}
