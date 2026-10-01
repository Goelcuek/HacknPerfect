// Mid-run save: enough to put a solo run back exactly where it was. The floor is
// rebuilt from its seed (same layout, same monsters), then what changed is
// replayed: monsters already killed, chests opened, barrels broken, loot on the
// ground, the hero's stats, gear, skills, blessings and position.

import { ALL_RARITIES, BLESSINGS } from './items.js';

const KEY = 'hacknperfect.run';
const VERSION = 4; // 2: more monsters per room, 3: raised platforms, 4: boss dens, wider corridors, new settings

function store() {
  try {
    return window.localStorage;
  } catch (_) {
    return null;
  }
}

export function packItem(it) {
  if (!it) return null;
  return { ...it, rarity: it.rarity.id };
}

export function unpackItem(o) {
  if (!o) return null;
  const rarity = ALL_RARITIES.find((r) => r.id === o.rarity) || ALL_RARITIES[0];
  return { ...o, rarity };
}

export function readSave() {
  try {
    const raw = store()?.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return s && s.v === VERSION ? s : null;
  } catch (_) {
    return null;
  }
}

export function writeSave(s) {
  try {
    store()?.setItem(KEY, JSON.stringify({ ...s, v: VERSION, at: Date.now() }));
  } catch (_) {
    /* storage full or unavailable: the run just won't resume */
  }
}

export function clearSave() {
  try {
    store()?.removeItem(KEY);
  } catch (_) {
    /* unavailable */
  }
}

// Re-apply shrine blessings on a fresh hero (their effects are stat changes).
export function replayBlessings(p, counts) {
  for (const [id, n] of Object.entries(counts || {})) {
    const b = BLESSINGS.find((x) => x.id === id);
    if (b) for (let i = 0; i < n; i++) p.applyUpgrade(b);
  }
}
