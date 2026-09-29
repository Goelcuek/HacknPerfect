// Procedural dungeon: room + corridor tile map, collision queries, flow-field
// pathing for enemies and instanced meshes for rendering.

import * as THREE from 'three';
import { makeRng, clamp } from './utils.js';

import { T, WALL_H, BLOCK_H, STEP_H, STAIR_DIRS, TILE, HEIGHT, THEMES } from './tiles.js';
import { buildEnvironment, PROP_WEIGHTS } from './decor.js';

export { T, WALL_H, BLOCK_H, STEP_H, STAIR_DIRS, TILE, THEMES };

export function themeForFloor(floor) {
  return THEMES[Math.floor((floor - 1) / 5) % THEMES.length];
}

export function enemyPoolForFloor(floor) {
  const pool = [{ type: 'grunt', w: 10 }];
  if (floor >= 2) pool.push({ type: 'archer', w: 5 + floor * 0.5 });
  if (floor >= 3) pool.push({ type: 'brute', w: 2 + floor * 0.4 });
  if (floor >= 3) pool.push({ type: 'mage', w: 1.5 + floor * 0.3 });
  if (floor >= 4) pool.push({ type: 'wisp', w: 3 + floor * 0.3 });
  return pool;
}

export class Dungeon {
  // party: players in a multiplayer run; only the host passes it (it alone spawns
  // monsters), and the extra monsters come from their own random stream so the
  // layout, chests and barrels stay identical on every player's machine.
  constructor(floor, seed, party = 1) {
    this.floor = floor;
    this.rng = makeRng(seed);
    this.isBoss = floor % 5 === 0;
    this.theme = themeForFloor(floor);
    this.generate();
    if (party > 1) this.addPartySpawns(party, seed);
  }

  // ---------------------------------------------------------------- generation
  generate() {
    const r = this.rng;
    const W = this.isBoss ? 44 : clamp(40 + this.floor * 2, 40, 64);
    const H = W;
    this.w = W;
    this.h = H;
    this.tiles = new Uint8Array(W * H); // all WALL
    this.elev = new Float32Array(W * H); // floor height of each tile (raised platforms)
    this.stair = new Uint8Array(W * H); // 1-4: a stair climbing STEP_H toward STAIR_DIRS[code - 1]
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
    this.placeProps();
    this.placeContent();
  }

  // Furniture and statues against room walls. Each placement is kept only if
  // every previously reachable floor tile stays reachable.
  placeProps() {
    this.props = [];
    const r = this.rng;
    const weights = PROP_WEIGHTS[this.theme.id];
    const reach = () => {
      const d = this.bfs(this.startRoom.cx, this.startRoom.cz);
      let n = 0;
      for (let i = 0; i < d.length; i++) if (d[i] >= 0) n++;
      return n;
    };
    let reachable = reach();
    for (const room of this.rooms) {
      if (room === this.startRoom || room.boss) continue;
      const want = Math.min(4, Math.round((room.w * room.h) / 28) + r.int(0, 1));
      let placed = 0;
      for (let tries = 0; tries < 30 && placed < want; tries++) {
        // a tile on the room's border, away from the central cross (doorways)
        const side = r.int(0, 3);
        let x;
        let z;
        if (side < 2) {
          x = r.int(room.x + 1, room.x + room.w - 2);
          z = side === 0 ? room.z : room.z + room.h - 1;
        } else {
          z = r.int(room.z + 1, room.z + room.h - 2);
          x = side === 2 ? room.x : room.x + room.w - 1;
        }
        if (Math.abs(x - room.cx) <= 1 || Math.abs(z - room.cz) <= 1) continue;
        if (!this.flatGround(x, z)) continue;
        // face away from the adjacent wall
        let ang = null;
        for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
          if (this.get(x + dx, z + dz) === TILE.WALL) {
            ang = Math.atan2(-dx, -dz);
            break;
          }
        }
        if (ang === null) continue;
        // keep a free tile between props so rooms stay readable
        let crowded = false;
        for (const p of this.props) if (Math.abs(p.tx - x) <= 1 && Math.abs(p.tz - z) <= 1) crowded = true;
        if (crowded) continue;
        this.set(x, z, TILE.PROP);
        const now = reach();
        if (now < reachable - 1) {
          this.set(x, z, TILE.FLOOR);
          continue;
        }
        reachable = now;
        let total = 0;
        for (const k in weights) total += weights[k];
        let roll = r.next() * total;
        let type = 'crates';
        for (const k in weights) {
          roll -= weights[k];
          if (roll <= 0) {
            type = k;
            break;
          }
        }
        this.props.push({ tx: x, tz: z, angle: ang, type });
        placed++;
      }
    }
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
    this.raisePlatforms(room);
    if (room.w >= 9 && room.h >= 9 && r.chance(0.5)) {
      for (const [ox, oz] of [
        [2, 2],
        [room.w - 3, 2],
        [2, room.h - 3],
        [room.w - 3, room.h - 3],
      ])
        if (this.flatGround(room.x + ox, room.z + oz)) this.set(room.x + ox, room.z + oz, TILE.PILLAR);
    }
    const blocks = r.int(1, 4);
    for (let i = 0; i < blocks; i++) {
      const bw = r.int(1, 2);
      const bh = r.int(1, 2);
      const x = r.int(room.x + 1, room.x + room.w - 1 - bw);
      const z = r.int(room.z + 1, room.z + room.h - 1 - bh);
      let ok = true;
      for (let dz = 0; dz < bh; dz++) for (let dx = 0; dx < bw; dx++) if (!clearOfCross(x + dx, z + dz) || !this.flatGround(x + dx, z + dz)) ok = false;
      if (!ok) continue;
      for (let dz = 0; dz < bh; dz++) for (let dx = 0; dx < bw; dx++) this.set(x + dx, z + dz, TILE.BLOCK);
    }
  }

  // Raised platforms in a room's corners, each reached by a flight of stairs. They
  // stay clear of the room's central cross, so corridors always arrive at ground level.
  raisePlatforms(room) {
    const r = this.rng;
    if (room === this.startRoom || room.boss || !r.chance(0.65)) return;
    const corners = [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ];
    const want = room.w * room.h >= 70 && r.chance(0.5) ? 2 : 1;
    let made = 0;
    for (let k = 0; k < 4 && made < want; k++) {
      const [sx, sz] = corners.splice(r.int(0, corners.length - 1), 1)[0];
      // the quadrant between the corner walls and the cross
      const x0 = sx < 0 ? room.x : room.cx + 2;
      const x1 = sx < 0 ? room.cx - 2 : room.x + room.w - 1;
      const z0 = sz < 0 ? room.z : room.cz + 2;
      const z1 = sz < 0 ? room.cz - 2 : room.z + room.h - 1;
      const w = x1 - x0 + 1;
      const d = z1 - z0 + 1;
      if (w < 2 || d < 2) continue;
      // stairs run from the platform's inner edge toward the wall, along x or z
      const alongZ = w < 3 ? true : d < 3 ? false : r.chance(0.5);
      const depth = alongZ ? d : w;
      const steps = depth >= 4 && r.chance(0.55) ? 2 : 1;
      if (depth < steps + 1) continue;
      let clear = true;
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (this.get(x, z) !== TILE.FLOOR) clear = false;
      if (!clear) continue;
      const reachBefore = this.reachCount();
      const top = steps * STEP_H;
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.elev[this.idx(x, z)] = top;
      // the platform's inner corner (nearest the room centre) holds the stairs
      const ix = sx < 0 ? x1 : x0;
      const iz = sz < 0 ? z1 : z0;
      for (let i = 0; i < steps; i++) {
        // flight i climbs from i * STEP_H, i tiles in from the inner edge
        const tx = alongZ ? ix : ix + sx * i;
        const tz = alongZ ? iz + sz * i : iz;
        const dir = alongZ ? (sz < 0 ? 4 : 3) : sx < 0 ? 2 : 1;
        this.elev[this.idx(tx, tz)] = i * STEP_H;
        this.stair[this.idx(tx, tz)] = dir;
      }
      // a corridor arriving through this corner would be walled off: undo it
      if (this.reachCount() < reachBefore) {
        for (let z = z0; z <= z1; z++)
          for (let x = x0; x <= x1; x++) {
            this.elev[this.idx(x, z)] = 0;
            this.stair[this.idx(x, z)] = 0;
          }
        continue;
      }
      room.platforms = room.platforms || [];
      room.platforms.push({ x0, x1, z0, z1, top });
      made++;
    }
  }

  // Walkable tiles a walker can reach from the start room.
  reachCount() {
    const d = this.bfs(this.startRoom.cx, this.startRoom.cz);
    let n = 0;
    for (let i = 0; i < d.length; i++) if (d[i] >= 0) n++;
    return n;
  }

  // A plain floor tile at ground level (no platform or stairs).
  flatGround(x, z) {
    const i = this.idx(x, z);
    return this.get(x, z) === TILE.FLOOR && this.elev[i] === 0 && !this.stair[i];
  }

  randomFloorIn(room, margin = 1, r = this.rng) {
    for (let i = 0; i < 40; i++) {
      const x = r.int(room.x + margin, room.x + room.w - 1 - margin);
      const z = r.int(room.z + margin, room.z + room.h - 1 - margin);
      if (this.get(x, z) === TILE.FLOOR && !this.stair[this.idx(x, z)]) return { x: (x + 0.5) * T, z: (z + 0.5) * T };
    }
    return { x: (room.cx + 0.5) * T, z: (room.cz + 0.5) * T };
  }

  rollSpawn(r, room, pool) {
    const f = this.floor;
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
    let pos = this.randomFloorIn(room, 1, r);
    // shooters like the high ground
    if ((type === 'archer' || type === 'mage') && room.platforms && r.chance(0.6)) {
      const pl = r.pick(room.platforms);
      const tx = r.int(pl.x0, pl.x1);
      const tz = r.int(pl.z0, pl.z1);
      if (!this.stair[this.idx(tx, tz)]) pos = { x: (tx + 0.5) * T, z: (tz + 0.5) * T };
    }
    // some skeletons lie in wait as bone piles and rise when the hero comes close
    const dormant = (type === 'grunt' || type === 'brute') && r.chance(0.3);
    return { type, ...pos, elite: f >= 2 && r.chance(0.06 + f * 0.01), dormant };
  }

  // Bigger parties get more monsters: +40% per extra player.
  addPartySpawns(party, seed) {
    const r = makeRng((seed ^ 0x5bd1e995) >>> 0);
    const pool = enemyPoolForFloor(this.floor);
    for (const room of this.rooms) {
      if (!room.spawnCount) continue;
      const extra = Math.round(room.spawnCount * 0.4 * (party - 1));
      for (let i = 0; i < extra; i++) this.spawns.push(this.rollSpawn(r, room, pool));
    }
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
      let n = Math.round(area / 20) + Math.floor(f / 3) + r.int(0, 2);
      n = clamp(n, 3, 10);
      room.spawnCount = n;
      for (let i = 0; i < n; i++) this.spawns.push(this.rollSpawn(r, room, pool));
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
    // spike traps: whole floor tiles that cycle up and down (from floor 2)
    this.traps = [];
    if (f >= 2 && !this.isBoss) {
      for (const room of this.rooms) {
        if (room === this.startRoom || !r.chance(0.4)) continue;
        const n = r.int(1, Math.min(4, 1 + Math.floor(f / 3)));
        for (let i = 0; i < n; i++) {
          const tx = r.int(room.x + 1, room.x + room.w - 2);
          const tz = r.int(room.z + 1, room.z + room.h - 2);
          if (!this.flatGround(tx, tz) || this.traps.some((t) => t.tx === tx && t.tz === tz)) continue;
          this.traps.push({ tx, tz, x: (tx + 0.5) * T, z: (tz + 0.5) * T, phase: r.next() * 3 });
        }
      }
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
  // Surface height of tile (x, z); on stairs, at world point (px, pz) (or at their top
  // when no point is given).
  heightAtTile(x, z, px, pz) {
    const t = this.get(x, z);
    const h = HEIGHT[t];
    if (h >= 100) return h;
    const i = z * this.w + x;
    const e = this.elev[i];
    const s = this.stair[i];
    if (!s) return h + e;
    if (px === undefined) return e + STEP_H;
    const [dx, dz] = STAIR_DIRS[s - 1];
    const u = clamp(px / T - x, 0, 1);
    const v = clamp(pz / T - z, 0, 1);
    const f = dx > 0 ? u : dx < 0 ? 1 - u : dz > 0 ? v : 1 - v;
    return e + STEP_H * f;
  }
  heightAtPoint(x, z) {
    return this.heightAtTile(Math.floor(x / T), Math.floor(z / T), x, z);
  }
  // Ground under a point, where effects sit: walls report the floor at their base.
  floorAt(x, z) {
    const h = this.heightAtPoint(x, z);
    if (h < 100) return h;
    const tx = clamp(Math.floor(x / T), 0, this.w - 1);
    const tz = clamp(Math.floor(z / T), 0, this.h - 1);
    return this.elev[this.idx(tx, tz)];
  }
  // Walls, pillars and props (not crates, platforms or stairs).
  solidAt(x, z) {
    return HEIGHT[this.get(Math.floor(x / T), Math.floor(z / T))] >= 100;
  }
  // Something running along the ground from (fx, fz) stops at (x, z): a wall, or the
  // floor rising up a ledge.
  groundBlocked(fx, fz, x, z) {
    return this.solidAt(x, z) || this.floorAt(x, z) > this.floorAt(fx, fz) + 0.6;
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
        if ((nx - x) ** 2 + (nz - z) ** 2 < rad * rad) fn(this.heightAtTile(tx, tz, nx, nz), tx, tz);
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
    // non-climbers (monsters) step from the floor they stand on, even mid-air
    const foot = canClimb ? ent.y : ent.groundY ?? Math.min(ent.y, 0.01);
    let hitWall = false;
    for (let i = 0; i < steps; i++) {
      if (!this.blocked(ent.x + sx, ent.z, ent.radius, foot)) ent.x += sx;
      else hitWall = true;
      if (!this.blocked(ent.x, ent.z + sz, ent.radius, foot)) ent.z += sz;
      else hitWall = true;
    }
    return hitWall;
  }

  // Walls (not low blocks) stop sight lines: a line maxH above the ground at each end
  // (or above the given heights ay / by), which platform edges can also cut.
  lineOfSight(ax, az, bx, bz, maxH = 1.5, ignoreProps = false, ay, by) {
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.ceil(d / 0.5);
    const y0 = (ay ?? this.floorAt(ax, az)) + maxH;
    const y1 = (by ?? this.floorAt(bx, bz)) + maxH;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if ((ignoreProps ? this.cameraHeightAt : this.heightAtPoint).call(this, ax + (bx - ax) * t, az + (bz - az) * t) > y0 + (y1 - y0) * t) return false;
    }
    return true;
  }

  // March from `from` to `to` (Vector3) and return how far (0..1) is free of geometry.
  // Height the camera must clear: furniture is only ~2.6m tall, not a full wall.
  cameraHeightAt(x, z) {
    const tx = Math.floor(x / T);
    const tz = Math.floor(z / T);
    return this.get(tx, tz) === TILE.PROP ? 2.6 : this.heightAtTile(tx, tz, x, z);
  }

  raycastFraction(from, to) {
    const d = from.distanceTo(to);
    const n = Math.ceil(d / 0.15);
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;
      const z = from.z + (to.z - from.z) * t;
      if (this.cameraHeightAt(x, z) > y - 0.3) return Math.max(0, (i - 1) / n);
    }
    return 1;
  }

  walkable(x, z) {
    return this.get(x, z) === TILE.FLOOR;
  }

  // Height of tile (x, z) where it meets its neighbour in direction (dx, dz).
  edgeHeight(x, z, dx, dz) {
    return this.heightAtTile(x, z, (x + 0.5 + dx * 0.5) * T, (z + 0.5 + dz * 0.5) * T);
  }

  // Can a walker step between neighbouring tiles a and b? Ledges can't be climbed,
  // so stairs only connect along their run.
  linked(ax, az, bx, bz) {
    if (!this.walkable(bx, bz)) return false;
    const dx = bx - ax;
    const dz = bz - az;
    if (dx && dz) return this.linked(ax, az, ax + dx, az) && this.linked(ax + dx, az, bx, bz) && this.linked(ax, az, ax, az + dz) && this.linked(ax, az + dz, bx, bz);
    return Math.abs(this.edgeHeight(ax, az, dx, dz) - this.edgeHeight(bx, bz, -dx, -dz)) < 0.45;
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
          if (c === s && !this.walkable(cx, cz)) {
            // starting on a crate or prop: step down anywhere
            if (!this.walkable(nx, nz) || (dx && dz && (!this.walkable(cx + dx, cz) || !this.walkable(cx, cz + dz)))) continue;
          } else if (!this.linked(cx, cz, nx, nz)) continue;
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
        if (this.walkable(tx, tz) ? !this.linked(tx, tz, nx, nz) : !this.walkable(nx, nz)) continue;
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
  buildMeshes(quality = 'high') {
    const env = buildEnvironment(this, quality);
    this.env = env;
    this.torchSpots = env.torchSpots;
    this.lightSpots = env.lightSpots;
    this.group = env.group;
    return env.group;
  }

  dispose() {
    if (!this.group) return;
    this.group.traverse((o) => {
      if (o.geometry && (o.userData.ownGeo || !o.geometry.userData.shared)) o.geometry.dispose();
      if (o.userData.ownMat && o.material) o.material.dispose();
    });
    this.env.dispose();
  }
}
