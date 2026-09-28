// The player: class-based stats and basic attack, movement (run / jump /
// double jump / dash), up to four owned skills, buffs and shields, and the
// clip-driven animation layer on the rigged hero model.

import * as THREE from 'three';
import { clamp, angleDiff } from './utils.js';
import { sfx } from './audio.js';
import { SLOTS } from './items.js';
import { CLASSES } from './classes.js';
import { skillDef, EVO_LEVEL } from './skills.js';
import { buildHero, dressHero } from './hero.js';
import { clip } from './assets.js';
import { Trail } from './effects.js';

const GRAVITY = 28;
const JUMP_V = 10;
const AIR_JUMP_V = 9;
const DASH_TIME = 0.17;
const DASH_SPEED = 24;
const DASH_RECHARGE = 0.9;
const TAU = Math.PI * 2;

// Basic attack chains per weapon. `hitAt` is the fraction of the swing where damage
// lands; `clip` is the animation, timed so its impact frame lands there too.
const ATTACKS = {
  sword: [
    { dur: 0.34, hitAt: 0.42, mult: 1.0, arc: 2.4, range: 2.5, knock: 4, anim: 'slashR', clip: '1H_Melee_Attack_Slice_Diagonal' },
    { dur: 0.34, hitAt: 0.42, mult: 1.1, arc: 2.4, range: 2.5, knock: 4, anim: 'slashL', clip: '1H_Melee_Attack_Slice_Horizontal', windup: 0.25 },
    { dur: 0.52, hitAt: 0.5, mult: 1.8, arc: 6.3, range: 3.0, knock: 10, anim: 'spinSlash', clip: '2H_Melee_Attack_Spin', windup: 0.55, part: 'full' },
  ],
  daggers: [
    { dur: 0.22, hitAt: 0.45, mult: 0.8, arc: 1.9, range: 2.2, knock: 2, anim: 'stabR', clip: '1H_Melee_Attack_Stab', windup: 0.25 },
    { dur: 0.22, hitAt: 0.45, mult: 0.8, arc: 1.9, range: 2.2, knock: 2, anim: 'stabL', clip: 'Dualwield_Melee_Attack_Slice', windup: 0.3 },
    { dur: 0.22, hitAt: 0.45, mult: 0.9, arc: 1.9, range: 2.2, knock: 2, anim: 'stabR', clip: 'Dualwield_Melee_Attack_Stab', windup: 0.25 },
    { dur: 0.38, hitAt: 0.5, mult: 1.6, arc: 2.8, range: 2.5, knock: 7, anim: 'crossSlash', clip: 'Dualwield_Melee_Attack_Chop', windup: 0.4 },
  ],
  bow: [
    { dur: 0.42, hitAt: 0.62, mult: 1.0, ranged: 'arrow', anim: 'bowShot', clip: '2H_Ranged_Shoot', windup: 0.12, part: 'upper' },
    { dur: 0.42, hitAt: 0.62, mult: 1.0, ranged: 'arrow', anim: 'bowShot', clip: '2H_Ranged_Shoot', windup: 0.12, part: 'upper' },
    { dur: 0.5, hitAt: 0.68, mult: 1.6, ranged: 'power', anim: 'bowShot', clip: '2H_Ranged_Shoot', windup: 0.12, part: 'upper' },
  ],
  staff: [
    { dur: 0.36, hitAt: 0.45, mult: 0.95, ranged: 'missile', anim: 'staffR', clip: 'Spellcast_Shoot', windup: 0.1, part: 'upper' },
    { dur: 0.36, hitAt: 0.45, mult: 0.95, ranged: 'missile', anim: 'staffL', clip: '1H_Ranged_Shoot', windup: 0.12, part: 'upper' },
    { dur: 0.5, hitAt: 0.5, mult: 0.8, ranged: 'missile3', anim: 'staffBurst', clip: 'Spellcast_Raise', windup: 0.27 },
  ],
  axe: [
    { dur: 0.46, hitAt: 0.5, mult: 1.3, arc: 2.8, range: 2.8, knock: 6, anim: 'slashR', clip: '2H_Melee_Attack_Slice', windup: 0.35 },
    { dur: 0.5, hitAt: 0.55, mult: 1.5, arc: 2.2, range: 3.0, knock: 8, anim: 'slashL', clip: '2H_Melee_Attack_Chop', windup: 0.5 },
    { dur: 0.7, hitAt: 0.55, mult: 2.4, arc: 6.3, range: 3.4, knock: 12, anim: 'spinSlash', clip: '2H_Melee_Attack_Spin', windup: 0.6, part: 'full' },
  ],
};

// When each clip's strike lands (s), measured from peak hand speed.
const CLIP_IMPACT = {
  '1H_Melee_Attack_Slice_Diagonal': 0.38,
  '1H_Melee_Attack_Slice_Horizontal': 0.25,
  '1H_Melee_Attack_Chop': 0.58,
  '1H_Melee_Attack_Stab': 0.38,
  '1H_Melee_Attack_Jump_Chop': 0.73,
  '1H_Ranged_Shoot': 0.12,
  '2H_Melee_Attack_Slice': 0.38,
  '2H_Melee_Attack_Chop': 0.72,
  '2H_Melee_Attack_Spin': 1.17,
  '2H_Melee_Attack_Stab': 0.38,
  '2H_Ranged_Shoot': 0.14,
  Dualwield_Melee_Attack_Stab: 0.38,
  Dualwield_Melee_Attack_Slice: 0.55,
  Dualwield_Melee_Attack_Chop: 0.55,
  Spellcast_Shoot: 0.1,
  Spellcast_Raise: 0.27,
  Throw: 0.72,
  Taunt: 0.65,
};

// Ground speed (m/s at hero scale) the walk and run clips were authored for.
const WALK_REF = 2.4;
const RUN_REF = 5.5;

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
    this.model = buildHero(clsId);
    this.mesh = this.model.group;
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
    this.buff = { dmg: 0, as: 0, crit: 0, armor: 0, ms: 0, pierce: 0, size: 0, ls: 0, critAll: 0, tripleShot: 0 };
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
    dressHero(this.model, this.equipment);
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
      cur.level = Math.min(EVO_LEVEL, cur.level + 1);
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
    return s ? skillDef(s.id, s.level).cd(s.level) * (1 - this.final.cdr) : 1;
  }

  // ----------------------------------------------------------------- buffs
  addBuff(id, dur, mods, color = 0xffffff) {
    this.buffs[id] = { t: dur, mods, color };
    this.refreshBuffs();
  }

  refreshBuffs() {
    const b = { dmg: 0, as: 0, crit: 0, armor: 0, ms: 0, pierce: 0, size: 0, ls: 0, critAll: 0, tripleShot: 0 };
    for (const id in this.buffs) for (const k in this.buffs[id].mods) b[k] = (b[k] || 0) + this.buffs[id].mods[k];
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
    let amount = f.damage * mult * (isSkill ? f.skillMult : 1) * (1 + this.buff.dmg + (this.game.comboBonus?.() || 0));
    amount *= 0.9 + Math.random() * 0.2;
    const crit = forceCrit || this.nextCrit || this.buff.critAll > 0 || Math.random() < f.crit + this.buff.crit;
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
        if (o.onLand) o.onLand(this.x, this.z);
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
        const spread = this.buffMod('tripleShot') ? [-0.14, 0, 0.14] : [0];
        for (const off of spread) game.shoot({ from: this, heading: this.heading + off, speed: power ? 38 : 32, life: 0.65, kind: power ? 'bigarrow' : 'arrow', dmg: () => this.rollDamage(c.mult), knock: power ? 6 : 3, pierce: pierce + (power ? 1 : 0) });
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
    const def = skillDef(s.id, s.level);
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
  // Clip-driven: a speed-blended locomotion base, with attacks/skills/hits layered on
  // top (upper body only while running, so the legs keep going), plus procedural lean,
  // head tracking, flips and squash on the model's pivot.

  // Play a strike clip so that its impact frame lands at `hitAt` of `dur`.
  strike(name, dur, hitAt = 0.5, o = {}) {
    const an = this.model.animator;
    const c = clip(name);
    if (!c) return null;
    const imp = CLIP_IMPACT[name] ?? c.duration * 0.4;
    const s0 = Math.max(0, imp - (o.windup ?? 0.32));
    const rate = clamp((imp - s0) / Math.max(0.04, dur * hitAt), 0.4, 3.5) * (o.rate ?? 1);
    const moving = this.speed > 1.5 && this.grounded;
    return an.play(name, {
      part: o.part || (moving ? 'upper' : 'full'),
      from: s0 / c.duration,
      speed: rate,
      dur: o.hold ? undefined : dur + 0.05,
      hold: o.hold,
      fadeIn: o.fadeIn ?? 0.06,
      fadeOut: o.fadeOut ?? 0.2,
      keep: o.keep,
      weight: o.weight,
    });
  }

  actionClip(a) {
    const an = this.model.animator;
    const cls = this.clsId;
    const dur = Math.max(0.15, a.dur);
    const twoH = cls === 'barbarian';
    const dual = cls === 'rogue';
    switch (a.anim) {
      case 'spin':
        return an.play(twoH ? '2H_Melee_Attack_Spinning' : '2H_Melee_Attack_Spinning', { loop: true, speed: 1.4, fadeIn: 0.1 });
      case 'charge':
        return an.play(cls === 'knight' ? 'Blocking' : '2H_Melee_Idle', { part: 'upper', loop: true, fadeIn: 0.1 });
      case 'roar':
        return this.strike('Taunt', Math.min(dur, 0.9), 0.55, { part: 'full', windup: 0.5 });
      case 'cleave':
        return this.strike('2H_Melee_Attack_Slice', dur, 0.45, { windup: 0.35 });
      case 'overhead':
        return this.strike(twoH ? '2H_Melee_Attack_Chop' : '1H_Melee_Attack_Chop', dur, 0.5, { windup: 0.45 });
      case 'leap':
        return an.play('1H_Melee_Attack_Jump_Chop', { from: 0.12, speed: 1.3, hold: true, fadeIn: 0.05 });
      case 'slamLand':
        return an.play(twoH ? '2H_Melee_Attack_Chop' : '1H_Melee_Attack_Jump_Chop', { from: twoH ? 0.45 : 0.55, speed: 1.4, dur: 0.45, fadeIn: 0.03 });
      case 'shoot':
        return this.strike('2H_Ranged_Shoot', dur, 0.3, { windup: 0.1 });
      case 'draw':
      case 'skyshot':
        return an.play('2H_Ranged_Aiming', { part: 'upper', loop: true, fadeIn: 0.1 });
      case 'flip':
        return an.play('Dodge_Backward', { dur: Math.min(dur, 0.5), fadeIn: 0.04, fadeOut: 0.15 });
      case 'throw':
      case 'throwdown':
        return this.strike('Throw', dur, 0.5, { windup: 0.4 });
      case 'slamcast':
        return this.strike(twoH ? '2H_Melee_Attack_Chop' : '1H_Melee_Attack_Chop', dur, 0.5, { windup: 0.4 });
      case 'skycast':
        return this.strike('Spellcast_Raise', dur, 0.5, { windup: 0.27 });
      case 'stab':
      case 'lunge':
        return this.strike(dual ? 'Dualwield_Melee_Attack_Stab' : '1H_Melee_Attack_Stab', dur, 0.45);
      case 'flurry':
        return an.play('Dualwield_Melee_Attack_Slice', { loop: true, speed: 2.4, fadeIn: 0.06 });
      case 'block':
        return an.play('Blocking', { part: 'upper', loop: true, fadeIn: 0.08 });
      default:
        return this.strike(cls === 'mage' ? 'Spellcast_Shoot' : 'Spellcast_Shoot', dur, 0.4, { windup: 0.1 });
    }
  }

  animate(dt) {
    this.animT += dt;
    const t = this.animT;
    const model = this.model;
    const an = model.animator;
    const g = model.group;
    const A = this.anim || (this.anim = { prevHeading: this.heading, prevSpeed: 0, accLean: 0, bank: 0, look: 0, idleT: 0, nextFidget: 6 + Math.random() * 4, attack: null, action: null, wasGrounded: true, dash: false, jumpT: 0, combat: 0 });
    g.position.set(this.x, this.y, this.z);
    g.rotation.y = this.heading;
    const hs = this.speed;
    const look = this.model.cfg;

    // turning bank and acceleration lean (smoothed)
    const turn = angleDiff(A.prevHeading, this.heading) / Math.max(dt, 1e-4);
    A.prevHeading = this.heading;
    const accel = (hs - A.prevSpeed) / Math.max(dt, 1e-4);
    A.prevSpeed = hs;
    const kk = Math.min(1, dt * 8);
    const sn = this.grounded ? clamp(hs / 7.5, 0, 1.3) : 0;
    A.bank += (clamp(-turn * 0.03 * sn, -0.25, 0.25) - A.bank) * kk;
    A.accLean += (clamp(accel * 0.01, -0.2, 0.2) - A.accLean) * kk;

    if (this.dead) {
      if (!A.deadPlayed) {
        A.deadPlayed = true;
        an.play(Math.random() < 0.5 ? 'Death_A' : 'Death_B', { hold: true, fadeIn: 0.08 });
      }
      model.pivot.rotation.set(0, 0, 0);
      model.update(dt);
      this.updateShadow();
      return;
    }
    A.deadPlayed = false;

    // ---- locomotion base
    const threat = this.demo ? null : this.nearestThreat();
    A.combat = threat ? Math.min(1, A.combat + dt * 2) : Math.max(0, A.combat - dt * 0.5);
    const idle = this.clsId === 'barbarian' ? '2H_Melee_Idle' : A.combat > 0.5 && (this.clsId === 'knight' || this.clsId === 'rogue') ? 'Idle_Combat' : 'Idle';
    if (!this.grounded && this.dashTime <= 0) {
      an.setBase({ Jump_Idle: 1 });
    } else if (hs < 0.35) {
      an.setBase({ [idle]: 1 });
    } else {
      const run = look.run;
      const wr = clamp((hs - 2.2) / 2.8, 0, 1);
      const w = {};
      w.Walking_A = 1 - wr;
      w[run] = wr;
      if (hs < 1.2) w[idle] = 1 - hs / 1.2;
      an.setBase(w, { Walking_A: clamp(hs / WALK_REF, 0.6, 1.5), [run]: clamp(hs / RUN_REF, 0.7, 1.6), sync: ['Walking_A', run] });
    }

    // footsteps: a foot plants every half stride
    const stride = 0.9 + 0.55 * clamp((sn - 0.35) / 0.45, 0, 1);
    const prevPhase = this.runPhase;
    this.runPhase += sn > 0.02 ? ((hs * dt) / stride) * Math.PI : 0;
    if (sn > 0.25 && Math.floor(prevPhase / Math.PI) !== Math.floor(this.runPhase / Math.PI) && !this.demo) {
      this.game.effects.puff(this.x, this.y + 0.05, this.z, 0x8a8478, 0.18 + 0.12 * sn, 0.35);
      if (sn > 0.6) sfx.step();
    }

    // ---- overlays: basic attacks
    const at = this.attack;
    if (at && A.attack !== at) {
      const c = at.c;
      this.strike(c.clip, at.dur, at.c.hitAt, { windup: c.windup, part: c.part, rate: c.rate });
    }
    A.attack = at;

    // ---- overlays: skill actions
    const a = this.action;
    if (a && A.action !== a) this.actionClip(a);
    if (!a && A.action && !at) an.stop(null, 0.2);
    A.action = a;

    // ---- dash, jumps, landing, hits
    if (this.dashTime > 0 && !A.dash) an.play('Dodge_Forward', { dur: DASH_TIME + 0.12, fadeIn: 0.03, fadeOut: 0.12 });
    A.dash = this.dashTime > 0;
    if (this.grounded && !A.wasGrounded && this.landT > 0 && !a && !at) an.play('Jump_Land', { from: 0.1, dur: 0.3, weight: hs > 2 ? 0.45 : 0.9, part: 'full', keep: true });
    if (!this.grounded && A.wasGrounded && this.vy > 5 && !a) an.play('Jump_Start', { from: 0.45, dur: 0.18, weight: 0.8, fadeOut: 0.12 });
    A.wasGrounded = this.grounded;
    if (this.hurtFlash > 0.2 && !A.hurt) {
      an.play(Math.random() < 0.5 ? 'Hit_A' : 'Hit_B', { part: 'upper', dur: 0.4, weight: a || at ? 0.4 : 0.85, keep: true, fadeIn: 0.04 });
      model.flash(0xff2020, 0.25);
    }
    A.hurt = this.hurtFlash > 0.2;

    // idle fidgets
    if (!at && !a && this.grounded && hs < 0.35) A.idleT += dt;
    else A.idleT = 0;
    if (A.idleT > A.nextFidget) {
      A.idleT = 0;
      A.nextFidget = 6 + Math.random() * 6;
      const opts = this.clsId === 'mage' ? ['Spellcasting', 'Idle_B'] : this.clsId === 'barbarian' ? ['Taunt', 'Idle_B'] : ['Idle_B', 'Taunt'];
      const pick = opts[Math.floor(Math.random() * opts.length)];
      an.play(pick, { dur: pick === 'Idle_B' ? 2.1 : pick === 'Spellcasting' ? 1.3 : 1.0, loop: pick === 'Spellcasting', fadeIn: 0.25, fadeOut: 0.35, weight: 0.9 });
    }

    model.update(dt);

    // ---- procedural layers on top of the clips
    let lookYaw = 0;
    if (threat && !at && !a) lookYaw = clamp(angleDiff(this.heading, Math.atan2(threat.x - this.x, threat.z - this.z)), -1.0, 1.0);
    A.look += (lookYaw - A.look) * Math.min(1, dt * 5);
    model.look(A.look * 0.7);
    if (a && a.anim === 'skyshot') model.bend(0, 0.75);

    const p = model.pivot;
    let spinY = 0;
    let flipX = 0;
    if (a && a.anim === 'spin') spinY = a.t * 18;
    if (a && a.anim === 'flip') flipX = -clamp(a.t / Math.max(0.2, a.dur), 0, 1) * TAU;
    if (this.flipT > 0) flipX = -(1 - this.flipT / 0.4) * TAU;
    p.rotation.set(A.accLean * (a || at ? 0.3 : 1) + flipX, spinY, A.bank);
    // landing squash
    const sq = this.landT > 0 ? (this.landT / 0.16) * 0.12 : 0;
    const size = 1 + (this.buff?.size || 0);
    const cur = g.scale.x + (size - g.scale.x) * Math.min(1, dt * 6);
    g.scale.set(cur * (1 + sq * 0.5), cur * (1 - sq), cur * (1 + sq * 0.5));

    if (model.orbit) {
      model.orbit.position.set(Math.cos(t * 2) * 0.7, 1.6 + Math.sin(t * 3) * 0.12, Math.sin(t * 2) * 0.7);
      model.orbit.rotation.y = t * 3;
    }
    this.updateTrails(dt);

    // legendary weapons shed sparks
    const tips = model.tips;
    if (tips.length && this.equipment.weapon && this.equipment.weapon.rarity.tier >= 4 && Math.random() < 0.25 && !this.demo) {
      const v = model.tipOf(tips[Math.floor(Math.random() * tips.length)], this._tmp || (this._tmp = new THREE.Vector3()), 0.6 + Math.random() * 0.4);
      this.game.effects.puff(v.x, v.y, v.z, this.equipment.weapon.rarity.hex, 0.12, 0.35);
    }

    // shield bubble, invuln flicker
    this.shieldMesh.visible = this.shield > 0;
    if (this.shield > 0) this.shieldMesh.rotation.y = t;
    const flick = this.invuln > 0.1 && this.hurtFlash <= 0 && this.dashTime <= 0 && !this.action && Math.floor(t * 20) % 2 === 0;
    p.visible = !flick;
    this.updateShadow();
  }

  updateShadow() {
    const g = this.game.dungeon ? this.game.dungeon.maxHeightUnder(this.x, this.z, 0.2) : 0;
    this.shadow.position.set(this.x, g + 0.03, this.z);
    const ss = clamp(1 - (this.y - g) * 0.12, 0.4, 1);
    this.shadow.scale.set(ss, ss, ss);
  }

  // Swing ribbons along each weapon blade.
  updateTrails(dt) {
    const model = this.model;
    if (!model.tips.length || !this.game.scene) return;
    if (!this.trails) {
      this.trails = model.tips.map(() => new Trail(this.game.scene, 0xffffff));
      this._ta = new THREE.Vector3();
      this._tb = new THREE.Vector3();
    }
    const a = this.action;
    const swinging = !!(this.attack && !this.attack.c.ranged && this.attack.t > this.attack.dur * this.attack.c.hitAt * 0.45 && this.attack.t < this.attack.dur * 0.9) || !!(a && ['spin', 'flurry', 'lunge', 'leap', 'slamLand', 'overhead', 'stab', 'cleave', 'slamcast'].includes(a.anim));
    const rarity = this.equipment.weapon ? this.equipment.weapon.rarity : null;
    const col = this.cls.weapon === 'staff' ? 0xb58cff : rarity && rarity.tier >= 1 ? rarity.hex : 0xdfe8ff;
    model.tips.forEach((tip, i) => {
      const tr = this.trails[i];
      if (!tr) return;
      tr.setColor(col);
      model.tipOf(tip, this._ta, 0.1);
      model.tipOf(tip, this._tb, 1);
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
    for (const e of this.game.enemies || []) {
      if (!e.alive || !e.aggro) continue;
      const d = (e.x - this.x) ** 2 + (e.z - this.z) ** 2;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
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
