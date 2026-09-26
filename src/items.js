// Loot (equipment with random affixes) and roguelike upgrade definitions.

import { rng, weightedPick } from './utils.js';

export const RARITIES = [
  { id: 'common', name: 'Common', color: '#d8d8d8', hex: 0xd8d8d8, mult: 1.0, affixes: 0, w: 55 },
  { id: 'magic', name: 'Magic', color: '#5aa9ff', hex: 0x5aa9ff, mult: 1.2, affixes: 1, w: 28 },
  { id: 'rare', name: 'Rare', color: '#ffd84a', hex: 0xffd84a, mult: 1.45, affixes: 2, w: 12 },
  { id: 'epic', name: 'Epic', color: '#c77dff', hex: 0xc77dff, mult: 1.75, affixes: 3, w: 4 },
  { id: 'legendary', name: 'Legendary', color: '#ff8c2e', hex: 0xff8c2e, mult: 2.1, affixes: 4, w: 1 },
];

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
};

const AFFIXES = [
  { stat: 'dmgPct', roll: (f) => 0.05 + rng.next() * 0.07 + f * 0.003 },
  { stat: 'attackSpeed', roll: () => 0.05 + rng.next() * 0.08 },
  { stat: 'crit', roll: () => 0.03 + rng.next() * 0.05 },
  { stat: 'critMult', roll: () => 0.15 + rng.next() * 0.25 },
  { stat: 'maxHp', roll: (f) => 8 + f * 3 + rng.next() * 10 },
  { stat: 'lifesteal', roll: () => 0.01 + rng.next() * 0.02 },
  { stat: 'moveSpeed', roll: () => 0.04 + rng.next() * 0.05 },
  { stat: 'cdr', roll: () => 0.04 + rng.next() * 0.06 },
  { stat: 'skillPower', roll: (f) => 0.08 + rng.next() * 0.12 + f * 0.004 },
  { stat: 'goldFind', roll: () => 0.1 + rng.next() * 0.2 },
  { stat: 'armor', roll: (f) => 2 + f * 0.8 + rng.next() * 3 },
];

const NAMES = {
  weapon: ['Sword', 'Blade', 'Cleaver', 'Saber', 'Falchion', 'Longsword', 'Edge'],
  armor: ['Plate', 'Mail', 'Cuirass', 'Hauberk', 'Vest', 'Brigandine'],
  charm: ['Amulet', 'Talisman', 'Ring', 'Sigil', 'Charm', 'Relic'],
};
const PREFIX = {
  common: ['Worn', 'Plain', 'Iron', 'Simple'],
  magic: ['Tempered', 'Glinting', 'Runed', 'Honed'],
  rare: ['Gilded', 'Stormforged', 'Serpent', 'Blessed'],
  epic: ['Voidtouched', 'Dragonbone', 'Soulbound', 'Astral'],
  legendary: ['Godslayer', 'Eternal', 'Worldender', 'Mythic'],
};

export const SLOTS = ['weapon', 'armor', 'charm'];
export const SLOT_ICON = { weapon: '⚔️', armor: '🛡️', charm: '💎' };

export function rollRarity(floor, bonus = 0, minRarity = 0) {
  // deeper floors and elites/chests shift odds toward better loot
  const shift = floor * 0.6 + bonus;
  const entries = RARITIES.map((r, i) => ({ r, w: r.w * (i === 0 ? Math.max(0.2, 1 - shift * 0.04) : 1 + shift * 0.08 * i) })).slice(minRarity);
  return weightedPick(rng, entries).r;
}

export function generateItem(floor, rarityBonus = 0, minRarity = 0, slot = null) {
  const rarity = rollRarity(floor, rarityBonus, minRarity);
  slot = slot || rng.pick(SLOTS);
  const stats = {};
  if (slot === 'weapon') stats.damage = (3 + floor * 1.6) * rarity.mult * (0.85 + rng.next() * 0.3);
  if (slot === 'armor') {
    stats.armor = (2 + floor * 1.2) * rarity.mult * (0.85 + rng.next() * 0.3);
    stats.maxHp = (8 + floor * 4) * rarity.mult;
  }
  let nAff = rarity.affixes + (slot === 'charm' ? 1 : 0);
  const pool = AFFIXES.slice();
  while (nAff-- > 0 && pool.length) {
    const a = pool.splice(Math.floor(rng.next() * pool.length), 1)[0];
    stats[a.stat] = (stats[a.stat] || 0) + a.roll(floor) * (0.8 + rarity.mult * 0.2);
  }
  const name = `${rng.pick(PREFIX[rarity.id])} ${rng.pick(NAMES[slot])}`;
  return { slot, rarity, name, stats, level: floor };
}

export function itemScore(item) {
  if (!item) return 0;
  let s = 0;
  for (const k in item.stats) s += item.stats[k] * (STAT_WEIGHT[k] || 1);
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

// ------------------------------------------------------------------ upgrades
// Each upgrade mutates player.stats / player.mods. `max` limits stacking.
export const UPGRADES = [
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
  { id: 'split', icon: '🔥', name: 'Split Bolt', desc: 'Fire Bolt launches 2 extra bolts', w: 4, max: 2, apply: (p) => (p.mods.boltExtra += 2) },
  { id: 'cyclone', icon: '🌪️', name: 'Cyclone', desc: 'Whirlwind lasts 50% longer and pulls enemies in', w: 4, max: 2, apply: (p) => { p.mods.whirlDur += 0.5; p.mods.whirlPull = true; } },
  { id: 'freeze', icon: '❄️', name: 'Deep Freeze', desc: 'Frost Nova: +1.5s freeze, +25% radius', w: 4, max: 3, apply: (p) => { p.mods.novaFreeze += 1.5; p.mods.novaRadius += 0.25; } },
  { id: 'quake', icon: '🌋', name: 'Earthshaker', desc: 'Leap Slam: +35% radius and damage', w: 4, max: 3, apply: (p) => (p.mods.slamPower += 0.35) },
  { id: 'firedash', icon: '☄️', name: 'Blazing Dash', desc: 'Dashing leaves a burning trail', w: 3, max: 1, apply: (p) => (p.mods.fireDash = true) },
  { id: 'stomp', icon: '🦶', name: 'Stomp', desc: 'Air jumps release a damaging shockwave', w: 3, max: 1, apply: (p) => (p.mods.stomp = true) },
  { id: 'thorns', icon: '🌵', name: 'Thorns', desc: 'Reflect 40% of melee damage taken', w: 4, max: 3, apply: (p) => (p.mods.thorns += 0.4) },
  { id: 'regen', icon: '🌿', name: 'Regeneration', desc: 'Regenerate 1% max health per second', w: 4, max: 3, apply: (p) => (p.mods.regen += 0.01) },
  { id: 'exec', icon: '💀', name: 'Executioner', desc: '+60% damage to enemies under 30% health', w: 4, max: 2, apply: (p) => (p.mods.execute += 0.6) },
  { id: 'greed', icon: '💰', name: 'Greed', desc: '+40% gold found', w: 5, max: 5, apply: (p) => (p.stats.goldFind += 0.4) },
  { id: 'reach', icon: '📏', name: 'Long Reach', desc: '+20% attack range', w: 5, max: 3, apply: (p) => (p.mods.reach += 0.2) },
];

export function rollUpgrades(player, n = 3) {
  const avail = UPGRADES.filter((u) => (player.upgradeCounts[u.id] || 0) < u.max);
  const out = [];
  const pool = avail.slice();
  while (out.length < n && pool.length) {
    const u = weightedPick(rng, pool);
    out.push(u);
    pool.splice(pool.indexOf(u), 1);
  }
  return out;
}
