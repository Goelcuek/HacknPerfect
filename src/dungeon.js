// Procedural dungeon: room + corridor tile map, collision queries, flow-field
// pathing for enemies and instanced meshes for rendering.

import * as THREE from 'three';
import { makeRng, clamp } from './utils.js';

import { T, WALL_H, BLOCK_H, STEP_H, STAIR_DIRS, TILE, HEIGHT, THEMES } from './tiles.js';
import { buildEnvironment, PROP_WEIGHTS } from './decor.js';
import { endlessEffects } from './endless.js';
import { throneBossForFloor } from './enemies.js';

export { T, WALL_H, BLOCK_H, STEP_H, STAIR_DIRS, TILE, THEMES };

export function themeForFloor(floor) {
  return THEMES[(floor - 1) % THEMES.length];
}

// Den lords in rotation: a different one guards the portal on each floor.
const DEN_BOSSES = ['warlord', 'lich', 'deathknight', 'butcher', 'matriarch'];
export function denBossForFloor(floor) {
  return DEN_BOSSES[(floor - 1 - Math.floor((floor - 1) / 5)) % DEN_BOSSES.length];
}

// Which monsters roam a floor: the deeper, the wider the bestiary, and each setting
// favours its own (theme.foes multiplies weights, e.g. more shades in the Frozen Vault).
export function enemyPoolForFloor(floor, theme = null) {
  const pool = [{ type: 'grunt', w: 10 }];
  if (floor >= 2) pool.push({ type: 'archer', w: 5 + floor * 0.5 }, { type: 'bomber', w: 2 + floor * 0.25 });
  if (floor >= 3) pool.push({ type: 'brute', w: 2 + floor * 0.4 }, { type: 'mage', w: 1.5 + floor * 0.3 }, { type: 'knight', w: 2 + floor * 0.3 });
  if (floor >= 4) pool.push({ type: 'wisp', w: 3 + floor * 0.3 }, { type: 'shade', w: 2 + floor * 0.3 });
  if (floor >= 5) pool.push({ type: 'berserker', w: 2 + floor * 0.3 }, { type: 'warlock', w: 1.5 + floor * 0.3 });
  const foes = theme?.foes || {};
  for (const p of pool) p.w *= foes[p.type] ?? 1;
  return pool;
}

export class Dungeon {
  // party: players in a multiplayer run; only the host passes it (it alone spawns
  // monsters), and the extra monsters come from their own random stream so the
  // layout, chests and barrels stay identical on every player's machine.
  constructor(floor, seed, party = 1, o = {}) {
    this.floor = floor;
    this.rng = makeRng(seed);
    // the PvP arena: one big room with platforms and pillars, no monsters
    this.arena = !!o.arena;
    this.isBoss = !this.arena && floor % 5 === 0;
    this.theme = themeForFloor(floor);
    this.endless = endlessEffects(floor);
    this.generate();
    if (party > 1) this.addPartySpawns(party, seed);
  }

  // ---------------------------------------------------------------- generation
  generate() {
    const r = this.rng;
    const W = this.arena ? 38 : this.isBoss ? 44 : clamp(46 + Math.floor(this.floor * 1.5), 46, 64);
    const H = W;
    this.w = W;
    this.h = H;
    this.tiles = new Uint8Array(W * H); // all WALL
    this.elev = new Float32Array(W * H); // floor height of each tile (raised platforms)
    this.stair = new Uint8Array(W * H); // 1-4: a stair climbing STEP_H toward STAIR_DIRS[code - 1]
    this.seen = new Uint8Array(W * H);
    this.rooms = [];

    if (this.arena) {
      this.rooms.push({ x: 3, z: 3, w: W - 6, h: H - 6, arena: true });
    } else if (this.isBoss) {
      this.rooms.push({ x: 3, z: Math.floor(H / 2) - 4, w: 8, h: 8 });
      this.rooms.push({ x: 18, z: Math.floor(H / 2) - 10, w: 20, h: 20, boss: true });
    } else {
      const fits = (x, z, w, h) => this.rooms.every((o) => x + w + 3 < o.x || o.x + o.w + 3 < x || z + h + 3 < o.z || o.z + o.h + 3 < z);
      // the start room, then the boss den as far from it as it will go
      const sw = r.int(7, 9);
      const sh = r.int(7, 9);
      this.rooms.push({ x: r.int(2, W - sw - 2), z: r.int(2, H - sh - 2), w: sw, h: sh });
      const st = this.rooms[0];
      const dw = r.int(13, 15);
      const dh = r.int(13, 15);
      let den = null;
      let far = -1;
      for (let i = 0; i < 80; i++) {
        const x = r.int(2, W - dw - 2);
        const z = r.int(2, H - dh - 2);
        if (!fits(x, z, dw, dh)) continue;
        const d = Math.hypot(x + dw / 2 - (st.x + st.w / 2), z + dh / 2 - (st.z + st.h / 2));
        if (d > far) {
          far = d;
          den = { x, z, w: dw, h: dh, den: true };
        }
      }
      if (den) this.rooms.push(den);
      const target = Math.min(5 + Math.floor(this.floor * 0.5), 10);
      for (let i = 0; i < 400 && this.rooms.length < target; i++) {
        const w = r.int(6, 11);
        const h = r.int(6, 11);
        const x = r.int(2, W - w - 2);
        const z = r.int(2, H - h - 2);
        if (fits(x, z, w, h)) this.rooms.push({ x, z, w, h });
      }
      // dig the den's corridor last, from whichever room is nearest: no straight shot
      // from the start
      if (den) this.rooms.push(...this.rooms.splice(this.rooms.indexOf(den), 1));
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

    // start / exit rooms: the portal is in the boss den (or the farthest room)
    this.startRoom = this.rooms[0];
    const dist = this.bfs(this.startRoom.cx, this.startRoom.cz);
    let exit = this.rooms.find((rm) => rm.den || rm.boss) || this.rooms[this.rooms.length - 1];
    if (!exit.den && !exit.boss) {
      let far = -1;
      for (const room of this.rooms) {
        const d = dist[this.idx(room.cx, room.cz)];
        if (d > far) {
          far = d;
          exit = room;
        }
      }
    }
    this.exitRoom = exit;
    this.denRoom = this.rooms.find((rm) => rm.den) || null;

    // decoration + gameplay content
    this.spawns = [];
    this.chests = [];
    this.pots = [];
    for (const room of this.rooms) {
      if (room === this.startRoom && !this.arena) continue;
      this.decorateRoom(room);
    }
    this.placeProps();
    this.placeContent();
    this.placeEvents();
  }

  // Furniture and statues against room walls. Each placement is kept only if
  // every previously reachable floor tile stays reachable.
  placeProps() {
    this.props = [];
    const r = this.rng;
    const weights = this.theme.props || PROP_WEIGHTS[this.theme.style];
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
    // corridors are 3 tiles (6 m) wide, centred on the rooms' central cross
    const carve = (cx, cz) => {
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
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
    if (room.arena) {
      // the PvP arena: a central dais, a balcony, corner perches, and pillars to duck behind
      this.raiseDais(room);
      this.raiseBalcony(room);
      this.raiseCorners(room, 2);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        const x = Math.round(room.cx + Math.cos(a) * 9);
        const z = Math.round(room.cz + Math.sin(a) * 9);
        if (this.flatGround(x, z)) this.set(x, z, TILE.PILLAR);
      }
      for (let i = 0; i < 6; i++) {
        const x = r.int(room.x + 4, room.x + room.w - 6);
        const z = r.int(room.z + 4, room.z + room.h - 6);
        if (this.flatGround(x, z) && this.flatGround(x + 1, z)) {
          this.set(x, z, TILE.BLOCK);
          this.set(x + 1, z, TILE.BLOCK);
        }
      }
      return;
    }
    if (room.den) {
      // the den: four great pillars, open floor for the fight
      for (const [ox, oz] of [
        [3, 3],
        [room.w - 4, 3],
        [3, room.h - 4],
        [room.w - 4, room.h - 4],
      ])
        this.set(room.x + ox, room.z + oz, TILE.PILLAR);
      return;
    }
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

  // Verticality: most rooms get raised floor, reached by flights of stairs:
  //  - a balcony along a whole wall, with stairs coming down into the room,
  //  - a dais in the middle of a big room, with stairs on all four sides,
  //  - platforms tucked into corners.
  // A feature that would wall off a doorway or corridor is undone (see tryRaise).
  raisePlatforms(room) {
    const r = this.rng;
    if (room === this.startRoom || room.boss || room.den || !r.chance(0.85)) return;
    const big = room.w >= 8 && room.h >= 8;
    const roll = r.next();
    let made = false;
    if (big && room !== this.exitRoom && roll < 0.35) made = this.raiseDais(room);
    else if (roll < 0.75) made = this.raiseBalcony(room);
    if (!made || (big && r.chance(0.5))) this.raiseCorners(room, made ? 1 : big && r.chance(0.5) ? 2 : 1);
  }

  // Raise rect (x0..x1, z0..z1) to height top and lay the given stairs
  // ([x, z, base, dir]); kept only if every tile that was reachable still is.
  tryRaise(room, x0, x1, z0, z1, top, stairs) {
    const inRoom = (x, z) => x >= room.x && x < room.x + room.w && z >= room.z && z < room.z + room.h;
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (!inRoom(x, z) || !this.flatGround(x, z)) return false;
    for (const [x, z] of stairs) {
      const inside = x >= x0 && x <= x1 && z >= z0 && z <= z1;
      if (!inRoom(x, z) || (!inside && !this.flatGround(x, z))) return false;
    }
    const before = this.reachCount();
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.elev[this.idx(x, z)] = top;
    for (const [x, z, base, dir] of stairs) {
      this.elev[this.idx(x, z)] = base;
      this.stair[this.idx(x, z)] = dir;
    }
    if (this.reachCount() < before) {
      const clear = (x, z) => {
        this.elev[this.idx(x, z)] = 0;
        this.stair[this.idx(x, z)] = 0;
      };
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) clear(x, z);
      for (const [x, z] of stairs) clear(x, z);
      return false;
    }
    (room.platforms ||= []).push({ x0, x1, z0, z1, top });
    return true;
  }

  // A stair code climbing toward (dx, dz).
  static stairCode(dx, dz) {
    return dx > 0 ? 1 : dx < 0 ? 2 : dz > 0 ? 3 : 4;
  }

  // A balcony 2-3 tiles deep along one wall, 1 or 2 steps up, with a flight of
  // stairs somewhere along its edge coming down into the room.
  raiseBalcony(room) {
    const r = this.rng;
    for (let tries = 0; tries < 4; tries++) {
      const side = r.int(0, 3); // wall at -z, +z, -x, +x
      const alongX = side < 2;
      const along = alongX ? room.w : room.h;
      const across = alongX ? room.h : room.w;
      if (along < 5 || across < 7) continue;
      const depth = across >= 10 && r.chance(0.5) ? 3 : 2;
      const steps = across >= 8 && r.chance(0.6) ? 2 : 1;
      // inward direction (from the wall into the room)
      const [ix, iz] = [[0, 1], [0, -1], [1, 0], [-1, 0]][side];
      let x0 = room.x;
      let x1 = room.x + room.w - 1;
      let z0 = room.z;
      let z1 = room.z + room.h - 1;
      if (side === 0) z1 = room.z + depth - 1;
      if (side === 1) z0 = room.z + room.h - depth;
      if (side === 2) x1 = room.x + depth - 1;
      if (side === 3) x0 = room.x + room.w - depth;
      // stairs: from the balcony's inner edge into the room, climbing back toward it
      const t = r.int(1, along - 2);
      const ex = alongX ? room.x + t : side === 2 ? x1 : x0;
      const ez = alongX ? (side === 0 ? z1 : z0) : room.z + t;
      const dir = Dungeon.stairCode(-ix, -iz);
      const stairs = [];
      for (let k = 0; k < steps; k++) stairs.push([ex + ix * (k + 1), ez + iz * (k + 1), (steps - 1 - k) * STEP_H, dir]);
      if (this.tryRaise(room, x0, x1, z0, z1, steps * STEP_H, stairs)) return true;
    }
    return false;
  }

  // A dais filling the middle of a big room, one step up, with stairs on the
  // room's cross so the way through the room stays open.
  raiseDais(room) {
    const x0 = room.x + 2;
    const x1 = room.x + room.w - 3;
    const z0 = room.z + 2;
    const z1 = room.z + room.h - 3;
    const stairs = [
      [room.cx, z0, 0, 3],
      [room.cx, z1, 0, 4],
      [x0, room.cz, 0, 1],
      [x1, room.cz, 0, 2],
    ];
    return this.tryRaise(room, x0, x1, z0, z1, STEP_H, stairs);
  }

  // Platforms tucked into the room's corners (clear of the central cross), with
  // their stairs at the corner nearest the room centre.
  raiseCorners(room, want) {
    const r = this.rng;
    const corners = [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ];
    let made = 0;
    for (let k = 0; k < 4 && made < want; k++) {
      const [sx, sz] = corners.splice(r.int(0, corners.length - 1), 1)[0];
      const x0 = sx < 0 ? room.x : room.cx + 2;
      const x1 = sx < 0 ? room.cx - 2 : room.x + room.w - 1;
      const z0 = sz < 0 ? room.z : room.cz + 2;
      const z1 = sz < 0 ? room.cz - 2 : room.z + room.h - 1;
      const w = x1 - x0 + 1;
      const d = z1 - z0 + 1;
      if (w < 2 || d < 2) continue;
      const alongZ = w < 3 ? true : d < 3 ? false : r.chance(0.5);
      const depth = alongZ ? d : w;
      const steps = depth >= 4 && r.chance(0.55) ? 2 : 1;
      if (depth < steps + 1) continue;
      const ix = sx < 0 ? x1 : x0;
      const iz = sz < 0 ? z1 : z0;
      const dir = alongZ ? (sz < 0 ? 4 : 3) : sx < 0 ? 2 : 1;
      const stairs = [];
      // flight i climbs from i * STEP_H, i tiles in from the inner edge
      for (let i = 0; i < steps; i++) stairs.push([alongZ ? ix : ix + sx * i, alongZ ? iz + sz * i : iz, i * STEP_H, dir]);
      if (this.tryRaise(room, x0, x1, z0, z1, steps * STEP_H, stairs)) made++;
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
    return { type, ...pos, elite: f >= 2 && r.chance(0.06 + Math.min(f, 25) * 0.012 + this.endless.elite), dormant };
  }

  // Bigger parties get more monsters: +40% per extra player.
  addPartySpawns(party, seed) {
    const r = makeRng((seed ^ 0x5bd1e995) >>> 0);
    const pool = enemyPoolForFloor(this.floor, this.theme);
    for (const room of this.rooms) {
      if (!room.spawnCount) continue;
      const extra = Math.round(room.spawnCount * 0.4 * (party - 1));
      for (let i = 0; i < extra; i++) this.spawns.push(this.rollSpawn(r, room, pool));
    }
  }

  placeContent() {
    const r = this.rng;
    this.traps = [];
    if (this.arena) {
      // a few barrels to smash for potions mid-fight
      for (let i = 0; i < 6; i++) this.pots.push(this.randomFloorIn(this.startRoom, 2));
      return;
    }
    const f = this.floor;
    const pool = enemyPoolForFloor(f, this.theme);
    for (const room of this.rooms) {
      if (room === this.startRoom) continue;
      if (room.boss) {
        this.spawns.push({ type: throneBossForFloor(f), ...this.worldCenter(room), elite: false });
        continue;
      }
      if (room.den) {
        // the den's lord (killing it opens the portal) and a few of its guards
        const c = this.worldCenter(room);
        this.spawns.push({ type: denBossForFloor(f), x: c.x, z: c.z + 3 * T, elite: false, den: true });
        const guards = 2 + Math.min(2, Math.floor(f / 4));
        room.spawnCount = guards;
        for (let i = 0; i < guards; i++) this.spawns.push({ ...this.rollSpawn(r, room, pool), dormant: false });
        continue;
      }
      const area = room.w * room.h;
      let n = Math.round(area / 20) + Math.floor(Math.min(f, 20) / 3) + r.int(0, 2);
      n = Math.round(clamp(n, 3, 10) * this.endless.swarm);
      room.spawnCount = n;
      for (let i = 0; i < n; i++) this.spawns.push(this.rollSpawn(r, room, pool));
      const pots = r.int(0, 3);
      for (let i = 0; i < pots; i++) this.pots.push(this.randomFloorIn(room));
    }
    const chestRooms = this.rooms.filter((rm) => rm !== this.startRoom && !rm.boss && !rm.den);
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

  // Floor events (from floor 2, not on throne floors): a wandering merchant, a cursed
  // altar, and one of a treasure goblin / trial shrine / prisoner's cage. Placed from
  // the floor's own seed, so every player sees the same ones.
  placeEvents() {
    this.events = [];
    const f = this.floor;
    if (f < 2 || this.isBoss || this.arena) return;
    const r = this.rng;
    const rooms = this.rooms.filter((rm) => rm !== this.startRoom && !rm.boss && !rm.den);
    if (!rooms.length) return;
    const spot = (room) => {
      for (let i = 0; i < 30; i++) {
        const tx = r.int(room.x + 2, room.x + room.w - 3);
        const tz = r.int(room.z + 2, room.z + room.h - 3);
        let ok = true;
        for (let dz = -1; dz <= 1 && ok; dz++) for (let dx = -1; dx <= 1 && ok; dx++) ok = this.flatGround(tx + dx, tz + dz) && !this.traps.some((t) => t.tx === tx + dx && t.tz === tz + dz);
        if (ok) return { x: (tx + 0.5) * T, z: (tz + 0.5) * T };
      }
      return null;
    };
    const take = () => rooms.splice(r.int(0, rooms.length - 1), 1)[0];
    const add = (kind, chance) => {
      if (!rooms.length || !r.chance(chance)) return;
      const room = take();
      const at = spot(room);
      if (at) this.events.push({ kind, ...at, room });
    };
    add('merchant', 0.45);
    add('altar', 0.5);
    const special = r.pick(['goblin', 'trial', 'cage']);
    add(special, 0.8);
    for (const ev of this.events) {
      if (ev.kind === 'goblin') this.spawns.push({ type: 'goblin', x: ev.x, z: ev.z, elite: false });
      if (ev.kind === 'cage') this.spawns.push({ type: 'cage', x: ev.x, z: ev.z, elite: false });
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
