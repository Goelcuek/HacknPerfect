// PvP Arena: a multiplayer mode the host picks instead of the co-op dungeon. Everyone
// fights everyone in one big arena room (platforms, pillars), starting from the same
// kit: epic gear and four skills at level 3. Killed heroes respawn after a few seconds;
// the first to the kill limit wins the round, and a new round starts.
//
// Other players stand in for monsters as Rival targets in game.enemies, so every
// attack, skill and projectile can hit them. A hit becomes a 'pvphit' message to that
// player (through the host), whose own game applies it with their armour; their death
// reports who scored, and the host keeps the scoreboard.

import { sfx } from './audio.js';
import { fmtNum, partyColor } from './utils.js';
import { T } from './tiles.js';
import { generateItem } from './items.js';

export const ARENA_FLOOR = 7; // the arena's look (Blood Temple) and gear level
export const KILL_LIMIT = 10;
const PVP_DAMAGE = 0.35; // player hits on players are softened: fights last a few exchanges
const RESPAWN = 3;

// Another player as something your attacks can hit.
export class Rival {
  constructor(game, r) {
    this.game = game;
    this.r = r;
    this.rival = true;
    this.id = `r${r.id}`;
    this.pid = r.id;
    this.radius = 0.5;
    this.height = 1.8;
    this.def = { name: r.name, color: parseInt(partyColor(r.id).slice(1), 16), hover: 0, boss: false };
    this.maxHp = 100;
    this.kx = this.kz = this.vy = this.stun = this.flash = this.flinch = 0;
    this.affixes = [];
  }
  get x() {
    return this.r.x;
  }
  set x(v) {}
  get z() {
    return this.r.z;
  }
  set z(v) {}
  get y() {
    return this.r.y || 0;
  }
  set y(v) {}
  get groundY() {
    return this.r.y || 0;
  }
  set groundY(v) {}
  get heading() {
    return this.r.heading;
  }
  set heading(v) {}
  get hp() {
    return (this.r.hpFrac ?? 1) * 100;
  }
  set hp(v) {}
  get alive() {
    return !this.r.dead && !this.r.inMenu && this.r.floor === this.game.floor;
  }
  set alive(v) {}
  status() {}
  absorb(a) {
    return a;
  }
}

export function installPvp(Game) {
  const P = Game.prototype;

  // The same start for everyone: plain epic gear for the class (no uniques or sets) and
  // four skills at level 3.
  P.arenaKit = function (p) {
    for (const slot of ['weapon', 'armor', 'charm']) {
      let it = null;
      for (let i = 0; i < 60 && (!it || it.rarity.id !== 'epic'); i++) it = generateItem(10, p.clsId, 0, 3, slot);
      p.equip(it);
    }
    p.skills = p.cls.skills.slice(0, 4).map((id) => ({ id, level: 3 }));
    p.recompute();
    p.hp = p.final.maxHp;
  };

  P.beginArena = function () {
    this.pvp = { scores: {}, over: false };
    this.respawnT = 0;
    this.lastHitBy = -1;
    this.ui.refreshSkills(this.player);
    this.state = 'play';
    this.input.reset();
    this.pvpRespawn(true);
    this.ui.toast(`⚔ PvP Arena — first to ${KILL_LIMIT} kills wins ⚔`, 3, '#ff7070');
  };

  // Spawn spots: the corners of the arena, and its middle.
  P.arenaSpawns = function () {
    const room = this.dungeon.startRoom;
    const m = 3;
    const pts = [
      [room.x + m, room.z + m],
      [room.x + room.w - 1 - m, room.z + room.h - 1 - m],
      [room.x + room.w - 1 - m, room.z + m],
      [room.x + m, room.z + room.h - 1 - m],
      [room.cx, room.cz],
    ];
    return pts.map(([x, z]) => ({ x: (x + 0.5) * T, z: (z + 0.5) * T })).filter((s) => !this.dungeon.blocked(s.x, s.z, 0.5, 10));
  };

  // Back in: the spawn spot farthest from everyone else, full health, a moment of grace.
  P.pvpRespawn = function (first = false) {
    const p = this.player;
    const spots = this.arenaSpawns();
    const others = [...this.net.remotes.values()].filter((r) => !r.dead && r.floor === this.floor);
    let best = spots[(this.net.myId ?? 0) % spots.length];
    if (!first && others.length) {
      let bd = -1;
      for (const s of spots) {
        const d = Math.min(...others.map((r) => Math.hypot(r.x - s.x, r.z - s.z)));
        if (d > bd) {
          bd = d;
          best = s;
        }
      }
    }
    p.x = best.x;
    p.z = best.z;
    p.y = this.dungeon.floorAt(best.x, best.z);
    const c = this.dungeon.worldCenter(this.dungeon.startRoom);
    p.heading = Math.atan2(c.x - p.x, c.z - p.z);
    this.cam.yaw = p.heading;
    if (p.dead) this.revivePlayer();
    p.hp = p.final.maxHp;
    p.invuln = 2;
    p.cooldowns = [0, 0, 0, 0];
    this.respawnT = 0;
    this.lastHitBy = -1;
    this.effects.ring(p.x, p.z, 2, 0xff7070, 0.5, p.y + 0.1);
  };

  // Keep one Rival per other player on this floor in the target list.
  P.syncRivals = function () {
    const remotes = this.net.remotes;
    this.enemies = this.enemies.filter((e) => !e.rival || remotes.get(e.pid) === e.r);
    for (const r of remotes.values()) if (!this.enemies.some((e) => e.rival && e.r === r)) this.enemies.push(new Rival(this, r));
  };

  P.updateArena = function (dt) {
    this.syncRivals();
    const p = this.player;
    if (p.dead && this.state === 'play') {
      if (this.respawnT <= 0) {
        // report the kill (the host keeps score), then wait to come back
        this.respawnT = RESPAWN;
        const by = this.lastHitBy;
        this.reportPvpDeath(by);
        const killer = by >= 0 ? this.net.remotes.get(by)?.name || (by === 0 ? 'Host' : `P${by + 1}`) : null;
        this.ui.toast(killer ? `Slain by ${killer}! Back in ${RESPAWN}…` : `You fell! Back in ${RESPAWN}…`, RESPAWN, '#ff7070');
      } else {
        this.respawnT -= dt;
        if (this.respawnT <= 0) this.pvpRespawn();
        else this.respawnT = Math.max(0.0001, this.respawnT);
      }
    }
  };

  // Our attack landed on another player.
  P.damageRival = function (e, hit, fromX, fromZ) {
    if (!e.alive || hit.remote) return;
    const p = this.player;
    const amount = Math.max(1, Math.round(p.pw.outgoing(hit.amount) * PVP_DAMAGE));
    const fx = this.effects;
    if (!hit.silent) {
      fx.burst(e.x, e.y + 1, e.z, hit.crit ? 0xffe066 : 0xff5060, hit.crit ? 12 : 6, 5, 0.12, 0.35);
      if (hit.crit) sfx.crit();
      else sfx.hit();
      this.addCombo();
      if (p.final.lifesteal + p.buff.ls > 0) p.heal(amount * (p.final.lifesteal + p.buff.ls), false);
    }
    fx.damageNumber(e.x, e.y + 2.2, e.z, fmtNum(amount), hit.crit ? 'crit' : hit.silent ? 'dot' : '');
    const k = { a: amount, c: hit.crit ? 1 : 0, k: Math.min(12, hit.knock || 0), x: Math.round(fromX * 100) / 100, z: Math.round(fromZ * 100) / 100, s: hit.silent ? 1 : 0 };
    if (this.net.isHost) this.net.sendTo(e.pid, 'pvphit', { ...k, from: this.net.myId ?? 0 });
    else this.net.send('pvphit', { ...k, to: e.pid });
  };

  // Another player hit us.
  P.onPvpHit = function (m) {
    const p = this.player;
    if (!this.arena || p.dead || this.state === 'dead' || p.invuln > 0) return;
    const from = +m.from;
    const src = this.enemies.find((e) => e.rival && e.pid === from) || null;
    const a = Math.max(0, Math.min(1e7, +m.a || 0));
    if (!p.takeDamage(a, src, !m.s)) return;
    // short grace between hits (dashing still dodges): bursts land, but not all at once
    p.invuln = Math.min(p.invuln, 0.15);
    this.lastHitBy = from;
    const k = +m.k || 0;
    if (k && !p.dead) {
      const dx = p.x - (+m.x || p.x);
      const dz = p.z - (+m.z || p.z);
      const d = Math.hypot(dx, dz) || 1;
      p.vx += (dx / d) * k;
      p.vz += (dz / d) * k;
    }
  };

  P.reportPvpDeath = function (by) {
    const victim = this.net.myId ?? 0;
    if (this.net.isHost) this.onPvpDeath(by, victim);
    else this.net.send('pvpdeath', { by });
  };

  // Host: someone died. Score it, tell everyone, and end the round at the kill limit.
  P.onPvpDeath = function (by, victim) {
    const pv = this.pvp;
    if (!pv || pv.over) return;
    if (by >= 0 && by !== victim) pv.scores[by] = (pv.scores[by] || 0) + 1;
    const msg = { scores: pv.scores, by, victim };
    this.net.broadcast('pvpscore', msg);
    this.applyPvpScore(msg);
    const winner = Object.keys(pv.scores).find((id) => pv.scores[id] >= KILL_LIMIT);
    if (winner !== undefined) {
      pv.over = true;
      this.net.broadcast('pvpwin', { id: +winner, scores: pv.scores });
      this.applyPvpWin({ id: +winner, scores: pv.scores });
      setTimeout(() => {
        if (!this.arena || !this.inRun) return;
        this.net.broadcast('pvpround', {});
        this.applyPvpRound();
      }, 7000);
    }
  };

  P.pvpName = function (id) {
    if (id === (this.net.myId ?? 0)) return 'You';
    return this.net.remotes.get(id)?.name || (id === 0 ? 'Host' : `P${id + 1}`);
  };

  P.applyPvpScore = function (m) {
    if (!this.pvp) this.pvp = { scores: {}, over: false };
    this.pvp.scores = m.scores || {};
    const by = +m.by;
    const victim = +m.victim;
    if (by >= 0 && by !== victim) {
      const me = this.net.myId ?? 0;
      this.ui.toast(`${this.pvpName(by)} ⚔ ${this.pvpName(victim)}`, 2, by === me ? '#6bff8f' : victim === me ? '#ff7070' : partyColor(by));
      if (by === me) sfx.coin();
    }
  };

  P.applyPvpWin = function (m) {
    this.pvp.over = true;
    this.pvp.scores = m.scores || this.pvp.scores;
    const me = this.net.myId ?? 0;
    const won = +m.id === me;
    this.ui.toast(won ? '🏆 You win the round! 🏆' : `🏆 ${this.pvpName(+m.id)} wins the round! 🏆`, 6.5, won ? '#ffd34d' : '#ff9a9a');
    sfx.portal();
  };

  P.applyPvpRound = function () {
    this.pvp = { scores: {}, over: false };
    this.pvpRespawn();
    this.ui.toast(`New round — first to ${KILL_LIMIT} kills!`, 2.5, '#ff7070');
  };

  P.pvpKillLimit = () => KILL_LIMIT;

  // For the HUD: everyone's kills, best first.
  P.pvpBoard = function () {
    if (!this.pvp) return '';
    const me = this.net.myId ?? 0;
    const ids = [me, ...this.net.remotes.keys()];
    return ids
      .map((id) => ({ id, n: this.pvp.scores[id] || 0 }))
      .sort((a, b) => b.n - a.n)
      .map((s) => `<span style="color:${partyColor(s.id)}">${s.id === me ? 'You' : this.pvpName(s.id)} ${s.n}</span>`)
      .join(' · ');
  };
}
