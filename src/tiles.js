// Tile-map constants shared by the dungeon generator and the decor builder.

export const T = 2; // world units per tile
export const WALL_H = 4;
export const BLOCK_H = 1.2;
// Raised floor: platforms stand 1 or 2 steps of this (one jump / a double jump high),
// and each stair tile climbs exactly one step.
export const STEP_H = 1.2;
// Stair directions: the way a stair tile climbs (index = code - 1).
export const STAIR_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// PROP tiles hold furniture and statues: solid, but not part of the wall mesh.
export const TILE = { WALL: 0, FLOOR: 1, BLOCK: 2, PILLAR: 3, PROP: 4 };
export const HEIGHT = { 0: 100, 1: 0, 2: BLOCK_H, 3: 100, 4: 100 };

// Floor settings, one per floor in this order (then around again). `style` picks the
// decoration set (crypt / moss / ember / void); the rest is the setting's own look:
// palette, fog distance, candle / torch / mote colours, wall details and props, and
// which monsters roam it more (`foes` multiplies spawn weights).
export const THEMES = [
  { id: 'crypt', style: 'crypt', name: 'Forgotten Crypt', floor: 0x4a4f5a, wall: 0x6a7080, block: 0x6b5238, fog: 0x0b0d14, accent: 0x7fb4ff, banner: 0x6a1a22 },
  { id: 'flooded', style: 'moss', name: 'Flooded Catacombs', floor: 0x3c4a50, wall: 0x55666c, block: 0x4a4a40, fog: 0x061216, accent: 0x6ad8ff, banner: 0x1a3a4a, mote: 0x9fe8ff, fogFar: 40, walls: { moss: 3, vines: 2, cracks: 3, chains: 2, banner: 1 }, props: { kitStorage: 3, kitBones: 2, urns: 2, statue: 1, sacks: 2, kitGrave: 1 }, foes: { archer: 1.5, wisp: 1.4 } },
  { id: 'ember', style: 'ember', name: 'Ember Halls', floor: 0x5a3e36, wall: 0x7a4f42, block: 0x4a3a33, fog: 0x160806, accent: 0xff8a4d, banner: 0x1e1614, foes: { bomber: 2, berserker: 1.5 } },
  { id: 'ossuary', style: 'crypt', name: 'Bone Ossuary', floor: 0x5a5448, wall: 0x8a8270, block: 0x6b5238, fog: 0x120e0a, accent: 0xffe0a0, banner: 0x5a2a1a, mote: 0xffe8c0, walls: { niche: 6, cracks: 3, chains: 2, banner: 1, shelf: 1 }, props: { kitBones: 5, kitCoffin: 2, urns: 2, sarcophagus: 2, kitGrave: 2 }, foes: { grunt: 1.5, mage: 1.6, brute: 1.3 } },
  { id: 'fungal', style: 'moss', name: 'Fungal Grotto', floor: 0x3e3a4a, wall: 0x4f4a5e, block: 0x4a3a50, fog: 0x0a0c14, accent: 0x60ffd0, banner: 0x2a1a4a, mote: 0x80ffd8, candle: 0x60ffd0, fogFar: 40, walls: { mushrooms: 6, vines: 3, moss: 3, cracks: 1 }, props: { mushrooms: 6, sacks: 1, statue: 1, kitStorage: 1 }, foes: { wisp: 2, shade: 1.3 } },
  { id: 'frozen', style: 'void', name: 'Frozen Vault', floor: 0x5a6878, wall: 0x8098b0, block: 0x506070, fog: 0x0a1420, accent: 0x9fe0ff, banner: 0x1a3a6a, mote: 0xeef6ff, candle: 0x9fe0ff, torch: 0x80c8ff, torchLight: 0x9fd0ff, walls: { crystals: 5, cracks: 3, banner: 2, chains: 1 }, props: { crystals: 4, statue: 3, kitTreasure: 1, urns: 1, shelf: 1 }, foes: { knight: 1.8, shade: 1.5, wisp: 1.2 } },
  { id: 'blood', style: 'void', name: 'Blood Temple', floor: 0x4a2a2e, wall: 0x6a3a40, block: 0x4a2a2a, fog: 0x1a0406, accent: 0xff3040, banner: 0x3a0a0a, mote: 0xff6060, candle: 0xff4040, torch: 0xff3020, torchLight: 0xff5040, walls: { banner: 4, chains: 3, runes: 3, cracks: 2 }, props: { altar: 4, brazier: 2, statue: 2, urns: 1, kitShrine: 2 }, foes: { warlock: 1.7, berserker: 1.4, mage: 1.3 } },
  { id: 'void', style: 'void', name: 'Void Sanctum', floor: 0x3f3a55, wall: 0x5a4f7a, block: 0x3c3453, fog: 0x0c0816, accent: 0xd08dff, banner: 0x3a1a5a, foes: { warlock: 1.5, wisp: 1.3 } },
  { id: 'library', style: 'crypt', name: 'Sunken Library', floor: 0x4a4038, wall: 0x6a5a4a, block: 0x5a4030, fog: 0x0e0a08, accent: 0xffc070, banner: 0x2a3a5a, mote: 0xffe0a0, walls: { shelf: 6, banner: 2, niche: 1, cracks: 2 }, props: { shelf: 4, kitTable: 3, statue: 1, urns: 1, kitStorage: 1 }, foes: { mage: 2, archer: 1.3, warlock: 1.5 } },
  { id: 'treasury', style: 'void', name: 'Gilded Treasury', floor: 0x5a5040, wall: 0x7a6a50, block: 0x6a5030, fog: 0x100c04, accent: 0xffd060, banner: 0x6a1a1a, mote: 0xffe08a, candle: 0xffc060, walls: { banner: 4, shelf: 2, cracks: 1, runes: 1 }, props: { kitTreasure: 5, statue: 3, urns: 2, altar: 1 }, foes: { knight: 1.8, bomber: 1.3 } },
];
