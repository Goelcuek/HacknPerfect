// The endless depths (floor 21 on, after the Hollow God falls). Every floor adds one
// more stacking curse from this list, the same for everyone (picked from the floor
// number), on top of the monsters' compounding strength. Loot keeps pace.

export const MODS = [
  { id: 'fortified', icon: '🛡️', name: 'Fortified', desc: 'monsters +50% health' },
  { id: 'bloodlust', icon: '🩸', name: 'Bloodlust', desc: 'monsters +30% damage' },
  { id: 'haste', icon: '💨', name: 'Haste', desc: 'monsters +18% speed' },
  { id: 'volatile', icon: '💥', name: 'Volatile', desc: 'monsters explode when they die' },
  { id: 'elite', icon: '👑', name: 'Elite Surge', desc: 'far more elites' },
  { id: 'vampiric', icon: '🧛', name: 'Vampiric', desc: 'monsters heal when they hit you' },
  { id: 'swarm', icon: '🐀', name: 'Swarm', desc: '+40% monsters' },
  { id: 'storm', icon: '⚡', name: 'Arcane Storm', desc: 'lightning hunts you' },
  { id: 'thick', icon: '🪨', name: 'Thick Skin', desc: 'monsters take 20% less damage' },
];

function hash(n) {
  let h = (n * 2654435761) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519) >>> 0;
  h ^= h >>> 13;
  return h >>> 0;
}

// { id: stacks } for a floor (empty before 21).
export function endlessMods(floor) {
  const out = {};
  for (let f = 21; f <= floor; f++) {
    const m = MODS[hash(f) % MODS.length];
    out[m.id] = (out[m.id] || 0) + 1;
  }
  return out;
}

// Numbers the game applies: multipliers and flags.
export function endlessEffects(floor) {
  const m = endlessMods(floor);
  const n = (id) => m[id] || 0;
  return {
    mods: m,
    loop: Math.max(0, floor - 20),
    hp: Math.pow(1.5, n('fortified')),
    dmg: Math.pow(1.3, n('bloodlust')),
    speed: Math.min(1.8, Math.pow(1.18, n('haste'))),
    volatile: n('volatile') > 0,
    elite: n('elite') * 0.12,
    vampiric: n('vampiric') > 0,
    swarm: 1 + n('swarm') * 0.4,
    storm: n('storm'),
    taken: Math.pow(0.8, n('thick')),
  };
}

export function modsLabel(floor) {
  const m = endlessMods(floor);
  return MODS.filter((x) => m[x.id])
    .map((x) => `${x.icon}${m[x.id] > 1 ? `×${m[x.id]}` : ''}`)
    .join(' ');
}

export function modsDetail(floor) {
  const m = endlessMods(floor);
  return MODS.filter((x) => m[x.id]).map((x) => `${x.icon} ${x.name}${m[x.id] > 1 ? ` ×${m[x.id]}` : ''}: ${x.desc}`);
}

// The curse this floor adds (for the arrival toast).
export function newModFor(floor) {
  if (floor < 21) return null;
  return MODS[hash(floor) % MODS.length];
}
