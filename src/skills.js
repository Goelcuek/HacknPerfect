// Skill definitions. Every class has a pool of six; the player owns up to four
// (one per swipe direction) and levels them from 1 to 5 between floors.
//
// cast(p, lv, ctx) uses the player/game primitives:
//   p.aimAt(ctx, range, cone)  -> target or null, turns the player
//   p.act({...})               -> occupy the player with an animated action
//   p.addBuff / p.shieldUp / p.teleport / p.rollDamage
//   g.hitEnemiesInRadius / g.hitCone / g.shoot / g.zone / g.schedule / g.lightning

import { sfx } from './audio.js';

export const MAX_SKILL_LEVEL = 5;
const S = (base, per, lv) => base + per * (lv - 1);
const pct = (v) => `${Math.round(v * 100)}%`;
const sec = (v) => `${+v.toFixed(1)}s`;

export const SKILLS = {
  // =================================================================== KNIGHT
  slam: {
    name: 'Leap Slam',
    icon: '🔨',
    cd: (lv) => 7 - 0.4 * (lv - 1),
    desc: (lv) => `Leap onto a foe and smash the ground for ${pct(S(3, 0.55, lv))} damage in a ${S(3.4, 0.3, lv).toFixed(1)}m radius.${lv >= 3 ? ` Stuns for ${sec(0.6 + 0.2 * lv)}.` : ''}`,
    cast(p, lv, ctx) {
      p.leapSlam(ctx, { dmg: S(3, 0.55, lv), radius: S(3.4, 0.3, lv), stun: lv >= 3 ? 0.6 + 0.2 * lv : 0 });
    },
  },
  whirl: {
    name: 'Whirlwind',
    icon: '🌀',
    cd: (lv) => 9 - 0.4 * (lv - 1),
    desc: (lv) => `Spin for ${sec(S(1.2, 0.3, lv))}, hitting everything around you for ${pct(S(0.72, 0.14, lv))} five times a second.${lv >= 3 ? ' Pulls enemies in.' : ''}${lv >= 5 ? ' Move at full speed.' : ''}`,
    cast(p, lv) {
      const R = 2.9 * p.mods.reach;
      p.act({
        anim: 'spin',
        dur: S(1.2, 0.3, lv),
        move: lv >= 5 ? 1 : 0.75,
        tick: 0,
        update(dt, a) {
          a.tick -= dt;
          if (a.tick > 0) return;
          a.tick = 0.2;
          sfx.swing();
          const g = p.game;
          g.effects.slash(p.x, p.y + 0.9, p.z, p.heading + a.t * 20, R, 0x9be7ff, Math.PI * 1.99);
          g.hitEnemiesInRadius(p.x, p.z, R, (e) => {
            if (Math.abs(e.y - p.y) > 2) return null;
            if (lv >= 3) {
              const dx = p.x - e.x;
              const dz = p.z - e.z;
              const d = Math.hypot(dx, dz) || 1;
              e.kx += (dx / d) * 6;
              e.kz += (dz / d) * 6;
            }
            return { ...p.rollDamage(S(0.72, 0.14, lv), true), knock: lv >= 3 ? 0 : 2 };
          });
        },
      });
    },
  },
  charge: {
    name: 'Shield Charge',
    icon: '🐗',
    cd: (lv) => 7 - 0.4 * (lv - 1),
    desc: (lv) => `Rush ${S(7, 1, lv)}m behind your shield, dealing ${pct(S(1.6, 0.3, lv))} damage and stunning foes for ${sec(S(0.8, 0.2, lv))}.`,
    cast(p, lv, ctx) {
      p.aimAt(ctx, 9, 0.6);
      const dist = S(7, 1, lv);
      const speed = 26;
      const hx = Math.sin(p.heading);
      const hz = Math.cos(p.heading);
      const hitSet = new Set();
      sfx.dash();
      p.act({
        anim: 'charge',
        dur: dist / speed,
        invuln: dist / speed + 0.1,
        vel: { x: hx * speed, z: hz * speed },
        update() {
          const g = p.game;
          g.effects.puff(p.x, p.y + 0.4, p.z, 0xcfd8e8, 0.4, 0.3);
          g.hitEnemiesInRadius(p.x, p.z, 1.6, (e) => {
            if (hitSet.has(e)) return null;
            hitSet.add(e);
            e.status({ stun: S(0.8, 0.2, lv) });
            // shove sideways out of the path
            const side = (e.x - p.x) * hz - (e.z - p.z) * hx > 0 ? 1 : -1;
            e.kx += hz * side * 8 + hx * 5;
            e.kz += -hx * side * 8 + hz * 5;
            g.effects.shake(0.2);
            return { ...p.rollDamage(S(1.9, 0.35, lv), true), knock: 0 };
          });
        },
      });
    },
  },
  warcry: {
    name: 'War Cry',
    icon: '📯',
    cd: (lv) => 15 - 0.5 * (lv - 1),
    desc: (lv) => `Roar: +${pct(S(0.25, 0.1, lv))} damage and +${S(10, 5, lv)} armor for ${sec(S(6, 1, lv))}. Knocks nearby enemies back.`,
    cast(p, lv) {
      const g = p.game;
      p.addBuff('warcry', S(6, 1, lv), { dmg: S(0.25, 0.1, lv), armor: S(10, 5, lv) }, 0xff5a3a);
      g.effects.ring(p.x, p.z, 5, 0xff7a4a, 0.5, p.y + 0.1);
      g.effects.ring(p.x, p.z, 3, 0xffd27f, 0.4, p.y + 0.15);
      g.effects.shake(0.3);
      sfx.slam();
      g.hitEnemiesInRadius(p.x, p.z, 4.5, () => ({ amount: 1, crit: false, knock: 9, silent: true }));
      p.act({ anim: 'roar', dur: 0.5 });
    },
  },
  aegis: {
    name: 'Holy Aegis',
    icon: '✨',
    cd: (lv) => 16 - 1 * (lv - 1),
    desc: (lv) => `Gain a shield absorbing ${pct(S(0.2, 0.06, lv))} of max health for 6s. When it ends it bursts for ${pct(S(2, 0.4, lv))} damage.`,
    cast(p, lv) {
      const g = p.game;
      sfx.heal();
      p.shieldUp(p.final.maxHp * S(0.2, 0.06, lv), 6, () => {
        g.effects.ring(p.x, p.z, 4, 0xfff0a0, 0.45, p.y + 0.1);
        g.effects.burst(p.x, p.y + 1, p.z, 0xfff0a0, 20, 7, 0.14, 0.6, 3);
        sfx.boom();
        g.hitEnemiesInRadius(p.x, p.z, 4, () => ({ ...p.rollDamage(S(2, 0.4, lv), true), knock: 7 }));
      });
      p.act({ anim: 'roar', dur: 0.35 });
    },
  },
  fissure: {
    name: 'Earthsplitter',
    icon: '⛰️',
    cd: (lv) => 9 - 0.5 * (lv - 1),
    desc: (lv) => `Split the ground ahead: ${S(3.8, 0.7, lv)} eruptions of ${pct(S(1.4, 0.25, lv))} damage that launch enemies.`,
    cast(p, lv, ctx) {
      p.aimAt(ctx, 10, 0.5);
      const g = p.game;
      const hx = Math.sin(p.heading);
      const hz = Math.cos(p.heading);
      const n = S(3.8, 0.7, lv);
      const ox = p.x;
      const oz = p.z;
      p.act({ anim: 'overhead', dur: 0.45 });
      for (let i = 0; i < n; i++) {
        g.schedule(0.18 + i * 0.07, () => {
          const x = ox + hx * (1.6 + i * 1.5);
          const z = oz + hz * (1.6 + i * 1.5);
          if (g.dungeon.groundBlocked(ox, oz, x, z)) return;
          g.effects.burst(x, 0.2, z, 0x8a7a60, 10, 7, 0.22, 0.6);
          g.effects.spikes(x, z, 0x7a6a50);
          g.effects.ring(x, z, 1.7, 0xffa060, 0.3);
          if (i % 2 === 0) sfx.slam();
          g.effects.shake(0.15);
          g.hitEnemiesInRadius(x, z, 1.7, () => ({ ...p.rollDamage(S(1.4, 0.25, lv), true), knock: 2, launch: 7 }));
        });
      }
    },
  },

  // =================================================================== RANGER
  multishot: {
    name: 'Multishot',
    icon: '🎯',
    cd: (lv) => 4.5 - 0.3 * (lv - 1),
    desc: (lv) => `Fire a fan of ${3 + 2 * lv} arrows, each dealing ${pct(S(0.8, 0.1, lv))} damage.`,
    cast(p, lv, ctx) {
      p.aimAt(ctx, 16, 0.8, true);
      const n = 3 + 2 * lv;
      p.act({ anim: 'shoot', dur: 0.28 });
      sfx.arrow();
      for (let i = 0; i < n; i++) {
        const off = (i - (n - 1) / 2) * (1.1 / (n - 1));
        p.game.shoot({ from: p, heading: p.heading + off, speed: 30, life: 0.7, kind: 'arrow', dmg: () => p.rollDamage(S(0.8, 0.1, lv), true), knock: 3, pierce: p.buffMod('pierce') ? 1 : 0 });
      }
    },
  },
  rain: {
    name: 'Arrow Rain',
    icon: '🌧️',
    cd: (lv) => 10 - 0.5 * (lv - 1),
    desc: (lv) => `Arrows pour on an area (${S(3.4, 0.3, lv).toFixed(1)}m) for 2s: 8 volleys of ${pct(S(0.5, 0.1, lv))} damage that slow enemies.`,
    cast(p, lv, ctx) {
      const t = p.aimAt(ctx, 16, 0.9, true);
      const g = p.game;
      const d = t ? Math.hypot(t.x - p.x, t.z - p.z) : 8;
      const x = p.x + Math.sin(p.heading) * d;
      const z = p.z + Math.cos(p.heading) * d;
      const R = S(3.4, 0.3, lv);
      p.act({ anim: 'skyshot', dur: 0.35 });
      sfx.arrow();
      g.zone({ x, z, r: R, life: 2.1, kind: 'rain', tick: 0.25, delay: 0.3, onTick: () => {
        sfx.arrow();
        for (let i = 0; i < 6; i++) g.effects.fallingArrow(x + (Math.random() - 0.5) * R * 1.6, z + (Math.random() - 0.5) * R * 1.6);
        g.hitEnemiesInRadius(x, z, R, (e) => {
          e.status({ slow: [1, 0.5] });
          return { ...p.rollDamage(S(0.5, 0.1, lv), true), knock: 0 };
        });
      } });
    },
  },
  pierce: {
    name: 'Piercing Shot',
    icon: '➶',
    cd: (lv) => 6 - 0.3 * (lv - 1),
    desc: (lv) => `A charged arrow that pierces every enemy in a line for ${pct(S(3, 0.6, lv))} damage.${lv >= 3 ? ' Slows targets.' : ''}`,
    cast(p, lv, ctx) {
      p.aimAt(ctx, 22, 0.5, true);
      p.act({
        anim: 'draw',
        dur: 0.38,
        move: 0.3,
        end() {
          sfx.arrow();
          sfx.dash();
          p.game.shoot({ from: p, heading: p.heading, speed: 44, life: 0.7, kind: 'bigarrow', radius: 0.8, pierce: 99, dmg: () => p.rollDamage(S(3, 0.6, lv), true), knock: 8, onHit: (e) => lv >= 3 && e.status({ slow: [2, 0.5] }) });
        },
      });
    },
  },
  vault: {
    name: 'Evasive Vault',
    icon: '🤸',
    cd: (lv) => 7 - 0.4 * (lv - 1),
    desc: (lv) => `Backflip out of danger, leaving a frost trap that freezes for ${sec(S(1.4, 0.3, lv))}.${lv >= 3 ? ' Fires 3 arrows mid-air.' : ''}`,
    cast(p, lv, ctx) {
      const g = p.game;
      const t = p.aimAt(ctx, 14, 3.2, true);
      const back = p.heading + Math.PI;
      const ox = p.x;
      const oz = p.z;
      p.vy = 9;
      p.grounded = false;
      sfx.jump();
      p.act({ anim: 'flip', invuln: 0.6, untilLand: true, dur: 2, vel: { x: Math.sin(back) * 10, z: Math.cos(back) * 10 }, fired: false,
        update(dt, a) {
          if (lv >= 3 && !a.fired && a.t > 0.2) {
            a.fired = true;
            const tt = t && t.alive ? t : g.findTarget(p.x, p.z, p.heading, 16, 1.2);
            const h = tt ? Math.atan2(tt.x - p.x, tt.z - p.z) : p.heading;
            for (let i = -1; i <= 1; i++) g.shoot({ from: p, heading: h + i * 0.12, speed: 30, life: 0.7, kind: 'arrow', dmg: () => p.rollDamage(0.9, true), knock: 3 });
            sfx.arrow();
          }
        } });
      g.zone({ x: ox, z: oz, r: 2.6, life: 0.4, kind: 'frost', onStart: () => {
        g.effects.ring(ox, oz, 2.6, 0x9fe3ff, 0.45);
        g.effects.burst(ox, 0.3, oz, 0xcff4ff, 16, 6, 0.15, 0.5, 5);
        sfx.frost();
        g.hitEnemiesInRadius(ox, oz, 2.6, (e) => {
          e.status({ freeze: S(1.4, 0.3, lv) });
          return { ...p.rollDamage(0.6, true), knock: 0 };
        });
      } });
    },
  },
  trap: {
    name: 'Blast Trap',
    icon: '💣',
    cd: (lv) => 8 - 0.4 * (lv - 1),
    desc: (lv) => `Toss a trap that explodes when an enemy steps on it, dealing ${pct(S(3, 0.6, lv))} damage in ${S(3.2, 0.3, lv).toFixed(1)}m.${lv >= 4 ? ' Throws two.' : ''}`,
    cast(p, lv, ctx) {
      const g = p.game;
      p.aimAt(ctx, 10, 0.8, true);
      p.act({ anim: 'throw', dur: 0.3 });
      const n = lv >= 4 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const h = p.heading + (n > 1 ? (i - 0.5) * 0.6 : 0);
        let x = p.x + Math.sin(h) * 4.5;
        let z = p.z + Math.cos(h) * 4.5;
        if (g.dungeon.groundBlocked(p.x, p.z, x, z)) {
          x = p.x;
          z = p.z;
        }
        g.zone({ x, z, r: 1.6, life: 20, kind: 'trap', arm: 0.5, onEnter: (zone) => {
          const R = S(3.2, 0.3, lv);
          g.effects.ring(zone.x, zone.z, R, 0xff9a3d, 0.4);
          g.effects.burst(zone.x, 0.4, zone.z, 0xff7a2e, 24, 8, 0.2, 0.6, 5);
          g.effects.shake(0.4);
          sfx.boom();
          g.hitEnemiesInRadius(zone.x, zone.z, R, () => ({ ...p.rollDamage(S(3, 0.6, lv), true), knock: 8, launch: 5 }));
          return true; // consumed
        } });
      }
    },
  },
  focus: {
    name: "Hunter's Focus",
    icon: '🦅',
    cd: (lv) => 16 - 0.6 * (lv - 1),
    desc: (lv) => `For ${sec(S(6, 1, lv))}: +${pct(S(0.35, 0.1, lv))} attack speed, +${pct(S(0.1, 0.05, lv))} crit, and arrows pierce.`,
    cast(p, lv) {
      p.addBuff('focus', S(6, 1, lv), { as: S(0.35, 0.1, lv), crit: S(0.1, 0.05, lv), pierce: 1 }, 0x8dff9c);
      p.game.effects.ring(p.x, p.z, 2.5, 0x8dff9c, 0.4, p.y + 0.1);
      sfx.pickup();
      p.act({ anim: 'roar', dur: 0.3 });
    },
  },

  // ===================================================================== MAGE
  firebolt: {
    name: 'Fire Bolt',
    icon: '🔥',
    cd: (lv) => 3.4 - 0.1 * (lv - 1),
    desc: (lv) => `Hurl ${lv >= 5 ? 5 : lv >= 3 ? 3 : 1} homing fireball${lv >= 3 ? 's' : ''} that explode for ${pct(S(1.9, 0.3, lv))} damage and burn.`,
    cast(p, lv, ctx) {
      const t = p.aimAt(ctx, 18, 0.9, true);
      const n = lv >= 5 ? 5 : lv >= 3 ? 3 : 1;
      p.act({ anim: 'cast', dur: 0.22 });
      sfx.fire();
      for (let i = 0; i < n; i++) {
        const off = n === 1 ? 0 : (i - (n - 1) / 2) * 0.22;
        p.game.shoot({ from: p, heading: p.heading + off, speed: 22, life: 1.4, kind: 'fire', homing: t, explode: 2.4, dmg: () => p.rollDamage(S(1.9, 0.3, lv), true), knock: 5, onHit: (e) => e.status({ burn: [1.8, p.final.damage * 0.2 * p.final.skillMult] }) });
      }
    },
  },
  nova: {
    name: 'Frost Nova',
    icon: '❄',
    cd: (lv) => 10 - 0.5 * (lv - 1),
    desc: (lv) => `Blast frost in ${S(5.5, 0.4, lv).toFixed(1)}m for ${pct(S(0.95, 0.18, lv))} damage, freezing enemies for ${sec(S(2, 0.4, lv))}.`,
    cast(p, lv) {
      const g = p.game;
      const R = S(5.5, 0.4, lv);
      g.effects.ring(p.x, p.z, R, 0x9fe3ff, 0.45, p.y + 0.1);
      g.effects.ring(p.x, p.z, R * 0.7, 0xffffff, 0.35, p.y + 0.15);
      g.effects.burst(p.x, p.y + 0.5, p.z, 0xcff4ff, 30, 9, 0.18, 0.6, 6);
      g.effects.iceShards(p.x, p.z, R);
      sfx.frost();
      g.hitEnemiesInRadius(p.x, p.z, R, (e) => {
        e.status({ freeze: S(2, 0.4, lv) });
        return { ...p.rollDamage(S(0.95, 0.18, lv), true), knock: 3 };
      });
      p.act({ anim: 'slamcast', dur: 0.3 });
    },
  },
  chain: {
    name: 'Chain Lightning',
    icon: '⚡',
    cd: (lv) => 4.5 - 0.25 * (lv - 1),
    desc: (lv) => `Lightning strikes a foe and jumps to ${2 + lv} more, dealing ${pct(S(1.6, 0.3, lv))} damage each.`,
    cast(p, lv, ctx) {
      const g = p.game;
      const first = p.aimAt(ctx, 14, 1.0, true);
      p.act({ anim: 'cast', dur: 0.25 });
      sfx.frost();
      const pts = [[p.x + Math.sin(p.heading) * 0.6, p.y + 1.4, p.z + Math.cos(p.heading) * 0.6]];
      if (!first) {
        pts.push([p.x + Math.sin(p.heading) * 8, 1.2, p.z + Math.cos(p.heading) * 8]);
        g.lightning(pts, 0xaad4ff);
        return;
      }
      const hit = new Set();
      let cur = first;
      for (let i = 0; i < 3 + lv && cur; i++) {
        hit.add(cur);
        pts.push([cur.x, cur.y + cur.height * 0.6, cur.z]);
        g.damageEnemy(cur, { ...p.rollDamage(S(1.15, 0.22, lv), true), knock: 2 }, p.x, p.z);
        cur.status({ stun: 0.25 });
        let next = null;
        let bd = 7;
        for (const e of g.enemies) {
          if (!e.alive || hit.has(e)) continue;
          const d = Math.hypot(e.x - cur.x, e.z - cur.z);
          if (d < bd) {
            bd = d;
            next = e;
          }
        }
        cur = next;
      }
      g.lightning(pts, 0xaad4ff);
    },
  },
  meteor: {
    name: 'Meteor',
    icon: '☄️',
    cd: (lv) => 12 - 0.6 * (lv - 1),
    desc: (lv) => `Call a meteor that lands after 0.9s for ${pct(S(3.8, 0.7, lv))} damage in ${S(4, 0.3, lv).toFixed(1)}m.${lv >= 3 ? ' Leaves burning ground.' : ''}`,
    cast(p, lv, ctx) {
      const g = p.game;
      const t = p.aimAt(ctx, 16, 0.9, true);
      const d = t ? Math.hypot(t.x - p.x, t.z - p.z) : 7;
      const x = p.x + Math.sin(p.heading) * d;
      const z = p.z + Math.cos(p.heading) * d;
      const R = S(4, 0.3, lv);
      p.act({ anim: 'skycast', dur: 0.4 });
      g.effects.telegraph(x, z, R, 0.9, 0xff7a2e);
      g.effects.meteor(x, z, 0.9);
      sfx.fire();
      g.schedule(0.9, () => {
        g.effects.ring(x, z, R, 0xff9a3d, 0.5);
        g.effects.ring(x, z, R * 0.6, 0xffffff, 0.35);
        g.effects.burst(x, 0.5, z, 0xff7a2e, 40, 12, 0.25, 0.8, 8);
        g.effects.burst(x, 0.5, z, 0x5a4a3a, 20, 8, 0.25, 0.8);
        g.effects.shake(0.8);
        g.hitStop(0.05);
        sfx.boom();
        g.hitEnemiesInRadius(x, z, R, (e) => {
          e.status({ burn: [2.5, p.final.damage * 0.3 * p.final.skillMult] });
          return { ...p.rollDamage(S(3.8, 0.7, lv), true), knock: 10, launch: 8 };
        });
        if (lv >= 3) for (let i = 0; i < 6; i++) g.spawnFirePatch(x + (Math.random() - 0.5) * R, z + (Math.random() - 0.5) * R);
      });
    },
  },
  blink: {
    name: 'Blink',
    icon: '💫',
    cd: (lv) => 6 - 0.6 * (lv - 1),
    desc: (lv) => `Teleport ${S(7, 0.5, lv)}m, releasing arcane bursts of ${pct(S(1.2, 0.3, lv))} damage at both ends that slow foes.`,
    cast(p, lv, ctx) {
      const g = p.game;
      const h = ctx.wish ?? ctx.camYaw;
      p.heading = h;
      const burst = (x, z) => {
        g.effects.ring(x, z, 2.6, 0xd08dff, 0.35, p.y + 0.1);
        g.effects.burst(x, p.y + 1, z, 0xd08dff, 16, 6, 0.14, 0.45, 3);
        g.hitEnemiesInRadius(x, z, 2.6, (e) => {
          e.status({ slow: [2, 0.5] });
          return { ...p.rollDamage(S(1.2, 0.3, lv), true), knock: 5 };
        });
      };
      burst(p.x, p.z);
      p.teleport(Math.sin(h), Math.cos(h), S(7, 0.5, lv));
      burst(p.x, p.z);
      p.invuln = Math.max(p.invuln, 0.35);
      sfx.portal();
      p.act({ anim: 'cast', dur: 0.15 });
    },
  },
  orb: {
    name: 'Arcane Orb',
    icon: '🔮',
    cd: (lv) => 7 - 0.4 * (lv - 1),
    desc: (lv) => `Launch a slow orb that grinds through enemies (${pct(S(0.7, 0.12, lv))} per tick) and bursts for ${pct(S(2, 0.4, lv))} at the end.`,
    cast(p, lv, ctx) {
      p.aimAt(ctx, 16, 0.6, true);
      p.act({ anim: 'cast', dur: 0.3 });
      sfx.portal();
      p.game.shoot({ from: p, heading: p.heading, speed: 7, life: 2.6, kind: 'orb', radius: S(1.5, 0.15, lv), pierce: 999, tickDmg: () => p.rollDamage(S(0.7, 0.12, lv), true), explode: 3, dmg: () => p.rollDamage(S(2, 0.4, lv), true), knock: 4, explodeAtEnd: true });
    },
  },

  // ==================================================================== ROGUE
  shadowstep: {
    name: 'Shadow Step',
    icon: '👤',
    cd: (lv) => 6 - 0.4 * (lv - 1),
    desc: (lv) => `Vanish and reappear behind a foe, striking for ${pct(S(2.4, 0.5, lv))} damage as a guaranteed critical hit.`,
    cast(p, lv, ctx) {
      const g = p.game;
      const t = p.aimAt(ctx, 13, 1.4);
      g.effects.burst(p.x, p.y + 1, p.z, 0x6a4a8a, 14, 4, 0.2, 0.5, 1);
      if (t) {
        const h = Math.atan2(t.x - p.x, t.z - p.z);
        const d = Math.hypot(t.x - p.x, t.z - p.z);
        p.teleport(Math.sin(h), Math.cos(h), d + t.radius + 0.9);
        p.heading = Math.atan2(t.x - p.x, t.z - p.z);
        g.damageEnemy(t, { ...p.rollDamage(S(2.4, 0.5, lv), true, true), knock: 4 }, p.x, p.z);
        t.status({ stun: 0.5 });
      } else {
        p.teleport(Math.sin(p.heading), Math.cos(p.heading), 6);
      }
      g.effects.burst(p.x, p.y + 1, p.z, 0x6a4a8a, 14, 4, 0.2, 0.5, 1);
      p.invuln = Math.max(p.invuln, 0.3);
      sfx.dash();
      p.act({ anim: 'stab', dur: 0.25 });
    },
  },
  fan: {
    name: 'Fan of Knives',
    icon: '✴️',
    cd: (lv) => 6 - 0.3 * (lv - 1),
    desc: (lv) => `Throw ${10 + 2 * lv} knives in every direction for ${pct(S(0.8, 0.15, lv))} damage each.${lv >= 3 ? ' Knives poison.' : ''}`,
    cast(p, lv) {
      const n = 10 + 2 * lv;
      sfx.swing();
      p.act({ anim: 'spin', dur: 0.3 });
      for (let i = 0; i < n; i++) {
        p.game.shoot({ from: p, heading: (i / n) * Math.PI * 2, speed: 22, life: 0.55, kind: 'knife', dmg: () => p.rollDamage(S(0.8, 0.15, lv), true), knock: 3, onHit: (e) => lv >= 3 && e.status({ poison: [3, p.final.damage * 0.25] }) });
      }
    },
  },
  poison: {
    name: 'Venom Cloud',
    icon: '☠️',
    cd: (lv) => 10 - 0.5 * (lv - 1),
    desc: (lv) => `Toss a venom flask: a ${S(3, 0.3, lv).toFixed(1)}m cloud for 5s poisons (${pct(S(0.35, 0.08, lv))} per tick) and slows enemies.`,
    cast(p, lv, ctx) {
      const g = p.game;
      const t = p.aimAt(ctx, 12, 0.9, true);
      const d = t ? Math.min(9, Math.hypot(t.x - p.x, t.z - p.z)) : 5;
      const x = p.x + Math.sin(p.heading) * d;
      const z = p.z + Math.cos(p.heading) * d;
      const R = S(3, 0.3, lv);
      p.act({ anim: 'throw', dur: 0.3 });
      g.zone({ x, z, r: R, life: 5, kind: 'poison', tick: 0.4, delay: 0.25, onStart: () => sfx.boom(), onTick: () => {
        g.hitEnemiesInRadius(x, z, R, (e) => {
          e.status({ slow: [0.6, 0.4] });
          return { ...p.rollDamage(S(0.35, 0.08, lv), true), knock: 0, silent: true, dot: 'poison' };
        });
      } });
    },
  },
  flurry: {
    name: 'Blade Flurry',
    icon: '🌪️',
    cd: (lv) => 7 - 0.4 * (lv - 1),
    desc: (lv) => `Unleash ${sec(S(0.9, 0.2, lv))} of rapid stabs in front of you, ${pct(S(0.4, 0.07, lv))} damage each.`,
    cast(p, lv, ctx) {
      p.aimAt(ctx, 4, 1.2);
      p.act({
        anim: 'flurry',
        dur: S(0.9, 0.2, lv),
        move: 0.55,
        tick: 0,
        update(dt, a) {
          a.tick -= dt;
          if (a.tick > 0) return;
          a.tick = 0.1;
          const g = p.game;
          const t = g.findTarget(p.x, p.z, p.heading, 3.5, 1.3);
          if (t) p.heading += Math.max(-0.3, Math.min(0.3, Math.atan2(t.x - p.x, t.z - p.z) - p.heading));
          g.effects.slash(p.x, p.y + 1, p.z, p.heading + (Math.random() - 0.5) * 0.8, 2.4, 0xff8a8a, 1.2, (Math.random() - 0.5) * 1.5);
          if (Math.random() < 0.5) sfx.swing();
          g.hitCone(p.x, p.z, p.heading, 2.8 * p.mods.reach, 2.2, () => ({ ...p.rollDamage(S(0.4, 0.07, lv), true), knock: 1 }));
        },
      });
    },
  },
  smoke: {
    name: 'Smoke Bomb',
    icon: '💨',
    cd: (lv) => 14 - 0.6 * (lv - 1),
    desc: (lv) => `Burst of smoke: nearby enemies are dazed for ${sec(S(2, 0.4, lv))}; you become untouchable for 1s and gain +40% speed for 3s.`,
    cast(p, lv) {
      const g = p.game;
      p.invuln = Math.max(p.invuln, 1);
      p.addBuff('smoke', 3, { ms: 0.4 }, 0x9a9aaa);
      for (let i = 0; i < 30; i++) g.effects.smoke(p.x + (Math.random() - 0.5) * 5, p.z + (Math.random() - 0.5) * 5);
      sfx.dash();
      g.hitEnemiesInRadius(p.x, p.z, 4.5, (e) => {
        e.status({ blind: S(2, 0.4, lv) });
        return null;
      });
      p.act({ anim: 'throwdown', dur: 0.25 });
    },
  },
  assassinate: {
    name: 'Assassinate',
    icon: '🩸',
    cd: (lv) => 10 - 0.5 * (lv - 1),
    desc: (lv) => `Dash through a target for ${pct(S(3.5, 0.7, lv))} damage (always crits below 50% health). Executes regular enemies under ${Math.round(S(15, 5, lv))}% health.`,
    cast(p, lv, ctx) {
      const g = p.game;
      const t = p.aimAt(ctx, 10, 1.0);
      const dist = t ? Math.hypot(t.x - p.x, t.z - p.z) + 2 : 7;
      const speed = 34;
      const hx = Math.sin(p.heading);
      const hz = Math.cos(p.heading);
      const hitSet = new Set();
      sfx.dash();
      p.act({
        anim: 'lunge',
        dur: Math.min(0.4, dist / speed),
        invuln: 0.5,
        vel: { x: hx * speed, z: hz * speed },
        update() {
          g.effects.puff(p.x, p.y + 1, p.z, 0x8a2a3a, 0.35, 0.3);
          g.hitEnemiesInRadius(p.x, p.z, 1.5, (e) => {
            if (hitSet.has(e)) return null;
            hitSet.add(e);
            const low = e.hp < e.maxHp * 0.5;
            if (!e.def.boss && e.hp < e.maxHp * S(0.15, 0.05, lv)) {
              g.effects.burst(e.x, e.y + 1, e.z, 0xff2a3a, 20, 6, 0.15, 0.5);
              return { amount: e.hp + 1, crit: true, knock: 6 };
            }
            g.hitStop(0.05);
            return { ...p.rollDamage(S(3.5, 0.7, lv), true, low), knock: 6 };
          });
        },
      });
    },
  },

  // ================================================================ BARBARIAN
  cleave: {
    name: 'Cleave',
    icon: '🪓',
    cd: (lv) => 5 - 0.3 * (lv - 1),
    desc: (lv) => `A huge sweeping blow: ${pct(S(2.5, 0.45, lv))} damage in a wide arc.${lv >= 3 ? ' Enemies bleed for 40% more over 3s.' : ''}${lv >= 5 ? ' Always crits wounded foes.' : ''}`,
    cast(p, lv, ctx) {
      p.aimAt(ctx, 4.5, 1.2);
      const g = p.game;
      p.act({ anim: 'cleave', dur: 0.45, move: 0.2 });
      g.schedule(0.2, () => {
        const R = 4 * p.mods.reach;
        g.effects.slash(p.x, p.y + 1.0, p.z, p.heading, R, 0xff5a3a, 4.2, 0);
        g.effects.shake(0.3);
        sfx.slam();
        g.hitCone(p.x, p.z, p.heading, R, 4.2, (e) => {
          const hit = p.rollDamage(S(2.5, 0.45, lv), true, lv >= 5 && e.hp < e.maxHp * 0.5);
          if (lv >= 3) e.status({ bleed: [3, (hit.amount * 0.4) / 8] });
          return { ...hit, knock: 6 };
        });
      });
    },
  },
  axethrow: {
    name: 'Axe Throw',
    icon: '🪃',
    cd: (lv) => 6 - 0.4 * (lv - 1),
    desc: (lv) => `Hurl a spinning axe that cuts through everything for ${pct(S(1.5, 0.3, lv))} damage, then flies back to you.${lv >= 3 ? ' Cuts again on the way back.' : ''}${lv >= 5 ? ' Throws two.' : ''}`,
    cast(p, lv, ctx) {
      p.aimAt(ctx, 14, 0.5, true);
      const g = p.game;
      p.act({ anim: 'throw', dur: 0.35, move: 0.5 });
      g.schedule(0.15, () => {
        sfx.swing();
        const n = lv >= 5 ? 2 : 1;
        for (let k = 0; k < n; k++)
          g.shoot({ from: p, heading: p.heading + (n > 1 ? (k - 0.5) * 0.3 : 0), speed: 18, life: 1.3, kind: 'axe', radius: 0.8, pierce: 99, boomerang: true, rehit: lv >= 3, dmg: () => p.rollDamage(S(1.5, 0.3, lv), true), knock: 4 });
      });
    },
  },
  stomp: {
    name: 'Earthshaker',
    icon: '🦶',
    cd: (lv) => 8 - 0.4 * (lv - 1),
    desc: (lv) => `Stomp the ground: ${pct(S(1.6, 0.3, lv))} damage in ${S(4, 0.4, lv).toFixed(1)}m, tossing enemies up and stunning them for ${sec(S(0.8, 0.2, lv))}.`,
    cast(p, lv) {
      const g = p.game;
      p.act({ anim: 'slamcast', dur: 0.5, move: 0 });
      g.schedule(0.25, () => quake(p, p.x, p.z, S(4, 0.4, lv), S(1.6, 0.3, lv), S(0.8, 0.2, lv)));
    },
  },
  berserk: {
    name: 'Berserk',
    icon: '😡',
    cd: (lv) => 16 - 0.6 * (lv - 1),
    desc: (lv) => `Fly into a rage for ${sec(S(6, 0.75, lv))}: +${pct(S(0.35, 0.08, lv))} attack speed, +${pct(S(0.15, 0.05, lv))} damage and ${pct(S(0.04, 0.01, lv))} life steal.`,
    cast(p, lv) {
      const g = p.game;
      p.addBuff('berserk', S(6, 0.75, lv), { as: S(0.35, 0.08, lv), dmg: S(0.15, 0.05, lv), ls: S(0.04, 0.01, lv), size: 0.1 }, 0xff3030);
      g.effects.ring(p.x, p.z, 4, 0xff3030, 0.5, p.y + 0.1);
      g.effects.burst(p.x, p.y + 1.2, p.z, 0xff3030, 20, 6, 0.15, 0.6);
      g.effects.shake(0.3);
      sfx.slam();
      p.act({ anim: 'roar', dur: 0.55 });
    },
  },
  hook: {
    name: 'Chain Hook',
    icon: '🪝',
    cd: (lv) => 9 - 0.5 * (lv - 1),
    desc: (lv) => `Lash out with chains: drag every enemy in a ${S(9, 1, lv)}m cone to you for ${pct(S(0.8, 0.2, lv))} damage, stunning them for ${sec(S(0.6, 0.15, lv))}.`,
    cast(p, lv, ctx) {
      p.aimAt(ctx, 10, 0.7);
      const g = p.game;
      p.act({ anim: 'throw', dur: 0.4, move: 0 });
      g.schedule(0.18, () => {
        sfx.swing();
        g.hitCone(p.x, p.z, p.heading, S(9, 1, lv), 1.3, (e) => {
          hookIn(p, e);
          e.status({ stun: S(0.6, 0.15, lv) });
          return { ...p.rollDamage(S(0.8, 0.2, lv), true), knock: 0 };
        });
      });
    },
  },
  totem: {
    name: 'War Totem',
    icon: '🗿',
    cd: (lv) => 18 - 0.8 * (lv - 1),
    desc: (lv) => `Plant a war totem for ${sec(S(6, 1, lv))}: inside its ${S(4, 0.3, lv).toFixed(1)}m circle you heal ${pct(S(0.02, 0.005, lv))} of max health per second and enemies take ${pct(S(0.4, 0.1, lv))} damage every second.`,
    cast(p, lv) {
      p.act({ anim: 'slamcast', dur: 0.45 });
      warTotem(p, S(4, 0.3, lv), S(6, 1, lv), S(0.02, 0.005, lv), S(0.4, 0.1, lv), false);
    },
  },
};

// Class skill pools are listed in classes.js; this attaches the id to each def.
for (const id in SKILLS) SKILLS[id].id = id;

// ================================================================ EVOLUTIONS
// A level-5 skill can evolve once (level 6): a new name, far more power and
// new effects. skillDef(id, level) returns whichever form applies.
export const EVO_LEVEL = MAX_SKILL_LEVEL + 1;

export function skillDef(id, level = 1) {
  const base = SKILLS[id];
  return level >= EVO_LEVEL && base.evo ? base.evo : base;
}

const evo = (id, o) => {
  SKILLS[id].evo = { ...o, id, evolved: true, base: id };
};

// helpers
const nearest = (g, x, z, range, skip) => {
  let best = null;
  let bd = range;
  for (const e of g.enemies) {
    if (!e.alive || (skip && skip.has(e))) continue;
    const d = Math.hypot(e.x - x, e.z - z);
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  return best;
};

// ------------------------------------------------------------------ KNIGHT
evo('slam', {
  name: 'Cataclysm',
  icon: '🌋',
  cd: () => 6,
  desc: () => 'Crash down for 500% damage in 5.5m, stunning for 2s, then send out two more quake rings and leave the ground burning.',
  cast(p, lv, ctx) {
    const g = p.game;
    p.leapSlam(ctx, {
      dmg: 5,
      radius: 5.5,
      stun: 2,
      onLand: (x, z) => {
        g.effects.shake(0.9);
        for (let i = 0; i < 8; i++) g.spawnFirePatch(x + Math.cos(i * 0.8) * 3, z + Math.sin(i * 0.8) * 3);
        [7.5, 10].forEach((R, i) =>
          g.schedule(0.2 + i * 0.22, () => {
            g.effects.ring(x, z, R, 0xff7a2e, 0.45);
            g.effects.spikes(x, z, 0x6a5040, R * 0.6);
            sfx.slam();
            g.hitEnemiesInRadius(x, z, R, () => ({ ...p.rollDamage(2, true), knock: 8, launch: 5 }));
          }),
        );
      },
    });
  },
});

evo('whirl', {
  name: 'Blade Tempest',
  icon: '🌪️',
  cd: () => 8,
  desc: () => 'A 4s storm of steel at full speed: 90% damage nine times a second, pulls enemies in and flings spectral blades outward.',
  cast(p) {
    const g = p.game;
    const R = 3.4 * p.mods.reach;
    p.act({
      anim: 'spin',
      dur: 4,
      move: 1,
      tick: 0,
      volley: 0,
      update(dt, a) {
        a.tick -= dt;
        a.volley -= dt;
        if (Math.random() < 0.6) g.effects.puff(p.x + (Math.random() - 0.5) * R, p.y + 0.8, p.z + (Math.random() - 0.5) * R, 0x9be7ff, 0.25, 0.3);
        if (a.volley <= 0) {
          a.volley = 0.5;
          for (let i = 0; i < 8; i++) g.shoot({ from: p, heading: a.t * 3 + (i / 8) * Math.PI * 2, speed: 18, life: 0.5, kind: 'knife', dmg: () => p.rollDamage(0.8, true), knock: 3, pierce: 2 });
        }
        if (a.tick > 0) return;
        a.tick = 0.11;
        sfx.swing();
        g.effects.slash(p.x, p.y + 0.9, p.z, p.heading + a.t * 20, R, 0x9be7ff, Math.PI * 1.99);
        g.hitEnemiesInRadius(p.x, p.z, R, (e) => {
          const dx = p.x - e.x;
          const dz = p.z - e.z;
          const d = Math.hypot(dx, dz) || 1;
          e.kx += (dx / d) * 5;
          e.kz += (dz / d) * 5;
          return { ...p.rollDamage(0.9, true), knock: 0 };
        });
      },
    });
  },
});

evo('charge', {
  name: 'Juggernaut',
  icon: '🦏',
  cd: () => 6,
  desc: () => 'An unstoppable 16m rampage: 300% damage, 2.5s stun, a trail of erupting stone and a 5m shockwave where you stop.',
  cast(p, lv, ctx) {
    const g = p.game;
    p.aimAt(ctx, 12, 0.6);
    const speed = 30;
    const dur = 16 / speed;
    const hx = Math.sin(p.heading);
    const hz = Math.cos(p.heading);
    const hit = new Set();
    sfx.dash();
    p.act({
      anim: 'charge',
      dur,
      invuln: dur + 0.2,
      vel: { x: hx * speed, z: hz * speed },
      spike: 0,
      update(dt, a) {
        a.spike -= dt;
        if (a.spike <= 0) {
          a.spike = 0.08;
          g.effects.spikes(p.x - hx, p.z - hz, 0x7a6a50, 0.8);
        }
        g.hitEnemiesInRadius(p.x, p.z, 2, (e) => {
          if (hit.has(e)) return null;
          hit.add(e);
          e.status({ stun: 2.5 });
          const side = (e.x - p.x) * hz - (e.z - p.z) * hx > 0 ? 1 : -1;
          e.kx += hz * side * 10 + hx * 6;
          e.kz += -hx * side * 10 + hz * 6;
          return { ...p.rollDamage(3, true), knock: 0, launch: 6 };
        });
      },
      end() {
        g.effects.ring(p.x, p.z, 5, 0xffd27f, 0.45);
        g.effects.spikes(p.x, p.z, 0x7a6a50, 2.5);
        g.effects.shake(0.7);
        sfx.slam();
        g.hitEnemiesInRadius(p.x, p.z, 5, () => ({ ...p.rollDamage(3, true), knock: 10 }));
      },
    });
  },
});

evo('warcry', {
  name: 'Avatar of War',
  icon: '👑',
  cd: () => 18,
  desc: () => 'Become a giant for 10s: +100% damage, +40% attack speed, +50 armor. Nearby enemies flee in terror for 3s.',
  cast(p) {
    const g = p.game;
    p.addBuff('avatar', 10, { dmg: 1, as: 0.4, armor: 50, size: 0.35 }, 0xffd24a);
    for (const [r, c, d] of [
      [8, 0xffd24a, 0.6],
      [5, 0xff7a4a, 0.45],
      [3, 0xffffff, 0.35],
    ])
      g.effects.ring(p.x, p.z, r, c, d, p.y + 0.1);
    g.effects.burst(p.x, p.y + 1.5, p.z, 0xffd24a, 40, 10, 0.2, 0.8, 4);
    g.effects.shake(0.6);
    sfx.slam();
    g.hitEnemiesInRadius(p.x, p.z, 8, (e) => {
      e.status({ blind: 3 });
      return { amount: 1, crit: false, knock: 12, silent: true };
    });
    p.act({ anim: 'roar', dur: 0.6 });
  },
});

evo('aegis', {
  name: 'Divine Bulwark',
  icon: '🌟',
  cd: () => 14,
  desc: () => 'A shield of 60% max health for 8s that pulses holy light (100% damage in 4m every 0.6s) and detonates for 500% when it ends.',
  cast(p) {
    const g = p.game;
    sfx.heal();
    const zone = g.zone({ x: p.x, z: p.z, r: 4, life: 8, kind: 'holy', tick: 0.6, follow: p, onTick: () => {
      g.effects.ring(p.x, p.z, 4, 0xfff0a0, 0.35, p.y + 0.1);
      g.hitEnemiesInRadius(p.x, p.z, 4, () => ({ ...p.rollDamage(1, true), knock: 3 }));
    } });
    p.shieldUp(p.final.maxHp * 0.6, 8, () => {
      zone.life = 0;
      g.effects.ring(p.x, p.z, 6, 0xfff0a0, 0.55, p.y + 0.1);
      g.effects.burst(p.x, p.y + 1, p.z, 0xfff0a0, 40, 10, 0.16, 0.7, 3);
      g.effects.shake(0.6);
      sfx.boom();
      g.hitEnemiesInRadius(p.x, p.z, 6, () => ({ ...p.rollDamage(5, true), knock: 10 }));
    });
    p.act({ anim: 'roar', dur: 0.4 });
  },
});

evo('fissure', {
  name: 'World Splitter',
  icon: '🗻',
  cd: () => 8,
  desc: () => 'Three fissures tear the ground in a fan: 10 eruptions each for 220% damage that launch enemies and leave fire.',
  cast(p, lv, ctx) {
    p.aimAt(ctx, 12, 0.5);
    const g = p.game;
    const ox = p.x;
    const oz = p.z;
    p.act({ anim: 'overhead', dur: 0.5 });
    for (const off of [-0.45, 0, 0.45]) {
      const hx = Math.sin(p.heading + off);
      const hz = Math.cos(p.heading + off);
      for (let i = 0; i < 10; i++) {
        g.schedule(0.18 + i * 0.06, () => {
          const x = ox + hx * (1.6 + i * 1.5);
          const z = oz + hz * (1.6 + i * 1.5);
          if (g.dungeon.groundBlocked(ox, oz, x, z)) return;
          g.effects.spikes(x, z, 0x7a5040, 1.1);
          g.effects.burst(x, 0.3, z, 0xff7a2e, 8, 7, 0.2, 0.5);
          if (i % 2 === 0) g.spawnFirePatch(x, z);
          if (i % 3 === 0) sfx.slam();
          g.hitEnemiesInRadius(x, z, 1.9, () => ({ ...p.rollDamage(2.2, true), knock: 2, launch: 8 }));
        });
      }
    }
    g.schedule(0.2, () => g.effects.shake(0.7));
  },
});

// ------------------------------------------------------------------ RANGER
evo('multishot', {
  name: 'Storm of Arrows',
  icon: '🌠',
  cd: () => 4,
  desc: () => 'Three volleys of 15 arrows in quick succession, 110% damage each, piercing two enemies.',
  cast(p, lv, ctx) {
    p.aimAt(ctx, 16, 0.8, true);
    const g = p.game;
    p.act({ anim: 'shoot', dur: 0.5, move: 0.4 });
    for (let v = 0; v < 3; v++)
      g.schedule(v * 0.15, () => {
        sfx.arrow();
        for (let i = 0; i < 15; i++) g.shoot({ from: p, heading: p.heading + (i - 7) * 0.11 + (v - 1) * 0.05, speed: 32, life: 0.75, kind: 'arrow', dmg: () => p.rollDamage(1.1, true), knock: 3, pierce: 2 });
      });
  },
});

evo('rain', {
  name: 'Arrow Monsoon',
  icon: '⛈️',
  cd: () => 12,
  desc: () => 'For 5s a storm of arrows follows you, hammering everything within 7m for 80% damage five times a second and slowing them.',
  cast(p) {
    const g = p.game;
    p.act({ anim: 'skyshot', dur: 0.4 });
    sfx.arrow();
    g.zone({ x: p.x, z: p.z, r: 7, life: 5, kind: 'rain', tick: 0.2, follow: p, onTick: (z) => {
      for (let i = 0; i < 10; i++) g.effects.fallingArrow(z.x + (Math.random() - 0.5) * 13, z.z + (Math.random() - 0.5) * 13);
      if (Math.random() < 0.5) sfx.arrow();
      g.hitEnemiesInRadius(z.x, z.z, 7, (e) => {
        e.status({ slow: [0.6, 0.45] });
        return { ...p.rollDamage(0.8, true), knock: 0 };
      });
    } });
  },
});

evo('pierce', {
  name: 'Dragon Lance',
  icon: '🐉',
  cd: () => 5,
  desc: () => 'A blazing lance for 600% damage that explodes on every enemy it passes through and scorches a burning trail.',
  cast(p, lv, ctx) {
    p.aimAt(ctx, 24, 0.5, true);
    const g = p.game;
    p.act({
      anim: 'draw',
      dur: 0.4,
      move: 0.3,
      end() {
        sfx.fire();
        sfx.dash();
        const hx = Math.sin(p.heading);
        const hz = Math.cos(p.heading);
        for (let i = 1; i < 12; i++) {
          const x = p.x + hx * i * 2;
          const z = p.z + hz * i * 2;
          if (g.dungeon.groundBlocked(p.x, p.z, x, z)) break;
          g.schedule(i * 0.04, () => g.spawnFirePatch(x, z));
        }
        g.shoot({
          from: p,
          heading: p.heading,
          speed: 46,
          life: 0.6,
          kind: 'fire',
          radius: 1,
          pierce: 99,
          dmg: () => p.rollDamage(6, true),
          knock: 10,
          onHit: (e) => {
            g.effects.ring(e.x, e.z, 2.8, 0xff9a3d, 0.3);
            g.effects.burst(e.x, 1, e.z, 0xff7a2e, 14, 6, 0.18, 0.4);
            g.hitEnemiesInRadius(e.x, e.z, 2.8, (o) => (o === e ? null : { ...p.rollDamage(2, true), knock: 5 }));
            e.status({ burn: [3, p.final.damage * 0.4 * p.final.skillMult] });
          },
        });
      },
    });
  },
});

evo('vault', {
  name: 'Phantom Vault',
  icon: '👻',
  cd: () => 6,
  desc: () => 'Backflip away, leaving a 5m frost blast (200% damage, 3s freeze), and loose 9 homing arrows mid-air.',
  cast(p, lv, ctx) {
    const g = p.game;
    p.aimAt(ctx, 14, 3.2, true);
    const back = p.heading + Math.PI;
    const ox = p.x;
    const oz = p.z;
    p.vy = 10;
    p.grounded = false;
    sfx.jump();
    sfx.frost();
    g.effects.ring(ox, oz, 5, 0x9fe3ff, 0.5);
    g.effects.iceShards(ox, oz, 4);
    g.hitEnemiesInRadius(ox, oz, 5, (e) => {
      e.status({ freeze: 3 });
      return { ...p.rollDamage(2, true), knock: 0 };
    });
    p.act({ anim: 'flip', invuln: 0.8, untilLand: true, dur: 2, vel: { x: Math.sin(back) * 11, z: Math.cos(back) * 11 }, fired: false,
      update(dt, a) {
        if (!a.fired && a.t > 0.18) {
          a.fired = true;
          sfx.arrow();
          const used = new Set();
          for (let i = 0; i < 9; i++) {
            const t = nearest(g, p.x, p.z, 18, used) || nearest(g, p.x, p.z, 18);
            if (t) used.add(t);
            g.shoot({ from: p, heading: t ? Math.atan2(t.x - p.x, t.z - p.z) + (Math.random() - 0.5) * 0.3 : p.heading + (i - 4) * 0.2, speed: 26, life: 0.9, kind: 'bigarrow', homing: t, dmg: () => p.rollDamage(1.4, true), knock: 3 });
          }
        }
      } });
  },
});

evo('trap', {
  name: 'Minefield',
  icon: '💥',
  cd: () => 8,
  desc: () => 'Scatter six mines in a ring. Each blasts 4.5m for 450% damage and sets foes ablaze, and a blast sets off every mine near it.',
  cast(p, lv, ctx) {
    const g = p.game;
    const t = p.aimAt(ctx, 12, 0.9, true);
    const d = t ? Math.min(8, Math.hypot(t.x - p.x, t.z - p.z)) : 5;
    const cx = p.x + Math.sin(p.heading) * d;
    const cz = p.z + Math.cos(p.heading) * d;
    p.act({ anim: 'throw', dur: 0.3 });
    const mines = [];
    const boom = (zone) => {
      if (zone.gone) return true;
      zone.gone = true;
      zone.life = 0;
      g.effects.ring(zone.x, zone.z, 4.5, 0xff9a3d, 0.4);
      g.effects.burst(zone.x, 0.4, zone.z, 0xff7a2e, 26, 9, 0.22, 0.6, 5);
      g.effects.shake(0.35);
      sfx.boom();
      g.hitEnemiesInRadius(zone.x, zone.z, 4.5, (e) => {
        e.status({ burn: [3, p.final.damage * 0.35 * p.final.skillMult] });
        return { ...p.rollDamage(4.5, true), knock: 9, launch: 6 };
      });
      for (const m of mines) if (!m.gone && Math.hypot(m.x - zone.x, m.z - zone.z) < 6) g.schedule(0.15, () => boom(m));
      return true;
    };
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      let x = cx + Math.cos(a) * 3.5;
      let z = cz + Math.sin(a) * 3.5;
      if (g.dungeon.groundBlocked(cx, cz, x, z)) {
        x = cx;
        z = cz;
      }
      mines.push(g.zone({ x, z, r: 1.8, life: 25, kind: 'trap', arm: 0.4, onEnter: boom }));
    }
  },
});

evo('focus', {
  name: 'Eagle Eye',
  icon: '👁️',
  cd: () => 16,
  desc: () => 'For 10s: +100% attack speed, +30% crit, every shot fires three arrows and all arrows pierce three enemies.',
  cast(p) {
    p.addBuff('eagle', 10, { as: 1, crit: 0.3, pierce: 3, tripleShot: 1 }, 0x8dff9c);
    p.game.effects.ring(p.x, p.z, 4, 0x8dff9c, 0.5, p.y + 0.1);
    p.game.effects.burst(p.x, p.y + 1.6, p.z, 0x8dff9c, 24, 6, 0.14, 0.6, 2);
    sfx.pickup();
    p.act({ anim: 'roar', dur: 0.35 });
  },
});

// -------------------------------------------------------------------- MAGE
evo('firebolt', {
  name: 'Inferno Barrage',
  icon: '☀️',
  cd: () => 3,
  desc: () => 'Nine homing fireballs spiral out, each exploding for 300% damage in 3m and leaving burning ground.',
  cast(p, lv, ctx) {
    const g = p.game;
    p.aimAt(ctx, 18, 1.2, true);
    p.act({ anim: 'cast', dur: 0.5, move: 0.5 });
    const used = new Set();
    for (let i = 0; i < 9; i++)
      g.schedule(i * 0.05, () => {
        sfx.fire();
        const t = nearest(g, p.x, p.z, 20, used) || nearest(g, p.x, p.z, 20);
        if (t) used.add(t);
        g.shoot({ from: p, heading: p.heading + (i - 4) * 0.35, speed: 20, life: 1.8, kind: 'fire', homing: t, explode: 3, dmg: () => p.rollDamage(3, true), knock: 5, onHit: (e) => {
          e.status({ burn: [2.5, p.final.damage * 0.3 * p.final.skillMult] });
          if (Math.random() < 0.35) g.spawnFirePatch(e.x, e.z);
        } });
      });
  },
});

evo('nova', {
  name: 'Absolute Zero',
  icon: '🧊',
  cd: () => 9,
  desc: () => 'Three expanding waves of frost (7m, 9m, 11m), each 250% damage, freezing everything for 4s.',
  cast(p) {
    const g = p.game;
    p.act({ anim: 'slamcast', dur: 0.6 });
    [7, 9, 11].forEach((R, i) =>
      g.schedule(i * 0.25, () => {
        g.effects.ring(p.x, p.z, R, 0x9fe3ff, 0.5, p.y + 0.1);
        g.effects.ring(p.x, p.z, R * 0.8, 0xffffff, 0.4, p.y + 0.12);
        g.effects.iceShards(p.x, p.z, R);
        g.effects.burst(p.x, p.y + 1, p.z, 0xcff4ff, 30, 12, 0.2, 0.8, 4);
        g.effects.shake(0.3);
        sfx.frost();
        g.hitEnemiesInRadius(p.x, p.z, R, (e) => {
          e.status({ freeze: 4 });
          return { ...p.rollDamage(2.5, true), knock: 2 };
        });
      }),
    );
  },
});

evo('chain', {
  name: 'Thunder God',
  icon: '🌩️',
  cd: () => 4,
  desc: () => 'Lightning leaps between 12 enemies for 250% damage, a sky bolt blasts each one it strikes, and six more bolts rain down nearby.',
  cast(p, lv, ctx) {
    const g = p.game;
    const first = p.aimAt(ctx, 16, 1.2, true);
    p.act({ anim: 'skycast', dur: 0.4 });
    sfx.frost();
    const strike = (e) => g.skyStrike(e.x, e.z, 2.5, () => ({ ...p.rollDamage(1.5, true), knock: 4 }));
    if (first) {
      const pts = [[p.x, p.y + 1.6, p.z]];
      const hit = new Set();
      let cur = first;
      for (let i = 0; i < 12 && cur; i++) {
        hit.add(cur);
        pts.push([cur.x, cur.y + cur.height * 0.6, cur.z]);
        g.damageEnemy(cur, { ...p.rollDamage(2.5, true), knock: 2 }, p.x, p.z);
        cur.status({ stun: 0.6 });
        const target = cur;
        g.schedule(0.05 * i, () => target.alive && strike(target));
        cur = nearest(g, cur.x, cur.z, 9, hit);
      }
      g.lightning(pts, 0xaad4ff);
    }
    for (let i = 0; i < 6; i++)
      g.schedule(0.2 + i * 0.15, () => {
        const e = g.enemies.filter((o) => o.alive && Math.hypot(o.x - p.x, o.z - p.z) < 14);
        const t = e[Math.floor(Math.random() * e.length)];
        if (t) strike(t);
        else g.skyStrike(p.x + (Math.random() - 0.5) * 10, p.z + (Math.random() - 0.5) * 10, 2.5, () => ({ ...p.rollDamage(1.5, true), knock: 4 }));
      });
  },
});

evo('meteor', {
  name: 'Armageddon',
  icon: '🌑',
  cd: () => 12,
  desc: () => 'Seven meteors pound the target area over 2s, each 600% damage in 4.5m, leaving the ground ablaze.',
  cast(p, lv, ctx) {
    const g = p.game;
    const t = p.aimAt(ctx, 16, 1, true);
    const d = t ? Math.hypot(t.x - p.x, t.z - p.z) : 8;
    const cx = p.x + Math.sin(p.heading) * d;
    const cz = p.z + Math.cos(p.heading) * d;
    p.act({ anim: 'skycast', dur: 0.6 });
    sfx.fire();
    for (let i = 0; i < 7; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = i === 0 ? 0 : 1.5 + Math.random() * 4;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      const delay = 0.2 + i * 0.25;
      g.schedule(delay, () => {
        g.effects.telegraph(x, z, 4.5, 0.8, 0xff7a2e);
        g.effects.meteor(x, z, 0.8);
      });
      g.schedule(delay + 0.8, () => {
        g.effects.ring(x, z, 4.5, 0xff9a3d, 0.5);
        g.effects.burst(x, 0.5, z, 0xff7a2e, 36, 12, 0.25, 0.8, 8);
        g.effects.shake(0.6);
        sfx.boom();
        g.hitEnemiesInRadius(x, z, 4.5, (e) => {
          e.status({ burn: [3, p.final.damage * 0.35 * p.final.skillMult] });
          return { ...p.rollDamage(6, true), knock: 10, launch: 8 };
        });
        for (let k = 0; k < 3; k++) g.spawnFirePatch(x + (Math.random() - 0.5) * 4, z + (Math.random() - 0.5) * 4);
      });
    }
  },
});

evo('blink', {
  name: 'Rift Walk',
  icon: '🌀',
  cd: () => 2.5,
  desc: () => 'Tear through space 12m: everything along the rift takes 300% damage and is slowed, with arcane blasts at both ends.',
  cast(p, lv, ctx) {
    const g = p.game;
    const h = ctx.wish ?? ctx.camYaw;
    p.heading = h;
    const sx = p.x;
    const sz = p.z;
    const blast = (x, z) => {
      g.effects.ring(x, z, 3.5, 0xd08dff, 0.4, p.y + 0.1);
      g.effects.burst(x, p.y + 1, z, 0xd08dff, 20, 7, 0.15, 0.5, 3);
      g.hitEnemiesInRadius(x, z, 3.5, (e) => {
        e.status({ slow: [2.5, 0.4] });
        return { ...p.rollDamage(2, true), knock: 6 };
      });
    };
    blast(sx, sz);
    p.teleport(Math.sin(h), Math.cos(h), 12);
    const len = Math.hypot(p.x - sx, p.z - sz);
    const hit = new Set();
    for (let d = 0; d <= len; d += 1) {
      const x = sx + Math.sin(h) * d;
      const z = sz + Math.cos(h) * d;
      g.effects.puff(x, p.y + 1, z, 0xb58cff, 0.5, 0.6);
      g.hitEnemiesInRadius(x, z, 1.8, (e) => {
        if (hit.has(e)) return null;
        hit.add(e);
        e.status({ slow: [3, 0.4] });
        return { ...p.rollDamage(3, true), knock: 4 };
      });
    }
    g.lightning([[sx, p.y + 1, sz], [p.x, p.y + 1, p.z]], 0xd08dff);
    blast(p.x, p.z);
    p.invuln = Math.max(p.invuln, 0.5);
    sfx.portal();
    p.act({ anim: 'cast', dur: 0.15 });
  },
});

evo('orb', {
  name: 'Singularity',
  icon: '🕳️',
  cd: () => 8,
  desc: () => 'A slow black hole that drags every enemy within 9m into it, grinding for 120% per tick, then collapses for 800% in 7m.',
  cast(p, lv, ctx) {
    p.aimAt(ctx, 16, 0.6, true);
    p.act({ anim: 'cast', dur: 0.35 });
    sfx.portal();
    const g = p.game;
    g.shoot({ from: p, heading: p.heading, speed: 4.5, life: 3.6, kind: 'orb', radius: 3.2, pull: 9, pierce: 999, tickDmg: () => p.rollDamage(1.2, true), explode: 7, dmg: () => {
      g.effects.shake(0.8);
      return p.rollDamage(8, true);
    }, knock: 12, explodeAtEnd: true });
  },
});

// ------------------------------------------------------------------- ROGUE
evo('shadowstep', {
  name: "Death's Dance",
  icon: '💀',
  cd: () => 7,
  desc: () => 'Flicker between up to six enemies, appearing behind each to strike a guaranteed critical hit for 300% damage.',
  cast(p) {
    const g = p.game;
    const hit = new Set();
    p.invuln = Math.max(p.invuln, 1);
    p.act({ anim: 'stab', dur: 0.9 });
    for (let i = 0; i < 6; i++)
      g.schedule(i * 0.13, () => {
        const t = nearest(g, p.x, p.z, 14, hit);
        if (!t) return;
        hit.add(t);
        g.effects.burst(p.x, p.y + 1, p.z, 0x6a4a8a, 10, 4, 0.2, 0.4, 1);
        const h = Math.atan2(t.x - p.x, t.z - p.z);
        p.teleport(Math.sin(h), Math.cos(h), Math.hypot(t.x - p.x, t.z - p.z) + t.radius + 0.9);
        p.heading = Math.atan2(t.x - p.x, t.z - p.z);
        g.effects.slash(p.x, p.y + 1, p.z, p.heading, 2.4, 0xff4a6a, 1.4, 0.3);
        sfx.crit();
        g.damageEnemy(t, { ...p.rollDamage(3, true, true), knock: 4 }, p.x, p.z);
        t.status({ stun: 0.8 });
      });
  },
});

evo('fan', {
  name: 'Blade Storm',
  icon: '⚔️',
  cd: () => 5,
  desc: () => 'Three spiralling waves of 30 poisoned knives, 120% damage each.',
  cast(p) {
    const g = p.game;
    p.act({ anim: 'spin', dur: 0.6 });
    for (let w = 0; w < 3; w++)
      g.schedule(w * 0.2, () => {
        sfx.swing();
        for (let i = 0; i < 30; i++) g.shoot({ from: p, heading: (i / 30) * Math.PI * 2 + w * 0.1, speed: 24, life: 0.6, kind: 'knife', dmg: () => p.rollDamage(1.2, true), knock: 3, onHit: (e) => e.status({ poison: [4, p.final.damage * 0.4] }) });
      });
  },
});

evo('poison', {
  name: 'Plague',
  icon: '🦠',
  cd: () => 10,
  desc: () => 'A 6m plague cloud clings to you for 8s, poisoning (80% per tick) and slowing everything inside.',
  cast(p) {
    const g = p.game;
    p.act({ anim: 'throwdown', dur: 0.3 });
    sfx.boom();
    g.zone({ x: p.x, z: p.z, r: 6, life: 8, kind: 'poison', tick: 0.35, follow: p, onTick: (z) => {
      g.hitEnemiesInRadius(z.x, z.z, 6, (e) => {
        e.status({ slow: [0.6, 0.5], poison: [2, p.final.damage * 0.3] });
        return { ...p.rollDamage(0.8, true), knock: 0, silent: true, dot: 'poison' };
      });
    } });
  },
});

evo('flurry', {
  name: 'Thousand Cuts',
  icon: '🩸',
  cd: () => 7,
  desc: () => '3s of blinding blade-work in every direction (50% damage fourteen times a second) that heals you for 5% of damage dealt.',
  cast(p) {
    const g = p.game;
    p.addBuff('cuts', 3, { ls: 0.05 }, 0xff4a6a);
    p.act({
      anim: 'flurry',
      dur: 3,
      move: 0.8,
      tick: 0,
      update(dt, a) {
        a.tick -= dt;
        if (a.tick > 0) return;
        a.tick = 0.07;
        g.effects.slash(p.x, p.y + 1, p.z, Math.random() * Math.PI * 2, 3, 0xff6a8a, 1.3, (Math.random() - 0.5) * 1.5);
        if (Math.random() < 0.5) sfx.swing();
        g.hitEnemiesInRadius(p.x, p.z, 3.2 * p.mods.reach, () => ({ ...p.rollDamage(0.5, true), knock: 1 }));
      },
    });
  },
});

evo('smoke', {
  name: 'Shadow Realm',
  icon: '🌘',
  cd: () => 14,
  desc: () => 'Vanish for 4s (untouchable). For 5s every hit crits, +50% damage and +60% speed; enemies within 9m are dazed for 5s.',
  cast(p) {
    const g = p.game;
    p.invuln = Math.max(p.invuln, 4);
    p.addBuff('realm', 5, { ms: 0.6, critAll: 1, dmg: 0.5 }, 0x7a5aaa);
    for (let i = 0; i < 50; i++) g.effects.smoke(p.x + (Math.random() - 0.5) * 9, p.z + (Math.random() - 0.5) * 9);
    g.effects.ring(p.x, p.z, 9, 0x7a5aaa, 0.6);
    sfx.dash();
    g.hitEnemiesInRadius(p.x, p.z, 9, (e) => {
      e.status({ blind: 5 });
      return null;
    });
    p.act({ anim: 'throwdown', dur: 0.25 });
  },
});

evo('assassinate', {
  name: 'Reaper',
  icon: '⚰️',
  cd: () => 9,
  desc: () => 'Dash through up to five enemies in a row for 500% critical damage each, executing any regular enemy under 40% health.',
  cast(p, lv, ctx) {
    const g = p.game;
    const hit = new Set();
    let first = p.aimAt(ctx, 12, 1.2);
    const dashTo = (t, i) => {
      if (!t || i >= 5) return;
      hit.add(t);
      p.heading = Math.atan2(t.x - p.x, t.z - p.z);
      const dist = Math.hypot(t.x - p.x, t.z - p.z) + 1.5;
      const speed = 40;
      p.act({
        anim: 'lunge',
        dur: Math.min(0.35, dist / speed),
        invuln: 0.5,
        vel: { x: Math.sin(p.heading) * speed, z: Math.cos(p.heading) * speed },
        update() {
          g.effects.puff(p.x, p.y + 1, p.z, 0x8a2a3a, 0.4, 0.35);
        },
        end() {
          if (t.alive) {
            if (!t.def.boss && t.hp < t.maxHp * 0.4) g.damageEnemy(t, { amount: t.hp + 1, crit: true, knock: 6 }, p.x, p.z);
            else g.damageEnemy(t, { ...p.rollDamage(5, true, true), knock: 6 }, p.x, p.z);
            g.effects.burst(t.x, t.y + 1, t.z, 0xff2a3a, 16, 6, 0.15, 0.5);
            g.hitStop(0.04);
          }
          dashTo(nearest(g, p.x, p.z, 12, hit), i + 1);
        },
      });
    };
    sfx.dash();
    dashTo(first || nearest(g, p.x, p.z, 10, hit), 0);
  },
});

// ---------------------------------------------------------------- barbarian
// shared helpers for the barbarian's skills
function quake(p, x, z, R, dmg, stun) {
  const g = p.game;
  g.effects.ring(x, z, R, 0xc8a060, 0.45, p.y + 0.1);
  g.effects.ring(x, z, R * 0.6, 0xffffff, 0.3, p.y + 0.12);
  g.effects.spikes(x, z, 0x8a7050, R * 0.55);
  g.effects.burst(x, 0.3, z, 0x8a7a60, 24, 8, 0.2, 0.6);
  g.effects.shake(0.5);
  sfx.slam();
  g.hitEnemiesInRadius(x, z, R, (e) => {
    e.status({ stun });
    return { ...p.rollDamage(dmg, true), knock: 5, launch: 4 };
  });
}

function hookIn(p, e) {
  const g = p.game;
  g.lightning([[p.x, p.y + 1.2, p.z], [e.x, e.y + e.height * 0.5, e.z]], 0xb0b0c0);
  if (e.def.boss) return;
  const dx = p.x - e.x;
  const dz = p.z - e.z;
  const d = Math.hypot(dx, dz) || 1;
  const pull = Math.max(0, d - 1.6) * (e.def.heavy ? 10 : 7);
  e.kx += (dx / d) * pull;
  e.kz += (dz / d) * pull;
}

function warTotem(p, R, life, heal, dmg, spirits) {
  const g = p.game;
  g.effects.ring(p.x, p.z, R, 0xffb347, 0.5, p.y + 0.1);
  sfx.slam();
  g.zone({
    x: p.x,
    z: p.z,
    r: R,
    life,
    tick: spirits ? 0.5 : 1,
    kind: 'totem',
    n: 0,
    onTick(zn) {
      zn.n++;
      if (zn.n % (spirits ? 2 : 1) === 0) {
        if (Math.hypot(p.x - zn.x, p.z - zn.z) < R) p.heal(p.final.maxHp * heal);
        g.effects.ring(zn.x, zn.z, R, 0xffb347, 0.35);
        g.hitEnemiesInRadius(zn.x, zn.z, R, () => ({ ...p.rollDamage(dmg, true), knock: 0 }));
      }
      if (spirits) {
        const foes = g.enemies.filter((e) => e.alive && !e.disguised && !e.dormant && Math.hypot(e.x - zn.x, e.z - zn.z) < 11);
        const e = foes[Math.floor(Math.random() * foes.length)];
        if (e) {
          g.lightning([[zn.x, 2.6, zn.z], [e.x, e.y + e.height * 0.5, e.z]], 0x9ff0ff);
          g.damageEnemy(e, { ...p.rollDamage(1.5, true), knock: 2 }, zn.x, zn.z);
        }
      }
    },
  });
}

evo('cleave', {
  name: 'Executioner',
  icon: '⚔️',
  cd: () => 5,
  desc: () => 'A full-circle double cleave for 450% damage. Enemies below 25% health are slain outright; the rest bleed heavily.',
  cast(p) {
    const g = p.game;
    p.act({ anim: 'spin', dur: 0.55, move: 0.3 });
    [0.1, 0.35].forEach((d, i) =>
      g.schedule(d, () => {
        const R = 4.8 * p.mods.reach;
        g.effects.slash(p.x, p.y + 1.0, p.z, p.heading + i * 3, R, 0xff2a2a, Math.PI * 1.99, 0);
        g.effects.ring(p.x, p.z, R, 0xff3a3a, 0.35, p.y + 0.1);
        g.effects.shake(0.45);
        g.hitStop(0.04);
        sfx.slam();
        g.hitEnemiesInRadius(p.x, p.z, R, (e) => {
          if (!e.def.boss && e.hp < e.maxHp * 0.25) {
            g.effects.burst(e.x, e.y + 1, e.z, 0xff1a2a, 20, 7, 0.16, 0.5);
            return { amount: e.hp + 1, crit: true, knock: 8 };
          }
          const hit = p.rollDamage(2.25, true);
          e.status({ bleed: [4, (hit.amount * 0.8) / 11] });
          return { ...hit, knock: 7 };
        });
      }),
    );
  },
});

evo('axethrow', {
  name: 'Twin Tempest',
  icon: '🌪️',
  cd: () => 5,
  desc: () => 'Hurl three huge spinning axes for 300% damage each. They carve through everything, pull enemies along and cut again on the way back.',
  cast(p, lv, ctx) {
    p.aimAt(ctx, 14, 0.6, true);
    const g = p.game;
    p.act({ anim: 'throw', dur: 0.35, move: 0.5 });
    g.schedule(0.15, () => {
      sfx.swing();
      for (let k = -1; k <= 1; k++)
        g.shoot({ from: p, heading: p.heading + k * 0.35, speed: 17, life: 1.5, kind: 'bigaxe', radius: 1.3, pierce: 99, boomerang: true, rehit: true, pull: 3.5, dmg: () => p.rollDamage(3, true), knock: 5 });
    });
  },
});

evo('stomp', {
  name: 'Tectonic Fury',
  icon: '🌋',
  cd: () => 7,
  desc: () => 'Three rolling quakes (4m, 7m, 10m) of 250% damage each, stunning for 1.5s and leaving the ground burning.',
  cast(p) {
    const g = p.game;
    p.act({ anim: 'slamcast', dur: 0.55, move: 0 });
    const x = p.x;
    const z = p.z;
    [4, 7, 10].forEach((R, i) =>
      g.schedule(0.25 + i * 0.3, () => {
        quake(p, x, z, R, 2.5, 1.5);
        for (let k = 0; k < 6; k++) g.spawnFirePatch(x + Math.cos(k + i) * R * 0.7, z + Math.sin(k + i) * R * 0.7);
      }),
    );
  },
});

evo('berserk', {
  name: 'Blood God',
  icon: '🩸',
  cd: () => 16,
  desc: () => 'For 10s: +80% attack speed, +50% damage, 10% life steal, grow huge, and a storm of blood shreds everything within 3m for 60% twice a second.',
  cast(p) {
    const g = p.game;
    p.addBuff('berserk', 10, { as: 0.8, dmg: 0.5, ls: 0.1, size: 0.4 }, 0xff1a2a);
    g.effects.ring(p.x, p.z, 6, 0xff1a2a, 0.6, p.y + 0.1);
    g.effects.burst(p.x, p.y + 1.4, p.z, 0xff1a2a, 40, 9, 0.2, 0.8);
    g.effects.shake(0.6);
    sfx.boom();
    p.act({ anim: 'roar', dur: 0.6 });
    g.zone({
      x: p.x,
      z: p.z,
      r: 3,
      life: 10,
      tick: 0.5,
      follow: p,
      kind: 'blood',
      onTick(zn) {
        g.effects.ring(zn.x, zn.z, 3, 0xff1a2a, 0.3, p.y + 0.1);
        for (let k = 0; k < 4; k++) g.effects.puff(zn.x + (Math.random() - 0.5) * 5, p.y + 0.5 + Math.random(), zn.z + (Math.random() - 0.5) * 5, 0xb01020, 0.3, 0.5);
        g.hitEnemiesInRadius(zn.x, zn.z, 3, () => ({ ...p.rollDamage(0.6, true), knock: 1 }));
      },
    });
  },
});

evo('hook', {
  name: 'Maelstrom',
  icon: '🌀',
  cd: () => 8,
  desc: () => 'Chains lash out in every direction: drag all enemies within 14m to you, then slam them for 350% damage and a 1.5s stun.',
  cast(p) {
    const g = p.game;
    p.act({ anim: 'spin', dur: 0.5, move: 0 });
    g.schedule(0.12, () => {
      sfx.swing();
      g.hitEnemiesInRadius(p.x, p.z, 14, (e) => {
        hookIn(p, e);
        e.status({ stun: 0.6 });
        return { amount: 1, crit: false, knock: 0, silent: true };
      });
    });
    g.schedule(0.5, () => quake(p, p.x, p.z, 5, 3.5, 1.5));
  },
});

evo('totem', {
  name: 'Ancestral Spirits',
  icon: '👻',
  cd: () => 16,
  desc: () => 'Raise a spirit totem for 10s: heal 5% of max health per second inside it, enemies there take 80% a second, and ancestral lightning strikes a nearby foe twice a second for 150%.',
  cast(p) {
    p.act({ anim: 'slamcast', dur: 0.45 });
    warTotem(p, 5, 10, 0.05, 0.8, true);
  },
});
