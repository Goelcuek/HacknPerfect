// Loot (equipment with random affixes) and the stat blessings sold between floors.

import { rng, weightedPick } from './utils.js';
import { CLASSES, WEAPON_NAMES, ARMOR_NAMES } from './classes.js';
import { UNIQUES, SETS, SET_IDS, rollUniques, uniquesOf } from './legend.js';

export const RARITIES = [
  { id: 'common', tier: 0, name: 'Common', color: '#d8d8d8', hex: 0xd8d8d8, mult: 1.0, affixes: 0, w: 55 },
  { id: 'magic', tier: 1, name: 'Magic', color: '#5aa9ff', hex: 0x5aa9ff, mult: 1.2, affixes: 1, w: 28 },
  { id: 'rare', tier: 2, name: 'Rare', color: '#ffd84a', hex: 0xffd84a, mult: 1.45, affixes: 2, w: 12 },
  { id: 'epic', tier: 3, name: 'Epic', color: '#c77dff', hex: 0xc77dff, mult: 1.75, affixes: 3, w: 4 },
  { id: 'legendary', tier: 4, name: 'Legendary', color: '#ff8c2e', hex: 0xff8c2e, mult: 2.1, affixes: 4, w: 1 },
  // deeper down: mythic from floor 8, primal from floor 15 (two uniques, everything bigger)
  { id: 'mythic', tier: 5, name: 'Mythic', color: '#ff3355', hex: 0xff3355, mult: 2.75, affixes: 5, w: 0.3, from: 8 },
  { id: 'primal', tier: 6, name: 'Primal', color: '#2effd5', hex: 0x2effd5, mult: 3.6, affixes: 6, w: 0.1, from: 15 },
];
// set pieces are their own colour, at legendary strength
export const SET_RARITY = { id: 'set', tier: 4, name: 'Set', color: '#3dff8a', hex: 0x3dff8a, mult: 2.0, affixes: 3, w: 0 };
export const ALL_RARITIES = [...RARITIES, SET_RARITY];

// How strong gear is on a floor. Past floor 20 (endless) it keeps compounding.
export function floorPower(f) {
  return (3 + f * 1.7) * (f > 20 ? Math.pow(1.13, f - 20) : 1);
}

export const STAT_LABELS = {
  damage: ['Damage', (v) => `+${Math.round(v)}`],
  dmgPct: ['Damage', (v) => `+${Math.round(v * 100)}%`],
  armor: ['Armor', (v) => `+${Math.round(v)}`],
  maxHp: ['Max Health', (v) => `+${Math.round(v)}`],
  attackSpeed: ['Attack Speed', (v) => `+${Math.round(v * 100)}%`],
  crit: ['Crit Chance', (v) => `+${Math.round(v * 100)}%`],
  critMult: ['Crit Damage', (v) => `+${Math.round(v * 100)}%`],
  lifesteal: ['Life Steal', (v) => `+${(v * 100).toFixed(1)}%`],
  moveSpeed: ['Move Speed', (v) => `+${Math.round(v * 100)}%`],
  cdr: ['Cooldown Red.', (v) => `+${Math.round(v * 100)}%`],
  skillPower: ['Skill Damage', (v) => `+${Math.round(v * 100)}%`],
  goldFind: ['Gold Find', (v) => `+${Math.round(v * 100)}%`],
  hpPct: ['Max Health', (v) => `+${Math.round(v * 100)}%`],
  armorPct: ['Armor', (v) => `+${Math.round(v * 100)}%`],
};

// how much each stat is "worth" for the quick comparison score
const STAT_WEIGHT = {
  damage: 3,
  dmgPct: 60,
  armor: 1.5,
  maxHp: 0.5,
  attackSpeed: 60,
  crit: 70,
  critMult: 25,
  lifesteal: 400,
  moveSpeed: 50,
  cdr: 60,
  skillPower: 45,
  goldFind: 10,
  hpPct: 80,
  armorPct: 50,
};

const AFFIXES = [
  { stat: 'dmgPct', roll: (f) => 0.05 + rng.next() * 0.07 + Math.min(f, 40) * 0.004 },
  { stat: 'attackSpeed', roll: () => 0.05 + rng.next() * 0.08 },
  { stat: 'crit', roll: () => 0.03 + rng.next() * 0.05 },
  { stat: 'critMult', roll: () => 0.15 + rng.next() * 0.25 },
  { stat: 'maxHp', roll: (f) => (8 + rng.next() * 10) * (floorPower(f) / 4.7) },
  { stat: 'lifesteal', roll: () => 0.01 + rng.next() * 0.02 },
  { stat: 'moveSpeed', roll: () => 0.04 + rng.next() * 0.05 },
  { stat: 'cdr', roll: () => 0.04 + rng.next() * 0.06 },
  { stat: 'skillPower', roll: (f) => 0.08 + rng.next() * 0.12 + Math.min(f, 40) * 0.005 },
  { stat: 'goldFind', roll: () => 0.1 + rng.next() * 0.2 },
  { stat: 'armor', roll: (f) => (2 + rng.next() * 3) * (floorPower(f) / 4.7) },
];

const CHARM_NAMES = ['Amulet', 'Talisman', 'Ring', 'Sigil', 'Charm', 'Relic'];
const PREFIX = {
  common: ['Worn', 'Plain', 'Iron', 'Simple'],
  magic: ['Tempered', 'Glinting', 'Runed', 'Honed'],
  rare: ['Gilded', 'Stormforged', 'Serpent', 'Blessed'],
  epic: ['Voidtouched', 'Dragonbone', 'Soulbound', 'Astral'],
  legendary: ['Godslayer', 'Eternal', 'Worldender', 'Fabled'],
  mythic: ['Abyssal', 'Starforged', 'Doombringer', 'Titanic'],
  primal: ['Primal', 'Primordial', 'Cataclysmic', 'Ascendant'],
};

export const SLOTS = ['weapon', 'armor', 'charm'];
export const SLOT_ICON = { weapon: '⚔️', armor: '🛡️', charm: '💎' };

export function rollRarity(floor, bonus = 0, minRarity = 0) {
  // deeper floors and elites/chests shift odds toward better loot
  const shift = Math.min(floor, 40) * 0.6 + bonus;
  const entries = RARITIES.map((r, i) => ({ r, w: r.from && floor < r.from ? 0 : r.w * (i === 0 ? Math.max(0.2, 1 - shift * 0.04) : 1 + shift * 0.08 * i) })).slice(Math.min(minRarity, RARITIES.length - 1));
  if (!entries.some((e) => e.w > 0)) return entries[0].r;
  return weightedPick(rng, entries).r;
}

// clsId decides the weapon type and naming so drops always suit the hero.
// o.set / o.unique force a set piece or a unique (rewards, merchant stock).
export function generateItem(floor, clsId, rarityBonus = 0, minRarity = 0, slot = null, o = {}) {
  let rarity = rollRarity(floor, rarityBonus, minRarity);
  slot = slot || rng.pick(SLOTS);
  // epic or better can come as a set piece (from floor 3)
  const setId = o.set || (rarity.tier >= 3 && rarity.tier <= 4 && floor >= 3 && rng.next() < 0.22 ? rng.pick(SET_IDS) : null);
  if (setId) rarity = SET_RARITY;
  const pw = floorPower(floor);
  const stats = {};
  if (slot === 'weapon') stats.damage = pw * rarity.mult * (0.85 + rng.next() * 0.3);
  if (slot === 'armor') {
    stats.armor = pw * 0.75 * rarity.mult * (0.85 + rng.next() * 0.3);
    stats.maxHp = pw * 2.6 * rarity.mult;
  }
  let nAff = rarity.affixes + (slot === 'charm' ? 1 : 0);
  const pool = AFFIXES.slice();
  while (nAff-- > 0 && pool.length) {
    const a = pool.splice(Math.floor(rng.next() * pool.length), 1)[0];
    stats[a.stat] = (stats[a.stat] || 0) + a.roll(floor) * (0.8 + rarity.mult * 0.2);
  }
  // uniques: often on legendaries, always on mythic, two on primal
  let u = [];
  if (!setId) {
    const n = rarity.tier >= 6 ? 2 : rarity.tier >= 5 ? 1 : rarity.tier === 4 && (o.unique || rng.next() < 0.6) ? 1 : 0;
    u = rollUniques(slot, n);
  }
  const cls = CLASSES[clsId] || CLASSES.knight;
  const base = slot === 'weapon' ? rng.pick(WEAPON_NAMES[cls.weapon]) : slot === 'armor' ? rng.pick(ARMOR_NAMES[cls.id]) : rng.pick(CHARM_NAMES);
  let name;
  if (setId) name = `${SETS[setId].name} ${base}`;
  else if (u.length === 2) name = `${rng.pick(PREFIX[rarity.id])} ${UNIQUES[u[0]].name} of ${UNIQUES[u[1]].name.replace(/^(The |Edge of |Heart of the |Ring of |Wrath of |Ring of )/, '')}`;
  else if (u.length === 1) name = rarity.tier >= 5 ? `${rng.pick(PREFIX[rarity.id])} ${UNIQUES[u[0]].name}` : UNIQUES[u[0]].name;
  else name = `${rng.pick(PREFIX[rarity.id])} ${base}`;
  const item = { slot, rarity, name, stats, level: floor, visual: { variant: rng.int(0, 2), hue: rng.next() } };
  if (u.length) item.u = u;
  if (setId) item.set = setId;
  if (slot === 'weapon') item.wtype = cls.weapon;
  return item;
}

export function itemScore(item) {
  if (!item) return 0;
  let s = 0;
  for (const k in item.stats) s += item.stats[k] * (STAT_WEIGHT[k] || 1);
  // a unique power or set bonus is worth a lot on its own
  s += uniquesOf(item).length * (40 + item.level * 6);
  if (item.set) s += 30 + item.level * 4;
  return s;
}

export function formatStats(item, compare) {
  const keys = new Set(Object.keys(item.stats));
  if (compare) for (const k of Object.keys(compare.stats)) keys.add(k);
  const lines = [];
  for (const k of keys) {
    const [label, fmt] = STAT_LABELS[k];
    const v = item.stats[k] || 0;
    const old = compare ? compare.stats[k] || 0 : v;
    let cls = '';
    if (compare) cls = v > old + 1e-6 ? 'up' : v < old - 1e-6 ? 'down' : '';
    lines.push({ label, value: v ? fmt(v) : '—', cls });
  }
  return lines;
}

// ----------------------------------------------------------------- blessings
// Stat boosts bought at the shrine between floors. `max` limits stacking.
export const BLESSINGS = [
  { id: 'dmg', icon: '🗡️', name: 'Sharpened Edge', desc: '+15% damage', w: 10, max: 10, apply: (p) => (p.stats.dmgPct += 0.15) },
  { id: 'hp', icon: '❤️', name: 'Vitality', desc: '+25 max health and heal 25', w: 10, max: 10, apply: (p) => { p.stats.maxHp += 25; p.hp += 25; } },
  { id: 'as', icon: '⚡', name: 'Frenzy', desc: '+12% attack speed', w: 8, max: 6, apply: (p) => (p.stats.attackSpeed += 0.12) },
  { id: 'crit', icon: '🎯', name: 'Keen Eye', desc: '+6% critical chance', w: 8, max: 6, apply: (p) => (p.stats.crit += 0.06) },
  { id: 'critm', icon: '💥', name: 'Brutality', desc: '+35% critical damage', w: 6, max: 5, apply: (p) => (p.stats.critMult += 0.35) },
  { id: 'ls', icon: '🩸', name: 'Vampirism', desc: '+2% life steal', w: 6, max: 5, apply: (p) => (p.stats.lifesteal += 0.02) },
  { id: 'ms', icon: '👟', name: 'Swiftness', desc: '+8% move speed', w: 6, max: 4, apply: (p) => (p.stats.moveSpeed += 0.08) },
  { id: 'cdr', icon: '⏳', name: 'Focus', desc: '-10% skill cooldowns', w: 7, max: 5, apply: (p) => (p.stats.cdr += 0.1) },
  { id: 'sp', icon: '✨', name: 'Arcane Might', desc: '+20% skill damage', w: 8, max: 8, apply: (p) => (p.stats.skillPower += 0.2) },
  { id: 'armor', icon: '🪨', name: 'Iron Skin', desc: '+8 armor', w: 7, max: 8, apply: (p) => (p.stats.armor += 8) },
  { id: 'dash', icon: '💨', name: 'Blink Reserve', desc: '+1 dash charge', w: 4, max: 2, apply: (p) => (p.mods.dashCharges += 1) },
  { id: 'jump', icon: '🪽', name: 'Featherweight', desc: '+1 air jump (triple jump!)', w: 3, max: 1, apply: (p) => (p.mods.airJumps += 1) },
  { id: 'firedash', icon: '☄️', name: 'Blazing Dash', desc: 'Dashing leaves a burning trail', w: 3, max: 1, apply: (p) => (p.mods.fireDash = true) },
  { id: 'stomp', icon: '🦶', name: 'Stomp', desc: 'Air jumps release a damaging shockwave', w: 3, max: 1, apply: (p) => (p.mods.stomp = true) },
  { id: 'thorns', icon: '🌵', name: 'Thorns', desc: 'Reflect 40% of melee damage taken', w: 4, max: 3, apply: (p) => (p.mods.thorns += 0.4) },
  { id: 'regen', icon: '🌿', name: 'Regeneration', desc: 'Regenerate 1% max health per second', w: 4, max: 3, apply: (p) => (p.mods.regen += 0.01) },
  { id: 'exec', icon: '💀', name: 'Executioner', desc: '+60% damage to enemies under 30% health', w: 4, max: 2, apply: (p) => (p.mods.execute += 0.6) },
  { id: 'greed', icon: '💰', name: 'Greed', desc: '+40% gold found', w: 5, max: 5, apply: (p) => (p.stats.goldFind += 0.4) },
  { id: 'reach', icon: '📏', name: 'Long Reach', desc: '+20% melee range', w: 5, max: 3, apply: (p) => (p.mods.reach += 0.2) },
];

export function rollBlessings(player, n = 2) {
  const pool = BLESSINGS.filter((u) => (player.upgradeCounts[u.id] || 0) < u.max);
  const out = [];
  while (out.length < n && pool.length) {
    const u = weightedPick(rng, pool);
    out.push(u);
    pool.splice(pool.indexOf(u), 1);
  }
  return out;
}
