// The Soul Forge: progress that outlives a run. Soul shards are earned in every run
// (elites, den lords, kings, floors cleared, victory) and kept when you fall; spend
// them on permanent upgrades from the title screen.

const KEY = 'hacknperfect.meta';

export const FORGE = [
  { id: 'vigor', icon: '❤️', name: 'Vigor', desc: (l) => `+${l * 8}% max health`, max: 10, cost: (l) => 20 + l * 15 },
  { id: 'might', icon: '🗡️', name: 'Might', desc: (l) => `+${l * 6}% damage`, max: 10, cost: (l) => 20 + l * 15 },
  { id: 'guard', icon: '🪨', name: 'Bulwark', desc: (l) => `+${l * 6}% armour`, max: 5, cost: (l) => 25 + l * 20 },
  { id: 'swift', icon: '👟', name: 'Fleetfoot', desc: (l) => `+${l * 3}% move speed`, max: 5, cost: (l) => 25 + l * 20 },
  { id: 'fortune', icon: '💰', name: 'Fortune', desc: (l) => `+${l * 15}% gold`, max: 5, cost: (l) => 15 + l * 15 },
  { id: 'hunter', icon: '💎', name: 'Treasure Hunter', desc: (l) => `rarer loot (+${l} rarity rolls)`, max: 5, cost: (l) => 40 + l * 30 },
  { id: 'purse', icon: '👛', name: 'Starting Purse', desc: (l) => `start with ${l * 60} gold`, max: 5, cost: (l) => 15 + l * 10 },
  { id: 'armory', icon: '⚔️', name: 'Armory', desc: (l) => (l >= 2 ? 'start with an epic weapon' : l ? 'start with a rare weapon' : 'start with a better weapon'), max: 2, cost: (l) => 60 + l * 90 },
  { id: 'wind', icon: '🌬️', name: 'Second Wind', desc: () => 'once a run, survive a killing blow', max: 1, cost: () => 250 },
  { id: 'shards', icon: '💠', name: 'Soul Siphon', desc: (l) => `+${l * 20}% soul shards`, max: 5, cost: (l) => 30 + l * 30 },
];

function store() {
  try {
    return window.localStorage;
  } catch (_) {
    return null;
  }
}

export function loadMeta() {
  try {
    const m = JSON.parse(store()?.getItem(KEY) || 'null');
    if (m && typeof m === 'object') return { shards: m.shards | 0, up: m.up || {}, wins: m.wins | 0, deepest: m.deepest | 0 };
  } catch (_) {
    /* fresh */
  }
  return { shards: 0, up: {}, wins: 0, deepest: 0 };
}

export function saveMeta(m) {
  try {
    store()?.setItem(KEY, JSON.stringify(m));
  } catch (_) {
    /* unavailable */
  }
}

export const forgeLevel = (m, id) => m.up[id] || 0;

export function buyForge(m, id) {
  const f = FORGE.find((x) => x.id === id);
  const l = forgeLevel(m, id);
  if (!f || l >= f.max || m.shards < f.cost(l)) return false;
  m.shards -= f.cost(l);
  m.up[id] = l + 1;
  saveMeta(m);
  return true;
}

// What the forge gives a new hero: bonus stats and perks.
export function forgeBonus(m) {
  const l = (id) => forgeLevel(m, id);
  return {
    stats: { hpPct: l('vigor') * 0.08, dmgPct: l('might') * 0.06, armorPct: l('guard') * 0.06, moveSpeed: l('swift') * 0.03, goldFind: l('fortune') * 0.15 },
    secondWind: l('wind') > 0,
    rarity: l('hunter'),
    gold: l('purse') * 60,
    armory: l('armory'),
    shardMult: 1 + l('shards') * 0.2,
  };
}

// Bank a run's shards (and remember the deepest floor / wins).
export function bankShards(n, floor, won = false) {
  const m = loadMeta();
  m.shards += Math.max(0, Math.round(n));
  m.deepest = Math.max(m.deepest, floor);
  if (won) m.wins++;
  saveMeta(m);
  return m;
}
