// The player knight: movement (run / jump / double jump / dash), 3-hit combo,
// four directional skills, stats derived from equipment + upgrades.

import * as THREE from 'three';
import { clamp, angleDiff } from './utils.js';
import { sfx } from './audio.js';
import { SLOTS } from './items.js';

export const SKILLS = [
  { id: 'slam', name: 'Leap Slam', icon: '🔨', cd: 6, color: '#ffb347', desc: 'Leap at a foe and crush the ground' },
  { id: 'bolt', name: 'Fire Bolt', icon: '🔥', cd: 2.5, color: '#ff6a3d', desc: 'Hurl an exploding fireball' },
  { id: 'whirl', name: 'Whirlwind', icon: '🌀', cd: 8, color: '#9be7ff', desc: 'Spin, striking everything around you' },
  { id: 'nova', name: 'Frost Nova', icon: '❄', cd: 10, color: '#8fd3ff', desc: 'Freeze nearby enemies in place' },
];

const GRAVITY = 28;
const JUMP_V = 10;
const AIR_JUMP_V = 9;
const DASH_TIME = 0.17;
const DASH_SPEED = 24;
const DASH_RECHARGE = 0.9;
const COMBO = [
  { dur: 0.32, hitAt: 0.35, mult: 1.0, arc: 2.3, range: 2.4, knock: 4, swing: 1 },
  { dur: 0.32, hitAt: 0.35, mult: 1.1, arc: 2.3, range: 2.4, knock: 4, swing: -1 },
  { dur: 0.5, hitAt: 0.45, mult: 1.8, arc: 6.3, range: 2.9, knock: 10, swing: 2 },
];

function baseStats() {
  return {
    maxHp: 100,
    damage: 10,
    dmgPct: 0,
    armor: 0,
    attackSpeed: 0,
    crit: 0.05,
    critMult: 0.6,
    lifesteal: 0,
    moveSpeed: 0,
    cdr: 0,
    skillPower: 0,
    goldFind: 0,
  };
}

export class Player {
  constructor(game) {
    this.game = game;
    this.radius = 0.45;
    this.stats = baseStats();
    this.mods = {
      dashCharges: 1,
      airJumps: 1,
      boltExtra: 0,
      whirlDur: 1,
      whirlPull: false,
      novaFreeze: 2,
      novaRadius: 1,
      slamPower: 1,
      fireDash: false,
      stomp: false,
      thorns: 0,
      regen: 0,
      execute: 0,
      reach: 1,
    };
    this.upgradeCounts = {};
    this.equipment = { weapon: null, armor: null, charm: null };
    this.recompute();
    this.hp = this.final.maxHp;
    this.gold = 0;
    this.kills = 0;
    this.buildMesh();
    this.resetState();
  }

  resetState() {
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.vx = 0;
    this.vz = 0;
    this.vy = 0;
    this.heading = 0;
    this.grounded = true;
    this.coyote = 0;
    this.airJumpsLeft = this.mods.airJumps;
    this.dashTime = 0;
    this.dashDir = { x: 0, z: 1 };
    this.dashCharges = this.mods.dashCharges;
    this.dashRecharge = 0;
    this.attack = null; // { i, t, dur, hit }
    this.comboIndex = 0;
    this.comboTimer = 0;
    this.attackBuffered = false;
    this.cooldowns = [0, 0, 0, 0];
    this.skill = null; // { id, t, ... }
    this.skillBuffer = null;
    this.invuln = 0;
    this.hurtFlash = 0;
    this.dead = false;
    this.animT = 0;
    this.fireTrailT = 0;
  }

  // ----------------------------------------------------------------- stats
  recompute() {
    const s = { ...this.stats };
    for (const slot of SLOTS) {
      const it = this.equipment[slot];
      if (!it) continue;
      for (const k in it.stats) s[k] = (s[k] || 0) + it.stats[k];
    }
    const prevMax = this.final ? this.final.maxHp : null;
    this.final = {
      maxHp: Math.round(s.maxHp),
      damage: s.damage * (1 + s.dmgPct),
      armor: s.armor,
      dmgTaken: 50 / (50 + Math.max(0, s.armor)),
      atkSpeed: 1 + s.attackSpeed,
      crit: Math.min(0.9, s.crit),
      critMult: 1 + s.critMult,
      lifesteal: s.lifesteal,
      moveSpeed: 7.5 * (1 + s.moveSpeed),
      cdr: Math.min(0.6, s.cdr),
      skillMult: 1 + s.skillPower,
      goldMult: 1 + s.goldFind,
    };
    if (prevMax !== null && this.hp !== undefined) {
      // keep the same missing-health when max hp changes
      if (this.final.maxHp > prevMax) this.hp += this.final.maxHp - prevMax;
      this.hp = Math.min(this.hp, this.final.maxHp);
    }
    if (this.swordMat) this.updateWeaponLook();
  }

  equip(item) {
    const old = this.equipment[item.slot];
    this.equipment[item.slot] = item;
    this.recompute();
    return old;
  }

  applyUpgrade(u) {
    this.upgradeCounts[u.id] = (this.upgradeCounts[u.id] || 0) + 1;
    u.apply(this);
    this.recompute();
    this.dashCharges = this.mods.dashCharges;
    this.airJumpsLeft = this.mods.airJumps;
  }

  rollDamage(mult, isSkill = false) {
    const f = this.final;
    let amount = f.damage * mult * (isSkill ? f.skillMult : 1);
    amount *= 0.9 + Math.random() * 0.2;
    const crit = Math.random() < f.crit;
    if (crit) amount *= f.critMult;
    return { amount, crit };
  }

  // ------------------------------------------------------------------ mesh
  buildMesh() {
    const g = new THREE.Group();
    const armor = new THREE.MeshLambertMaterial({ color: 0x8a9bb5 });
    const dark = new THREE.MeshLambertMaterial({ color: 0x2c3444 });
    const skin = new THREE.MeshLambertMaterial({ color: 0xe0b48f });
    const cape = new THREE.MeshLambertMaterial({ color: 0xb8322f, side: THREE.DoubleSide });
    this.bodyMats = [armor, dark, skin, cape];

    const root = new THREE.Group(); // bob / lean
    g.add(root);

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.38), armor);
    torso.position.y = 1.0;
    root.add(torso);
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.12, 0.4), dark);
    belt.position.y = 0.72;
    root.add(belt);

    const head = new THREE.Group();
    head.position.y = 1.5;
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), skin);
    head.add(face);
    const helm = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.22, 0.42), armor);
    helm.position.set(0, 0.12, -0.02);
    head.add(helm);
    const plume = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.36), cape);
    plume.position.set(0, 0.3, -0.04);
    head.add(plume);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.06, 0.05), dark);
    visor.position.set(0, 0.02, 0.18);
    head.add(visor);
    root.add(head);

    const capeMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.8), cape);
    capeMesh.geometry.translate(0, -0.4, 0);
    capeMesh.position.set(0, 1.28, -0.21);
    root.add(capeMesh);
    this.cape = capeMesh;

    const mkLimb = (w, h, mat, x, y) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, 0);
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), mat);
      m.position.y = -h / 2;
      pivot.add(m);
      root.add(pivot);
      return pivot;
    };
    // model faces +z, so the character's right-hand side is -x
    this.legL = mkLimb(0.22, 0.66, dark, 0.16, 0.66);
    this.legR = mkLimb(0.22, 0.66, dark, -0.16, 0.66);
    this.armL = mkLimb(0.18, 0.58, armor, 0.42, 1.26);
    this.armR = mkLimb(0.18, 0.58, armor, -0.42, 1.26);

    // shield on left arm
    const shield = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.42), new THREE.MeshLambertMaterial({ color: 0x6b4a2b }));
    shield.position.set(0.1, -0.35, 0.05);
    this.armL.add(shield);

    // sword in right hand
    const sword = new THREE.Group();
    sword.position.set(0, -0.56, 0.05);
    this.swordMat = new THREE.MeshLambertMaterial({ color: 0xdfe6ee, emissive: 0x000000 });
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 1.1), this.swordMat);
    blade.position.z = 0.62;
    sword.add(blade);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.07, 0.07), dark);
    guard.position.z = 0.06;
    sword.add(guard);
    const hilt = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.2), dark);
    hilt.position.z = -0.06;
    sword.add(hilt);
    this.armR.add(sword);
    this.sword = sword;

    // blob shadow
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.5, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    this.shadow = shadow;

    this.root = root;
    this.head = head;
    this.mesh = g;
    this.updateWeaponLook();
  }

  updateWeaponLook() {
    const w = this.equipment.weapon;
    if (w && w.rarity.id !== 'common') {
      this.swordMat.color.setHex(w.rarity.hex);
      this.swordMat.emissive.setHex(w.rarity.hex).multiplyScalar(0.45);
    } else {
      this.swordMat.color.setHex(0xdfe6ee);
      this.swordMat.emissive.setHex(0x000000);
    }
  }

  // --------------------------------------------------------------- update
  update(dt, input, cam) {
    const game = this.game;
    const dg = game.dungeon;
    const f = this.final;

    // timers
    this.invuln = Math.max(0, this.invuln - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    for (let i = 0; i < 4; i++) this.cooldowns[i] = Math.max(0, this.cooldowns[i] - dt);
    if (this.dashCharges < this.mods.dashCharges) {
      this.dashRecharge += dt;
      if (this.dashRecharge >= DASH_RECHARGE) {
        this.dashRecharge = 0;
        this.dashCharges++;
      }
    }
    if (this.mods.regen > 0) this.heal(f.maxHp * this.mods.regen * dt, false);

    // camera-relative wish direction
    const sy = Math.sin(cam.yaw);
    const cy = Math.cos(cam.yaw);
    let wx = sy * input.moveY - cy * input.moveX;
    let wz = cy * input.moveY + sy * input.moveX;
    const wlen = Math.hypot(wx, wz);
    const wmag = Math.min(1, wlen);
    if (wlen > 0.01) {
      wx /= wlen;
      wz /= wlen;
    }
    const hasMove = wmag > 0.05;
    const wishHeading = hasMove ? Math.atan2(wx, wz) : this.heading;

    // ---------------- actions
    if (input.pressed.jump) this.tryJump();
    if (input.pressed.dash) this.tryDash(hasMove ? { x: wx, z: wz } : { x: Math.sin(this.heading), z: Math.cos(this.heading) });
    // skills are buffered briefly so a swipe released mid-swing still fires
    if (input.skillPressed >= 0) this.skillBuffer = { idx: input.skillPressed, t: 0.35 };
    if (this.skillBuffer) {
      this.skillBuffer.t -= dt;
      if (this.trySkill(this.skillBuffer.idx, hasMove ? wishHeading : null, cam) || this.skillBuffer.t <= 0) this.skillBuffer = null;
    }
    if (input.pressed.attack) this.attackBuffered = true;
    if ((this.attackBuffered || input.attackHeld) && this.canStartAttack()) {
      this.startAttack(hasMove ? wishHeading : null);
      this.attackBuffered = false;
    }

    // ---------------- horizontal velocity
    let speed = f.moveSpeed * wmag;
    let tvx = hasMove ? wx * speed : 0;
    let tvz = hasMove ? wz * speed : 0;
    let accel = this.grounded ? 60 : 25;

    if (this.skill && this.skill.id === 'slam' && this.skill.airborne) {
      tvx = this.skill.vx;
      tvz = this.skill.vz;
      accel = 1000;
    } else if (this.dashTime > 0) {
      tvx = this.dashDir.x * DASH_SPEED;
      tvz = this.dashDir.z * DASH_SPEED;
      accel = 1000;
    } else if (this.attack) {
      // small forward lunge during the swing, otherwise rooted
      const a = this.attack;
      const lunge = a.t < a.dur * 0.4 ? 5 : 0;
      tvx = Math.sin(this.heading) * lunge + tvx * 0.15;
      tvz = Math.cos(this.heading) * lunge + tvz * 0.15;
      accel = 80;
    } else if (this.skill && this.skill.id === 'whirl') {
      tvx *= 0.8;
      tvz *= 0.8;
    }
    const k = Math.min(1, accel * dt / Math.max(1, Math.hypot(tvx - this.vx, tvz - this.vz)));
    this.vx += (tvx - this.vx) * (accel === 1000 ? 1 : k);
    this.vz += (tvz - this.vz) * (accel === 1000 ? 1 : k);

    // ---------------- facing
    if (!this.attack && !(this.skill && this.skill.id === 'whirl') && hasMove) {
      const d = angleDiff(this.heading, wishHeading);
      this.heading += d * Math.min(1, dt * 16);
    }

    // ---------------- dash
    if (this.dashTime > 0) {
      this.dashTime -= dt;
      this.vy = Math.max(this.vy, 0);
      if (Math.random() < 0.9) game.effects.puff(this.x, this.y + 0.9, this.z, 0x9fd8ff, 0.35, 0.25);
      if (this.mods.fireDash) {
        this.fireTrailT -= dt;
        if (this.fireTrailT <= 0) {
          this.fireTrailT = 0.04;
          game.spawnFirePatch(this.x, this.z);
        }
      }
    }

    // ---------------- attack progression
    if (this.attack) {
      const a = this.attack;
      a.t += dt;
      const c = COMBO[a.i];
      if (!a.hit && a.t >= a.dur * c.hitAt) {
        a.hit = true;
        this.performHit(a.i);
      }
      if (a.t >= a.dur) {
        this.attack = null;
        this.comboTimer = 0.45;
        this.comboIndex = (a.i + 1) % COMBO.length;
      }
    }

    // ---------------- active skills
    this.updateSkill(dt);

    // ---------------- physics
    if (this.dashTime <= 0) this.vy -= GRAVITY * dt;
    dg.move(this, this.vx * dt, this.vz * dt, true);
    this.y += this.vy * dt;
    const ground = dg.maxHeightUnder(this.x, this.z, this.radius * 0.8);
    const wasGrounded = this.grounded;
    if (this.y <= ground) {
      if (!this.grounded && this.vy < -4) game.effects.burst(this.x, ground + 0.1, this.z, 0x777777, 5, 2, 0.1, 0.3);
      this.y = ground;
      this.vy = 0;
      this.grounded = true;
      this.coyote = 0.1;
      this.airJumpsLeft = this.mods.airJumps;
      if (this.skill && this.skill.id === 'slam' && this.skill.airborne) this.landSlam();
    } else if (this.y > ground + 0.02) {
      this.grounded = false;
    }
    if (wasGrounded && !this.grounded) this.coyote = 0.1;
    if (!this.grounded) this.coyote = Math.max(0, this.coyote - dt);
    if (this.y < -20) this.y = ground; // safety

    this.animate(dt, hasMove ? wmag : 0);
  }

  heal(amount, show = true) {
    const before = this.hp;
    this.hp = Math.min(this.final.maxHp, this.hp + amount);
    if (show && this.hp - before >= 1) this.game.effects.damageNumber(this.x, this.y + 2, this.z, `+${Math.round(this.hp - before)}`, 'heal');
  }

  tryJump() {
    if (this.skill && this.skill.id === 'slam') return;
    if (this.grounded || this.coyote > 0) {
      this.vy = JUMP_V;
      this.grounded = false;
      this.coyote = 0;
      this.attack = null;
      sfx.jump();
    } else if (this.airJumpsLeft > 0) {
      this.airJumpsLeft--;
      this.vy = AIR_JUMP_V;
      this.attack = null;
      sfx.djump();
      this.game.effects.ring(this.x, this.z, 1.4, 0xbfe6ff, 0.3, this.y + 0.05);
      this.game.effects.burst(this.x, this.y + 0.2, this.z, 0xbfe6ff, 8, 3, 0.12, 0.35, 4);
      if (this.mods.stomp) {
        this.game.effects.ring(this.x, this.z, 3.5, 0xffd27f, 0.35, Math.max(0.1, this.y - 1));
        this.game.hitEnemiesInRadius(this.x, this.z, 3.5, (e) => {
          if (Math.abs(e.y - this.y) > 3.5) return null;
          return { ...this.rollDamage(0.8, true), knock: 7 };
        });
      }
    }
  }

  tryDash(dir) {
    if (this.dashCharges <= 0 || this.dashTime > 0) return;
    if (this.skill && this.skill.id === 'slam') return;
    this.dashCharges--;
    this.dashTime = DASH_TIME;
    this.invuln = Math.max(this.invuln, DASH_TIME + 0.08);
    this.dashDir = dir;
    this.heading = Math.atan2(dir.x, dir.z);
    this.attack = null;
    this.vy = Math.max(this.vy, 0);
    sfx.dash();
  }

  canStartAttack() {
    if (this.dashTime > 0 || this.skill) return false;
    if (!this.attack) return true;
    // allow chaining into the next hit late in the current swing
    return this.attack.hit && this.attack.t > this.attack.dur * 0.7;
  }

  startAttack(wishHeading) {
    const i = this.attack ? (this.attack.i + 1) % COMBO.length : this.comboTimer > 0 ? this.comboIndex : 0;
    const c = COMBO[i];
    this.attack = { i, t: 0, dur: c.dur / this.final.atkSpeed, hit: false };
    this.faceTarget(wishHeading, 5, 1.8);
    if (!this.grounded) this.vy = Math.max(this.vy, 1.5); // tiny air hang
    sfx.swing();
  }

  // Soft lock-on: turn toward the best enemy near the intended direction.
  faceTarget(wishHeading, range, cone) {
    const desired = wishHeading ?? this.heading;
    const t = this.game.findTarget(this.x, this.z, desired, range, cone);
    if (t) this.heading = Math.atan2(t.x - this.x, t.z - this.z);
    else this.heading = desired;
    return t;
  }

  performHit(i) {
    const c = COMBO[i];
    const range = c.range * this.mods.reach;
    const game = this.game;
    game.effects.slash(this.x, this.y + 1.0, this.z, this.heading, range, i === 2 ? 0xffe9a8 : 0xffffff, Math.min(c.arc, Math.PI * 1.99), i === 1 ? 0.3 : i === 0 ? -0.3 : 0);
    const hx = Math.sin(this.heading);
    const hz = Math.cos(this.heading);
    let hitAny = false;
    game.hitEnemiesInRadius(this.x, this.z, range + 0.4, (e) => {
      if (Math.abs(e.y + e.height * 0.5 - (this.y + 1)) > 1.8) return null;
      const dx = e.x - this.x;
      const dz = e.z - this.z;
      const d = Math.hypot(dx, dz) || 1;
      const dot = (dx * hx + dz * hz) / d;
      if (c.arc < 6 && dot < Math.cos(c.arc / 2) && d > e.radius + 0.3) return null;
      hitAny = true;
      return { ...this.rollDamage(c.mult), knock: c.knock, melee: true };
    });
    if (hitAny && i === 2) game.effects.shake(0.25);
  }

  trySkill(idx, wishHeading, cam) {
    if (this.cooldowns[idx] > 0) return true; // on cooldown: drop the request
    if (this.skill || this.dashTime > 0) return false; // busy: keep it buffered
    const def = SKILLS[idx];
    this.cooldowns[idx] = def.cd * (1 - this.final.cdr);
    this.attack = null;
    const game = this.game;
    const fx = game.effects;
    if (def.id === 'slam') {
      const t = this.faceTarget(wishHeading, 11, 1.2);
      let vx = Math.sin(this.heading) * 6;
      let vz = Math.cos(this.heading) * 6;
      if (this.grounded) {
        this.vy = 11;
        const flight = (2 * 11) / GRAVITY;
        if (t) {
          const d = Math.max(0, Math.hypot(t.x - this.x, t.z - this.z) - 0.8);
          const sp = Math.min(d / flight, 14);
          vx = Math.sin(this.heading) * sp;
          vz = Math.cos(this.heading) * sp;
        }
      } else {
        this.vy = -22; // plunge
        vx *= 0.3;
        vz *= 0.3;
      }
      this.grounded = false;
      this.skill = { id: 'slam', t: 0, airborne: true, vx, vz };
      sfx.jump();
    } else if (def.id === 'bolt') {
      // aim: locked target, else where the camera is looking
      const aimHeading = wishHeading ?? cam.yaw;
      const t = this.faceTarget(aimHeading, 18, 0.9);
      if (!t) this.heading = aimHeading;
      const n = 1 + this.mods.boltExtra;
      for (let i = 0; i < n; i++) {
        const off = n === 1 ? 0 : (i - (n - 1) / 2) * 0.22;
        game.spawnBolt(this.x, this.y + 1.1, this.z, this.heading + off, this.rollDamage(2.2, true), t && i === Math.floor(n / 2) ? t : null);
      }
      this.skill = { id: 'cast', t: 0, dur: 0.18 };
      sfx.fire();
    } else if (def.id === 'whirl') {
      this.skill = { id: 'whirl', t: 0, dur: 1.4 * this.mods.whirlDur, tick: 0 };
      sfx.swing();
    } else if (def.id === 'nova') {
      const R = 5.5 * this.mods.novaRadius;
      fx.ring(this.x, this.z, R, 0x9fe3ff, 0.45, this.y + 0.1);
      fx.ring(this.x, this.z, R * 0.7, 0xffffff, 0.35, this.y + 0.15);
      fx.burst(this.x, this.y + 0.5, this.z, 0xcff4ff, 30, 9, 0.18, 0.6, 6);
      sfx.frost();
      game.hitEnemiesInRadius(this.x, this.z, R, (e) => {
        e.freeze = Math.max(e.freeze, this.mods.novaFreeze);
        return { ...this.rollDamage(1.3, true), knock: 3 };
      });
      this.skill = { id: 'cast', t: 0, dur: 0.25 };
    }
    return true;
  }

  updateSkill(dt) {
    const s = this.skill;
    if (!s) return;
    s.t += dt;
    const game = this.game;
    if (s.id === 'cast') {
      if (s.t >= s.dur) this.skill = null;
    } else if (s.id === 'slam') {
      if (s.t > 3) this.skill = null; // safety
      if (Math.random() < 0.6) game.effects.puff(this.x, this.y + 0.8, this.z, 0xffb347, 0.3, 0.3);
    } else if (s.id === 'whirl') {
      s.tick -= dt;
      if (s.tick <= 0) {
        s.tick = 0.2;
        sfx.swing();
        game.effects.slash(this.x, this.y + 0.9, this.z, this.heading, 2.9 * this.mods.reach, 0x9be7ff, Math.PI * 1.99);
        game.hitEnemiesInRadius(this.x, this.z, 2.9 * this.mods.reach, (e) => {
          if (Math.abs(e.y - this.y) > 2) return null;
          if (this.mods.whirlPull) {
            const dx = this.x - e.x;
            const dz = this.z - e.z;
            const d = Math.hypot(dx, dz) || 1;
            e.kx += (dx / d) * 6;
            e.kz += (dz / d) * 6;
            return { ...this.rollDamage(0.6, true), knock: 0 };
          }
          return { ...this.rollDamage(0.6, true), knock: 2 };
        });
      }
      if (s.t >= s.dur) this.skill = null;
    }
  }

  landSlam() {
    const game = this.game;
    const R = 3.6 * this.mods.slamPower;
    game.effects.ring(this.x, this.z, R, 0xffb347, 0.4, this.y + 0.1);
    game.effects.ring(this.x, this.z, R * 0.6, 0xffffff, 0.3, this.y + 0.12);
    game.effects.burst(this.x, this.y + 0.2, this.z, 0x9a8a70, 24, 8, 0.2, 0.6);
    game.effects.shake(0.5);
    game.hitStop(0.06);
    sfx.slam();
    game.hitEnemiesInRadius(this.x, this.z, R, () => ({ ...this.rollDamage(2.6 * this.mods.slamPower, true), knock: 9, launch: 6 }));
    this.skill = { id: 'cast', t: 0, dur: 0.2 };
  }

  takeDamage(amount, source = null, melee = false) {
    if (this.dead || this.invuln > 0) return false;
    const dmg = Math.max(1, Math.round(amount * this.final.dmgTaken));
    this.hp -= dmg;
    this.invuln = 0.45;
    this.hurtFlash = 0.2;
    const game = this.game;
    game.effects.damageNumber(this.x, this.y + 2, this.z, `-${dmg}`, 'player');
    game.effects.shake(0.35);
    game.effects.burst(this.x, this.y + 1, this.z, 0xff3030, 8, 4, 0.12, 0.4);
    game.ui.flashDamage();
    sfx.hurt();
    if (melee && source && this.mods.thorns > 0 && source.alive) {
      game.damageEnemy(source, { amount: amount * this.mods.thorns, crit: false, knock: 3 }, this.x, this.z);
    }
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      sfx.death();
    }
    return true;
  }

  // ------------------------------------------------------------- animation
  animate(dt, moveAmt) {
    this.animT += dt;
    const t = this.animT;
    const m = this.mesh;
    m.position.set(this.x, this.y, this.z);
    m.rotation.y = this.heading;
    const root = this.root;
    root.rotation.set(0, 0, 0);
    root.position.set(0, 0, 0);

    const hspeed = Math.hypot(this.vx, this.vz);
    const run = this.grounded ? clamp(hspeed / 7, 0, 1.3) : 0;
    const cyc = t * 12;
    let legL = Math.sin(cyc) * 0.9 * run;
    let legR = -legL;
    let armL = -Math.sin(cyc) * 0.6 * run;
    let armR = Math.sin(cyc) * 0.6 * run - 0.3;
    let armRz = 0;
    let swordX = 0.5;
    root.position.y = Math.abs(Math.sin(cyc)) * 0.08 * run;

    if (!this.grounded) {
      legL = -0.6;
      legR = 0.3;
      armL = -0.8;
      armR = -1.2;
    }
    if (this.dashTime > 0) {
      root.rotation.x = 0.6;
      legL = 0.8;
      legR = 0.6;
      armL = 1.2;
      armR = 1.2;
    }
    if (this.attack) {
      const a = this.attack;
      const p = clamp(a.t / a.dur, 0, 1);
      const c = COMBO[a.i];
      const e = p < c.hitAt ? p / c.hitAt : 1;
      if (c.swing === 2) {
        // overhead spin slash
        root.rotation.y = -e * Math.PI * 2;
        armR = -1.6;
        armRz = 0.2;
        swordX = 1.45;
      } else {
        const s = c.swing;
        armR = -1.45;
        armRz = s * (1.3 - e * 2.6) * -1;
        root.rotation.y = s * (0.6 - e * 1.2) * -0.5;
        swordX = 1.45;
      }
      legL = 0.4;
      legR = -0.3;
    }
    if (this.skill && this.skill.id === 'whirl') {
      root.rotation.y = t * 22;
      armR = -1.5;
      armRz = 1.2;
      armL = -1.5;
      swordX = 1.45;
    } else if (this.skill && this.skill.id === 'slam') {
      root.rotation.x = -0.4;
      armR = -2.8;
      armL = -2.6;
    } else if (this.skill && this.skill.id === 'cast') {
      armL = -1.6;
    }

    this.legL.rotation.x = legL;
    this.legR.rotation.x = legR;
    this.armL.rotation.x = armL;
    this.armR.rotation.set(armR, 0, armRz);
    // blade in line with the arm while swinging, angled forward at rest
    this.sword.rotation.x = swordX;
    this.cape.rotation.x = 0.15 + Math.min(1.1, hspeed * 0.08) + (this.vy > 0 ? 0 : Math.min(0.6, -this.vy * 0.04));

    // hurt / invuln flicker
    const flick = this.hurtFlash > 0 || (this.invuln > 0 && this.dashTime <= 0 && Math.floor(t * 20) % 2 === 0);
    this.bodyMats[0].emissive.setHex(this.hurtFlash > 0 ? 0x802020 : 0x000000);
    root.visible = !(flick && this.hurtFlash <= 0 && this.invuln > 0.1);

    // shadow on ground below
    const g = this.game.dungeon.maxHeightUnder(this.x, this.z, 0.2);
    this.shadow.position.set(this.x, g + 0.03, this.z);
    const hs = clamp(1 - (this.y - g) * 0.12, 0.4, 1);
    this.shadow.scale.set(hs, hs, hs);
  }
}
