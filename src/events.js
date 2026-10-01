// Floor events and the people of the dungeon: the wandering merchant, cursed altars
// (a bargain for the floor), the trial shrine (survive the waves for a treasure),
// and freed prisoners who fight at your side until the floor ends.

import * as THREE from 'three';
import { G, mat, part } from './rig.js';
import { propModel } from './assets.js';
import { CharacterModel } from './model.js';
import { HERO_LOOKS, dressHero } from './hero.js';
import { generateItem, RARITIES } from './items.js';
import { sfx } from './audio.js';
import { rng, angleDiff, clamp } from './utils.js';

// ------------------------------------------------------------------ meshes
function prop(name, scale = 1) {
  const m = propModel(name);
  if (!m) return new THREE.Group();
  m.scale.setScalar(scale);
  m.traverse((o) => o.isMesh && (o.castShadow = true));
  return m;
}

export function buildMerchant(x, y, z, heading) {
  const g = new THREE.Group();
  const own = [];
  const npc = new CharacterModel('Barbarian', { scale: 0.85 });
  const look = HERO_LOOKS.barbarian;
  npc.only(look.gear, ['Mug', 'Barbarian_Hat']);
  npc.animator.setBase({ Idle: 1 });
  npc.group.position.set(0, 0, -0.9);
  g.add(npc.group);
  const table = prop('table_medium_decorated_A', 0.8);
  table.position.set(0, 0, 0.3);
  g.add(table);
  const coins = prop('coin_stack_large', 0.8);
  coins.position.set(-0.5, 0.82, 0.3);
  g.add(coins);
  const lamp = prop('lantern_standing', 0.8);
  lamp.position.set(1.3, 0, -0.4);
  g.add(lamp);
  const trunk = prop('trunk_large_A', 0.7);
  trunk.position.set(-1.4, 0, -0.6);
  trunk.rotation.y = 0.5;
  g.add(trunk);
  // a glowing sign so it can be spotted across the room
  const signMat = mat(0xffd34d, { emissive: 0xffb020, ei: 1.4 });
  own.push(signMat);
  part(g, G.octa(0.18), signMat, [0, 2.9, -0.9]);
  g.position.set(x, y, z);
  g.rotation.y = heading;
  return { mesh: g, npc, mats: own };
}

export function buildAltar(x, y, z) {
  const g = new THREE.Group();
  const shrine = prop('shrine_candles', 1.1);
  g.add(shrine);
  const glow = mat(0xff2030, { emissive: 0xff1020, ei: 2.2 });
  const stone = mat(0x2a1a1e, { rough: 0.9 });
  const orb = part(g, G.octa(0.3), glow, [0, 2.6, 0], null, [1, 1.5, 1]);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const c = prop('candle_triple', 0.9);
    c.position.set(Math.cos(a) * 1.05, 0, Math.sin(a) * 1.05);
    g.add(c);
  }
  const ring = part(g, G.torus(1.3, 0.05, Math.PI * 2, 4, 32), glow, [0, 0.06, 0], [-Math.PI / 2, 0, 0]);
  part(g, G.cyl(1.25, 1.35, 0.1, 18), stone, [0, 0.02, 0]);
  g.position.set(x, y, z);
  return { mesh: g, orb, ring, mats: [glow, stone] };
}

export function buildTrial(x, y, z) {
  const g = new THREE.Group();
  const pillar = prop('pillar_decorated', 0.9);
  g.add(pillar);
  const glow = mat(0x6ad8ff, { emissive: 0x3aa8ff, ei: 2 });
  const gold = mat(0xe8c14a, { metal: 0.6, rough: 0.3 });
  const crystal = part(g, G.octa(0.35), glow, [0, 3.6, 0], null, [1, 1.6, 1]);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const post = prop('post_skull', 0.9);
    post.position.set(Math.cos(a) * 3, 0, Math.sin(a) * 3);
    post.rotation.y = -a;
    g.add(post);
  }
  const ring = part(g, G.torus(3, 0.06, Math.PI * 2, 4, 48), glow, [0, 0.07, 0], [-Math.PI / 2, 0, 0]);
  part(g, G.torus(0.5, 0.06, Math.PI * 2, 4, 20), gold, [0, 3.1, 0], [-Math.PI / 2, 0, 0]);
  g.position.set(x, y, z);
  return { mesh: g, crystal, ring, mats: [glow, gold] };
}

// ---------------------------------------------------------------- the merchant
// Stock: one showpiece (set or unique), two good pieces, a healing elixir and a
// mystery cache. Prices grow with the floor and the item's rarity.
export function merchantStock(floor, clsId, rarityBonus = 0) {
  const showpiece = rng.next() < 0.5 ? generateItem(floor, clsId, 8 + rarityBonus, 4, null, { unique: true }) : generateItem(floor, clsId, 6 + rarityBonus, 3, null, { set: ['inferno', 'frost', 'storm', 'bone', 'giant'][Math.floor(rng.next() * 5)] });
  const items = [showpiece, generateItem(floor, clsId, 4 + rarityBonus, 2), generateItem(floor, clsId, 4 + rarityBonus, 2)];
  const base = 25 + floor * 12;
  const out = items.map((it) => ({ kind: 'item', item: it, price: Math.round(base * (1 + it.rarity.tier * 0.9) * (it.u ? 1.3 : 1)) }));
  out.push({ kind: 'elixir', name: 'Elixir of Life', desc: 'heal to full', price: Math.round(base * 0.8) });
  out.push({ kind: 'cache', name: 'Mystery Cache', desc: 'a random item, rare or better — maybe much better', price: Math.round(base * 1.6) });
  return out;
}

// ------------------------------------------------------------- cursed altars
// A pact lasts until the floor ends. stats feed the hero; curse the world.
export const PACTS = [
  { id: 'blood', icon: '🩸', name: 'Pact of Blood', boon: '+60% damage', bane: '−35% max health', stats: { dmgPct: 0.6, hpPct: -0.35 } },
  { id: 'greed', icon: '💰', name: 'Pact of Greed', boon: 'monsters drop triple gold and twice the loot', bane: 'your hits deal 35% less damage', curse: { gold: 3, loot: 2, dmgDealt: 0.65 } },
  { id: 'haste', icon: '⚡', name: 'Pact of Haste', boon: '+35% move and attack speed', bane: 'you take 40% more damage', stats: { moveSpeed: 0.35, attackSpeed: 0.35, dmgTakenPct: 0.4 } },
  { id: 'glass', icon: '🔮', name: 'Pact of Glass', boon: '+20% crit chance, +120% crit damage', bane: 'max health halved', stats: { crit: 0.2, critMult: 1.2, hpPct: -0.5 } },
  { id: 'war', icon: '⚔️', name: 'Pact of War', boon: 'a legendary (or better) item, right now', bane: 'an elite warband answers the call', host: true },
];

export function rollPacts(canSpawn) {
  const pool = PACTS.filter((p) => canSpawn || !p.host);
  const out = [];
  while (out.length < 2 && pool.length) out.push(pool.splice(Math.floor(rng.next() * pool.length), 1)[0]);
  return out;
}

// ----------------------------------------------------------------- the trial
export const TRIAL_WAVES = [
  { n: 5, elites: 0 },
  { n: 7, elites: 1 },
  { n: 9, elites: 2 },
];

// ------------------------------------------------------------------- allies
// A freed prisoner: follows you and fights whatever is closest. Can't be hurt, and
// leaves when the floor ends.
const ALLY_ATTACK = {
  knight: { clip: '1H_Melee_Attack_Chop', range: 2.4, cd: 0.9, mult: 0.7 },
  barbarian: { clip: '2H_Melee_Attack_Chop', range: 2.6, cd: 1.1, mult: 0.9 },
  rogue: { clip: '1H_Melee_Attack_Stab', range: 2.2, cd: 0.6, mult: 0.5 },
  ranger: { clip: '2H_Ranged_Shoot', range: 11, cd: 1.0, mult: 0.6, shot: 'arrow' },
  mage: { clip: 'Spellcast_Shoot', range: 11, cd: 1.1, mult: 0.7, shot: 'missile' },
};

export class Ally {
  constructor(game, cls, x, z) {
    this.game = game;
    this.cls = cls;
    this.x = x;
    this.z = z;
    this.y = game.dungeon.floorAt(x, z);
    this.heading = 0;
    this.radius = 0.4;
    this.cd = 0.5;
    this.speed = 0;
    this.model = new CharacterModel(HERO_LOOKS[cls].model, { scale: 0.8 });
    this.model.cfg = HERO_LOOKS[cls];
    this.model.clsId = cls;
    this.model.extras = new THREE.Group();
    this.model.group.add(this.model.extras);
    // dressed in decent gear: rare weapon and armour in the ally's colour
    const r = RARITIES[2];
    dressHero(this.model, { weapon: { slot: 'weapon', rarity: r }, armor: { slot: 'armor', rarity: r }, charm: null });
    this.model.bodyGlow(0x3a8aff, 0.12, HERO_LOOKS[cls].gear);
    this.mesh = this.model.group;
    game.scene.add(this.mesh);
    game.applyShadows?.(this.mesh);
    this.atk = ALLY_ATTACK[cls];
  }

  update(dt) {
    const g = this.game;
    const p = g.player;
    const dg = g.dungeon;
    this.cd -= dt;
    // nearest awake enemy within 10 m of the ally (and not too far from the hero)
    let t = null;
    let bd = 10;
    for (const e of g.enemies) {
      if (!e.alive || e.disguised || e.dormant || e.def.cage) continue;
      const d = Math.hypot(e.x - this.x, e.z - this.z);
      if (d < bd && Math.hypot(e.x - p.x, e.z - p.z) < 16) {
        bd = d;
        t = e;
      }
    }
    let gx;
    let gz;
    let stop;
    if (t) {
      gx = t.x;
      gz = t.z;
      stop = this.atk.range * 0.85 + t.radius;
    } else {
      // heel: stay a couple of metres behind the hero
      gx = p.x - Math.sin(p.heading) * 2;
      gz = p.z - Math.cos(p.heading) * 2;
      stop = 1.2;
    }
    const dx = gx - this.x;
    const dz = gz - this.z;
    const d = Math.hypot(dx, dz);
    // too far behind (another room, a platform): catch up by stepping out of the shadows
    if (Math.hypot(p.x - this.x, p.z - this.z) > 22) {
      this.x = p.x - Math.sin(p.heading) * 1.5;
      this.z = p.z - Math.cos(p.heading) * 1.5;
      g.effects.smoke(this.x, this.z);
    }
    if (d > stop) {
      const sp = d > 6 ? 8 : 6;
      const before = { x: this.x, z: this.z };
      dg.move(this, (dx / d) * sp * dt, (dz / d) * sp * dt, true);
      this.speed = Math.hypot(this.x - before.x, this.z - before.z) / Math.max(dt, 1e-4);
      this.heading += angleDiff(this.heading, Math.atan2(dx, dz)) * Math.min(1, dt * 10);
    } else {
      this.speed = 0;
      if (t) this.heading += angleDiff(this.heading, Math.atan2(dx, dz)) * Math.min(1, dt * 12);
    }
    const ground = dg.maxHeightUnder(this.x, this.z, this.radius);
    if (ground < 50) this.y += (ground - this.y) * Math.min(1, dt * 12);
    if (t && d <= this.atk.range + t.radius && this.cd <= 0) this.strike(t);
    this.animate(dt);
  }

  strike(t) {
    const g = this.game;
    const p = g.player;
    const a = this.atk;
    this.cd = a.cd;
    this.model.animator.play(a.clip, { part: 'upper', dur: 0.55, fadeIn: 0.05, fadeOut: 0.2 });
    const dmg = () => ({ amount: p.final.damage * a.mult * (0.9 + Math.random() * 0.2), crit: false, noProc: true });
    if (a.shot) {
      g.shoot({ from: this, heading: Math.atan2(t.x - this.x, t.z - this.z), speed: 24, life: 0.8, kind: a.shot, dmg, knock: 2, homing: t });
      sfx.arrow();
    } else {
      g.schedule(0.2, () => {
        if (!t.alive) return;
        g.effects.slash(this.x, this.y + 1, this.z, this.heading, 2, 0x9fc8ff);
        g.damageEnemy(t, { ...dmg(), knock: 3 }, this.x, this.z);
      });
      sfx.swing();
    }
  }

  animate(dt) {
    const an = this.model.animator;
    const run = this.model.cfg.run;
    const w = clamp((this.speed - 2) / 3, 0, 1);
    if (this.speed < 0.4) an.setBase({ Idle: 1 });
    else an.setBase({ Walking_A: 1 - w, [run]: w });
    this.mesh.position.set(this.x, this.y, this.z);
    this.mesh.rotation.y = this.heading;
    this.model.update(dt);
  }

  dispose() {
    this.game.scene.remove(this.mesh);
    this.model.dispose();
  }
}
