// Enemy archetypes: animated skeleton warbands (rigged KayKit models driven by the
// shared animation library), the procedural wisp, elite affixes, and a small
// state-machine AI (dormant → rise → chase → windup → attack → recover).

import * as THREE from 'three';
import { clamp, angleDiff, rng } from './utils.js';
import { sfx } from './audio.js';
import { G, mat, part } from './rig.js';
import { CharacterModel } from './model.js';
import { gearModel, mergeCharacter, clip, propModel, hingeLid } from './assets.js';

// gear: [libraryModel, hand] — 'r' right hand, 'l' left hand, 'x' crossbow grip
export const ENEMY_TYPES = {
  grunt: { name: 'Skeleton Minion', model: 'Skeleton_Minion', mscale: 0.72, gear: [['Skeleton_Blade', 'r']], hp: 34, dmg: 9, speed: 4.4, radius: 0.5, height: 1.55, range: 1.8, windup: 0.42, recover: 0.55, color: 0xe8e0c8, gold: [2, 6], walk: 'Walking_D_Skeletons', run: 'Running_C', attack: '1H_Melee_Attack_Chop' },
  archer: { name: 'Skeleton Rogue', model: 'Skeleton_Rogue', mscale: 0.78, gear: [['Skeleton_Crossbow', 'x']], hp: 24, dmg: 8, speed: 3.6, radius: 0.45, height: 1.8, range: 13, keep: 7, windup: 0.65, recover: 1.3, color: 0xe3dccb, gold: [3, 7], ranged: true, walk: 'Walking_B', run: 'Running_A' },
  brute: { name: 'Skeleton Warrior', model: 'Skeleton_Warrior', mscale: 1.1, gear: [['Skeleton_Axe', 'r'], ['Skeleton_Shield_Large_A', 'l']], hp: 115, dmg: 20, speed: 2.8, radius: 0.9, height: 2.5, range: 3.0, windup: 0.85, recover: 1.1, color: 0xd8d0bc, gold: [8, 15], heavy: true, walk: 'Walking_A', run: 'Running_B', attack: '2H_Melee_Attack_Chop' },
  mage: { name: 'Skeleton Mage', model: 'Skeleton_Mage', mscale: 0.8, gear: [['Skeleton_Staff', 'r']], hp: 30, dmg: 10, speed: 3.2, radius: 0.45, height: 1.9, range: 14, keep: 9, windup: 0.75, recover: 1.5, color: 0xd8c8ff, gold: [4, 9], ranged: true, caster: true, walk: 'Walking_C', run: 'Running_A' },
  mimic: { name: 'Mimic', prop: 'chest', hp: 90, dmg: 15, speed: 5.4, radius: 0.65, height: 1.0, range: 2.0, windup: 0.35, recover: 0.65, color: 0xc89a50, gold: [30, 50] },
  wisp: { name: 'Wisp', hp: 18, dmg: 7, speed: 6.5, radius: 0.4, height: 0.8, hover: 1.3, range: 2.2, windup: 0.3, recover: 0.6, color: 0xa98bff, gold: [2, 5] },
  boss: { name: 'The Bone King', model: 'Skeleton_Warrior', mscale: 1.75, gear: [['Skeleton_Axe', 'r'], ['Skeleton_Shield_Large_B', 'l']], hp: 1000, dmg: 22, speed: 3.6, radius: 1.5, height: 3.8, range: 3.8, windup: 0.8, recover: 0.9, color: 0x5a2a6a, gold: [120, 180], heavy: true, boss: true, walk: 'Walking_A', run: 'Running_B', attack: '2H_Melee_Attack_Chop' },
};

// Elite affixes: each elite rolls one (two from floor 5), shown in its name tag.
export const AFFIXES = {
  swift: { name: 'Swift', color: 0x66ccff },
  vampiric: { name: 'Vampiric', color: 0xff3355 },
  explosive: { name: 'Explosive', color: 0xff8c2e },
  shielded: { name: 'Shielded', color: 0xffe066 },
  frenzied: { name: 'Frenzied', color: 0xff6a3a },
  arcane: { name: 'Arcane', color: 0xb58cff },
};
const AFFIX_IDS = Object.keys(AFFIXES);

// when each strike clip's blow lands (s)
const IMPACT = {
  '1H_Melee_Attack_Chop': 0.58,
  '1H_Melee_Attack_Jump_Chop': 0.73,
  '2H_Melee_Attack_Chop': 0.72,
  '2H_Melee_Attack_Slice': 0.38,
  '2H_Ranged_Shoot': 0.14,
  Spellcast_Shoot: 0.1,
  Spellcast_Summon: 2.92,
  Spellcast_Raise: 0.27,
  Throw: 0.72,
  Taunt: 0.65,
};

const ease = (t) => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));

// shared materials
const SH = {};
function shared() {
  if (SH.ready) return SH;
  SH.ready = true;
  SH.gold = mat(0xe8c14a, { metal: 0.6, rough: 0.3, emissive: 0x332200 });
  SH.gem = mat(0xb04dff, { emissive: 0xb04dff, ei: 1.6 });
  SH.yellowEye = mat(0xffdd33, { emissive: 0xffcc22, ei: 1.2 });
  SH.ice = new THREE.MeshStandardMaterial({ color: 0xaee8ff, transparent: true, opacity: 0.45, roughness: 0.1, metalness: 0.1, emissive: 0x2266aa, emissiveIntensity: 0.3 });
  SH.star = new THREE.MeshBasicMaterial({ color: 0xffe066 });
  SH.hbBg = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6, depthTest: false });
  SH.hbRed = new THREE.MeshBasicMaterial({ color: 0xff4040, depthTest: false });
  SH.hbGold = new THREE.MeshBasicMaterial({ color: 0xffc94a, depthTest: false });
  SH.shield = new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending });
  return SH;
}
// Health bars, freeze ice, stun stars, shields: hidden until a fight, so the game
// draws them once up front (see Game.prewarmShaders).
export function sharedEnemyMaterials() {
  return Object.values(shared()).filter((m) => m && m.isMaterial);
}
const fillGeo = (() => {
  const g = new THREE.PlaneGeometry(1, 0.12);
  g.translate(0.5, 0, 0);
  return g;
})();

// Name tag sprite for elites ("Swift Vampiric Skeleton Warrior").
function nameTag(text, color) {
  const c = document.createElement('canvas');
  const x = c.getContext('2d');
  const font = 'bold 34px system-ui, sans-serif';
  x.font = font;
  c.width = Math.ceil(x.measureText(text).width + 24);
  c.height = 64;
  x.font = font;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.lineWidth = 7;
  x.strokeStyle = 'rgba(0,0,0,0.85)';
  x.strokeText(text, c.width / 2, 32);
  x.fillStyle = '#' + new THREE.Color(color).getHexString();
  x.fillText(text, c.width / 2, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(0.5 * (c.width / 64), 0.5, 1);
  s.renderOrder = 12;
  return s;
}

export class Enemy {
  constructor(game, type, x, z, floor, elite = false, o = {}) {
    const def = ENEMY_TYPES[type];
    this.game = game;
    this.type = type;
    this.def = def;
    this.elite = elite;
    this.floor = floor;
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
    this.bleed = 0;
    this.slowT = 0;
    this.slowF = 1;
    this.blind = 0;
    this.animT = rng.next() * 10;
    this.speedNow = 0;
    this.strafe = rng.next() < 0.5 ? 1 : -1;
    this.bossMove = 0;
    this.speedMul = 1;
    this.tempo = 1; // windup/recover multiplier
    this.casts = 0;
    this.affixes = [];
    this.shieldHp = 0;
    // multiplayer clients mirror monsters the host simulates ("puppets")
    this.puppet = !!o.puppet;
    if (elite) this.rollAffixes(floor, Array.isArray(o.affixes) ? o.affixes.filter((a) => AFFIXES[a]) : null);
    this.buildMesh();
    // skeletons can lie dormant as bone piles, or claw their way out of the ground
    if (o.rise) this.startRise();
    else if (o.dormant && this.model) this.startDormant();
    if (o.mimic) this.disguised = true;
  }

  rollAffixes(floor, given = null) {
    const n = floor >= 5 ? 2 : 1;
    const pool = AFFIX_IDS.slice();
    if (given && given.length) this.affixes = given.slice(0, 2);
    else for (let i = 0; i < n && pool.length; i++) this.affixes.push(pool.splice(Math.floor(rng.next() * pool.length), 1)[0]);
    const has = (a) => this.affixes.includes(a);
    if (has('swift')) this.speedMul = 1.45;
    if (has('frenzied')) this.tempo = 0.6;
    if (has('shielded')) this.shieldHp = this.maxHp * 0.4;
    this.arcaneT = 2 + rng.next() * 2;
  }

  // ---------------------------------------------------------------- status
  status(s) {
    if (this.puppet) this.game.net.send('status', { id: this.id, s });
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
    if (s.bleed) {
      this.bleed = Math.max(this.bleed || 0, s.bleed[0]);
      this.bleedDmg = Math.max(this.bleedDmg || 0, s.bleed[1]);
    }
  }

  // Incoming damage passes through here (shield affix soaks it first).
  absorb(amount) {
    if (this.shieldHp > 0) {
      const soak = Math.min(this.shieldHp, amount * 0.75);
      this.shieldHp -= soak;
      if (this.shieldHp <= 0) {
        this.game.effects.burst(this.x, this.y + this.height * 0.6, this.z, 0xffe066, 18, 6, 0.15, 0.5);
        sfx.crit();
      }
      return amount - soak;
    }
    return amount;
  }

  // Called when this enemy's attack connects with the player.
  onHitPlayer(dmg) {
    if (this.affixes.includes('vampiric') && this.alive) {
      const h = dmg * 1.5;
      this.hp = Math.min(this.maxHp, this.hp + h);
      this.game.effects.damageNumber(this.x, this.y + this.height + 0.3, this.z, `+${Math.round(h)}`, 'heal');
    }
  }

  // --------------------------------------------------------------- visuals
  buildMesh() {
    const S = shared();
    const d = this.def;
    const root = new THREE.Group();
    this.ownMats = [];
    if (d.model) {
      const model = new CharacterModel(d.model, { scale: d.mscale * this.scale, pivotY: this.height * 0.45 });
      this.model = model;
      for (const [name, hand] of d.gear) {
        const g = gearModel(name);
        if (!g) continue;
        if (hand === 'r') g.rotation.y = Math.PI;
        if (hand === 'x') g.rotation.y = Math.PI / 2;
        model.bones[hand === 'l' ? 'handslotl' : 'handslotr'].add(g);
      }
      if (d.boss) this.crown(model);
      // bake everything into a few skinned meshes (one draw call per material)
      const merged = mergeCharacter(model.root);
      for (const m of merged) m.userData.ownGeo = true;
      model.parts = {};
      model.mats = [...new Set(merged.map((m) => m.material))];
      // eyes: the pack's glow material; recolour for elites and the boss
      this.eyeMat = model.mats.find((m) => m.name === 'Glow') || null;
      this.bodyMats = model.mats.filter((m) => m !== this.eyeMat);
      const eye = d.boss ? 0xb04dff : this.elite ? AFFIXES[this.affixes[0]].color : null;
      if (this.eyeMat && eye) {
        this.eyeMat.color.setHex(eye);
        this.eyeMat.emissive.setHex(eye);
        this.eyeMat.emissiveIntensity = 2.2;
      }
      root.add(model.group);
    } else if (d.prop) {
      this.buildMimic(root);
    } else {
      this.buildWisp(root);
    }

    if (this.elite) {
      const col = AFFIXES[this.affixes[0]].color;
      const aura = new THREE.Mesh(G.torus(1, 0.04, Math.PI * 2, 4, 32), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false }));
      this.ownMats.push(aura.material);
      aura.rotation.x = -Math.PI / 2;
      aura.position.y = 0.06 - (d.hover || 0);
      aura.scale.setScalar(this.radius * 1.5);
      root.add(aura);
      this.aura = aura;
      const label = this.affixes.map((a) => AFFIXES[a].name).join(' ') + ' ' + d.name;
      this.tag = nameTag(label, col);
      this.ownMats.push(this.tag.material);
      this.tag.position.y = this.height + 0.85 - (d.hover || 0);
      root.add(this.tag);
      if (this.shieldHp > 0) {
        this.bubble = new THREE.Mesh(G.ico(1, 2), S.shield);
        this.bubble.scale.set(this.radius * 1.6, this.height * 0.65, this.radius * 1.6);
        this.bubble.position.y = this.height * 0.5 - (d.hover || 0);
        this.bubble.userData.noShadow = true;
        root.add(this.bubble);
      }
    }

    if (!d.boss) {
      const bar = new THREE.Group();
      const bg = new THREE.Mesh(G.plane(1, 0.12), S.hbBg);
      const fill = new THREE.Mesh(fillGeo, this.elite ? S.hbGold : S.hbRed);
      fill.userData.noShadow = true;
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

  crown(model) {
    const S = shared();
    const c = new THREE.Group();
    part(c, G.cyl(0.36, 0.33, 0.16, 10, true), S.gold, [0, 0, 0]);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      part(c, G.cone(0.07, 0.24, 4), S.gold, [Math.sin(a) * 0.34, 0.18, Math.cos(a) * 0.34]);
    }
    part(c, G.octa(0.08), S.gem, [0, 0.02, 0.36]);
    c.position.set(0, 1.18, 0.02);
    model.bones.head.add(c);
  }

  // A treasure chest with a tongue, two rows of teeth and eyes on the lid.
  buildMimic(root) {
    const body = propModel(this.def.prop);
    const own = new Map();
    body.traverse((o) => {
      if (!o.isMesh) return;
      if (!own.has(o.material)) own.set(o.material, o.material.clone());
      o.material = own.get(o.material);
      o.castShadow = true;
    });
    this.bodyMats = [...own.values()];
    this.ownMats.push(...this.bodyMats);
    body.scale.setScalar(0.62 * this.scale);
    const lid = hingeLid(body, this.def.prop + '_lid', 0.6, -0.64);
    const tooth = mat(0xf4efe0, { rough: 0.5 });
    const tongue = mat(0xc0304a, { rough: 0.6 });
    const eye = mat(0xffe24a, { emissive: 0xffc81a, ei: 2 });
    this.ownMats.push(tooth, tongue, eye);
    const base = body.children[0] || body;
    for (let i = 0; i < 7; i++) part(base, G.cone(0.07, 0.24, 4), tooth, [-0.6 + i * 0.2, 0.68, 0.6]);
    part(base, G.box(0.7, 0.08, 0.8), tongue, [0, 0.58, 0.05], [0.12, 0, 0]);
    if (lid) {
      for (let i = 0; i < 7; i++) part(lid, G.cone(0.07, 0.22, 4), tooth, [-0.6 + i * 0.2, -0.08, 1.36], [Math.PI, 0, 0]);
      this.eyes = [];
      for (const s of [-1, 1]) this.eyes.push(part(lid, G.sphere(0.12, 10, 8), eye, [s * 0.38, 0.42, 1.4]));
    }
    this.lid = lid;
    this.lidBase = lid ? lid.rotation.x : 0;
    this.mimicBody = body;
    this.hopT = 0;
    root.add(body);
  }

  reveal() {
    this.disguised = false;
    this.aggro = true;
    this.vy = 7;
    this.stun = 0.4;
    this.game.effects.burst(this.x, 0.8, this.z, 0xffd34d, 16, 5, 0.15, 0.6);
    this.game.effects.shake(0.3);
    this.game.ui.toast("It's a Mimic!", 1.6, '#ffcf5a');
    sfx.slam();
  }

  buildWisp(root) {
    const d = this.def;
    this.bodyMat = mat(d.color, { rough: 0.8 });
    this.bodyMat.emissive = new THREE.Color(d.color);
    this.bodyMat.emissiveIntensity = 0.35;
    this.baseEmissive = this.elite ? 0xffaa33 : d.color;
    this.ownMats.push(this.bodyMat);
    const g = new THREE.Group();
    const shellMat = new THREE.MeshBasicMaterial({ color: d.color, wireframe: true, transparent: true, opacity: 0.45 });
    this.ownMats.push(shellMat);
    this.shell = part(g, G.ico(0.52, 0), shellMat);
    this.shards = [];
    for (let i = 0; i < 4; i++) this.shards.push(part(g, G.octa(0.08), this.bodyMat, [0, 0, 0], null, [1, 1.8, 1]));
    for (const s of [1, -1]) part(g, G.sphere(0.05, 6, 5), shared().yellowEye, [s * 0.1, 0.05, 0.27]);
    this.wispBody = g;
    g.scale.setScalar(this.scale);
    root.add(g);
  }

  // ------------------------------------------------------------ spawn states
  startDormant() {
    this.dormant = true;
    this.model.animator.play('Skeletons_Awaken_Floor', { hold: true, speed: 0, instant: true });
    this.model.update(0);
  }

  startRise() {
    this.rising = 2.1;
    this.aggro = true;
    if (this.model) this.model.animator.play('Spawn_Ground_Skeletons', { from: 0.12, speed: 1.55, dur: 2.1, instant: true, fadeOut: 0.25 });
    this.game.effects.burst(this.x, 0.1, this.z, 0x6a5a48, 14, 4, 0.15, 0.5);
  }

  awaken() {
    if (!this.dormant) return;
    this.dormant = false;
    this.rising = 1.6;
    this.aggro = true;
    this.model.animator.play('Skeletons_Awaken_Floor', { speed: 1.45, dur: 1.6, instant: true, fadeOut: 0.25 });
    this.game.effects.burst(this.x, 0.2, this.z, 0xe8e0c8, 10, 3, 0.1, 0.4);
    sfx.hit();
  }

  // ------------------------------------------------------------------ update
  update(dt, game) {
    // chase whoever is closest (every player, in multiplayer)
    const p = game.targetFor ? game.targetFor(this) : game.player;
    this.lookTarget = p;
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
      ['bleed', 'bleedDmg', 'dot'],
    ]) {
      if (this[k] <= 0) continue;
      this[k] -= dt;
      this[k + 'Tick'] = (this[k + 'Tick'] || 0) - dt;
      if (this[k + 'Tick'] <= 0) {
        this[k + 'Tick'] = 0.35;
        game.damageEnemy(this, { amount: this[dk] || 3, crit: false, knock: 0, silent: true, dot: col }, this.x, this.z);
        if (!this.alive) return;
      }
      if (Math.random() < 0.2) game.effects.puff(this.x + (Math.random() - 0.5) * 0.6, this.y + this.height * (0.3 + Math.random() * 0.6), this.z + (Math.random() - 0.5) * 0.6, k === 'burn' ? 0xff7a2e : k === 'bleed' ? 0xb01020 : 0x7adf4a, 0.18, 0.4);
    }

    // knockback + vertical launch
    if (Math.abs(this.kx) + Math.abs(this.kz) > 0.05) {
      dg.move(this, this.kx * dt, this.kz * dt, false);
      const decay = Math.exp(-(def.heavy ? 10 : 7) * dt);
      this.kx *= decay;
      this.kz *= decay;
    }
    // stand on the floor below (platforms, stairs); fall when knocked off a ledge
    const floor = dg.maxHeightUnder(this.x, this.z, this.radius * 0.6);
    if (floor < 50) this.groundY = floor;
    const baseY = (this.groundY || 0) + (def.hover || 0);
    if (this.y < baseY) {
      this.y = baseY;
      if (this.vy < 0) this.vy = 0;
    } else if (this.vy === 0 && this.y - baseY < 0.4) {
      this.y = baseY; // down the stairs
    } else if (this.y > baseY || this.vy > 0) {
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
    // draw and animate only enemies the player could plausibly see
    this.losT = (this.losT ?? Math.random() * 0.3) - dt;
    if (this.losT <= 0 || this.seen === undefined) {
      this.losT = 0.25;
      this.seen = dist < 10 || (dist < 34 && dg.lineOfSight(this.x, this.z, p.x, p.z, 3.5, true));
    }
    this.mesh.visible = !!(this.seen || this.def.boss);
    this.speedNow = 0;

    if (this.disguised) {
      if ((dist < 2.4 && Math.abs(p.y - this.y) < 2) || this.hp < this.maxHp) this.reveal();
      this.render(dt);
      return;
    }
    if (this.dormant) {
      if ((dist < 6.5 && Math.abs(p.y - this.y) < 3) || this.hp < this.maxHp) this.awaken();
      this.render(dt);
      return;
    }
    if (this.rising > 0) {
      this.rising -= dt;
      this.turnTo(toPlayer, dt, 2);
      this.render(dt);
      return;
    }
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

    // arcane elites spray orbs now and then
    if (this.affixes.includes('arcane')) {
      this.arcaneT -= dt;
      if (this.arcaneT <= 0 && dist < 16) {
        this.arcaneT = 3.8;
        for (let i = 0; i < 6; i++) game.spawnEnemyProjectile(this.x, (this.groundY || 0) + 1.1, this.z, (i / 6) * Math.PI * 2 + this.animT, 7, this.def.dmg * this.dmgMul * 0.5, 'orb');
        game.effects.ring(this.x, this.z, 1.6, 0xb58cff, 0.35);
        sfx.fire();
      }
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
        // straight at the player on the same level; otherwise follow the path (stairs)
        if (los && Math.abs(dy) < 0.6) {
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
            if (this.stateT > 0.8 * this.tempo) this.beginWindup(toPlayer);
          }
        } else if (dist < def.range + this.radius * 0.3 && Math.abs(dy) < 1.3 && los) {
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
        moveSpeed = def.speed * this.slowF * this.speedMul;
        mvx = dirx;
        mvz = dirz;
        if (mvx || mvz) this.turnTo(Math.atan2(mvx, mvz), dt, 8);
        if (def.ranged && los) this.turnTo(toPlayer, dt, 10);
        break;
      }
      case 'windup': {
        if (!def.heavy) this.turnTo(toPlayer, dt, 3);
        if (this.stateT >= this.windupTime) {
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
        if (this.stateT > this.def.recover * (this.elite ? 0.8 : 1) * this.tempo) {
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
    this.windupTime = this.def.windup * this.tempo;
    this.castKind = null;
    if (this.type === 'brute') {
      const fx = this.x + Math.sin(this.heading) * 1.6 * this.scale;
      const fz = this.z + Math.cos(this.heading) * 1.6 * this.scale;
      this.slamAt = { x: fx, z: fz, r: 3.2 * this.scale };
      this.game.effects.telegraph(fx, fz, this.slamAt.r, this.windupTime);
    }
    if (this.type === 'mage') {
      this.casts++;
      // every third spell raises the dead instead
      if (this.casts % 3 === 0 && this.game.enemies.filter((e) => e.alive && e.summoned).length < 6) {
        this.castKind = 'summon';
        this.windupTime = 1.3 * this.tempo;
        this.game.effects.telegraph(this.x, this.z, 3, this.windupTime, 0x9a66ff);
      }
    }
    this.playWindup();
  }

  performAttack(game, dist) {
    const p = this.lookTarget || game.player;
    const dmg = this.def.dmg * this.dmgMul;
    if (this.type === 'grunt' || this.type === 'mimic') {
      this.lunge = this.type === 'mimic' ? 0.16 : 0.12;
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
      const y = (this.groundY || 0) + 1.3;
      const vy = this.aimVy(p, y, 16);
      game.spawnEnemyProjectile(this.x, y, this.z, h, 16, dmg, 'arrow', vy);
      if (this.elite) {
        game.spawnEnemyProjectile(this.x, y, this.z, h + 0.2, 16, dmg, 'arrow', vy);
        game.spawnEnemyProjectile(this.x, y, this.z, h - 0.2, 16, dmg, 'arrow', vy);
      }
      sfx.arrow();
    } else if (this.type === 'mage') {
      if (this.castKind === 'summon') {
        game.raiseDead(this, 2);
      } else {
        const h = Math.atan2(p.x - this.x, p.z - this.z);
        const y = (this.groundY || 0) + 1.4;
        const vy = this.aimVy(p, y, 9);
        for (const off of this.elite ? [-0.3, -0.1, 0.1, 0.3] : [-0.18, 0, 0.18]) game.spawnEnemyProjectile(this.x, y, this.z, h + off, 9, dmg * 0.8, 'orb', vy);
        sfx.fire();
      }
    } else if (this.type === 'brute') {
      const s = this.slamAt || { x: this.x + Math.sin(this.heading) * 1.6 * this.scale, z: this.z + Math.cos(this.heading) * 1.6 * this.scale, r: 3.2 * this.scale };
      game.shockwave(s.x, s.z, s.r, dmg, this);
    }
    this.playAttack();
  }

  // Vertical speed for a shot from height y to reach the target's chest (0 on the same level).
  aimVy(p, y, speed) {
    const dy = (p.y || 0) + 1.0 - y;
    if (Math.abs(dy) < 0.6) return 0;
    const d = Math.max(1, Math.hypot(p.x - this.x, p.z - this.z));
    return Math.max(-14, Math.min(14, dy / (d / speed)));
  }

  checkLungeHit(game) {
    const p = this.lookTarget || game.player;
    const reach = this.def.range + this.radius;
    const dx = p.x - this.x;
    const dz = p.z - this.z;
    const d = Math.hypot(dx, dz);
    if (d > reach || Math.abs(p.y - (this.y - (this.def.hover || 0))) > 1.6) return;
    const dot = (dx * Math.sin(this.heading) + dz * Math.cos(this.heading)) / (d || 1);
    if (dot < 0.2 && d > this.radius + p.radius + 0.2) return;
    this.lungeHit = true;
    const dmg = this.def.dmg * this.dmgMul;
    if (p.takeDamage(dmg, this, true)) {
      p.vx += (dx / (d || 1)) * 6;
      p.vz += (dz / (d || 1)) * 6;
      this.onHitPlayer(dmg);
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
      this.bossWind = m === 'charge' ? 0.7 : m === 'volley' ? 0.6 : m === 'summon' ? 1.2 : 1.0;
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
      this.playBossWindup(m);
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
    const p = this.lookTarget || game.player;
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
          for (let i = 0; i < n; i++) game.spawnEnemyProjectile(this.x, (this.groundY || 0) + 1.6, this.z, this.heading + (i - (n - 1) / 2) * 0.17, 11, dmg * 0.7, 'orb');
          sfx.fire();
        } else if (m === 'charge') {
          this.chargeT = 0.75;
          this.lungeHit = false;
          sfx.dash();
        } else if (m === 'summon') {
          game.raiseDead(this, 3);
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
  // Play a strike so its impact frame lands `t` seconds from now.
  strike(name, t, o = {}) {
    const c = clip(name);
    if (!c || !this.model) return;
    const imp = IMPACT[name] ?? c.duration * 0.4;
    const s0 = Math.max(0, imp - (o.windup ?? 0.55));
    const rate = clamp((imp - s0) / Math.max(0.05, t), 0.3, 3);
    this.model.animator.play(name, { from: s0 / c.duration, speed: rate, dur: t + (o.after ?? 0.45), part: o.part || 'full', fadeIn: 0.08, fadeOut: 0.25 });
  }

  playWindup() {
    if (!this.model) return;
    const an = this.model.animator;
    const w = this.windupTime;
    switch (this.type) {
      case 'grunt':
        return this.strike('1H_Melee_Attack_Chop', w + 0.06);
      case 'brute':
        return this.strike('2H_Melee_Attack_Chop', w, { windup: 0.6 });
      case 'archer':
        return an.play('2H_Ranged_Aiming', { part: 'upper', loop: true, fadeIn: 0.12 });
      case 'mage':
        if (this.castKind === 'summon') return this.strike('Spellcast_Summon', w, { windup: 1.6, after: 0.6 });
        return an.play('Spellcasting', { part: 'upper', loop: true, fadeIn: 0.12 });
      default:
        return null;
    }
  }

  playAttack() {
    if (!this.model) return;
    const an = this.model.animator;
    if (this.type === 'archer') an.play('2H_Ranged_Shoot', { part: 'upper', from: 0.08, dur: 0.5, fadeIn: 0.03 });
    else if (this.type === 'mage' && this.castKind !== 'summon') an.play('Spellcast_Shoot', { part: 'upper', from: 0.05, dur: 0.6, fadeIn: 0.03 });
  }

  playBossWindup(m) {
    const an = this.model.animator;
    const w = this.bossWind;
    if (m === 'slam') this.strike('2H_Melee_Attack_Chop', w, { windup: 0.65 });
    else if (m === 'nova') this.strike('1H_Melee_Attack_Jump_Chop', w, { windup: 0.7 });
    else if (m === 'volley') this.strike('Throw', w, { windup: 0.6 });
    else if (m === 'summon') this.strike('Spellcast_Summon', w, { windup: 1.8, after: 0.6 });
    else if (m === 'charge') an.play('Blocking', { part: 'upper', loop: true, fadeIn: 0.1 });
  }

  render(dt, frozen = false) {
    const m = this.mesh;
    m.position.set(this.x, this.y, this.z);
    m.rotation.y = this.heading;
    if (!m.visible && dt > 0) return; // off-screen: skip pose work entirely
    const t = this.animT;

    // tint: hit flash > freeze > burn/poison > none
    const tint = this.flash > 0 ? 0xffffff : this.freeze > 0 ? 0x2266aa : this.burn > 0 ? 0x662200 : this.poison > 0 ? 0x1f5a10 : 0;
    if (this.bodyMats) {
      if (tint !== this.lastTint) {
        for (const mt of this.bodyMats) {
          mt.emissive.setHex(tint);
          mt.emissiveIntensity = this.flash > 0 ? 0.7 : 0.6;
        }
        this.lastTint = tint;
      }
    } else this.bodyMat.emissive.setHex(tint || this.baseEmissive);

    this.updateIce();
    this.updateStars(dt);
    if (this.aura) this.aura.rotation.z = t;
    if (this.bubble) {
      this.bubble.visible = this.shieldHp > 0;
      this.bubble.rotation.y = t * 0.8;
    }
    if (this.hpBar) {
      this.hpBar.visible = this.hp < this.maxHp && !this.dormant && !this.disguised;
      this.hpFill.scale.x = clamp(this.hp / this.maxHp, 0, 1);
      this.hpBar.quaternion.copy(m.quaternion).invert().multiply(this.game.camera.quaternion);
    }
    if (this.tag) this.tag.visible = !this.dormant;
    if (frozen) return; // hold the pose while encased in ice

    if (this.type === 'wisp') return this.animateWisp(dt);
    if (this.type === 'mimic') return this.animateMimic(dt);
    const model = this.model;
    const an = model.animator;
    const d = this.def;

    // locomotion base
    const s = this.speedNow;
    const idle = this.aggro ? 'Idle_Combat' : 'Idle';
    // airborne: above the floor it stands on (platforms count as floor)
    const air = this.y - (this.groundY || 0) > (d.hover || 0) + 0.3;
    if (air) an.setBase({ Jump_Idle: 1 });
    else if (s < 0.3) an.setBase({ [idle]: 1 });
    else {
      const ref = d.mscale * this.scale;
      const wr = clamp((s - 2.5) / 3, 0, 1);
      an.setBase({ [d.walk]: 1 - wr, [d.run]: wr }, { [d.walk]: clamp(s / (3.4 * ref), 0.6, 1.8), [d.run]: clamp(s / (6.5 * ref), 0.7, 1.8), sync: [d.walk, d.run] });
    }

    // leave windup/aim loops when the state machine moves on
    const st = this.state;
    // (puppets get these animation calls from the host instead)
    if (st !== this.lastState && !this.puppet) {
      if (this.lastState === 'windup' && st !== 'attack') an.stop(null, 0.2);
      if (st === 'chase' && (this.type === 'archer' || this.type === 'mage')) an.stop(null, 0.25);
      if (this.lastState === 'bossact' || (this.lastState === 'bosswind' && st === 'chase')) an.stop(null, 0.3);
      this.lastState = st;
    }
    if (this.flinch > 0.18 && !this.flinched && !this.puppet) an.play(Math.random() < 0.5 ? 'Hit_A' : 'Hit_B', { part: 'upper', dur: 0.35, weight: 0.8, keep: true, fadeIn: 0.03 });
    this.flinched = this.flinch > 0.18;

    model.update(dt);

    // head tracks the player; dazed enemies wobble
    if (this.aggro && !this.rising && st !== 'windup' && st !== 'bosswind') {
      const p = this.lookTarget || this.game.player;
      this.lookA = (this.lookA || 0) + (clamp(angleDiff(this.heading, Math.atan2(p.x - this.x, p.z - this.z)), -1, 1) - (this.lookA || 0)) * Math.min(1, dt * 5);
      model.look(this.lookA * 0.6);
    }
    const daze = this.stun > 0 || this.blind > 0 ? Math.sin(t * 7) * 0.12 : 0;
    model.pivot.rotation.set(air ? -0.35 : 0, 0, daze);
  }

  animateMimic(dt) {
    const b = this.mimicBody;
    const t = this.animT;
    if (this.eyes) for (const e of this.eyes) e.visible = !this.disguised;
    let lid = 0;
    let hop = 0;
    let tilt = 0;
    if (!this.disguised) {
      const s = this.state;
      if (this.speedNow > 0.5) {
        this.hopT += dt * 9;
        hop = Math.abs(Math.sin(this.hopT)) * 0.35;
        tilt = 0.15;
        lid = -0.35 - Math.abs(Math.sin(this.hopT * 0.5)) * 0.35;
      } else lid = -0.25 - Math.sin(t * 6) * 0.1;
      if (s === 'windup') {
        lid = -1.25 * ease(this.stateT / this.windupTime);
        tilt = -0.2;
      } else if (s === 'attack') {
        lid = 0;
        tilt = 0.3;
      }
      if (this.stun > 0) lid = -0.9 + Math.sin(t * 20) * 0.1;
    } else if (Math.floor(t * 0.4) % 5 === 0) {
      // a nervous twitch now and then gives it away
      lid = -Math.max(0, Math.sin(t * 30)) * 0.05;
    }
    if (this.lid) this.lid.rotation.x += (this.lidBase + lid - this.lid.rotation.x) * Math.min(1, dt * 18);
    b.position.y = hop;
    b.rotation.x += (tilt - b.rotation.x) * Math.min(1, dt * 10);
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
        this.ice = part(this.mesh, G.ico(1, 0), shared().ice, [0, this.height * 0.5, 0], null, [r, this.height * 0.62, r]);
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
    this.dormant = false;
    this.rising = 0;
    if (this.hpBar) this.hpBar.visible = false;
    if (this.stars) this.stars.visible = false;
    if (this.ice) this.ice.visible = false;
    if (this.aura) this.aura.visible = false;
    if (this.tag) this.tag.visible = false;
    if (this.bubble) this.bubble.visible = false;
    if (this.model) {
      for (const mt of this.bodyMats) mt.emissive.setHex(0);
      this.model.pivot.rotation.set(0, 0, 0);
      this.model.animator.setBase({ Idle: 1 });
      // skeletons fall apart into a bone pile; the heavy ones topple
      this.model.animator.play(this.def.heavy ? 'Death_A' : 'Death_C_Skeletons', { hold: true, fadeIn: 0.06, speed: this.def.heavy ? 1 : 1.3 });
    } else if (this.bodyMats) {
      for (const mt of this.bodyMats) mt.emissive.setHex(0);
    } else this.bodyMat.emissive.setHex(0);
    // explosive elites detonate a moment after dying
    if (this.affixes.includes('explosive')) {
      const g = this.game;
      const x = this.x;
      const z = this.z;
      const dmg = this.def.dmg * this.dmgMul * 1.5;
      g.effects.telegraph(x, z, 3.5, 0.9, 0xff8c2e);
      g.schedule(0.9, () => {
        g.effects.burst(x, 0.6, z, 0xff8c2e, 30, 9, 0.25, 0.6);
        g.shockwave(x, z, 3.5, dmg, null);
      });
    }
  }

  // Returns false once the corpse is gone.
  updateDeath(dt) {
    this.deathT += dt;
    const t = this.deathT;
    if (this.type === 'wisp') {
      this.wispBody.scale.setScalar(Math.max(0.01, this.scale * (1 - t * 3)));
      return t < 0.35;
    }
    if (this.type === 'mimic') {
      // lid flops open, the chest keels over and sinks
      if (this.lid) this.lid.rotation.x += (this.lidBase - 1.6 - this.lid.rotation.x) * Math.min(1, dt * 8);
      this.mimicBody.rotation.z = Math.min(1.3, t * 3);
      this.mimicBody.position.y = 0;
      if (t > 1.6) this.mesh.position.y = -(t - 1.6) * 0.8;
      return t < 2.8;
    }
    this.heading += angleDiff(this.heading, this.fallDir + Math.PI) * Math.min(1, dt * 6);
    this.mesh.rotation.y = this.heading;
    if (this.mesh.visible) this.model.update(dt);
    // linger as a bone pile (a mage may raise it again), then sink away
    if (t > 7) this.mesh.position.y = this.y - (t - 7) * 0.8;
    return t < 8.2;
  }

  // Stand a fallen skeleton back up (Skeleton Mage / Bone King).
  resurrect() {
    this.alive = true;
    this.dying = false;
    this.hp = this.maxHp * 0.5;
    this.summoned = true;
    this.aggro = true;
    this.state = 'chase';
    this.stateT = 0;
    this.rising = 2.2;
    this.mesh.position.y = this.y;
    this.model.animator.play('Death_C_Skeletons_Resurrect', { from: 0.1, speed: 1.3, dur: 2.2, fadeIn: 0.05, fadeOut: 0.3 });
    if (this.aura) this.aura.visible = true;
    if (this.tag) this.tag.visible = true;
  }

  dispose() {
    this.mesh.traverse((o) => {
      if (o.userData.ownGeo && o.geometry) o.geometry.dispose();
    });
    for (const m of this.ownMats) {
      m.map?.dispose?.();
      m.dispose();
    }
    if (this.model) this.model.dispose();
  }
}
