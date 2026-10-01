// Uniques and sets: the loot that changes how a run plays. A legendary (sometimes),
// mythic or primal item carries a unique power (primal items carry two); set pieces
// add bonuses at 2 and 3 worn. Powers are ids; the Powers object on the local hero
// turns them into procs (on hit, on kill, when hurt, over time) and looks (huge
// weapons, burning armour, auras) that every player sees.

import { rng } from './utils.js';
import { sfx } from './audio.js';

// el: the element of the look — fire / frost / storm / blood / void / gold / thorn / soul
export const UNIQUES = {
  // ---- weapons
  hellbrand: { slot: 'weapon', name: 'Hellbrand', desc: 'Hits set enemies ablaze (burn for 60% damage per second). Swings shed embers.', stats: { dmgPct: 0.25 }, fx: { scale: 1.5, hex: 0xff5a1a, el: 'fire' }, powers: ['ignite'] },
  worldsplitter: { slot: 'weapon', name: 'Worldsplitter', desc: 'A weapon the size of a door: +40% damage, +50% reach, and every 3rd hit splits the earth.', stats: { dmgPct: 0.4 }, mods: { reach: 0.5 }, fx: { scale: 2.1, hex: 0xffc24a, el: 'gold' }, powers: ['split'] },
  stormcaller: { slot: 'weapon', name: 'Stormcaller', desc: '30% chance on hit to arc lightning through 4 more enemies.', stats: { attackSpeed: 0.15 }, fx: { scale: 1.4, hex: 0x7ad8ff, el: 'storm' }, powers: ['arc'] },
  bloodthirster: { slot: 'weapon', name: 'Bloodthirster', desc: '+6% life steal. Every kill heals 6% of your max health.', stats: { lifesteal: 0.06 }, fx: { scale: 1.6, hex: 0xff2040, el: 'blood' }, powers: ['feast'] },
  wintersbite: { slot: 'weapon', name: "Winter's Bite", desc: 'Hits chill enemies (−45% speed) and have a 15% chance to freeze them solid.', stats: { crit: 0.08 }, fx: { scale: 1.5, hex: 0x9fe8ff, el: 'frost' }, powers: ['chill', 'freeze'] },
  headsman: { slot: 'weapon', name: "Headsman's End", desc: 'Executes any non-boss enemy under 20% health.', stats: { critMult: 0.6 }, fx: { scale: 2.0, hex: 0xb04dff, el: 'void' }, powers: ['behead'] },
  midas: { slot: 'weapon', name: 'Edge of Midas', desc: 'Enemies you kill drop triple gold; critical hits spray coins.', stats: { goldFind: 1 }, fx: { scale: 1.6, hex: 0xffd700, el: 'gold' }, powers: ['midas'] },
  // ---- armour
  infernal: { slot: 'armor', name: 'Infernal Plate', desc: 'You burn. Enemies within 3.5 m take 90% of your damage every second.', stats: { armorPct: 0.2 }, fx: { aura: 0xff5a1a, el: 'fire' }, powers: ['firecloak'] },
  glacial: { slot: 'armor', name: 'Glacial Bulwark', desc: '+30% armour. Taking a hit releases a frost nova that freezes enemies around you (every 3 s).', stats: { armorPct: 0.3 }, fx: { aura: 0x9fe8ff, el: 'frost' }, powers: ['frostnova'] },
  thornmail: { slot: 'armor', name: 'Thornmail', desc: 'Reflect 250% of melee damage taken. +20% armour.', stats: { armorPct: 0.2 }, fx: { aura: 0x7adf4a, el: 'thorn' }, powers: ['spikes'] },
  phoenix: { slot: 'armor', name: 'Phoenix Mantle', desc: 'Once per floor, rise from death at 60% health in a blast of fire.', stats: { hpPct: 0.15 }, fx: { aura: 0xffa040, el: 'fire' }, powers: ['rebirth'] },
  titan: { slot: 'armor', name: "Titan's Shell", desc: 'You grow 35% larger: +60% max health and your landings quake the ground.', stats: { hpPct: 0.6 }, mods: { size: 0.35 }, fx: { aura: 0xffc24a, el: 'gold' }, powers: ['quakeland'] },
  shadowshroud: { slot: 'armor', name: 'Shadowshroud', desc: 'Dashing turns you into shadow for 1.5 s; your next hit deals triple damage.', stats: { moveSpeed: 0.12 }, fx: { aura: 0x6a40c0, el: 'void' }, powers: ['shadow'] },
  // ---- charms
  bladering: { slot: 'charm', name: 'Ring of Blades', desc: 'Three spectral blades orbit you, cutting everything they touch.', stats: {}, fx: { orbit: 0xdfe8ff, el: 'storm' }, powers: ['blades'] },
  comet: { slot: 'charm', name: 'Heart of the Comet', desc: 'Every 5 s a meteor slams into the nearest enemy.', stats: { skillPower: 0.2 }, fx: { orbit: 0xff8a3a, el: 'fire' }, powers: ['comet'] },
  hoard: { slot: 'charm', name: 'Dragon Hoard', desc: '+150% gold. Picking up gold heals you.', stats: { goldFind: 1.5 }, fx: { orbit: 0xffd700, el: 'gold' }, powers: ['goldheal'] },
  chrono: { slot: 'charm', name: 'Chrono Sigil', desc: '−25% cooldowns, and skills have a 25% chance to come straight back.', stats: { cdr: 0.25 }, fx: { orbit: 0x80ffd8, el: 'storm' }, powers: ['refresh'] },
  wrath: { slot: 'charm', name: 'Wrath of Ages', desc: 'Every kill: +4% damage for 8 s, stacking up to +40%.', stats: {}, fx: { orbit: 0xff3040, el: 'blood' }, powers: ['wrath'] },
  lantern: { slot: 'charm', name: 'Soul Lantern', desc: 'Each kill frees a soul that hunts down another enemy.', stats: {}, fx: { orbit: 0x9fffb0, el: 'soul' }, powers: ['souls'] },
};

export const SETS = {
  inferno: {
    name: "Inferno Lord's",
    hex: 0xff6a2a,
    color: '#ff8a4a',
    el: 'fire',
    two: { desc: '+30% damage, and your hits ignite', stats: { dmgPct: 0.3 }, powers: ['ignite'] },
    three: { desc: 'Wreathed in flame: a burning aura, and dashes leave fire', powers: ['firecloak', 'firedash'] },
  },
  frost: {
    name: "Frost Tyrant's",
    hex: 0x9fe8ff,
    color: '#a8ecff',
    el: 'frost',
    two: { desc: '+40% armour, and your hits chill', stats: { armorPct: 0.4 }, powers: ['chill'] },
    three: { desc: 'Every 6 s a frost nova freezes everything around you', powers: ['frostpulse'] },
  },
  storm: {
    name: "Storm Sovereign's",
    hex: 0x7ad8ff,
    color: '#8ae0ff',
    el: 'storm',
    two: { desc: '+25% attack speed, +10% crit chance', stats: { attackSpeed: 0.25, crit: 0.1 }, powers: [] },
    three: { desc: 'Critical hits call lightning down from the sky', powers: ['critbolt', 'arc'] },
  },
  bone: {
    name: "Bonelord's",
    hex: 0xe8e0c8,
    color: '#f0e8d0',
    el: 'soul',
    two: { desc: '+30% max health, +4% life steal', stats: { hpPct: 0.3, lifesteal: 0.04 }, powers: [] },
    three: { desc: 'Slain enemies explode for 40% of their max health', powers: ['corpseboom', 'feast'] },
  },
  giant: {
    name: "Giant-King's",
    hex: 0xffc24a,
    color: '#ffd070',
    el: 'gold',
    two: { desc: '+35% damage, +30% reach, and your weapon grows enormous', stats: { dmgPct: 0.35 }, mods: { reach: 0.3 }, powers: ['bigweapon'] },
    three: { desc: 'You grow 40% larger and every blow quakes the ground', mods: { size: 0.4 }, powers: ['quake', 'quakeland'] },
  },
};
export const SET_IDS = Object.keys(SETS);

// Which uniques an item carries (ids), and the set it belongs to.
export const uniquesOf = (it) => (it && it.u ? it.u.filter((id) => UNIQUES[id]) : []);

export function rollUniques(slot, n) {
  const pool = Object.keys(UNIQUES).filter((id) => UNIQUES[id].slot === slot);
  const out = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rng.next() * pool.length), 1)[0]);
  return out;
}

// Count worn pieces per set.
export function setCounts(equipment) {
  const c = {};
  for (const k in equipment) {
    const it = equipment[k];
    if (it && it.set && SETS[it.set]) c[it.set] = (c[it.set] || 0) + 1;
  }
  return c;
}

// Everything the gear grants beyond its stat lines: bonus stats, mods and powers.
export function gearBonuses(equipment) {
  const stats = {};
  const mods = {};
  const powers = new Set();
  const add = (src) => {
    if (!src) return;
    for (const k in src.stats || {}) stats[k] = (stats[k] || 0) + src.stats[k];
    for (const k in src.mods || {}) mods[k] = (mods[k] || 0) + src.mods[k];
    for (const pw of src.powers || []) powers.add(pw);
  };
  for (const k in equipment) for (const id of uniquesOf(equipment[k])) add(UNIQUES[id]);
  const counts = setCounts(equipment);
  for (const id in counts) {
    if (counts[id] >= 2) add(SETS[id].two);
    if (counts[id] >= 3) add(SETS[id].three);
  }
  return { stats, mods, powers, counts };
}

// The look of a piece of gear: weapon scale / element, armour aura, charm orbit.
export function gearFx(it, equipment) {
  if (!it) return null;
  const u = uniquesOf(it);
  let fx = u.length ? { ...UNIQUES[u[0]].fx } : null;
  if (it.set && SETS[it.set]) {
    const s = SETS[it.set];
    fx = fx || { hex: s.hex, el: s.el };
    if (it.slot === 'armor') fx.aura = fx.aura ?? s.hex;
    if (it.slot === 'weapon') fx.scale = fx.scale ?? 1.3;
    if (it.slot === 'charm') fx.orbit = fx.orbit ?? s.hex;
    // the giant set's two-piece bonus grows the weapon
    if (it.slot === 'weapon' && equipment && setCounts(equipment).giant >= 2) fx.scale = Math.max(fx.scale, 2.0);
  }
  // primal gear burns brighter, and its weapon is bigger still
  if (fx && it.rarity && it.rarity.tier >= 6) {
    fx.scale = (fx.scale || 1.2) * 1.15;
    fx.primal = true;
  }
  return fx;
}

// Element colours for particles.
export const EL_COLORS = {
  fire: [0xff5a1a, 0xffb347, 0xffe08a],
  frost: [0x9fe8ff, 0xffffff, 0x5ab4ff],
  storm: [0x7ad8ff, 0xffffff, 0xb0e8ff],
  blood: [0xff2040, 0x8a0010, 0xff6070],
  void: [0xb04dff, 0x40205a, 0xd090ff],
  gold: [0xffd700, 0xffe88a, 0xffb020],
  thorn: [0x7adf4a, 0x3a8a20, 0xb0ff80],
  soul: [0x9fffb0, 0xe0fff0, 0x60d080],
};
const elColor = (el) => {
  const c = EL_COLORS[el] || EL_COLORS.gold;
  return c[Math.floor(Math.random() * c.length)];
};

// Particles for a dressed hero (local or remote): flames off a burning weapon, an
// aura rising off cursed armour.
export function emitGearFx(model, fx, dt, pos) {
  const g = model.gearFx;
  if (!g || !fx) return;
  const w = g.weapon;
  if (w && w.el && model.tips.length) {
    const rate = (w.primal ? 40 : 22) * dt;
    for (let i = 0; i < rate || Math.random() < rate - i; i++) {
      const tip = model.tips[Math.floor(Math.random() * model.tips.length)];
      const v = model.tipOf(tip, (model._fxv = model._fxv || pos.clone()), 0.2 + Math.random() * 0.8);
      fx.puff(v.x, v.y, v.z, elColor(w.el), w.el === 'fire' ? 0.2 : 0.13, w.el === 'fire' ? 0.45 : 0.35);
      if (i > 4) break;
    }
  }
  const a = g.armor;
  if (a && a.el) {
    const rate = (a.el === 'fire' ? 26 : 12) * dt;
    for (let i = 0; i < rate || Math.random() < rate - i; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = 0.35 + Math.random() * 0.3;
      fx.puff(pos.x + Math.cos(ang) * r, pos.y + 0.3 + Math.random() * 1.4 * (model.sizeK || 1), pos.z + Math.sin(ang) * r, elColor(a.el), a.el === 'fire' ? 0.28 : 0.18, a.el === 'fire' ? 0.5 : 0.6);
      if (i > 4) break;
    }
  }
}

// ---------------------------------------------------------------- runtime
// The local hero's powers in action.
export class Powers {
  constructor(p) {
    this.p = p;
    this.set = new Set();
    this.t = 0;
    this.hits = 0;
    this.cometT = 3;
    this.pulseT = 4;
    this.novaCd = 0;
    this.quakeCd = 0;
    this.wrath = { n: 0, t: 0 };
    this.shadowT = 0;
    this.shadowHit = false;
    this.rebirthUsed = false;
    this.blades = null;
  }

  has(id) {
    return this.set.has(id);
  }

  dmg(mult) {
    const p = this.p;
    return p.final.damage * mult * (1 + this.wrathBonus());
  }

  wrathBonus() {
    return this.wrath.t > 0 ? this.wrath.n * 0.04 : 0;
  }

  // per-floor reset
  newFloor() {
    this.rebirthUsed = false;
    this.wrath = { n: 0, t: 0 };
  }

  // Extra damage factor applied to the hero's own hits.
  outgoing(amount) {
    let a = amount * (1 + this.wrathBonus());
    if (this.shadowT > 0 && !this.shadowHit) {
      this.shadowHit = true;
      this.shadowT = 0;
      a *= 3;
    }
    return a;
  }

  // A direct hit of ours just landed on e.
  onHit(e, amount, hit, game) {
    const fx = game.effects;
    this.hits++;
    if (this.has('ignite')) e.status({ burn: [3, this.dmg(0.6) * 0.35] });
    if (this.has('chill')) e.status({ slow: [2, 0.55] });
    if (this.has('freeze') && Math.random() < 0.15) {
      e.status({ freeze: 1.4 });
      fx.burst(e.x, e.y + e.height * 0.5, e.z, 0x9fe8ff, 10, 4, 0.12, 0.4);
    }
    if (this.has('behead') && !e.def.boss && e.alive && e.hp - amount < e.maxHp * 0.2 && e.hp > amount) {
      fx.burst(e.x, e.y + e.height, e.z, 0xb04dff, 24, 8, 0.2, 0.6);
      fx.damageNumber(e.x, e.y + e.height + 0.6, e.z, 'EXECUTED', 'crit');
      game.damageEnemy(e, { amount: e.hp + e.maxHp, crit: true, knock: 6, noProc: true }, this.p.x, this.p.z);
      return;
    }
    if (this.has('arc') && (hit.crit || Math.random() < 0.3)) this.chainLightning(e, game);
    if (this.has('critbolt') && hit.crit) {
      game.skyStrike(e.x, e.z, 2.2, () => ({ amount: this.dmg(1.2), crit: false, knock: 2, noProc: true }), 0x9fe0ff);
      sfx.frost();
    }
    if (this.has('midas') && hit.crit) game.dropGold(e.x, e.z, Math.max(1, Math.round(2 + game.floor)));
    const quake = (this.has('split') && this.hits % 3 === 0) || this.has('quake');
    if (quake && this.quakeCd <= 0) {
      this.quakeCd = this.has('quake') ? 0.5 : 0;
      this.earthsplit(e.x, e.z, game, this.has('quake') ? 3.2 : 4);
    }
  }

  earthsplit(x, z, game, r) {
    const fx = game.effects;
    fx.ring(x, z, r, 0xffc24a, 0.35);
    fx.spikes(x, z, 0x8a7a60, r * 0.6);
    fx.burst(x, 0.3, z, 0x9a8a70, 14, 7, 0.2, 0.5);
    fx.shake(0.3);
    sfx.slam();
    game.hitEnemiesInRadius(x, z, r, () => ({ amount: this.dmg(0.9), crit: false, knock: 7, launch: 5, noProc: true }));
  }

  chainLightning(from, game) {
    let cur = from;
    const done = new Set([from]);
    const pts = [[from.x, from.y + from.height * 0.6, from.z]];
    for (let i = 0; i < 4; i++) {
      let best = null;
      let bd = 7;
      for (const o of game.enemies) {
        if (!o.alive || done.has(o) || o.disguised || o.dormant) continue;
        const d = Math.hypot(o.x - cur.x, o.z - cur.z);
        if (d < bd) {
          bd = d;
          best = o;
        }
      }
      if (!best) break;
      done.add(best);
      pts.push([best.x, best.y + best.height * 0.6, best.z]);
      game.damageEnemy(best, { amount: this.dmg(0.7), crit: false, knock: 1, noProc: true }, cur.x, cur.z);
      cur = best;
    }
    if (pts.length > 1) {
      game.lightning(pts, 0x9fe0ff);
      sfx.frost();
    }
  }

  // We killed e.
  onKill(e, game) {
    const p = this.p;
    const fx = game.effects;
    if (this.has('feast')) p.heal(p.final.maxHp * 0.06);
    if (this.has('wrath')) {
      this.wrath.n = Math.min(10, this.wrath.n + 1);
      this.wrath.t = 8;
    }
    if (this.has('souls')) {
      const t = game.findTarget(e.x, e.z, 0, 16, Math.PI);
      if (t) {
        game.shoot({ from: { x: e.x, y: e.groundY || 0, z: e.z }, heading: Math.atan2(t.x - e.x, t.z - e.z), speed: 14, life: 2.2, kind: 'orb', radius: 0.5, dmg: () => ({ amount: this.dmg(1.0), crit: false, noProc: true }), knock: 2, homing: t });
      }
    }
    if (this.has('corpseboom')) {
      const dmg = e.maxHp * 0.4;
      fx.burst(e.x, e.y + 0.6, e.z, 0xe8e0c8, 20, 8, 0.18, 0.5);
      fx.ring(e.x, e.z, 3, 0xe8e0c8, 0.3);
      sfx.boom();
      game.schedule(0.05, () => game.hitEnemiesInRadius(e.x, e.z, 3, (o) => (o === e ? null : { amount: dmg, crit: false, knock: 6, noProc: true })));
    }
  }

  // We took a hit (after mitigation). Returns nothing.
  onHurt(dmg, src, melee, game) {
    const p = this.p;
    const fx = game.effects;
    if (this.has('spikes') && melee && src && src.alive) {
      game.damageEnemy(src, { amount: dmg * 2.5 + this.dmg(0.5), crit: false, knock: 4, noProc: true }, p.x, p.z);
      fx.spikes(p.x, p.z, 0x7adf4a, 1.2);
    }
    if (this.has('frostnova') && this.novaCd <= 0) {
      this.novaCd = 3;
      this.frostNova(game, 4.5);
    }
  }

  frostNova(game, r) {
    const p = this.p;
    game.effects.ring(p.x, p.z, r, 0x9fe8ff, 0.45, p.y + 0.1);
    game.effects.iceShards(p.x, p.z, r * 0.8);
    sfx.frost();
    game.hitEnemiesInRadius(p.x, p.z, r, (e) => {
      e.status({ freeze: e.def.boss ? 0.6 : 2 });
      return { amount: this.dmg(0.8), crit: false, knock: 3, noProc: true };
    });
  }

  // About to die: the Phoenix Mantle says no (once per floor).
  cheatDeath(game) {
    if (!this.has('rebirth') || this.rebirthUsed) return false;
    this.rebirthUsed = true;
    const p = this.p;
    p.hp = p.final.maxHp * 0.6;
    p.invuln = 2;
    const fx = game.effects;
    fx.ring(p.x, p.z, 6, 0xffa040, 0.6, p.y + 0.1);
    fx.burst(p.x, p.y + 1, p.z, 0xffa040, 40, 10, 0.25, 0.8);
    fx.shake(0.8);
    sfx.boom();
    game.ui.toast('🔥 Reborn in flame! 🔥', 2, '#ffb347');
    game.hitEnemiesInRadius(p.x, p.z, 6, () => ({ amount: this.dmg(3), crit: true, knock: 12, launch: 7, noProc: true }));
    return true;
  }

  onDash(game) {
    if (this.has('shadow')) {
      this.shadowT = 1.5;
      this.shadowHit = false;
      game.effects.smoke(this.p.x, this.p.z);
    }
  }

  onSkill(idx) {
    if (this.has('refresh') && Math.random() < 0.25) {
      this.p.cooldowns[idx] = 0;
      this.p.game.effects.damageNumber(this.p.x, this.p.y + 2.4, this.p.z, '⟳ Refreshed', 'heal');
    }
  }

  onLand(game) {
    if (!this.has('quakeland')) return;
    const p = this.p;
    if (this.landCd > 0) return;
    this.landCd = 0.6;
    this.earthsplit(p.x, p.z, game, 3.5);
  }

  onGold() {
    if (this.has('goldheal')) this.p.heal(this.p.final.maxHp * 0.01, false);
  }

  update(dt, game) {
    const p = this.p;
    if (p.dead) return;
    this.t += dt;
    this.quakeCd -= dt;
    this.novaCd -= dt;
    this.landCd = (this.landCd || 0) - dt;
    if (this.wrath.t > 0) {
      this.wrath.t -= dt;
      if (this.wrath.t <= 0) this.wrath.n = 0;
    }
    if (this.shadowT > 0) this.shadowT -= dt;
    p.model.setOpacity?.(this.shadowT > 0 ? 0.35 : 1);
    if (this.has('firecloak')) {
      this.cloakT = (this.cloakT || 0) - dt;
      if (this.cloakT <= 0) {
        this.cloakT = 0.5;
        game.hitEnemiesInRadius(p.x, p.z, 3.5, (e) => {
          e.status({ burn: [1.2, this.dmg(0.2)] });
          return { amount: this.dmg(0.45), crit: false, knock: 0, silent: true, dot: 'dot', noProc: true };
        });
      }
    }
    if (this.has('frostpulse')) {
      this.pulseT -= dt;
      if (this.pulseT <= 0) {
        this.pulseT = 6;
        this.frostNova(game, 5.5);
      }
    }
    if (this.has('comet')) {
      this.cometT -= dt;
      if (this.cometT <= 0) {
        const t = game.findTarget(p.x, p.z, p.heading, 14, Math.PI);
        this.cometT = t ? 5 : 1;
        if (t) {
          const x = t.x;
          const z = t.z;
          game.effects.telegraph(x, z, 3, 0.7, 0xff8a3a);
          game.effects.meteor(x, z, 0.7);
          game.schedule(0.7, () => {
            game.effects.ring(x, z, 3, 0xff8a3a, 0.4);
            game.effects.burst(x, 0.4, z, 0xff8a3a, 24, 9, 0.22, 0.6);
            game.effects.shake(0.35);
            sfx.boom();
            game.hitEnemiesInRadius(x, z, 3, (e) => {
              e.status({ burn: [2, this.dmg(0.3)] });
              return { amount: this.dmg(2.2), crit: false, knock: 8, launch: 4, noProc: true };
            });
          });
        }
      }
    }
    if (this.has('blades')) this.updateBlades(dt, game);
    else if (this.blades) this.dropBlades();
  }

  updateBlades(dt, game) {
    const p = this.p;
    if (!this.blades) this.blades = { hit: new Map() };
    const B = this.blades;
    const pts = [];
    for (let i = 0; i < 3; i++) {
      const a = this.t * 3.2 + (i * Math.PI * 2) / 3;
      pts.push([p.x + Math.cos(a) * 2.2, p.y + 1, p.z + Math.sin(a) * 2.2]);
    }
    if (Math.random() < 0.9) for (const q of pts) game.effects.puff(q[0], q[1], q[2], 0xdfe8ff, 0.16, 0.18);
    for (const [e, t] of B.hit) if (t <= this.t) B.hit.delete(e);
    for (const e of game.enemies) {
      if (!e.alive || e.disguised || B.hit.has(e)) continue;
      for (const q of pts) {
        if (Math.hypot(e.x - q[0], e.z - q[2]) < e.radius + 0.6) {
          B.hit.set(e, this.t + 0.5);
          game.damageEnemy(e, { amount: this.dmg(0.5), crit: false, knock: 2, noProc: true }, p.x, p.z);
          break;
        }
      }
    }
  }

  dropBlades() {
    this.blades = null;
  }

  // status line for the HUD (wrath stacks, shadow)
  buffText() {
    const out = [];
    if (this.wrath.t > 0 && this.wrath.n) out.push(`🩸${this.wrath.n * 4}%`);
    if (this.shadowT > 0) out.push('🌑');
    return out.join(' ');
  }
}

// Little helper for the item card: the unique/set lines of an item.
export function legendLines(it, equipment) {
  const out = [];
  for (const id of uniquesOf(it)) out.push({ kind: 'unique', name: UNIQUES[id].name, desc: UNIQUES[id].desc });
  if (it.set && SETS[it.set]) {
    const s = SETS[it.set];
    const counts = setCounts(equipment || {});
    // counting as if this item were worn
    const worn = equipment && equipment[it.slot] && equipment[it.slot].set === it.set;
    const n = (counts[it.set] || 0) + (worn ? 0 : 1);
    out.push({ kind: 'set', name: `${s.name} set (${Math.min(3, n)}/3)`, color: s.color, two: s.two.desc, three: s.three.desc, n });
  }
  return out;
}
