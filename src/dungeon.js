// Procedural dungeon: room + corridor tile map, collision queries, flow-field
// pathing for enemies and instanced meshes for rendering.

import * as THREE from 'three';
import { makeRng, clamp } from './utils.js';

export const T = 2; // world units per tile
export const WALL_H = 4;
export const BLOCK_H = 1.2;

export const TILE = { WALL: 0, FLOOR: 1, BLOCK: 2, PILLAR: 3 };
const HEIGHT = { 0: 100, 1: 0, 2: BLOCK_H, 3: 100 };

export const THEMES = [
  { name: 'Forgotten Crypt', floor: 0x3a3f4a, wall: 0x565d6e, block: 0x6b5238, fog: 0x0b0d14, accent: 0x7fb4ff },
  { name: 'Mossy Depths', floor: 0x34402f, wall: 0x4d5a45, block: 0x5d4a2e, fog: 0x08110b, accent: 0x8dff9c },
  { name: 'Ember Halls', floor: 0x45302b, wall: 0x6a3f33, block: 0x4a3a33, fog: 0x160806, accent: 0xff8a4d },
  { name: 'Void Sanctum', floor: 0x2f2a42, wall: 0x4a3f68, block: 0x3c3453, fog: 0x0c0816, accent: 0xd08dff },
];

export function themeForFloor(floor) {
  return THEMES[Math.floor((floor - 1) / 5) % THEMES.length];
}

export function enemyPoolForFloor(floor) {
  const pool = [{ type: 'grunt', w: 10 }];
  if (floor >= 2) pool.push({ type: 'archer', w: 5 + floor * 0.5 });
  if (floor >= 3) pool.push({ type: 'brute', w: 2 + floor * 0.4 });
  if (floor >= 4) pool.push({ type: 'wisp', w: 3 + floor * 0.3 });
  return pool;
}

// Procedural grayscale stone textures (tinted per-instance by the theme colour).
const texCache = {};
function stoneTexture(kind) {
  if (texCache[kind]) return texCache[kind];
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const r = makeRng(kind === 'wall' ? 7 : 11);
  g.fillStyle = '#d0d0d0';
  g.fillRect(0, 0, S, S);
  // speckle noise
  for (let i = 0; i < 1400; i++) {
    const v = 150 + Math.floor(r.next() * 105);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(r.next() * S, r.next() * S, 2, 2);
  }
  g.strokeStyle = 'rgba(40,40,40,0.9)';
  g.lineWidth = 3;
  if (kind === 'wall') {
    // running-bond bricks
    const rows = 4;
    const h = S / rows;
    for (let y = 0; y < rows; y++) {
      g.beginPath();
      g.moveTo(0, y * h);
      g.lineTo(S, y * h);
      g.stroke();
      const off = y % 2 ? S / 4 : 0;
      for (let x = off; x <= S; x += S / 2) {
        g.beginPath();
        g.moveTo(x, y * h);
        g.lineTo(x, y * h + h);
        g.stroke();
      }
    }
  } else if (kind === 'floor') {
    g.strokeRect(1, 1, S - 2, S - 2);
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(S / 2, 0);
    g.lineTo(S / 2, S);
    g.moveTo(0, S / 2);
    g.lineTo(S, S / 2);
    g.stroke();
  } else {
    // wooden planks
    g.lineWidth = 2;
    for (let x = 0; x <= S; x += S / 4) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, S);
      g.stroke();
    }
    g.lineWidth = 6;
    g.strokeRect(3, 3, S - 6, S - 6);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  texCache[kind] = tex;
  return tex;
}

export class Dungeon {
  constructor(floor, seed) {
    this.floor = floor;
    this.rng = makeRng(seed);
    this.isBoss = floor % 5 === 0;
    this.theme = themeForFloor(floor);
    this.generate();
  }

  // ---------------------------------------------------------------- generation
  generate() {
    const r = this.rng;
    const W = this.isBoss ? 44 : clamp(40 + this.floor * 2, 40, 64);
    const H = W;
    this.w = W;
    this.h = H;
    this.tiles = new Uint8Array(W * H); // all WALL
    this.seen = new Uint8Array(W * H);
    this.rooms = [];

    if (this.isBoss) {
      this.rooms.push({ x: 3, z: Math.floor(H / 2) - 4, w: 8, h: 8 });
      this.rooms.push({ x: 18, z: Math.floor(H / 2) - 10, w: 20, h: 20, boss: true });
    } else {
      const target = Math.min(5 + Math.floor(this.floor * 0.8), 12);
      for (let i = 0; i < 400 && this.rooms.length < target; i++) {
        const w = r.int(6, 11);
        const h = r.int(6, 11);
        const x = r.int(2, W - w - 2);
        const z = r.int(2, H - h - 2);
        const ok = this.rooms.every(
          (o) => x + w + 3 < o.x || o.x + o.w + 3 < x || z + h + 3 < o.z || o.z + o.h + 3 < z,
        );
        if (ok) this.rooms.push({ x, z, w, h });
      }
    }

    for (const room of this.rooms) {
      room.cx = room.x + Math.floor(room.w / 2);
      room.cz = room.z + Math.floor(room.h / 2);
      for (let z = room.z; z < room.z + room.h; z++)
        for (let x = room.x; x < room.x + room.w; x++) this.set(x, z, TILE.FLOOR);
    }

    // connect every room to its nearest already-connected room, plus a loop or two
    for (let i = 1; i < this.rooms.length; i++) {
      const a = this.rooms[i];
      let best = null;
      let bd = Infinity;
      for (let j = 0; j < i; j++) {
        const b = this.rooms[j];
        const d = Math.abs(a.cx - b.cx) + Math.abs(a.cz - b.cz);
        if (d < bd) {
          bd = d;
          best = b;
        }
      }
      this.corridor(a, best);
    }
    if (!this.isBoss && this.rooms.length > 4) {
      for (let k = 0; k < 2; k++) this.corridor(r.pick(this.rooms), r.pick(this.rooms));
    }

    // start / exit rooms
    this.startRoom = this.rooms[0];
    const dist = this.bfs(this.startRoom.cx, this.startRoom.cz);
    let exit = this.rooms[this.rooms.length - 1];
    let far = -1;
    for (const room of this.rooms) {
      const d = dist[this.idx(room.cx, room.cz)];
      if (d > far) {
        far = d;
        exit = room;
      }
    }
    this.exitRoom = exit;

    // decoration + gameplay content
    this.spawns = [];
    this.chests = [];
    this.pots = [];
    for (const room of this.rooms) {
      if (room === this.startRoom) continue;
      this.decorateRoom(room);
    }
    this.placeContent();
  }

  corridor(a, b) {
    if (a === b) return;
    const r = this.rng;
    let x = a.cx;
    let z = a.cz;
    const horizontalFirst = r.chance(0.5);
    const carve = (cx, cz) => {
      for (let dz = 0; dz < 2; dz++)
        for (let dx = 0; dx < 2; dx++) {
          const tx = cx + dx;
          const tz = cz + dz;
          if (tx > 0 && tz > 0 && tx < this.w - 1 && tz < this.h - 1 && this.get(tx, tz) === TILE.WALL)
            this.set(tx, tz, TILE.FLOOR);
        }
    };
    const stepX = () => {
      while (x !== b.cx) {
        carve(x, z);
        x += Math.sign(b.cx - x);
      }
    };
    const stepZ = () => {
      while (z !== b.cz) {
        carve(x, z);
        z += Math.sign(b.cz - z);
      }
    };
    if (horizontalFirst) {
      stepX();
      stepZ();
    } else {
      stepZ();
      stepX();
    }
    carve(x, z);
  }

  decorateRoom(room) {
    const r = this.rng;
    // keep the central cross clear so corridors always connect through the room
    const clearOfCross = (x, z) => Math.abs(x - room.cx) > 1 && Math.abs(z - room.cz) > 1 && Math.abs(x + 1 - room.cx) > 1 && Math.abs(z + 1 - room.cz) > 1;
    if (room.boss) {
      // arena pillars
      for (const [ox, oz] of [
        [4, 4],
        [room.w - 5, 4],
        [4, room.h - 5],
        [room.w - 5, room.h - 5],
      ])
        this.set(room.x + ox, room.z + oz, TILE.PILLAR);
      for (const [ox, oz] of [
        [7, room.h / 2 - 1],
        [room.w - 8, room.h / 2 - 1],
      ]) {
        this.set(room.x + ox, room.z + oz, TILE.BLOCK);
      }
      return;
    }
    if (room.w >= 9 && room.h >= 9 && r.chance(0.5)) {
      for (const [ox, oz] of [
        [2, 2],
        [room.w - 3, 2],
        [2, room.h - 3],
        [room.w - 3, room.h - 3],
      ])
        this.set(room.x + ox, room.z + oz, TILE.PILLAR);
    }
    const blocks = r.int(1, 4);
    for (let i = 0; i < blocks; i++) {
      const bw = r.int(1, 2);
      const bh = r.int(1, 2);
      const x = r.int(room.x + 1, room.x + room.w - 1 - bw);
      const z = r.int(room.z + 1, room.z + room.h - 1 - bh);
      let ok = true;
      for (let dz = 0; dz < bh; dz++) for (let dx = 0; dx < bw; dx++) if (!clearOfCross(x + dx, z + dz) || this.get(x + dx, z + dz) !== TILE.FLOOR) ok = false;
      if (!ok) continue;
      for (let dz = 0; dz < bh; dz++) for (let dx = 0; dx < bw; dx++) this.set(x + dx, z + dz, TILE.BLOCK);
    }
  }

  randomFloorIn(room, margin = 1) {
    for (let i = 0; i < 40; i++) {
      const x = this.rng.int(room.x + margin, room.x + room.w - 1 - margin);
      const z = this.rng.int(room.z + margin, room.z + room.h - 1 - margin);
      if (this.get(x, z) === TILE.FLOOR) return { x: (x + 0.5) * T, z: (z + 0.5) * T };
    }
    return { x: (room.cx + 0.5) * T, z: (room.cz + 0.5) * T };
  }

  placeContent() {
    const r = this.rng;
    const f = this.floor;
    const pool = enemyPoolForFloor(f);
    for (const room of this.rooms) {
      if (room === this.startRoom) continue;
      if (room.boss) {
        this.spawns.push({ type: 'boss', ...this.worldCenter(room), elite: false });
        continue;
      }
      const area = room.w * room.h;
      let n = Math.round(area / 30) + Math.floor(f / 3) + r.int(0, 1);
      n = clamp(n, 2, 8);
      for (let i = 0; i < n; i++) {
        let total = 0;
        for (const p of pool) total += p.w;
        let roll = r.next() * total;
        let type = pool[0].type;
        for (const p of pool) {
          roll -= p.w;
          if (roll <= 0) {
            type = p.type;
            break;
          }
        }
        const pos = this.randomFloorIn(room);
        this.spawns.push({ type, ...pos, elite: f >= 2 && r.chance(0.06 + f * 0.01) });
      }
      const pots = r.int(0, 3);
      for (let i = 0; i < pots; i++) this.pots.push(this.randomFloorIn(room));
    }
    const chestRooms = this.rooms.filter((rm) => rm !== this.startRoom && !rm.boss);
    const nChests = this.isBoss ? 0 : r.int(1, 2);
    for (let i = 0; i < nChests && chestRooms.length; i++) {
      const room = chestRooms.splice(r.int(0, chestRooms.length - 1), 1)[0];
      this.chests.push(this.randomFloorIn(room, 1));
    }
    if (this.isBoss) {
      // a reward chest waits in the start room of boss floors... after the fight it spawns in the arena
      this.pots.push(this.randomFloorIn(this.startRoom));
    }
  }

  worldCenter(room) {
    return { x: (room.x + room.w / 2) * T, z: (room.z + room.h / 2) * T };
  }

  // ------------------------------------------------------------------- queries
  idx(x, z) {
    return z * this.w + x;
  }
  get(x, z) {
    if (x < 0 || z < 0 || x >= this.w || z >= this.h) return TILE.WALL;
    return this.tiles[z * this.w + x];
  }
  set(x, z, v) {
    if (x < 0 || z < 0 || x >= this.w || z >= this.h) return;
    this.tiles[z * this.w + x] = v;
  }
  heightAtTile(x, z) {
    return HEIGHT[this.get(x, z)];
  }
  heightAtPoint(x, z) {
    return this.heightAtTile(Math.floor(x / T), Math.floor(z / T));
  }

  // Highest tile under a circle footprint.
  maxHeightUnder(x, z, rad) {
    let best = 0;
    this.forTilesInCircle(x, z, rad, (h) => {
      if (h > best) best = h;
    });
    return best;
  }

  forTilesInCircle(x, z, rad, fn) {
    const x0 = Math.floor((x - rad) / T);
    const x1 = Math.floor((x + rad) / T);
    const z0 = Math.floor((z - rad) / T);
    const z1 = Math.floor((z + rad) / T);
    for (let tz = z0; tz <= z1; tz++)
      for (let tx = x0; tx <= x1; tx++) {
        const nx = clamp(x, tx * T, (tx + 1) * T);
        const nz = clamp(z, tz * T, (tz + 1) * T);
        if ((nx - x) ** 2 + (nz - z) ** 2 < rad * rad) fn(this.heightAtTile(tx, tz), tx, tz);
      }
  }

  blocked(x, z, rad, footY, step = 0.35) {
    let hit = false;
    this.forTilesInCircle(x, z, rad, (h) => {
      if (h > footY + step) hit = true;
    });
    return hit;
  }

  // Slide an entity {x,z,y,radius} by (dx,dz) with per-axis resolution.
  move(ent, dx, dz, canClimb = true) {
    const len = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(len / (ent.radius * 0.8)));
    const sx = dx / steps;
    const sz = dz / steps;
    const foot = canClimb ? ent.y : Math.min(ent.y, 0.01);
    let hitWall = false;
    for (let i = 0; i < steps; i++) {
      if (!this.blocked(ent.x + sx, ent.z, ent.radius, foot)) ent.x += sx;
      else hitWall = true;
      if (!this.blocked(ent.x, ent.z + sz, ent.radius, foot)) ent.z += sz;
      else hitWall = true;
    }
    return hitWall;
  }

  // Walls (not low blocks) stop sight lines and projectiles.
  lineOfSight(ax, az, bx, bz, maxH = 1.5) {
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.ceil(d / 0.5);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (this.heightAtPoint(ax + (bx - ax) * t, az + (bz - az) * t) > maxH) return false;
    }
    return true;
  }

  // March from `from` to `to` (Vector3) and return how far (0..1) is free of geometry.
  raycastFraction(from, to) {
    const d = from.distanceTo(to);
    const n = Math.ceil(d / 0.15);
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;
      const z = from.z + (to.z - from.z) * t;
      if (this.heightAtPoint(x, z) > y - 0.3) return Math.max(0, (i - 1) / n);
    }
    return 1;
  }

  walkable(x, z) {
    return this.get(x, z) === TILE.FLOOR;
  }

  bfs(sx, sz, out) {
    const W = this.w;
    const dist = out || new Int16Array(W * this.h);
    dist.fill(-1);
    const q = new Int32Array(W * this.h);
    let head = 0;
    let tail = 0;
    const s = this.idx(sx, sz);
    dist[s] = 0;
    q[tail++] = s;
    while (head < tail) {
      const c = q[head++];
      const cx = c % W;
      const cz = (c / W) | 0;
      const cd = dist[c];
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = cx + dx;
          const nz = cz + dz;
          if (!this.walkable(nx, nz)) continue;
          if (dx && dz && (!this.walkable(cx + dx, cz) || !this.walkable(cx, cz + dz))) continue;
          const ni = nz * W + nx;
          if (dist[ni] !== -1) continue;
          dist[ni] = cd + 1;
          q[tail++] = ni;
        }
    }
    return dist;
  }

  updateFlow(px, pz) {
    const tx = clamp(Math.floor(px / T), 0, this.w - 1);
    const tz = clamp(Math.floor(pz / T), 0, this.h - 1);
    if (this.flow && tx === this.flowTx && tz === this.flowTz) return;
    this.flowTx = tx;
    this.flowTz = tz;
    this.flow = this.bfs(tx, tz, this.flow);
  }

  // Direction (unit vector) an enemy at (x,z) should walk to reach the player.
  flowDir(x, z) {
    if (!this.flow) return null;
    const tx = Math.floor(x / T);
    const tz = Math.floor(z / T);
    const W = this.w;
    const here = this.walkable(tx, tz) ? this.flow[tz * W + tx] : 9999;
    let best = here === -1 ? 9999 : here;
    let bx = 0;
    let bz = 0;
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = tx + dx;
        const nz = tz + dz;
        if (!this.walkable(nx, nz)) continue;
        if (dx && dz && (!this.walkable(tx + dx, tz) || !this.walkable(tx, tz + dz))) continue;
        const d = this.flow[nz * W + nx];
        if (d >= 0 && d < best) {
          best = d;
          bx = nx;
          bz = nz;
        }
      }
    if (best === 9999 || (bx === 0 && bz === 0 && best === here)) return null;
    const wx = (bx + 0.5) * T - x;
    const wz = (bz + 0.5) * T - z;
    const m = Math.hypot(wx, wz) || 1;
    return { x: wx / m, z: wz / m };
  }

  reveal(px, pz, radius = 9) {
    const tx = Math.floor(px / T);
    const tz = Math.floor(pz / T);
    for (let dz = -radius; dz <= radius; dz++)
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dz * dz > radius * radius) continue;
        const x = tx + dx;
        const z = tz + dz;
        if (x >= 0 && z >= 0 && x < this.w && z < this.h) this.seen[z * this.w + x] = 1;
      }
  }

  // ------------------------------------------------------------------ rendering
  buildMeshes() {
    const group = new THREE.Group();
    const th = this.theme;
    const W = this.w;
    const H = this.h;
    const color = new THREE.Color();
    const m4 = new THREE.Matrix4();
    const r = makeRng(this.floor * 977 + 13);

    const floorTiles = [];
    const wallTiles = [];
    const blockTiles = [];
    const pillarTiles = [];
    for (let z = 0; z < H; z++)
      for (let x = 0; x < W; x++) {
        const t = this.get(x, z);
        if (t === TILE.WALL) {
          let adj = false;
          for (let dz = -1; dz <= 1 && !adj; dz++) for (let dx = -1; dx <= 1; dx++) if (this.get(x + dx, z + dz) !== TILE.WALL) adj = true;
          if (adj) wallTiles.push([x, z]);
        } else {
          floorTiles.push([x, z]);
          if (t === TILE.BLOCK) blockTiles.push([x, z]);
          if (t === TILE.PILLAR) pillarTiles.push([x, z]);
        }
      }

    const makeInst = (geo, mat, list, y, jitter, baseColor) => {
      const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
      list.forEach(([x, z], i) => {
        m4.makeTranslation((x + 0.5) * T, y, (z + 0.5) * T);
        mesh.setMatrixAt(i, m4);
        color.setHex(baseColor).offsetHSL(0, 0, (r.next() - 0.5) * jitter);
        mesh.setColorAt(i, color);
      });
      mesh.count = list.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.frustumCulled = false;
      group.add(mesh);
      return mesh;
    };

    const floorGeo = new THREE.BoxGeometry(T * 0.98, 0.4, T * 0.98);
    makeInst(floorGeo, new THREE.MeshLambertMaterial({ map: stoneTexture('floor') }), floorTiles, -0.2, 0.06, th.floor);

    const wallGeo = new THREE.BoxGeometry(T, WALL_H, T);
    // repeat the brick texture vertically along the wall height
    const uv = wallGeo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * (WALL_H / T));
    makeInst(wallGeo, new THREE.MeshLambertMaterial({ map: stoneTexture('wall') }), wallTiles, WALL_H / 2, 0.08, th.wall);

    const blockGeo = new THREE.BoxGeometry(T * 0.98, BLOCK_H, T * 0.98);
    makeInst(blockGeo, new THREE.MeshLambertMaterial({ map: stoneTexture('crate') }), blockTiles, BLOCK_H / 2, 0.1, th.block);
    // plank trim on crates
    const trimGeo = new THREE.BoxGeometry(T * 1.0, 0.12, T * 1.0);
    makeInst(trimGeo, new THREE.MeshLambertMaterial(), blockTiles, BLOCK_H - 0.06, 0.05, 0x2a1f14);

    const pillarGeo = new THREE.CylinderGeometry(T * 0.42, T * 0.5, WALL_H, 8);
    makeInst(pillarGeo, new THREE.MeshLambertMaterial(), pillarTiles, WALL_H / 2, 0.08, th.wall);

    // wall-top caps to give walls a readable silhouette
    const capGeo = new THREE.BoxGeometry(T * 1.02, 0.15, T * 1.02);
    makeInst(capGeo, new THREE.MeshLambertMaterial(), wallTiles, WALL_H + 0.07, 0.05, new THREE.Color(th.wall).offsetHSL(0, 0, 0.08).getHex());

    // wall torches: iron sconce + bowl + layered flame, facing into the room
    const torchSpots = [];
    const torchDirs = [];
    for (const [x, z] of wallTiles) {
      if (r.next() > 0.07) continue;
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        if (this.get(x + dx, z + dz) === TILE.FLOOR) {
          torchSpots.push([(x + 0.5 + dx * 0.62) * T, (z + 0.5 + dz * 0.62) * T]);
          torchDirs.push(Math.atan2(dx, dz));
          break;
        }
      }
    }
    if (torchSpots.length) {
      const q = new THREE.Quaternion();
      const e = new THREE.Euler();
      const sc = new THREE.Vector3(1, 1, 1);
      const pos = new THREE.Vector3();
      const addTorchPart = (geo, material, ox, oy, oz) => {
        const inst = new THREE.InstancedMesh(geo, material, torchSpots.length);
        torchSpots.forEach(([x, z], i) => {
          const h = torchDirs[i];
          e.set(0, h, 0);
          q.setFromEuler(e);
          pos.set(ox, oy, oz).applyQuaternion(q).add(new THREE.Vector3(x, 0, z));
          m4.compose(pos, q, sc);
          inst.setMatrixAt(i, m4);
        });
        inst.frustumCulled = false;
        group.add(inst);
      };
      const iron = new THREE.MeshLambertMaterial({ color: 0x2e2e34 });
      addTorchPart(new THREE.BoxGeometry(0.12, 0.5, 0.12), iron, 0, 2.2, -0.3);
      addTorchPart(new THREE.BoxGeometry(0.08, 0.08, 0.4), iron, 0, 2.0, -0.12);
      addTorchPart(new THREE.CylinderGeometry(0.16, 0.08, 0.18, 8), iron, 0, 2.3, 0.05);
      addTorchPart(new THREE.ConeGeometry(0.15, 0.5, 7), new THREE.MeshBasicMaterial({ color: 0xff7a2e, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }), 0, 2.62, 0.05);
      addTorchPart(new THREE.ConeGeometry(0.08, 0.3, 6), new THREE.MeshBasicMaterial({ color: 0xffe08a }), 0, 2.55, 0.05);
      addTorchPart(new THREE.OctahedronGeometry(0.06), new THREE.MeshBasicMaterial({ color: th.accent }), 0, 2.12, 0.05);
    }
    this.torchSpots = torchSpots;

    // floor clutter: rubble and bones scattered around rooms
    const rubble = [];
    const bones = [];
    for (const [x, z] of floorTiles) {
      if (this.get(x, z) !== TILE.FLOOR) continue;
      const v = r.next();
      if (v < 0.05) rubble.push([x, z]);
      else if (v < 0.075) bones.push([x, z]);
    }
    const scatter = (geo, material, list, y, sMin, sMax, lay = 0) => {
      const inst = new THREE.InstancedMesh(geo, material, Math.max(1, list.length));
      const q = new THREE.Quaternion();
      const e = new THREE.Euler();
      const sc = new THREE.Vector3();
      const pos = new THREE.Vector3();
      list.forEach(([x, z], i) => {
        e.set(lay + r.next() * 0.6, r.next() * 6.28, r.next() * 0.6);
        q.setFromEuler(e);
        const k = sMin + r.next() * (sMax - sMin);
        sc.set(k, k * (0.6 + r.next() * 0.4), k);
        pos.set((x + 0.2 + r.next() * 0.6) * T, y, (z + 0.2 + r.next() * 0.6) * T);
        m4.compose(pos, q, sc);
        inst.setMatrixAt(i, m4);
      });
      inst.count = list.length;
      inst.frustumCulled = false;
      group.add(inst);
    };
    scatter(new THREE.DodecahedronGeometry(0.22, 0), new THREE.MeshLambertMaterial({ color: new THREE.Color(th.wall).offsetHSL(0, 0, -0.05) }), rubble, 0.05, 0.6, 1.4);
    scatter(new THREE.CapsuleGeometry(0.04, 0.4, 2, 5), new THREE.MeshLambertMaterial({ color: 0xd8d0b8 }), bones, 0.05, 0.8, 1.2, Math.PI / 2);

    // big dark ground plane under everything (hides the void when looking over walls)
    const under = new THREE.Mesh(new THREE.PlaneGeometry(W * T * 3, H * T * 3), new THREE.MeshBasicMaterial({ color: th.fog }));
    under.rotation.x = -Math.PI / 2;
    under.position.set((W * T) / 2, -0.5, (H * T) / 2);
    group.add(under);

    this.group = group;
    return group;
  }

  dispose() {
    if (!this.group) return;
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}
