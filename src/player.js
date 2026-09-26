// The player: class-based stats and basic attack, movement (run / jump /
// double jump / dash), up to four owned skills, buffs and shields, and a
// pose-driven animation layer on top of the hero rig.

import * as THREE from 'three';
import { clamp, angleDiff } from './utils.js';
import { sfx } from './audio.js';
import { SLOTS } from './items.js';
import { CLASSES } from './classes.js';
import { SKILLS, MAX_SKILL_LEVEL } from './skills.js';
import { buildHero, dressHero } from './hero.js';
import { bowPose } from './rig.js';
import { followNock } from './gear.js';
import { Trail } from './effects.js';

const GRAVITY = 28;
const JUMP_V = 10;
const AIR_JUMP_V = 9;
const DASH_TIME = 0.17;
const DASH_SPEED = 24;
const DASH_RECHARGE = 0.9;
const TAU = Math.PI * 2;

// Basic attack chains per weapon. `hitAt` is the fraction of the swing where damage lands.
const ATTACKS = {
  sword: [
    { dur: 0.34, hitAt: 0.42, mult: 1.0, arc: 2.4, range: 2.5, knock: 4, anim: 'slashR' },
    { dur: 0.34, hitAt: 0.42, mult: 1.1, arc: 2.4, range: 2.5, knock: 4, anim: 'slashL' },
    { dur: 0.52, hitAt: 0.5, mult: 1.8, arc: 6.3, range: 3.0, knock: 10, anim: 'spinSlash' },
  ],
  daggers: [
    { dur: 0.22, hitAt: 0.45, mult: 0.8, arc: 1.9, range: 2.2, knock: 2, anim: 'stabR' },
    { dur: 0.22, hitAt: 0.45, mult: 0.8, arc: 1.9, range: 2.2, knock: 2, anim: 'stabL' },
    { dur: 0.22, hitAt: 0.45, mult: 0.9, arc: 1.9, range: 2.2, knock: 2, anim: 'stabR' },
    { dur: 0.38, hitAt: 0.5, mult: 1.6, arc: 2.8, range: 2.5, knock: 7, anim: 'crossSlash' },
  ],
  bow: [
    { dur: 0.42, hitAt: 0.62, mult: 1.0, ranged: 'arrow', anim: 'bowShot' },
    { dur: 0.42, hitAt: 0.62, mult: 1.0, ranged: 'arrow', anim: 'bowShot' },
    { dur: 0.5, hitAt: 0.68, mult: 1.6, ranged: 'power', anim: 'bowShot' },
  ],
  staff: [
    { dur: 0.36, hitAt: 0.45, mult: 0.95, ranged: 'missile', anim: 'staffR' },
    { dur: 0.36, hitAt: 0.45, mult: 0.95, ranged: 'missile', anim: 'staffL' },
    { dur: 0.5, hitAt: 0.5, mult: 0.8, ranged: 'missile3', anim: 'staffBurst' },
  ],
};

function baseStats(cls) {
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
    ...cls.stats,
  };
}

// joints that trail the core a little (hands, forearms, head, feet)
const LOOSE = { foreL: 0.8, foreR: 0.8, handL: 0.7, handR: 0.7, head: 0.75, neck: 0.85, footL: 1.1, footR: 1.1 };

const ease = (t) => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));
const easeOut = (t) => 1 - (1 - clamp(t, 0, 1)) ** 3;
const wrap = (a) => {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  if (a < -Math.PI) a += TAU;
  return a;
};

export class Player {
  constructor(game, clsId = 'knight') {
    this.game = game;
    this.clsId = clsId;
    this.cls = CLASSES[clsId];
    this.radius = 0.45;
    this.stats = baseStats(this.cls);
    this.mods = {
      dashCharges: 1,
      airJumps: 1,
      fireDash: false,
      stomp: false,
      thorns: 0,
      regen: 0,
      execute: 0,
      reach: 1,
      ...this.cls.mods,
    };
    this.chain = ATTACKS[this.cls.attack];
    this.upgradeCounts = {};
    this.skills = [null, null, null, null]; // { id, level } per swipe direction
    this.equipment = { weapon: null, armor: null, charm: null };
    this.hero = buildHero(clsId);
    this.mesh = this.hero.mesh;
    this.buildShadowAndShield();
    this.recompute();
    this.hp = this.final.maxHp;
    this.gold = 0;
    this.kills = 0;
    this.resetState();
    this.dress();
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
    this.attack = null;
    this.comboIndex = 0;
    this.comboTimer = 0;
    this.attackBuffered = false;
    this.cooldowns = [0, 0, 0, 0];
    this.action = null;
    this.skillBuffer = null;
    this.buffs = {};
    this.buff = { dmg: 0, as: 0, crit: 0, armor: 0, ms: 0, pierce: 0 };
    this.shield = 0;
    this.shieldT = 0;
    this.shieldEnd = null;
    this.invuln = 0;
    this.hurtFlash = 0;
    this.dead = false;
    this.deadT = 0;
    this.animT = 0;
    this.runPhase = 0;
    this.landT = 0;
    this.flipT = 0;
    this.fireTrailT = 0;
    this.nextCrit = false;
    this.demo = false;
    this.speed = 0;
  }

  buildShadowAndShield() {
    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.5, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shieldMesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.05, 2),
      new THREE.MeshBasicMaterial({ color: 0xfff0a0, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.shieldMesh.position.y = 1;
    this.shieldMesh.visible = false;
    this.mesh.add(this.shieldMesh);
  }

  dress() {
    this.disposeTrails();
    dressHero(this.hero, this.equipment);
    if (this.game.applyShadows) this.game.applyShadows(this.mesh);
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
      atkSpeed: 1 + s.attackSpeed,
      crit: Math.min(0.9, s.crit),
      critMult: 1 + s.critMult,
      lifesteal: s.lifesteal,
      moveSpeed: 7.5 * (1 + s.moveSpeed),
      cdr: Math.min(0.6, s.cdr),
      skillMult: 1 + s.skillPower,
      goldMult: 1 + s.goldFind,
    };
    this.updateArmor();
    if (prevMax !== null && this.hp !== undefined) {
      if (this.final.maxHp > prevMax) this.hp += this.final.maxHp - prevMax;
      this.hp = Math.min(this.hp, this.final.maxHp);
    }
  }

  updateArmor() {
    const a = this.final.armor + (this.buff ? this.buff.armor : 0);
    this.final.dmgTaken = 50 / (50 + Math.max(0, a));
  }

  equip(item) {
    const old = this.equipment[item.slot];
    this.equipment[item.slot] = item;
    this.recompute();
    this.dress();
    return old;
  }

  applyUpgrade(u) {
    this.upgradeCounts[u.id] = (this.upgradeCounts[u.id] || 0) + 1;
    u.apply(this);
    this.recompute();
    this.dashCharges = this.mods.dashCharges;
    this.airJumpsLeft = this.mods.airJumps;
  }

  // ---------------------------------------------------------------- skills
  skillLevel(id) {
    const s = this.skills.find((k) => k && k.id === id);
    return s ? s.level : 0;
  }

  learnSkill(id) {
    const cur = this.skills.find((k) => k && k.id === id);
    if (cur) {
      cur.level = Math.min(MAX_SKILL_LEVEL, cur.level + 1);
      return this.skills.indexOf(cur);
    }
    const slot = this.skills.indexOf(null);
    if (slot < 0) return -1;
    this.skills[slot] = { id, level: 1 };
    this.cooldowns[slot] = 0;
    return slot;
  }

  skillCooldown(slot) {
    const s = this.skills[slot];
    return s ? SKILLS[s.id].cd(s.level) * (1 - this.final.cdr) : 1;
  }

  // ----------------------------------------------------------------- buffs
  addBuff(id, dur, mods, color = 0xffffff) {
    this.buffs[id] = { t: dur, mods, color };
    this.refreshBuffs();
  }

  refreshBuffs() {
    const b = { dmg: 0, as: 0, crit: 0, armor: 0, ms: 0, pierce: 0 };
    for (const id in this.buffs) for (const k in this.buffs[id].mods) b[k] += this.buffs[id].mods[k];
    this.buff = b;
    this.updateArmor();
  }

  buffMod(k) {
    return this.buff[k] || 0;
  }

  shieldUp(amount, dur, onEnd) {
    if (this.shieldEnd) this.shieldEnd();
    this.shield = amount;
    this.shieldT = dur;
    this.shieldEnd = onEnd;
  }

  breakShield() {
    const cb = this.shieldEnd;
    this.shield = 0;
    this.shieldT = 0;
    this.shieldEnd = null;
    if (cb) cb();
  }

  rollDamage(mult, isSkill = false, forceCrit = false) {
    const f = this.final;
    let amount = f.damage * mult * (isSkill ? f.skillMult : 1) * (1 + this.buff.dmg);
    amount *= 0.9 + Math.random() * 0.2;
    const crit = forceCrit || this.nextCrit || Math.random() < f.crit + this.buff.crit;
    this.nextCrit = false;
    if (crit) amount *= f.critMult;
    return { amount, crit };
  }

  // Turn toward the best target near the intended direction.
  aimAt(ctx, range, cone, ranged = false) {
    const pref = ctx.wish ?? (ranged ? ctx.camYaw : this.heading);
    const t = this.game.findTarget(this.x, this.z, pref, range, cone);
    this.heading = t ? Math.atan2(t.x - this.x, t.z - this.z) : pref;
    return t;
  }

  act(o) {
    const a = { t: 0, dur: 0.3, move: 0, anim: 'cast', ...o };
    this.action = a;
    this.attack = null;
    if (a.invuln) this.invuln = Math.max(this.invuln, a.invuln);
    return a;
  }

  teleport(dx, dz, dist) {
    const dg = this.game.dungeon;
    const step = 0.25;
    let x = this.x;
    let z = this.z;
    for (let d = step; d <= dist; d += step) {
      const nx = this.x + dx * d;
      const nz = this.z + dz * d;
      if (dg.blocked(nx, nz, this.radius, this.y + 1.3)) break;
      x = nx;
      z = nz;
    }
    this.x = x;
    this.z = z;
    const ground = dg.maxHeightUnder(x, z, this.radius * 0.8);
    if (ground < 50) this.y = Math.max(this.y, ground);
  }

  leapSlam(ctx, o) {
    const t = this.aimAt(ctx, 11, 1.2);
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
      this.vy = -22;
      vx *= 0.3;
      vz *= 0.3;
    }
    this.grounded = false;
    sfx.jump();
    const g = this.game;
    this.act({
      anim: 'leap',
      dur: 3,
      untilLand: true,
      vel: { x: vx, z: vz },
      update: () => g.effects.puff(this.x, this.y + 0.8, this.z, 0xffb347, 0.3, 0.3),
      land: () => {
        const R = o.radius;
        g.effects.ring(this.x, this.z, R, 0xffb347, 0.4, this.y + 0.1);
        g.effects.ring(this.x, this.z, R * 0.6, 0xffffff, 0.3, this.y + 0.12);
        g.effects.burst(this.x, this.y + 0.2, this.z, 0x9a8a70, 24, 8, 0.2, 0.6);
        g.effects.spikes(this.x, this.z, 0x8a7a60, R * 0.7);
        g.effects.shake(0.5);
        g.hitStop(0.06);
        sfx.slam();
        g.hitEnemiesInRadius(this.x, this.z, R, (e) => {
          if (o.stun) e.status({ stun: o.stun });
          return { ...this.rollDamage(o.dmg, true), knock: 9, launch: 6 };
        });
        this.act({ anim: 'slamLand', dur: 0.25 });
      },
    });
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
    this.landT = Math.max(0, this.landT - dt);
    if (this.flipT > 0) this.flipT = Math.max(0, this.flipT - dt);
    for (let i = 0; i < 4; i++) this.cooldowns[i] = Math.max(0, this.cooldowns[i] - dt);
    if (this.dashCharges < this.mods.dashCharges) {
      this.dashRecharge += dt;
      if (this.dashRecharge >= DASH_RECHARGE) {
        this.dashRecharge = 0;
        this.dashCharges++;
      }
    }
    let buffChanged = false;
    for (const id in this.buffs) {
      this.buffs[id].t -= dt;
      if (this.buffs[id].t <= 0) {
        delete this.buffs[id];
        buffChanged = true;
      }
    }
    if (buffChanged) this.refreshBuffs();
    if (this.shieldT > 0) {
      this.shieldT -= dt;
      if (this.shieldT <= 0) this.breakShield();
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
    const wishHeading = hasMove ? Math.atan2(wx, wz) : null;
    const ctx = { wish: wishHeading, camYaw: cam.yaw };

    // ---------------- actions
    if (input.pressed.jump) this.tryJump();
    if (input.pressed.dash) this.tryDash(hasMove ? { x: wx, z: wz } : { x: Math.sin(this.heading), z: Math.cos(this.heading) });
    if (input.skillPressed >= 0) this.skillBuffer = { idx: input.skillPressed, t: 0.35 };
    if (this.skillBuffer) {
      this.skillBuffer.t -= dt;
      if (this.trySkill(this.skillBuffer.idx, ctx) || this.skillBuffer.t <= 0) this.skillBuffer = null;
    }
    if (input.pressed.attack) this.attackBuffered = true;
    if ((this.attackBuffered || input.attackHeld) && this.canStartAttack()) {
      this.startAttack(ctx);
      this.attackBuffered = false;
    }

    // ---------------- horizontal velocity
    const a = this.action;
    const ms = f.moveSpeed * (1 + this.buff.ms);
    let tvx = hasMove ? wx * ms * wmag : 0;
    let tvz = hasMove ? wz * ms * wmag : 0;
    let accel = this.grounded ? 60 : 25;
    let snap = false;
    if (a && a.vel) {
      tvx = a.vel.x;
      tvz = a.vel.z;
      snap = true;
    } else if (this.dashTime > 0) {
      tvx = this.dashDir.x * DASH_SPEED;
      tvz = this.dashDir.z * DASH_SPEED;
      snap = true;
    } else if (a) {
      tvx *= a.move;
      tvz *= a.move;
    } else if (this.attack) {
      const at = this.attack;
      if (at.c.ranged) {
        tvx *= 0.5;
        tvz *= 0.5;
      } else {
        // small forward lunge during the swing, otherwise rooted
        const lunge = at.t < at.dur * 0.45 ? 5 : 0;
        tvx = Math.sin(this.heading) * lunge + tvx * 0.15;
        tvz = Math.cos(this.heading) * lunge + tvz * 0.15;
        accel = 80;
      }
    }
    if (snap) {
      this.vx = tvx;
      this.vz = tvz;
    } else {
      const k = Math.min(1, (accel * dt) / Math.max(1, Math.hypot(tvx - this.vx, tvz - this.vz)));
      this.vx += (tvx - this.vx) * k;
      this.vz += (tvz - this.vz) * k;
    }

    // ---------------- facing
    const busyFacing = this.attack || (a && (a.anim === 'spin' || a.vel || a.anim === 'draw'));
    if (!busyFacing && hasMove) this.heading += angleDiff(this.heading, wishHeading) * Math.min(1, dt * 16);

    // ---------------- dash
    if (this.dashTime > 0) {
      this.dashTime -= dt;
      this.vy = Math.max(this.vy, 0);
      game.effects.puff(this.x, this.y + 0.9, this.z, 0x9fd8ff, 0.35, 0.25);
      if (this.mods.fireDash) {
        this.fireTrailT -= dt;
        if (this.fireTrailT <= 0) {
          this.fireTrailT = 0.04;
          game.spawnFirePatch(this.x, this.z);
        }
      }
    }

    // ---------------- basic attack progression
    if (this.attack) {
      const at = this.attack;
      at.t += dt;
      if (!at.hit && at.t >= at.dur * at.c.hitAt) {
        at.hit = true;
        this.performHit(at);
      }
      if (at.t >= at.dur) {
        this.attack = null;
        this.comboTimer = 0.5;
        this.comboIndex = (at.i + 1) % this.chain.length;
      }
    }

    // ---------------- skill action progression
    if (a) {
      a.t += dt;
      if (a.update) a.update(dt, a);
      if (a.untilLand && a.t > 3 && this.action === a) this.action = null; // safety: never hang mid-air
      if (!a.untilLand && a.t >= a.dur && this.action === a) {
        this.action = null;
        if (a.end) a.end(a);
      }
    }

    // ---------------- physics
    if (this.dashTime <= 0) this.vy -= GRAVITY * dt;
    dg.move(this, this.vx * dt, this.vz * dt, true);
    this.y += this.vy * dt;
    const ground = dg.maxHeightUnder(this.x, this.z, this.radius * 0.8);
    const wasGrounded = this.grounded;
    if (this.y <= ground) {
      if (!this.grounded && this.vy < -4) {
        game.effects.burst(this.x, ground + 0.1, this.z, 0x777777, 5, 2, 0.1, 0.3);
        this.landT = 0.16;
      }
      this.y = ground;
      this.vy = 0;
      this.grounded = true;
      this.coyote = 0.1;
      this.airJumpsLeft = this.mods.airJumps;
      const cur = this.action;
      if (cur && cur.untilLand && cur.t > 0.05) {
        this.action = null;
        if (cur.land) cur.land(cur);
      }
    } else if (this.y > ground + 0.02) {
      this.grounded = false;
    }
    if (wasGrounded && !this.grounded) this.coyote = 0.1;
    if (!this.grounded) this.coyote = Math.max(0, this.coyote - dt);
    if (this.y < -20) this.y = ground;

    this.speed = Math.hypot(this.vx, this.vz);
    this.animate(dt);
  }

  heal(amount, show = true) {
    const before = this.hp;
    this.hp = Math.min(this.final.maxHp, this.hp + amount);
    if (show && this.hp - before >= 1) this.game.effects.damageNumber(this.x, this.y + 2, this.z, `+${Math.round(this.hp - before)}`, 'heal');
  }

  tryJump() {
    if (this.action && (this.action.untilLand || this.action.vel)) return;
    if (this.grounded || this.coyote > 0) {
      this.vy = JUMP_V;
      this.grounded = false;
      this.coyote = 0;
      this.attack = null;
      this.action = null;
      sfx.jump();
    } else if (this.airJumpsLeft > 0) {
      this.airJumpsLeft--;
      this.vy = AIR_JUMP_V;
      this.attack = null;
      this.flipT = 0.4;
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
    if (this.action && (this.action.untilLand || this.action.vel)) return;
    this.dashCharges--;
    this.dashTime = DASH_TIME;
    this.invuln = Math.max(this.invuln, DASH_TIME + 0.08);
    this.dashDir = dir;
    this.heading = Math.atan2(dir.x, dir.z);
    this.attack = null;
    this.action = null; // dashing cancels channels
    this.vy = Math.max(this.vy, 0);
    sfx.dash();
  }

  canStartAttack() {
    if (this.dashTime > 0 || this.action) return false;
    if (!this.attack) return true;
    return this.attack.hit && this.attack.t > this.attack.dur * 0.7;
  }

  startAttack(ctx) {
    const n = this.chain.length;
    const i = this.attack ? (this.attack.i + 1) % n : this.comboTimer > 0 ? this.comboIndex : 0;
    const c = this.chain[i];
    const dur = c.dur / (this.final.atkSpeed * (1 + this.buff.as));
    this.attack = { i, c, t: 0, dur, hit: false };
    if (c.ranged) {
      const pref = ctx.wish ?? ctx.camYaw;
      const t = this.game.findTarget(this.x, this.z, pref, 20, 0.75);
      this.attack.target = t;
      this.heading = t ? Math.atan2(t.x - this.x, t.z - this.z) : pref;
    } else {
      const pref = ctx.wish ?? this.heading;
      const t = this.game.findTarget(this.x, this.z, pref, 5, 1.8);
      this.heading = t ? Math.atan2(t.x - this.x, t.z - this.z) : pref;
    }
    if (!this.grounded) this.vy = Math.max(this.vy, 1.5);
    if (!c.ranged) sfx.swing();
  }

  performHit(at) {
    if (this.demo) return;
    const c = at.c;
    const game = this.game;
    const hx = Math.sin(this.heading);
    const hz = Math.cos(this.heading);
    if (c.ranged) {
      // re-aim at the locked target if it moved
      if (at.target && at.target.alive) this.heading = Math.atan2(at.target.x - this.x, at.target.z - this.z);
      const pierce = this.buffMod('pierce') ? 1 : 0;
      if (c.ranged === 'arrow' || c.ranged === 'power') {
        const power = c.ranged === 'power';
        sfx.arrow();
        game.shoot({ from: this, heading: this.heading, speed: power ? 38 : 32, life: 0.65, kind: power ? 'bigarrow' : 'arrow', dmg: () => this.rollDamage(c.mult), knock: power ? 6 : 3, pierce: pierce + (power ? 1 : 0) });
      } else {
        sfx.fire();
        const n = c.ranged === 'missile3' ? 3 : 1;
        for (let k = 0; k < n; k++) {
          const off = n === 1 ? 0 : (k - 1) * 0.25;
          game.shoot({ from: this, heading: this.heading + off, speed: 20, life: 0.95, kind: 'missile', homing: at.target, dmg: () => this.rollDamage(c.mult), knock: 3, pierce });
        }
      }
      return;
    }
    const range = c.range * this.mods.reach;
    const tilt = c.anim === 'slashL' || c.anim === 'stabL' ? 0.3 : c.anim === 'slashR' || c.anim === 'stabR' ? -0.3 : 0;
    const col = c.anim.startsWith('stab') || c.anim === 'crossSlash' ? 0xffb0b0 : c.anim === 'spinSlash' ? 0xffe9a8 : 0xffffff;
    game.effects.slash(this.x, this.y + 1.0, this.z, this.heading, range, col, Math.min(c.arc, Math.PI * 1.99), tilt);
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
    if (hitAny && c.knock >= 7) game.effects.shake(0.25);
  }

  trySkill(idx, ctx) {
    const s = this.skills[idx];
    if (!s) return true; // empty slot: drop the request
    if (this.cooldowns[idx] > 0) return true;
    if (this.action || this.dashTime > 0) return false; // busy: keep it buffered
    const def = SKILLS[s.id];
    this.cooldowns[idx] = def.cd(s.level) * (1 - this.final.cdr);
    this.attack = null;
    def.cast(this, s.level, ctx);
    this.game.ui.skillFlash(idx);
    return true;
  }

  takeDamage(amount, source = null, melee = false) {
    if (this.dead || this.invuln > 0) return false;
    let dmg = Math.max(1, Math.round(amount * this.final.dmgTaken));
    const game = this.game;
    if (this.shield > 0) {
      const absorbed = Math.min(this.shield, dmg);
      this.shield -= absorbed;
      dmg -= absorbed;
      game.effects.damageNumber(this.x, this.y + 2.2, this.z, `(${absorbed})`, 'shield');
      if (this.shield <= 0) this.breakShield();
      this.invuln = 0.25;
      if (dmg <= 0) return true;
    }
    this.hp -= dmg;
    this.invuln = 0.45;
    this.hurtFlash = 0.22;
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
      this.deadT = 0;
      this.action = null;
      this.attack = null;
      sfx.death();
    }
    return true;
  }

  // ------------------------------------------------------------- animation
  animate(dt) {
    this.animT += dt;
    const t = this.animT;
    const hero = this.hero;
    const rig = hero.rig;
    const P = rig.pose;
    const m = this.mesh;
    const A = this.anim || (this.anim = { prevHeading: this.heading, prevSpeed: 0, accLean: 0, bank: 0, idleT: 0, fidget: null, nextFidget: 3 + Math.random() * 3, blinkT: 2, stepSide: 0, look: 0, capeV: [0, 0], capeA: [0.12, 0], hairV: 0 });
    m.position.set(this.x, this.y, this.z);
    m.rotation.y = this.heading;
    rig.resetPose();

    const hs = this.speed;
    const sn = this.grounded ? clamp(hs / 7.5, 0, 1.3) : 0;
    // stride-matched phase: feet advance with distance, so they don't skate
    const stride = 0.9 + 0.55 * clamp((sn - 0.35) / 0.45, 0, 1);
    const prevPhase = this.runPhase;
    this.runPhase += sn > 0.02 ? ((hs * dt) / stride) * Math.PI : 0;
    // turning bank and acceleration lean (smoothed)
    const turn = angleDiff(A.prevHeading, this.heading) / Math.max(dt, 1e-4);
    A.prevHeading = this.heading;
    const accel = (hs - A.prevSpeed) / Math.max(dt, 1e-4);
    A.prevSpeed = hs;
    const kk = Math.min(1, dt * 8);
    A.bank += (clamp(-turn * 0.035 * sn, -0.32, 0.32) - A.bank) * kk;
    A.accLean += (clamp(accel * 0.012, -0.28, 0.25) - A.accLean) * kk;

    let w = 20;
    let spinY = null;
    let flipX = null;
    let draw = 0;
    let showArrow = false;
    const wt = this.cls.weapon;
    const busy = this.attack || this.action || this.dashTime > 0 || !this.grounded;

    if (this.dead) {
      this.deadT += dt;
      const d = easeOut(this.deadT / 0.6);
      const fall = clamp((this.deadT - 0.3) / 0.5, 0, 1);
      P.thighL[0] = -1.4 * d;
      P.thighR[0] = -1.2 * d;
      P.shinL[0] = 1.6 * d;
      P.shinR[0] = 1.8 * d;
      P.body[0] = -1.35 * fall;
      P.bodyY = -0.55 * d - 0.15 * fall;
      P.armL[2] = 0.9 * d;
      P.armR[2] = -0.9 * d;
      P.head[0] = -0.4 * d + 0.3 * fall;
      P.chest[0] = 0.3 * d;
      w = 12;
    } else {
      // base layers: locomotion, breathing idle, weapon stance
      rig.locomotion(this.runPhase, sn, wt === 'sword' ? 0.55 : 0.9);
      const still = 1 - clamp(sn * 3, 0, 1);
      rig.idle(t, still);
      this.stance(P, sn);
      P.body[0] += A.accLean * (busy ? 0.3 : 1);
      P.body[2] += A.bank;
      P.chest[2] += A.bank * 0.4;

      // footstep dust + sound when a foot plants
      if (sn > 0.25 && Math.floor(prevPhase / Math.PI) !== Math.floor(this.runPhase / Math.PI)) {
        A.stepSide ^= 1;
        const side = A.stepSide ? 1 : -1;
        const fx = this.x + Math.cos(this.heading) * 0.12 * side;
        const fz = this.z - Math.sin(this.heading) * 0.12 * side;
        if (!this.demo) {
          this.game.effects.puff(fx, this.y + 0.05, fz, 0x8a8478, 0.18 + 0.12 * sn, 0.35);
          if (sn > 0.6) sfx.step();
        }
      }

      // idle life: blinking, glancing around, class fidgets
      if (!busy && sn < 0.05) A.idleT += dt;
      else {
        A.idleT = 0;
        A.fidget = null;
      }
      if (A.idleT > A.nextFidget && !A.fidget) {
        const opts = ['look', 'stretch', this.clsId];
        A.fidget = { type: opts[Math.floor(Math.random() * opts.length)], t: 0, dur: 2.2 };
        A.nextFidget = A.idleT + 5 + Math.random() * 5;
      }
      if (A.fidget) {
        A.fidget.t += dt;
        const f = A.fidget.t / A.fidget.dur;
        if (f >= 1) A.fidget = null;
        else this.fidgetPose(P, A.fidget.type, f, t);
      }
      // track the nearest threat with the head
      const tgt = this.demo ? null : this.game.findTarget ? this.nearestThreat() : null;
      let look = 0;
      if (tgt) look = clamp(angleDiff(this.heading, Math.atan2(tgt.x - this.x, tgt.z - this.z)), -1.1, 1.1);
      A.look += (look - A.look) * Math.min(1, dt * 5);
      if (!this.attack && !this.action) {
        P.head[1] += A.look * 0.6;
        P.neck[1] += A.look * 0.3;
        P.chest[1] += A.look * 0.15;
      }

      const a = this.action;
      const at = this.attack;
      if (!this.grounded && !(a && (a.anim === 'leap' || a.anim === 'flip')) && this.dashTime <= 0) this.airPose(P);
      if (this.landT > 0) {
        const l = this.landT / 0.16;
        P.bodyY -= 0.2 * l;
        P.thighL[0] -= 0.7 * l;
        P.thighR[0] -= 0.7 * l;
        P.shinL[0] += 1.3 * l;
        P.shinR[0] += 1.3 * l;
        P.footL[0] -= 0.5 * l;
        P.footR[0] -= 0.5 * l;
        P.body[0] += 0.25 * l;
        P.armL[2] += 0.3 * l;
        P.armR[2] -= 0.3 * l;
      }
      if (this.dashTime > 0) {
        P.body[0] = 0.6;
        P.armL = [0.9, 0, 0.35];
        P.armR = [0.9, 0, -0.35];
        P.foreL[0] = -0.3;
        P.foreR[0] = -0.3;
        P.thighL[0] = -0.8;
        P.shinL[0] = 1.2;
        P.thighR[0] = 0.8;
        P.shinR[0] = 0.6;
        P.head[0] = -0.4;
        P.bodyY = -0.12;
        w = 32;
      }
      if (at) {
        const r = this.attackPose(P, at);
        if (r) {
          if (r.spinY !== undefined) spinY = r.spinY;
          draw = r.draw ?? 0;
          showArrow = r.arrow ?? false;
        }
        w = 34;
      }
      if (a) {
        const r = this.actionPose(P, a);
        if (r) {
          if (r.spinY !== undefined) spinY = r.spinY;
          if (r.flipX !== undefined) flipX = r.flipX;
          if (r.draw !== undefined) {
            draw = r.draw;
            showArrow = r.arrow ?? true;
          }
        }
        w = 30;
      }
      if (this.flipT > 0 && flipX === null) flipX = (1 - this.flipT / 0.4) * TAU;
      if (this.hurtFlash > 0) {
        const h = this.hurtFlash / 0.22;
        P.chest[0] -= 0.4 * h;
        P.head[0] -= 0.3 * h;
        P.armL[2] += 0.35 * h;
        P.armR[2] -= 0.35 * h;
        P.body[0] -= 0.15 * h;
      }
    }

    rig.body.rotation.y = wrap(rig.body.rotation.y);
    rig.body.rotation.x = wrap(rig.body.rotation.x);
    rig.spring(dt, w, 0.62, LOOSE);
    if (spinY !== null) {
      rig.body.rotation.y = spinY;
      rig.vel.body[1] = 0;
    }
    if (flipX !== null) {
      rig.body.rotation.x = flipX;
      rig.vel.body[0] = 0;
    }

    // blinking
    A.blinkT -= dt;
    if (A.blinkT < 0) A.blinkT = 2 + Math.random() * 3.5;
    const blink = A.blinkT < 0.13 ? 1 - Math.abs(A.blinkT / 0.065 - 1) : 0;
    const lidOpen = this.dead ? 1 : this.hurtFlash > 0 ? 0.8 : blink;
    for (const s of [1, -1]) {
      const lid = hero.face['lid' + s];
      if (lid) {
        lid.scale.y = 0.35 + 0.65 * lidOpen;
        lid.rotation.x = -0.3 + 0.9 * lidOpen;
      }
    }

    // bow string follows the draw
    const wpn = hero.weapon;
    if (wpn && wpn.bow) followNock(wpn.bow, hero.rig.j.handR, draw > 0.01 || showArrow, showArrow);

    // cape: two damped springs driven by speed, fall speed and turning
    if (hero.cape) {
      const [top, bot] = hero.cape;
      const lift = Math.min(1.15, hs * 0.1) + (this.vy < 0 ? Math.min(0.7, -this.vy * 0.05) : -Math.min(0.3, this.vy * 0.03));
      const tgt0 = 0.1 + lift + Math.sin(t * 2.7) * 0.025 * (1 + sn);
      const tgt1 = lift * 0.55 + Math.sin(t * 3.9 + 1) * 0.06 * (0.4 + sn);
      const cw = 9;
      const step = (i, tg) => {
        const acc = cw * cw * (tg - A.capeA[i]) - 2 * 0.35 * cw * A.capeV[i];
        A.capeV[i] += acc * dt;
        A.capeA[i] += A.capeV[i] * dt;
      };
      step(0, tgt0);
      step(1, tgt1);
      top.rotation.x = clamp(A.capeA[0], -0.2, 1.5);
      top.rotation.z = -A.bank * 0.8;
      bot.rotation.x = clamp(A.capeA[1], -0.3, 1.2);
    }
    if (hero.orbit) {
      hero.orbit.position.set(Math.cos(t * 2) * 0.6, 1.5 + Math.sin(t * 3) * 0.12, Math.sin(t * 2) * 0.6);
      hero.orbit.rotation.y = t * 3;
    }
    this.updateTrails(dt);

    // legendary weapons shed sparks
    if (wpn && this.equipment.weapon && this.equipment.weapon.rarity.tier >= 4 && Math.random() < 0.25 && !this.demo) {
      const tip = wpn.tips[Math.floor(Math.random() * wpn.tips.length)];
      tip.getWorldPosition(this._tmp || (this._tmp = new THREE.Vector3()));
      this.game.effects.puff(this._tmp.x, this._tmp.y, this._tmp.z, this.equipment.weapon.rarity.hex, 0.12, 0.35);
    }

    // shield bubble, hurt tint, invuln flicker
    this.shieldMesh.visible = this.shield > 0;
    if (this.shield > 0) this.shieldMesh.rotation.y = t;
    const hurt = this.hurtFlash > 0 ? 0x802020 : 0x000000;
    hero.mats.skin.emissive.setHex(hurt);
    hero.mats.cloth.emissive.setHex(hurt);
    const flick = this.invuln > 0.1 && this.hurtFlash <= 0 && this.dashTime <= 0 && !this.action && Math.floor(t * 20) % 2 === 0;
    rig.scaler.visible = !flick;

    const g = this.game.dungeon ? this.game.dungeon.maxHeightUnder(this.x, this.z, 0.2) : 0;
    this.shadow.position.set(this.x, g + 0.03, this.z);
    const ss = clamp(1 - (this.y - g) * 0.12, 0.4, 1);
    this.shadow.scale.set(ss, ss, ss);
  }

  // Swing ribbons from each weapon tip back toward the hand.
  updateTrails(dt) {
    const hero = this.hero;
    const w = hero.weapon;
    if (!w || this.cls.weapon === 'bow' || !this.game.scene) return;
    if (!this.trails) {
      this.trails = w.tips.map(() => new Trail(this.game.scene, 0xffffff));
      this._ta = new THREE.Vector3();
      this._tb = new THREE.Vector3();
    }
    const a = this.action;
    const swinging = !!(this.attack && !this.attack.c.ranged && this.attack.t > this.attack.dur * this.attack.c.hitAt * 0.5 && this.attack.t < this.attack.dur * 0.85) || !!(a && ['spin', 'flurry', 'lunge', 'leap', 'slamLand', 'overhead', 'stab'].includes(a.anim));
    const rarity = this.equipment.weapon ? this.equipment.weapon.rarity : null;
    const col = this.cls.weapon === 'staff' ? 0xb58cff : rarity && rarity.tier >= 1 ? rarity.hex : 0xdfe8ff;
    w.tips.forEach((tip, i) => {
      const tr = this.trails[i];
      if (!tr) return;
      tr.setColor(col);
      tip.getWorldPosition(this._tb);
      (i === 0 ? hero.rig.j.handR : hero.rig.j.handL).getWorldPosition(this._ta);
      this._ta.lerp(this._tb, 0.25);
      tr.update(dt, this._ta, this._tb, swinging && !this.demo);
    });
  }

  disposeTrails() {
    if (this.trails) this.trails.forEach((t) => t.dispose());
    this.trails = null;
  }

  nearestThreat() {
    let best = null;
    let bd = 100;
    for (const e of this.game.enemies) {
      if (!e.alive || !e.aggro) continue;
      const d = (e.x - this.x) ** 2 + (e.z - this.z) ** 2;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  // Idle fidgets, f = 0..1 through the fidget.
  fidgetPose(P, type, f, t) {
    const env = Math.sin(Math.PI * f); // ease in and out of the fidget
    if (type === 'look') {
      const a = Math.sin(f * Math.PI * 2) * 0.8 * env;
      P.head[1] += a;
      P.neck[1] += a * 0.4;
      P.chest[1] += a * 0.15;
    } else if (type === 'stretch') {
      P.chest[0] -= 0.25 * env;
      P.head[0] -= 0.2 * env;
      P.armL[2] += 0.5 * env;
      P.armR[2] -= 0.5 * env;
      P.armL[0] += 0.3 * env;
      P.armR[0] += 0.3 * env;
      P.chest[1] += Math.sin(f * Math.PI * 4) * 0.12 * env;
    } else if (type === 'knight') {
      // rest the sword on the shoulder
      P.armR = [-2.3 * env - 0.35 * (1 - env), 0, -0.3 * env - 0.15 * (1 - env)];
      P.foreR[0] = -1.9 * env - 1.0 * (1 - env);
      P.handR[0] = -0.2 - 0.9 * env;
      P.head[1] += -0.25 * env;
      P.chest[1] += -0.1 * env;
    } else if (type === 'ranger') {
      // raise the bow and test the string
      P.armL = [-1.3 * env - 0.2, 0.4 * env, 0.15];
      P.foreL[0] = -0.4 * env - 0.5 * (1 - env);
      P.armR = [-1.2 * env, -0.3 * env, -0.2];
      P.foreR[0] = -1.4 * env + Math.sin(t * 18) * 0.15 * env;
      P.head[0] += 0.15 * env;
    } else if (type === 'mage') {
      // tap the staff on the ground, then conjure a spark
      const tap = f < 0.5 ? Math.max(0, Math.sin(f * Math.PI * 6)) : 0;
      P.armR[0] += -0.35 * tap;
      P.foreR[0] += 0.3 * tap;
      if (f > 0.45) {
        const g = Math.sin(((f - 0.45) / 0.55) * Math.PI);
        P.armL = [-1.1 * g, 0, 0.25];
        P.foreL[0] = -1.2 * g;
        P.handL[0] = -1.2 * g;
        P.head[0] += 0.25 * g;
        P.head[1] += 0.3 * g;
        if (Math.random() < 0.25 && !this.demo) {
          const hx = this.x + Math.sin(this.heading + 0.6) * 0.45;
          const hz = this.z + Math.cos(this.heading + 0.6) * 0.45;
          this.game.effects.puff(hx, this.y + 1.2, hz, 0xb58cff, 0.1, 0.5);
        }
      }
    } else if (type === 'rogue') {
      // flip a dagger in the right hand
      P.armR = [-0.9 * env, 0, -0.25];
      P.foreR[0] = -1.5 * env - 0.6;
      P.handR[0] = 0.6 + env * f * TAU * 2;
      P.head[0] += 0.3 * env;
      P.head[1] -= 0.3 * env;
    }
  }

  // Resting weapon hold, blended over the run cycle.
  stance(P, sn) {
    const wt = this.cls.weapon;
    const run = clamp((sn - 0.35) / 0.45, 0, 1);
    const k = 0.75 - run * 0.25;
    const mix = (arr, v) => {
      arr[0] += (v[0] - arr[0]) * k;
      arr[1] += (v[1] - arr[1]) * k;
      arr[2] += (v[2] - arr[2]) * k;
    };
    if (wt === 'sword') {
      mix(P.armR, [-0.35 + P.armR[0] * 0.3, 0, -0.18]);
      mix(P.foreR, [-1.0 - run * 0.3, 0, 0]);
      P.handR[0] = -0.2 + run * 0.5;
      mix(P.armL, [-0.55, 0.2, 0.25]);
      mix(P.foreL, [-1.2, 0.3, 0]);
    } else if (wt === 'daggers') {
      mix(P.armR, [-0.3 + P.armR[0] * 0.5, 0, -0.22]);
      mix(P.armL, [-0.3 + P.armL[0] * 0.5, 0, 0.22]);
      P.foreR[0] = Math.min(P.foreR[0], -1.1);
      P.foreL[0] = Math.min(P.foreL[0], -1.1);
      P.handR[0] = 0.6;
      P.handL[0] = 0.6;
      P.chest[0] += 0.08;
      P.body[0] += 0.05;
    } else if (wt === 'bow') {
      mix(P.armL, [-0.25 + P.armL[0] * 0.4, 0, 0.15]);
      P.foreL[0] = -0.5;
      P.handL[0] = -0.2;
    } else if (wt === 'staff') {
      mix(P.armR, [-0.3 + P.armR[0] * 0.2, 0, -0.18]);
      P.foreR[0] = -1.3;
      P.handR[0] = -0.25 + run * 0.4;
    }
  }

  airPose(P) {
    const up = this.vy > 0;
    const v = clamp(this.vy / 10, -1, 1);
    P.thighL[0] = up ? -1.1 : -0.35 - 0.2 * -v;
    P.shinL[0] = up ? 1.6 : 0.4;
    P.thighR[0] = up ? 0.3 : 0.15;
    P.shinR[0] = up ? 0.8 : 0.35;
    P.footL[0] = up ? 0.4 : -0.2;
    P.footR[0] = 0.3;
    P.armL[2] += 0.55 - v * 0.35;
    P.armR[2] -= 0.55 - v * 0.35;
    P.armL[0] -= up ? 0.4 : 0;
    P.armR[0] -= up ? 0.2 : 0;
    P.body[0] = up ? 0.12 : -0.08;
    P.chest[0] += up ? -0.1 : 0.1;
    P.head[0] += up ? -0.15 : 0.15;
  }

  attackPose(P, at) {
    const c = at.c;
    const p = at.t / at.dur;
    const h = c.hitAt;
    const wind = ease(p / h);
    const strike = easeOut((p - h * 0.75) / (1 - h * 0.75) * 1.8);
    const legsStance = () => {
      P.thighL[0] = -0.45;
      P.shinL[0] = 0.35;
      P.thighR[0] = 0.35;
      P.shinR[0] = 0.25;
      P.bodyY = -0.06;
    };
    switch (c.anim) {
      case 'slashR': {
        legsStance();
        const z = -1.5 * wind + 2.7 * strike;
        P.armR = [-1.45, 0, z * 1 - 0 + (p < h ? 0 : 0)];
        P.armR[2] = p < h * 0.75 ? -1.5 * wind : -1.5 + 2.7 * strike;
        P.foreR = [-0.25, 0, 0];
        P.handR = [1.25, 0, 0];
        P.chest[1] = p < h * 0.75 ? -0.55 * wind : -0.55 + 1.1 * strike;
        P.armL = [-0.6, 0, 0.5];
        P.foreL = [-1.1, 0, 0];
        return null;
      }
      case 'slashL': {
        legsStance();
        P.armR[0] = -1.45;
        P.armR[2] = p < h * 0.75 ? 1.1 * wind : 1.1 - 2.6 * strike;
        P.foreR = [-0.3, 0, 0];
        P.handR = [1.25, 0, 0];
        P.chest[1] = p < h * 0.75 ? 0.5 * wind : 0.5 - 1.0 * strike;
        P.armL = [-0.6, 0, 0.5];
        P.foreL = [-1.1, 0, 0];
        return null;
      }
      case 'spinSlash': {
        P.thighL = [-0.4, 0, 0.35];
        P.thighR = [-0.2, 0, -0.35];
        P.shinL[0] = 0.5;
        P.shinR[0] = 0.5;
        P.bodyY = -0.14;
        P.armR = [-1.5, 0, -0.4];
        P.handR = [1.3, 0, 0];
        P.armL = [-0.3, 0, 1.2];
        const s = p < h * 0.6 ? -0.4 * wind : -0.4 + (TAU + 0.4) * easeOut((p - h * 0.6) / (1 - h * 0.6) * 1.4);
        return { spinY: s };
      }
      case 'stabR':
      case 'stabL': {
        const right = c.anim === 'stabR';
        const A = right ? P.armR : P.armL;
        const F = right ? P.foreR : P.foreL;
        const H = right ? P.handR : P.handL;
        const O = right ? P.armL : P.armR;
        const OF = right ? P.foreL : P.foreR;
        const ext = p < h ? 0 : strike;
        A[0] = -0.4 - 1.15 * ext + 0.3 * wind * (1 - ext);
        A[2] = (right ? -1 : 1) * 0.15;
        F[0] = -1.7 + 1.6 * ext;
        H[0] = 1.3;
        O[0] = 0.2;
        OF[0] = -1.4;
        P.chest[1] = (right ? 1 : -1) * (-0.3 * wind + 0.7 * ext);
        legsStance();
        if (!right) {
          P.thighL[0] = 0.35;
          P.thighR[0] = -0.45;
        }
        return null;
      }
      case 'crossSlash': {
        legsStance();
        const s = p < h * 0.7 ? 0 : strike;
        P.armR = [-1.9 + 0.5 * s, 0, 0.6 - 1.9 * s];
        P.armL = [-1.9 + 0.5 * s, 0, -0.6 + 1.9 * s];
        P.foreR = [-0.4, 0, 0];
        P.foreL = [-0.4, 0, 0];
        P.handR = [1.2, 0, 0];
        P.handL = [1.2, 0, 0];
        P.chest[0] = -0.2 * wind + 0.35 * s;
        return null;
      }
      case 'bowShot': {
        const d = p < h ? ease(p / h) : Math.max(0, 1 - (p - h) * 8);
        this.bowAim(P, d);
        return { draw: d, arrow: p < h };
      }
      case 'staffR':
      case 'staffL':
      case 'staffBurst': {
        const s = p < h ? 0 : strike;
        if (c.anim === 'staffBurst') {
          P.armR = [-2.5 + 1.2 * s, 0, -0.2];
          P.armL = [-2.5 + 1.1 * s, 0, 0.2];
          P.foreR[0] = -0.3;
          P.foreL[0] = -0.3;
          P.handR[0] = -0.2 + 1.0 * s;
          P.chest[0] = -0.25 * wind + 0.3 * s;
        } else {
          const right = c.anim === 'staffR';
          P.armR = [-0.5 - 0.9 * s * (right ? 1 : 0.3), 0, -0.2];
          P.foreR[0] = -1.2 + 0.9 * s * (right ? 1 : 0.3);
          P.handR[0] = -0.3 + 0.9 * s * (right ? 1 : 0.2);
          P.armL = [right ? -0.3 : -0.6 - 1.0 * s, 0, 0.25];
          P.foreL[0] = right ? -0.6 : -0.9 + 0.8 * s;
          P.handL[0] = -1.2;
          P.chest[1] = (right ? 0.35 : -0.35) * s;
        }
        legsStance();
        return null;
      }
      default:
        return null;
    }
  }

  // Side-on archer stance solved with IK: bow arm on the aim line, draw hand to the cheek.
  bowAim(P, d, pitch = 0.03) {
    bowPose(this.hero.rig, P, d, pitch);
    P.thighL[0] = -0.25;
    P.thighR[0] = 0.2;
    P.thighL[2] = 0.12;
    P.thighR[2] = -0.12;
    P.shinL[0] = Math.max(P.shinL[0], 0.1);
  }

  actionPose(P, a) {
    const p = clamp(a.t / Math.max(0.01, a.dur), 0, 1);
    switch (a.anim) {
      case 'spin':
        P.armL = [-0.2, 0, 1.45];
        P.armR = [-0.2, 0, -1.45];
        P.foreL[0] = 0;
        P.foreR[0] = 0;
        P.handR[0] = 1.3;
        P.handL[0] = 1.3;
        P.thighL[2] = 0.3;
        P.thighR[2] = -0.3;
        P.bodyY = -0.08;
        return { spinY: a.t * 20 };
      case 'charge':
        P.body[0] = 0.4;
        P.armL = [-1.4, 0.3, 0.3];
        P.foreL = [-0.9, 0, 0];
        P.armR = [0.5, 0, -0.3];
        return null;
      case 'roar':
        P.armL = [-0.6, 0, 1.3];
        P.armR = [-0.6, 0, -1.3];
        P.foreL[0] = -0.8;
        P.foreR[0] = -0.8;
        P.chest[0] = -0.3;
        P.head[0] = -0.35;
        P.thighL[2] = 0.25;
        P.thighR[2] = -0.25;
        P.bodyY = -0.08;
        return null;
      case 'overhead': {
        const s = p < 0.4 ? ease(p / 0.4) : 1 - easeOut((p - 0.4) / 0.25);
        P.armR = [-0.6 - 2.3 * s, 0, 0.1];
        P.armL = [-0.6 - 2.3 * s, 0, -0.1];
        P.foreR[0] = -0.4;
        P.foreL[0] = -0.4;
        P.handR[0] = 0.8;
        P.body[0] = p < 0.4 ? -0.15 : 0.45;
        P.bodyY = p < 0.4 ? 0 : -0.15;
        P.thighL[0] = -0.6;
        P.shinL[0] = 0.6;
        P.thighR[0] = 0.4;
        return null;
      }
      case 'leap':
        P.armR = [-2.8, 0, 0.2];
        P.armL = [-2.6, 0, -0.2];
        P.foreR[0] = -0.5;
        P.foreL[0] = -0.5;
        P.handR[0] = 0.9;
        P.thighL[0] = -1.1;
        P.shinL[0] = 1.7;
        P.thighR[0] = -0.7;
        P.shinR[0] = 1.5;
        P.body[0] = this.vy > 0 ? -0.25 : 0.4;
        return null;
      case 'slamLand':
        P.armR = [-0.9, 0, 0];
        P.armL = [-0.7, 0, 0];
        P.handR[0] = 1.2;
        P.body[0] = 0.5;
        P.bodyY = -0.3;
        P.thighL[0] = -1.1;
        P.shinL[0] = 1.6;
        P.thighR[0] = 0.3;
        P.shinR[0] = 1.2;
        return null;
      case 'shoot':
        this.bowAim(P, p < 0.5 ? ease(p / 0.25) : 0);
        return { draw: p < 0.5 ? 1 : 0, arrow: p < 0.5 };
      case 'draw':
        this.bowAim(P, ease(p));
        P.bodyY = -0.1;
        return { draw: ease(p) * 1.15, arrow: true };
      case 'skyshot':
        this.bowAim(P, p < 0.6 ? ease(p / 0.3) : 0, 0.95);
        return { draw: p < 0.6 ? 1 : 0, arrow: p < 0.6 };
      case 'flip':
        P.thighL[0] = -1.3;
        P.shinL[0] = 1.8;
        P.thighR[0] = -1.2;
        P.shinR[0] = 1.7;
        P.armL[2] = 0.7;
        P.armR[2] = -0.7;
        return { flipX: -Math.min(1, a.t / 0.62) * TAU };
      case 'throw':
      case 'throwdown': {
        const s = p < 0.45 ? 0 : easeOut((p - 0.45) / 0.3);
        P.armR = a.anim === 'throw' ? [-2.6 + 1.9 * s, 0, -0.2] : [-1.2 + 1.2 * s, 0, -0.2];
        P.foreR[0] = -1.0 + 0.9 * s;
        P.chest[1] = 0.4 - 0.8 * s;
        P.armL = [-0.9, 0, 0.3];
        if (a.anim === 'throwdown') {
          P.bodyY = -0.25 * s;
          P.thighL[0] = -0.8 * s;
          P.shinL[0] = 1.2 * s;
          P.thighR[0] = -0.3 * s;
          P.shinR[0] = 1.0 * s;
        }
        return null;
      }
      case 'cast':
        P.armL = [-1.5, 0, 0.1];
        P.foreL[0] = -0.1;
        P.handL[0] = -1.3;
        if (this.cls.weapon === 'staff') {
          P.armR = [-1.2, 0, -0.1];
          P.foreR[0] = -0.4;
          P.handR[0] = 0.6;
        }
        P.chest[1] = -0.25;
        return null;
      case 'slamcast':
        P.armR = [-0.9, 0, -0.1];
        P.foreR[0] = -0.9;
        P.handR[0] = 0.3;
        P.armL = [-0.3, 0, 0.9];
        P.bodyY = -0.22;
        P.thighL[0] = -0.8;
        P.shinL[0] = 1.3;
        P.thighR[0] = -0.2;
        P.shinR[0] = 1.1;
        P.body[0] = 0.25;
        return null;
      case 'skycast':
        P.armR = [-2.9, 0, -0.2];
        P.armL = [-2.9, 0, 0.2];
        P.foreR[0] = -0.2;
        P.foreL[0] = -0.2;
        P.chest[0] = -0.3;
        P.head[0] = -0.3;
        return null;
      case 'stab':
      case 'lunge':
        P.armR = [-1.55, 0, -0.1];
        P.foreR[0] = -0.1;
        P.handR[0] = 1.3;
        P.armL = [0.6, 0, 0.3];
        P.body[0] = a.anim === 'lunge' ? 0.5 : 0.2;
        P.thighL[0] = -0.9;
        P.shinL[0] = 0.8;
        P.thighR[0] = 0.6;
        P.chest[1] = 0.4;
        return null;
      case 'flurry': {
        const s = Math.sin(a.t * 38);
        P.armR = [-1.1 - 0.5 * s, 0, -0.15];
        P.armL = [-1.1 + 0.5 * s, 0, 0.15];
        P.foreR[0] = -0.9 + 0.8 * Math.max(0, s);
        P.foreL[0] = -0.9 + 0.8 * Math.max(0, -s);
        P.handR[0] = 1.3;
        P.handL[0] = 1.3;
        P.chest[1] = s * 0.3;
        return null;
      }
      default:
        return null;
    }
  }

  // Showcase for the class-select screen: idle, with a demo swing now and then.
  showcase(dt) {
    this.demo = true;
    this.demoT = (this.demoT || 0) + dt;
    if (!this.attack && this.demoT > 7) {
      this.demoT = 0;
      this.startAttack({ wish: this.heading, camYaw: this.heading });
    }
    if (this.attack) {
      const at = this.attack;
      at.t += dt;
      if (!at.hit && at.t >= at.dur * at.c.hitAt) at.hit = true;
      if (at.t >= at.dur) {
        this.attack = at.i + 1 < this.chain.length ? { i: at.i + 1, c: this.chain[at.i + 1], t: 0, dur: this.chain[at.i + 1].dur, hit: false } : null;
      }
    }
    this.speed = 0;
    this.grounded = true;
    this.animate(dt);
  }
}
