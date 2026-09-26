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
    desc: (lv) => `Leap onto a foe and smash the ground for ${pct(S(2.6, 0.5, lv))} damage in a ${S(3.4, 0.3, lv).toFixed(1)}m radius.${lv >= 3 ? ` Stuns for ${sec(0.6 + 0.2 * lv)}.` : ''}`,
    cast(p, lv, ctx) {
      p.leapSlam(ctx, { dmg: S(2.6, 0.5, lv), radius: S(3.4, 0.3, lv), stun: lv >= 3 ? 0.6 + 0.2 * lv : 0 });
    },
  },
  whirl: {
    name: 'Whirlwind',
    icon: '🌀',
    cd: (lv) => 9 - 0.4 * (lv - 1),
    desc: (lv) => `Spin for ${sec(S(1.2, 0.3, lv))}, hitting everything around you for ${pct(S(0.6, 0.12, lv))} five times a second.${lv >= 3 ? ' Pulls enemies in.' : ''}${lv >= 5 ? ' Move at full speed.' : ''}`,
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
            return { ...p.rollDamage(S(0.6, 0.12, lv), true), knock: lv >= 3 ? 0 : 2 };
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
            return { ...p.rollDamage(S(1.6, 0.3, lv), true), knock: 0 };
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
    desc: (lv) => `Split the ground ahead: ${S(5, 1, lv)} eruptions of ${pct(S(1.4, 0.25, lv))} damage that launch enemies.`,
    cast(p, lv, ctx) {
      p.aimAt(ctx, 10, 0.5);
      const g = p.game;
      const hx = Math.sin(p.heading);
      const hz = Math.cos(p.heading);
      const n = S(5, 1, lv);
      const ox = p.x;
      const oz = p.z;
      p.act({ anim: 'overhead', dur: 0.45 });
      for (let i = 0; i < n; i++) {
        g.schedule(0.18 + i * 0.07, () => {
          const x = ox + hx * (1.6 + i * 1.5);
          const z = oz + hz * (1.6 + i * 1.5);
          if (g.dungeon.heightAtPoint(x, z) > 2) return;
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
    desc: (lv) => `Fire a fan of ${3 + 2 * lv} arrows, each dealing ${pct(S(0.9, 0.12, lv))} damage.`,
    cast(p, lv, ctx) {
      p.aimAt(ctx, 16, 0.8, true);
      const n = 3 + 2 * lv;
      p.act({ anim: 'shoot', dur: 0.28 });
      sfx.arrow();
      for (let i = 0; i < n; i++) {
        const off = (i - (n - 1) / 2) * (1.1 / (n - 1));
        p.game.shoot({ from: p, heading: p.heading + off, speed: 30, life: 0.7, kind: 'arrow', dmg: () => p.rollDamage(S(0.9, 0.12, lv), true), knock: 3, pierce: p.buffMod('pierce') ? 1 : 0 });
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
        if (g.dungeon.heightAtPoint(x, z) > 2) {
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
    cd: (lv) => 2.8 - 0.1 * (lv - 1),
    desc: (lv) => `Hurl ${lv >= 5 ? 5 : lv >= 3 ? 3 : 1} homing fireball${lv >= 3 ? 's' : ''} that explode for ${pct(S(2.2, 0.35, lv))} damage and burn.`,
    cast(p, lv, ctx) {
      const t = p.aimAt(ctx, 18, 0.9, true);
      const n = lv >= 5 ? 5 : lv >= 3 ? 3 : 1;
      p.act({ anim: 'cast', dur: 0.22 });
      sfx.fire();
      for (let i = 0; i < n; i++) {
        const off = n === 1 ? 0 : (i - (n - 1) / 2) * 0.22;
        p.game.shoot({ from: p, heading: p.heading + off, speed: 22, life: 1.4, kind: 'fire', homing: t, explode: 2.4, dmg: () => p.rollDamage(S(2.2, 0.35, lv), true), knock: 5, onHit: (e) => e.status({ burn: [1.8, p.final.damage * 0.2 * p.final.skillMult] }) });
      }
    },
  },
  nova: {
    name: 'Frost Nova',
    icon: '❄',
    cd: (lv) => 10 - 0.5 * (lv - 1),
    desc: (lv) => `Blast frost in ${S(5.5, 0.4, lv).toFixed(1)}m for ${pct(S(1.3, 0.25, lv))} damage, freezing enemies for ${sec(S(2, 0.4, lv))}.`,
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
        return { ...p.rollDamage(S(1.3, 0.25, lv), true), knock: 3 };
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
        g.damageEnemy(cur, { ...p.rollDamage(S(1.6, 0.3, lv), true), knock: 2 }, p.x, p.z);
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
    desc: (lv) => `Call a meteor that lands after 0.9s for ${pct(S(5, 1, lv))} damage in ${S(4, 0.3, lv).toFixed(1)}m.${lv >= 3 ? ' Leaves burning ground.' : ''}`,
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
          return { ...p.rollDamage(S(5, 1, lv), true), knock: 10, launch: 8 };
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
};

// Class skill pools are listed in classes.js; this attaches the id to each def.
for (const id in SKILLS) SKILLS[id].id = id;
