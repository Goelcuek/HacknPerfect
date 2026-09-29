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

export const THEMES = [
  { id: 'crypt', name: 'Forgotten Crypt', floor: 0x4a4f5a, wall: 0x6a7080, block: 0x6b5238, fog: 0x0b0d14, accent: 0x7fb4ff, banner: 0x6a1a22 },
  { id: 'moss', name: 'Mossy Depths', floor: 0x4a5540, wall: 0x62705a, block: 0x5d4a2e, fog: 0x08110b, accent: 0x8dff9c, banner: 0x2a5a2a },
  { id: 'ember', name: 'Ember Halls', floor: 0x5a3e36, wall: 0x7a4f42, block: 0x4a3a33, fog: 0x160806, accent: 0xff8a4d, banner: 0x1e1614 },
  { id: 'void', name: 'Void Sanctum', floor: 0x3f3a55, wall: 0x5a4f7a, block: 0x3c3453, fog: 0x0c0816, accent: 0xd08dff, banner: 0x3a1a5a },
];
