// Small math / RNG helpers shared across modules.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist2 = (ax, az, bx, bz) => (ax - bx) ** 2 + (az - bz) ** 2;

// Shortest signed difference between two angles (radians).
export function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// Deterministic RNG (mulberry32) so a floor can be regenerated from a seed.
export function makeRng(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (a, b) => a + (b - a) * next(),
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
  };
}

export const rng = makeRng((Math.random() * 2 ** 32) >>> 0);

export function weightedPick(r, entries) {
  // entries: [{ w, ... }]
  let total = 0;
  for (const e of entries) total += e.w;
  let roll = r.next() * total;
  for (const e of entries) {
    roll -= e.w;
    if (roll <= 0) return e;
  }
  return entries[entries.length - 1];
}
