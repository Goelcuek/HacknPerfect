// Co-op multiplayer over WebRTC (PeerJS). One player hosts: their game is the
// authority for the dungeon, enemies, the portal and floor changes. Others join
// with the host's 6-digit PIN. Each player simulates their own hero locally and
// streams its state; hits on enemies go to the host, which streams the enemies
// back. Loot is per player. Star topology: the host relays between clients.

import { RemotePlayer } from './remote.js';
import { Enemy, ENEMY_TYPES } from './enemies.js';

const PREFIX = 'hacknperfect-';
export const MAX_PLAYERS = 4;
const SEND_HZ = 15;
const SNAP_HZ = 12;
// Effects mirrored to other players (all take plain arguments).
const FX = ['burst', 'ring', 'telegraph', 'slash', 'spikes', 'fallingArrow', 'iceShards', 'meteor', 'smoke', 'lightning'];
const STATES = ['idle', 'chase', 'windup', 'attack', 'recover', 'bosswind', 'bossact'];
const r2 = (v) => Math.round(v * 100) / 100;

// Signalling server: the free PeerJS cloud by default; `?signal=host:port`
// points at a self-hosted `peerjs` server (used by the tests).
function peerOptions() {
  const q = new URLSearchParams(location.search);
  const o = { debug: 0 };
  const sig = q.get('signal');
  if (sig) {
    const [host, port] = sig.split(':');
    Object.assign(o, { host, port: +port || 9000, path: '/', secure: q.get('secure') === '1' });
  }
  if (q.has('noice')) o.config = { iceServers: [] };
  return o;
}

function withTimeout(p, ms, msg) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
}

// Only plain, cloneable animation options go over the wire.
function cleanOpts(o = {}) {
  const out = {};
  for (const k of ['part', 'from', 'to', 'speed', 'dur', 'hold', 'loop', 'fadeIn', 'fadeOut', 'keep', 'weight', 'instant']) if (o[k] !== undefined) out[k] = o[k];
  return out;
}

export class Net {
  constructor(game) {
    this.game = game;
    this.mode = null; // 'host' | 'client' | null
    this.peer = null;
    this.pin = null;
    this.myId = 0;
    this.conns = new Map(); // host: client id -> connection
    this.hellos = new Map(); // host: client id -> hello info (class, look)
    this.hostConn = null;
    this.remotes = new Map(); // player id -> RemotePlayer
    this.nextId = 1;
    this.outAnim = [];
    this.outFx = [];
    this.outShoot = [];
    this.outZone = [];
    this.eAnim = [];
    this.sendT = 0;
    this.snapT = 0;
    this.overT = 0;
    this.reviveT = 0;
    this.onStatus = null; // UI callback (lobby screen)
    this.wrapEffects();
  }

  get isHost() {
    return this.mode === 'host';
  }
  get isClient() {
    return this.mode === 'client';
  }
  // A session with at least one other player in it.
  get live() {
    return (this.isHost && this.conns.size > 0) || (this.isClient && !!this.hostConn);
  }
  get playerCount() {
    return 1 + this.remotes.size;
  }

  status(msg) {
    this.onStatus?.(msg);
  }

  // ------------------------------------------------------------ connecting
  host() {
    this.leave();
    const attempt = (n) =>
      new Promise((resolve, reject) => {
        const pin = String(Math.floor(100000 + Math.random() * 900000));
        const peer = new window.Peer(PREFIX + pin, peerOptions());
        let opened = false;
        peer.on('open', () => {
          opened = true;
          this.peer = peer;
          this.pin = pin;
          this.mode = 'host';
          this.myId = 0;
          resolve(pin);
        });
        peer.on('connection', (conn) => this.onIncoming(conn));
        peer.on('disconnected', () => {
          // lost the signalling server: existing players stay connected, new joins need it back
          if (!peer.destroyed) peer.reconnect();
        });
        peer.on('error', (err) => {
          if (!opened) {
            peer.destroy();
            if (err.type === 'unavailable-id' && n < 5) attempt(n + 1).then(resolve, reject);
            else reject(new Error(err.type === 'browser-incompatible' ? 'This browser does not support WebRTC' : 'Could not reach the multiplayer server'));
          } else if (err.type !== 'peer-unavailable') this.game.ui.toast(`Network: ${err.type}`, 2);
        });
      });
    return withTimeout(attempt(0), 15000, 'Could not reach the multiplayer server');
  }

  join(pin) {
    this.leave();
    const p = new Promise((resolve, reject) => {
      const peer = new window.Peer(undefined, peerOptions());
      this.peer = peer;
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + pin, { reliable: true, serialization: 'json' });
        conn.on('open', () => {
          this.hostConn = conn;
          this.mode = 'client';
          this.pin = pin;
          resolve();
        });
        conn.on('data', (m) => this.onClientMsg(m));
        conn.on('close', () => this.onHostLost());
        conn.on('error', () => this.onHostLost());
      });
      peer.on('error', (err) => {
        if (err.type === 'peer-unavailable') reject(new Error('No game found with that PIN'));
        else if (err.type === 'browser-incompatible') reject(new Error('This browser does not support WebRTC'));
        else reject(new Error('Could not reach the multiplayer server'));
      });
    });
    return withTimeout(p, 15000, 'Timed out: check the PIN and your connection').catch((e) => {
      this.leave();
      throw e;
    });
  }

  leave() {
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear();
    for (const c of this.conns.values()) c.close();
    this.conns.clear();
    this.hellos.clear();
    this.hostConn?.close();
    this.hostConn = null;
    this.peer?.destroy();
    this.peer = null;
    this.mode = null;
    this.pin = null;
    this.game.ui.setParty?.(null);
  }

  // ------------------------------------------------------------- messaging
  send(t, o = {}) {
    if (this.isClient && this.hostConn?.open) this.hostConn.send({ t, ...o });
    else if (this.isHost) this.broadcast(t, o);
  }
  sendTo(id, t, o = {}) {
    const c = this.conns.get(id);
    if (c?.open) c.send({ t, ...o });
  }
  broadcast(t, o = {}, except = -1) {
    for (const [id, c] of this.conns) if (id !== except && c.open && this.hellos.has(id)) c.send({ t, ...o });
  }

  // --------------------------------------------------------------- host side
  onIncoming(conn) {
    if (this.conns.size >= MAX_PLAYERS - 1) {
      conn.on('open', () => {
        conn.send({ t: 'full' });
        setTimeout(() => conn.close(), 500);
      });
      return;
    }
    const id = this.nextId++;
    this.conns.set(id, conn);
    conn.on('data', (m) => this.onHostMsg(id, m));
    conn.on('close', () => this.dropPlayer(id));
    conn.on('error', () => this.dropPlayer(id));
  }

  dropPlayer(id) {
    if (!this.conns.has(id)) return;
    this.conns.delete(id);
    const had = this.hellos.delete(id);
    const r = this.remotes.get(id);
    if (r) {
      this.game.ui.toast(`${r.name} left`, 2);
      r.dispose();
      this.remotes.delete(id);
    }
    if (had) this.broadcast('leave', { id });
    this.refreshParty();
  }

  playerInfo(id) {
    if (id === this.myId) {
      const p = this.game.player;
      return { id, name: this.myName(), cls: p.clsId, look: lookOf(p), x: p.x, z: p.z, floor: this.game.floor };
    }
    const r = this.remotes.get(id);
    return { id, name: r.name, cls: r.clsId, look: r.look, x: r.x, z: r.z, floor: r.floor };
  }

  myName() {
    return `P${this.myId + 1}`;
  }

  welcome(id) {
    const g = this.game;
    const players = [this.playerInfo(0), ...[...this.remotes.keys()].filter((k) => k !== id).map((k) => this.playerInfo(k))];
    this.sendTo(id, 'welcome', { id, floor: g.floor, seed: g.floorSeed, x: g.player.x, z: g.player.z, pin: this.pin, players });
  }

  // The host started a (new) run: bring everyone who said hello into it.
  onRunStarted() {
    if (!this.isHost) return;
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear();
    for (const [id, h] of this.hellos) this.addRemote(id, h);
    for (const id of this.hellos.keys()) this.welcome(id);
    this.refreshParty();
  }

  addRemote(id, info) {
    this.remotes.get(id)?.dispose();
    const g = this.game;
    const r = new RemotePlayer(g, id, { ...info, name: info.name || `P${id + 1}`, x: g.player?.x, z: g.player?.z, floor: -1 });
    this.remotes.set(id, r);
    return r;
  }

  onHostMsg(id, m) {
    if (!m || typeof m.t !== 'string') return;
    const g = this.game;
    const r = this.remotes.get(id);
    switch (m.t) {
      case 'hello': {
        const info = { cls: m.cls, look: m.look || {}, name: `P${id + 1}` };
        this.hellos.set(id, info);
        if (!g.inRun) {
          this.sendTo(id, 'wait');
          this.status(`${info.name} is in! ${this.hellos.size + 1} players — enter the dungeon when ready.`);
          return;
        }
        this.addRemote(id, info);
        this.welcome(id);
        this.broadcast('join', { ...info, id }, id);
        g.ui.toast(`${info.name} joined the dungeon`, 2.2, '#9fe8ff');
        this.refreshParty();
        return;
      }
      case 'st':
        if (r) {
          r.push(m);
          this.broadcast('st', { ...m, id }, id);
          this.refreshParty();
        }
        return;
      case 'hit': {
        const e = this.enemyById(m.id);
        if (e && e.alive) g.damageEnemy(e, { amount: +m.a || 0, crit: !!m.c, knock: +m.k || 0, launch: +m.l || 0, dot: m.d, remote: true, silent: !!m.s }, +m.x, +m.z);
        return;
      }
      case 'status': {
        const e = this.enemyById(m.id);
        if (e && e.alive && m.s && typeof m.s === 'object') e.status(m.s);
        return;
      }
      case 'knock': {
        const e = this.enemyById(m.id);
        if (e && e.alive) {
          e.kx += clampK(m.kx);
          e.kz += clampK(m.kz);
        }
        return;
      }
      case 'fx':
      case 'shoot':
      case 'zone':
        this.applyVisual(m, id);
        this.broadcast(m.t, { ...m, id }, id);
        return;
      case 'pot':
        g.breakPotById(m.i, true);
        this.broadcast('pot', { i: m.i }, id);
        return;
      case 'enter':
        if (g.floorCleared && g.state !== 'upgrade') g.enterPortal(true);
        return;
      case 'look':
        if (r && m.look) {
          r.setLook(m.look);
          this.broadcast('look', { id, look: m.look }, id);
        }
        return;
      case 'sync':
        if (m.f === g.floor) this.sendTo(id, 'espawn', { f: g.floor, list: g.enemies.filter((e) => e.alive).map((e) => this.spawnInfo(e)), portal: g.floorCleared ? 1 : 0 });
        return;
      default:
    }
  }

  spawnInfo(e) {
    return { id: e.id, type: e.type, x: r2(e.x), z: r2(e.z), elite: e.elite ? 1 : 0, af: e.affixes, hp: Math.round(e.maxHp), cur: Math.round(e.hp), dormant: e.dormant ? 1 : 0, mimic: e.disguised ? 1 : 0, rise: e.rising > 0 ? 1 : 0, sum: e.summoned ? 1 : 0, h: r2(e.heading) };
  }

  // Host: a new enemy exists — tell everyone and mirror its animation calls.
  onEnemySpawned(e) {
    if (!this.isHost) return;
    const an = e.model?.animator;
    if (an) {
      const play = an.play.bind(an);
      const stop = an.stop.bind(an);
      an.play = (name, o = {}) => {
        const res = play(name, o);
        if (this.live && e.alive && !e.dying) this.eAnim.push([e.id, 'p', name, cleanOpts(o)]);
        return res;
      };
      an.stop = (name = null, fade = 0.15) => {
        stop(name, fade);
        if (this.live && e.alive && !e.dying) this.eAnim.push([e.id, 's', name, fade]);
      };
    }
    if (this.live) this.broadcast('espawn', { f: this.game.floor, list: [this.spawnInfo(e)] });
  }

  enemyById(id) {
    return this.game.enemies.find((e) => e.id === id) || null;
  }

  // ------------------------------------------------------------- client side
  sendHello(cls) {
    const p = this.game.player;
    this.send('hello', { cls, look: p ? lookOf(p) : {} });
  }

  onHostLost() {
    if (!this.isClient) return;
    const g = this.game;
    this.hostConn = null;
    this.leave();
    if (g.inRun && g.state !== 'dead') {
      g.ui.toast('The host left the game', 3, '#ff8080');
      g.state = 'dead';
      g.showDeath();
    }
    this.status('Disconnected from the host');
  }

  onClientMsg(m) {
    if (!m || typeof m.t !== 'string') return;
    const g = this.game;
    switch (m.t) {
      case 'full':
        this.status('That game is full (4 players)');
        return;
      case 'wait':
        this.status('Connected! Waiting for the host to enter the dungeon…');
        g.ui.toast('Waiting for the host to enter the dungeon…', 3);
        return;
      case 'welcome': {
        this.myId = m.id;
        for (const r of this.remotes.values()) r.dispose();
        this.remotes.clear();
        g.startClientRun(m);
        for (const pl of m.players || []) this.addRemote(pl.id, pl);
        this.refreshParty();
        return;
      }
      case 'join':
        this.addRemote(m.id, m);
        g.ui.toast(`${m.name} joined the dungeon`, 2.2, '#9fe8ff');
        this.refreshParty();
        return;
      case 'leave': {
        const r = this.remotes.get(m.id);
        if (r) {
          g.ui.toast(`${r.name} left`, 2);
          r.dispose();
          this.remotes.delete(m.id);
        }
        this.refreshParty();
        return;
      }
      case 'st':
        this.remotes.get(m.id)?.push(m);
        this.refreshParty();
        return;
      case 'look':
        this.remotes.get(m.id)?.setLook(m.look || {});
        return;
      case 'espawn':
        if (m.f !== g.floor || !g.inRun) return;
        for (const s of m.list || []) g.spawnPuppet(s);
        if (m.portal && !g.floorCleared) {
          g.floorCleared = true;
          g.activatePortal();
        }
        return;
      case 'es':
        if (m.f === g.floor) this.applySnapshot(m.list || []);
        return;
      case 'ea':
        for (const [id, k, name, o] of m.list || []) {
          const e = this.enemyById(id);
          const an = e?.model?.animator;
          if (!an || !e.alive) continue;
          if (k === 'p') an.play(name, o || {});
          else an.stop(name, o);
        }
        return;
      case 'ekill': {
        const e = this.enemyById(m.id);
        if (e && e.alive) g.puppetKilled(e, m.x, m.z, !m.n);
        return;
      }
      case 'erez': {
        const c = g.corpses.find((k) => k.id === m.id);
        if (c) {
          g.corpses.splice(g.corpses.indexOf(c), 1);
          c.resurrect();
          g.enemies.push(c);
        }
        return;
      }
      case 'eproj':
        if (m.f === g.floor) g.spawnEnemyProjectile(m.x, m.y, m.z, m.h, m.sp, m.dmg, m.k);
        return;
      case 'shock':
        if (m.f === g.floor) g.shockwave(m.x, m.z, m.r, m.dmg, this.enemyById(m.src), !!m.big);
        return;
      case 'hurt': {
        const p = g.player;
        if (!p || p.dead || g.state !== 'play') return;
        const src = this.enemyById(m.src);
        if (p.takeDamage(+m.a || 0, src, !!m.m)) {
          const d = Math.hypot(m.kx, m.kz);
          if (d > 0.01) {
            p.vx += (m.kx / d) * 6;
            p.vz += (m.kz / d) * 6;
          }
          if (src?.onHitPlayer) src.onHitPlayer(+m.a || 0);
        }
        return;
      }
      case 'fx':
      case 'shoot':
      case 'zone':
        this.applyVisual(m, m.id ?? 0);
        return;
      case 'pot':
        g.breakPotById(m.i, true);
        return;
      case 'portal':
        if (m.f === g.floor && !g.floorCleared) {
          g.floorCleared = true;
          g.activatePortal();
        }
        return;
      case 'next':
        g.beginNextFloor(m.f, m.seed);
        return;
      case 'over':
        g.gameOver();
        return;
      default:
    }
  }

  applySnapshot(list) {
    const g = this.game;
    for (const s of list) {
      const e = this.enemyById(s[0]);
      if (!e || !e.alive) continue;
      (e.nbuf || (e.nbuf = [])).push({ t: g.netClock, x: s[1] / 100, z: s[2] / 100, y: s[3] / 100, h: s[4] / 100 });
      if (e.nbuf.length > 12) e.nbuf.shift();
      e.hp = s[5];
      const f = s[6];
      e.aggro = !!(f & 1);
      if (e.dormant && !(f & 2)) e.dormant = false;
      if (e.disguised && !(f & 4)) e.reveal();
      e.rising = f & 8 ? 1 : 0;
      e.freeze = f & 16 ? 1 : 0;
      e.burn = f & 32 ? 1 : 0;
      e.poison = f & 64 ? 1 : 0;
      e.stun = f & 128 ? Math.max(e.stun, 0.3) : Math.min(e.stun, 0.05);
      e.shieldHp = f & 256 ? 1 : 0;
      const st = STATES[s[7]] || 'chase';
      if (st !== e.state) {
        e.state = st;
        e.stateT = 0;
      }
    }
  }

  // Client: move and animate the puppet enemies between host snapshots.
  updatePuppets(dt) {
    const g = this.game;
    const rt = g.netClock - 0.1;
    const p = g.player;
    for (const e of g.enemies) {
      if (!e.alive) continue;
      // knockback from our own hits goes to the host
      if (Math.abs(e.kx) + Math.abs(e.kz) > 0.01) {
        this.send('knock', { id: e.id, kx: r2(e.kx), kz: r2(e.kz) });
        e.kx = 0;
        e.kz = 0;
      }
      const b = e.nbuf;
      if (b && b.length) {
        let a = b[0];
        let c = b[b.length - 1];
        for (let i = 0; i < b.length - 1; i++)
          if (b[i].t <= rt && b[i + 1].t >= rt) {
            a = b[i];
            c = b[i + 1];
            break;
          }
        const k = Math.max(0, Math.min(1, (rt - a.t) / Math.max(1e-3, c.t - a.t)));
        const px = e.x;
        const pz = e.z;
        e.x = a.x + (c.x - a.x) * k;
        e.z = a.z + (c.z - a.z) * k;
        e.y = a.y + (c.y - a.y) * k;
        let dh = c.h - a.h;
        while (dh > Math.PI) dh -= Math.PI * 2;
        while (dh < -Math.PI) dh += Math.PI * 2;
        e.heading = a.h + dh * k;
        const sp = Math.hypot(e.x - px, e.z - pz) / Math.max(dt, 1e-3);
        e.speedNow += (Math.min(sp, 25) - e.speedNow) * Math.min(1, dt * 10);
      }
      e.animT += dt;
      e.stateT += dt;
      e.flash = Math.max(0, e.flash - dt);
      e.flinch = Math.max(0, e.flinch - dt);
      e.lookTarget = g.targetFor(e);
      e.mesh.visible = e.def.boss || Math.hypot(e.x - p.x, e.z - p.z) < 40;
      e.render(dt, e.freeze > 0);
    }
  }

  // ----------------------------------------------------------- shared
  // Mirror effect calls made by our own hero (and, on the host, by enemies).
  wrapEffects() {
    const g = this.game;
    const fx = g.effects;
    for (const m of FX) {
      const orig = fx[m].bind(fx);
      fx[m] = (...args) => {
        const res = orig(...args);
        if (this.live && (g.fxCtx === 'local' || (this.isHost && g.fxCtx === 'enemy')) && this.outFx.length < 200) this.outFx.push([m, args]);
        return res;
      };
    }
  }

  applyVisual(m, fromId) {
    const g = this.game;
    if (m.f !== undefined && m.f !== g.floor) return;
    const prev = g.fxCtx;
    g.fxCtx = 'remote';
    try {
      if (m.t === 'fx') {
        for (const [name, args] of m.list || []) if (FX.includes(name) && Array.isArray(args)) g.effects[name](...args);
      } else if (m.t === 'shoot') {
        for (const o of m.list || []) g.shootGhost(o, this.remotes.get(fromId));
      } else if (m.t === 'zone') {
        for (const o of m.list || []) g.zoneGhost(o, this.remotes.get(fromId));
      }
    } finally {
      g.fxCtx = prev;
    }
  }

  // Our hero's animation calls, replayed on everyone else's screen.
  attachPlayer(p) {
    const an = p.model.animator;
    const play = an.play.bind(an);
    const stop = an.stop.bind(an);
    an.play = (name, o = {}) => {
      const res = play(name, o);
      if (this.live) this.outAnim.push(['p', name, cleanOpts(o)]);
      return res;
    };
    an.stop = (name = null, fade = 0.15) => {
      stop(name, fade);
      if (this.live) this.outAnim.push(['s', name, fade]);
    };
  }

  onLocalLook(p) {
    if (this.live) this.send('look', { look: lookOf(p) });
  }

  refreshParty() {
    const g = this.game;
    if (!this.mode || !g.player) return g.ui.setParty?.(null);
    const list = [{ name: this.myName() + ' (you)', cls: g.player.clsId, hp: g.player.hp / g.player.final.maxHp, dead: g.player.dead }];
    for (const r of this.remotes.values()) list.push({ name: r.name, cls: r.clsId, hp: r.hpFrac, dead: r.dead, away: r.floor !== g.floor || r.inMenu });
    g.ui.setParty?.({ pin: this.pin, host: this.isHost, list });
  }

  // Called every frame while a run is going.
  update(dt) {
    const g = this.game;
    if (!this.mode || !g.inRun) return;
    g.netClock = (g.netClock || 0) + dt;
    for (const r of this.remotes.values()) r.update(dt);
    if (this.isClient) this.updatePuppets(dt);
    if (!this.live) return;
    const p = g.player;

    // our state, ~15 times a second
    this.sendT -= dt;
    if (this.sendT <= 0) {
      this.sendT = 1 / SEND_HZ;
      const pv = p.model.pivot.rotation;
      this.send('st', {
        id: this.myId,
        x: r2(p.x), y: r2(p.y), z: r2(p.z), h: r2(p.heading), g: p.grounded ? 1 : 0, d: p.dead ? 1 : 0, m: g.state === 'play' ? 0 : 1, f: g.floor,
        px: r2(pv.x), py: r2(pv.y), pz: r2(pv.z), s: r2(p.model.group.scale.x), hp: r2(Math.max(0, p.hp) / p.final.maxHp), a: this.outAnim,
      });
      this.outAnim = [];
      if (this.outFx.length) this.send('fx', { f: g.floor, list: this.outFx });
      if (this.outShoot.length) this.send('shoot', { f: g.floor, list: this.outShoot });
      if (this.outZone.length) this.send('zone', { f: g.floor, list: this.outZone });
      this.outFx = [];
      this.outShoot = [];
      this.outZone = [];
      if (this.isHost && this.eAnim.length) {
        this.broadcast('ea', { list: this.eAnim });
        this.eAnim = [];
      }
      this.refreshParty();
    }

    if (this.isHost) {
      // enemy snapshots, each client only gets enemies near them
      this.snapT -= dt;
      if (this.snapT <= 0) {
        this.snapT = 1 / SNAP_HZ;
        for (const [id, c] of this.conns) {
          const r = this.remotes.get(id);
          if (!r || !c.open || r.floor !== g.floor) continue;
          const list = [];
          for (const e of g.enemies) {
            if (!e.alive || (Math.hypot(e.x - r.x, e.z - r.z) > 50 && !e.def.boss)) continue;
            const f = (e.aggro ? 1 : 0) | (e.dormant ? 2 : 0) | (e.disguised ? 4 : 0) | (e.rising > 0 ? 8 : 0) | (e.freeze > 0 ? 16 : 0) | (e.burn > 0 ? 32 : 0) | (e.poison > 0 || e.bleed > 0 ? 64 : 0) | (e.stun > 0 || e.blind > 0 ? 128 : 0) | (e.shieldHp > 0 ? 256 : 0);
            list.push([e.id, Math.round(e.x * 100), Math.round(e.z * 100), Math.round(e.y * 100), Math.round(e.heading * 100), Math.round(e.hp), f, Math.max(0, STATES.indexOf(e.state))]);
          }
          c.send({ t: 'es', f: g.floor, list });
        }
      }
      // everyone down: the run is over
      this.overT -= dt;
      if (this.overT <= 0) {
        this.overT = 0.5;
        if (p.dead && [...this.remotes.values()].every((r) => r.dead || r.floor !== g.floor)) {
          this.broadcast('over');
          g.gameOver();
        }
      }
    }

    // downed: a teammate standing next to you brings you back
    if (p.dead && g.state === 'play') {
      const helper = [...this.remotes.values()].find((r) => !r.dead && r.floor === g.floor && !r.inMenu && Math.hypot(r.x - p.x, r.z - p.z) < 1.9);
      if (helper) {
        this.reviveT += dt;
        g.ui.toast(`${helper.name} is reviving you… ${Math.min(100, Math.round((this.reviveT / 2.5) * 100))}%`, 0.3, '#9fe8ff');
        if (this.reviveT >= 2.5) {
          this.reviveT = 0;
          g.revivePlayer();
        }
      } else this.reviveT = Math.max(0, this.reviveT - dt);
    }
  }
}

function clampK(v) {
  const n = +v || 0;
  return Math.max(-60, Math.min(60, n));
}

// What other players need to dress our hero: rarity tier + colour per slot.
export function lookOf(p) {
  const it = (x) => (x ? { t: x.rarity.tier, h: x.rarity.hex } : null);
  return { w: it(p.equipment.weapon), a: it(p.equipment.armor), c: it(p.equipment.charm) };
}

export { ENEMY_TYPES, Enemy };
