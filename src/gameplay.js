// Run features layered on the Game: the soul forge's head start, shards, floor events
// (merchant, cursed altar, trial shrine, treasure goblin, prisoner's cage), allies,
// the Hollow God's echoes, victory on floor 20 and the endless depths' curses.

import { generateItem } from './items.js';
import { ENEMY_TYPES, DEN_BOSSES } from './enemies.js';
import { endlessEffects, newModFor, modsDetail } from './endless.js';
import { loadMeta, forgeBonus, bankShards } from './meta.js';
import { buildMerchant, buildAltar, buildTrial, merchantStock, rollPacts, TRIAL_WAVES, Ally } from './events.js';
import { sfx } from './audio.js';
import { jingle } from './music.js';
import { rng, fmtNum, partyColor } from './utils.js';
import { enemyPoolForFloor } from './dungeon.js';

const SHARDS = { elite: 1, goblin: 6, den: (f) => 5 + Math.floor(f / 2), throne: (f) => 25 + f * 2, floor: 2, victory: 120 };

export function installRunFeatures(Game) {
  const P = Game.prototype;

  // ------------------------------------------------------------ soul forge
  P.applyForge = function (p, fresh) {
    const meta = loadMeta();
    const fb = forgeBonus(meta);
    p.meta = fb;
    p.recompute();
    if (fresh) {
      p.hp = p.final.maxHp;
      p.gold += fb.gold;
      if (fb.armory) {
        const it = generateItem(1, p.clsId, 0, fb.armory >= 2 ? 3 : 2, 'weapon');
        p.equip(it);
      }
    }
    this.forge = fb;
  };

  P.rarityBonus = function () {
    return (this.forge ? this.forge.rarity : 0) + (this.endless ? this.endless.loop * 0.4 : 0);
  };

  // every item the game rolls goes through here (forge and endless luck)
  P.gen = function (floor, cls, bonus = 0, min = 0, slot = null, o = {}) {
    return generateItem(floor, cls, bonus + this.rarityBonus(), min, slot, o);
  };

  P.addShards = function (n, why = null, x = null, z = null) {
    const k = (this.forge ? this.forge.shardMult : 1) * (this.floor > 20 ? 2 : 1);
    const v = Math.max(1, Math.round(n * k));
    this.runShards = (this.runShards || 0) + v;
    if (x !== null) this.effects.damageNumber(x, 2.6, z, `+${v} 💠`, 'heal');
    if (why) this.ui.toast(`+${v} soul shards — ${why}`, 1.6, '#9fe8ff');
  };

  // Keep the run's shards (on death, victory or abandoning). Returns the total.
  P.bankRun = function (won = false) {
    const n = this.runShards || 0;
    this.runShards = 0;
    const m = bankShards(n, this.floor, won);
    return { earned: n, total: m.shards };
  };

  // --------------------------------------------------------------- floors
  P.setupFloorFeatures = function (restore) {
    const dg = this.dungeon;
    const p = this.player;
    this.endless = dg.endless;
    this.curse = null;
    this.pact = null;
    p.pact = null;
    p.recompute();
    p.pw.newFloor();
    this.trial = null;
    this.events = [];
    this.stormT = 4;
    for (const a of this.allies || []) a.dispose();
    this.allies = [];
    const used = new Set(restore?.used || []);
    (dg.events || []).forEach((ev, i) => {
      const y = dg.floorAt(ev.x, ev.z);
      const e = { ...ev, i, y, used: used.has(i) };
      const face = Math.atan2(dg.worldCenter(ev.room).x - ev.x, dg.worldCenter(ev.room).z - ev.z);
      if (ev.kind === 'merchant') Object.assign(e, buildMerchant(ev.x, y, ev.z, face));
      else if (ev.kind === 'altar') Object.assign(e, buildAltar(ev.x, y, ev.z));
      else if (ev.kind === 'trial') Object.assign(e, buildTrial(ev.x, y, ev.z));
      else return;
      if (e.used) this.dimEvent(e);
      this.scene.add(e.mesh);
      this.applyShadows(e.mesh);
      this.events.push(e);
    });
    if (this.floor > 20) {
      const m = newModFor(this.floor);
      if (m) setTimeout(() => this.inRun && this.ui.toast(`The depths grow crueler: ${m.icon} ${m.name} — ${m.desc}`, 3.5, '#ff7070'), 3400);
    }
  };

  P.clearFloorFeatures = function () {
    for (const e of this.events || []) {
      this.scene.remove(e.mesh);
      e.npc?.dispose();
      for (const m of e.mats || []) m.dispose();
    }
    this.events = [];
    for (const a of this.allies || []) a.dispose();
    this.allies = [];
  };

  P.dimEvent = function (e) {
    if (e.kind === 'altar' && e.orb) {
      e.orb.visible = false;
      e.ring.visible = false;
    }
    if (e.kind === 'trial' && e.crystal) e.crystal.material.emissiveIntensity = 0.2;
  };

  // ----------------------------------------------------------- per frame
  P.updateFloorFeatures = function (dt, controls) {
    const p = this.player;
    const t = this.runTime;
    for (const e of this.events) {
      if (e.npc) {
        e.npc.update(dt);
        // the merchant turns to watch you when you're close
        const d = Math.hypot(p.x - e.x, p.z - e.z);
        if (d < 8) e.npc.group.rotation.y += ((Math.atan2(p.x - e.x, p.z - e.z) - e.mesh.rotation.y) - e.npc.group.rotation.y) * Math.min(1, dt * 3);
      }
      if (e.orb && !e.used) {
        e.orb.rotation.y = t * 2;
        e.orb.position.y = 2.6 + Math.sin(t * 2) * 0.12;
        if (Math.random() < dt * 8) this.effects.puff(e.x + (Math.random() - 0.5) * 1.6, e.y + 0.3, e.z + (Math.random() - 0.5) * 1.6, 0xff2030, 0.3, 0.8);
      }
      if (e.crystal) {
        e.crystal.rotation.y = t;
        e.ring.rotation.z = t * (this.trial && this.trial.ev === e ? 2 : 0.3);
      }
    }
    for (const a of this.allies) a.update(dt);
    if (this.trial && !this.net.isClient) this.updateTrial(dt);
    // the endless storm hunts the hero
    if (this.endless && this.endless.storm && !p.dead && this.state === 'play') {
      this.stormT -= dt;
      if (this.stormT <= 0) {
        this.stormT = Math.max(1.2, 4 / this.endless.storm);
        const x = p.x + p.vx * 0.5;
        const z = p.z + p.vz * 0.5;
        this.effects.telegraph(x, z, 2.2, 1, 0x9fe0ff);
        this.schedule(1, () => {
          this.effects.lightning([[x, 12, z], [x, 0.1, z]], 0x9fe0ff);
          sfx.frost();
          const dmg = 14 * (1 + 0.15 * 19) * Math.pow(1.09, Math.max(0, this.floor - 20));
          const d = Math.hypot(p.x - x, p.z - z);
          if (d < 2.2 + p.radius) p.takeDamage(dmg, null, false);
        });
      }
    }
    if (!controls) return;
    // the nearest event you can use, for the card and F
    let near = null;
    let bd = 2.8;
    for (const e of this.events) {
      if (e.used || (e.kind === 'trial' && this.trial)) continue;
      const d = Math.hypot(p.x - e.x, p.z - e.z);
      if (d < bd && Math.abs(p.y - e.y) < 1.5) {
        bd = d;
        near = e;
      }
    }
    this.nearEvent = this.portalAsk ? null : near;
    this.ui.setEventCard(this.nearEvent);
  };

  P.useEvent = function (e = this.nearEvent) {
    if (!e || e.used) return;
    if (e.kind === 'merchant') this.openMerchant(e);
    else if (e.kind === 'altar') this.openAltar(e);
    else if (e.kind === 'trial') {
      if (this.net.isClient) {
        this.net.send('trial', { i: e.i });
        e.used = true;
        this.ui.toast('The trial begins!', 1.5, '#6ad8ff');
      } else this.startTrial(e);
    }
  };

  // ------------------------------------------------------- event screens
  P.openEventScreen = function (o) {
    if (this.state !== 'play') return;
    this.state = 'event';
    this.input.reset();
    if (document.pointerLockElement) document.exitPointerLock();
    this.ui.showEventScreen(o, () => this.closeEventScreen());
  };

  P.closeEventScreen = function () {
    this.ui.hideEventScreen();
    if (this.state === 'event') this.state = 'play';
    this.input.reset();
  };

  P.openMerchant = function (e) {
    const p = this.player;
    if (!e.stock) e.stock = merchantStock(this.floor, p.clsId, this.rarityBonus());
    sfx.coin();
    const render = () => {
      const rows = e.stock.map((s) => {
        if (s.sold) return { html: `<s>${s.item ? s.item.name : s.name}</s>`, btn: 'Sold', disabled: true };
        const label = s.kind === 'item' ? `<b style="color:${s.item.rarity.color}">${s.item.name}</b><small>${s.item.rarity.name} ${s.item.slot}${s.item.u ? ' · unique power' : ''}${s.item.set ? ' · set piece' : ''}</small>` : `<b>${s.name}</b><small>${s.desc}</small>`;
        return {
          html: label,
          btn: `${fmtNum(s.price)} 💰`,
          disabled: p.gold < s.price || (s.kind === 'elixir' && p.hp >= p.final.maxHp),
          onClick: () => {
            if (p.gold < s.price) return;
            p.gold -= s.price;
            s.sold = true;
            sfx.coin();
            if (s.kind === 'item') this.dropItem(p.x, p.z, s.item);
            else if (s.kind === 'elixir') {
              p.hp = p.final.maxHp;
              sfx.heal();
            } else {
              const it = this.gen(this.floor, p.clsId, 7, 2);
              this.dropItem(p.x, p.z, it);
              this.ui.toast(`The cache holds: ${it.name}!`, 2, it.rarity.color);
            }
            render();
          },
        };
      });
      this.ui.showEventScreen({ title: '💰 Wandering Merchant', sub: `"Finest wares in the deep, friend." · You have ${fmtNum(p.gold)} gold. Bought gear lands at your feet.`, rows }, () => this.closeEventScreen());
    };
    this.openEventScreen({ title: '', rows: [] });
    render();
  };

  P.openAltar = function (e) {
    const p = this.player;
    if (!e.pacts) e.pacts = rollPacts(!this.net.isClient);
    sfx.portal();
    const rows = e.pacts.map((pk) => ({
      html: `<b>${pk.icon} ${pk.name}</b><small><span style="color:#6bff8f">+ ${pk.boon}</span><br><span style="color:#ff7070">− ${pk.bane}</span></small>`,
      btn: 'Accept',
      onClick: () => {
        this.acceptPact(e, pk);
        this.closeEventScreen();
      },
    }));
    this.openEventScreen({ title: '🩸 Cursed Altar', sub: 'Strike a bargain. It lasts until you leave this floor.', rows, closeLabel: 'Walk away' });
  };

  P.acceptPact = function (e, pk) {
    const p = this.player;
    e.used = true;
    this.dimEvent(e);
    this.pact = pk;
    p.pact = pk.stats ? { stats: pk.stats } : null;
    this.curse = pk.curse || null;
    p.recompute();
    this.effects.ring(e.x, e.z, 3, 0xff2030, 0.6, e.y + 0.1);
    this.effects.burst(p.x, p.y + 1, p.z, 0xff2030, 30, 6, 0.2, 0.7);
    this.effects.shake(0.4);
    sfx.boom();
    this.ui.toast(`${pk.icon} ${pk.name}: ${pk.boon}… ${pk.bane}`, 3, '#ff7070');
    if (pk.id === 'war') {
      const it = this.gen(this.floor, p.clsId, 10, 4);
      this.dropItem(e.x, e.z, it);
      this.spawnWarband(e.x, e.z, 3);
    }
  };

  // Elites burst out of the floor around (x, z).
  P.spawnWarband = function (x, z, n, trial = false) {
    const pool = enemyPoolForFloor(Math.max(3, this.floor), this.dungeon.theme).filter((k) => k.type !== 'bomber');
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng.next();
      const r = 3 + rng.next() * 2.5;
      let ex = x + Math.cos(a) * r;
      let ez = z + Math.sin(a) * r;
      if (this.dungeon.blocked(ex, ez, 0.6, this.dungeon.floorAt(x, z) + 0.3)) {
        ex = x + Math.cos(a) * 1.5;
        ez = z + Math.sin(a) * 1.5;
      }
      const type = pool[Math.floor(rng.next() * pool.length)].type;
      const e = this.spawnEnemy(type, ex, ez, true, !trial || i < (trial.elites || 0), { rise: type !== 'wisp' });
      if (trial) e.trial = true;
    }
  };

  // ------------------------------------------------------------------ trial
  P.startTrial = function (e) {
    if (this.trial || e.used) return;
    e.used = true;
    this.trial = { ev: e, wave: 0, t: 0, between: 1.2 };
    this.effects.ring(e.x, e.z, 3, 0x6ad8ff, 0.8, e.y + 0.1);
    sfx.portal();
    this.ui.toast('⚔ Trial of the Shrine: survive three waves! ⚔', 2.6, '#6ad8ff');
  };

  P.updateTrial = function (dt) {
    const tr = this.trial;
    const e = tr.ev;
    const alive = this.enemies.some((x) => x.alive && x.trial);
    if (alive) return;
    tr.between -= dt;
    if (tr.between > 0) return;
    if (tr.wave >= TRIAL_WAVES.length) {
      // done: a treasure for everyone
      this.trial = null;
      this.dimEvent(e);
      this.trialReward(e.i);
      if (this.net.isHost && this.net.live) this.net.broadcast('trialdone', { f: this.floor, i: e.i });
      return;
    }
    const w = TRIAL_WAVES[tr.wave++];
    tr.between = 1.5;
    this.ui.toast(`Wave ${tr.wave} / ${TRIAL_WAVES.length}`, 1.4, '#6ad8ff');
    this.fxCtx = 'enemy';
    this.spawnWarband(e.x, e.z, Math.round(w.n * (this.net.live ? 1 + 0.4 * (this.net.playerCount - 1) : 1)), { elites: w.elites });
    this.fxCtx = null;
  };

  P.trialReward = function (i) {
    const e = this.events.find((x) => x.i === i);
    if (!e) return;
    e.used = true;
    this.dimEvent(e);
    this.spawnChest(e.x + 1.2, e.z, true);
    this.dropItem(e.x, e.z, this.gen(this.floor, this.player.clsId, 8, 3));
    this.addShards(4, 'trial complete', e.x, e.z);
    this.effects.ring(e.x, e.z, 4, 0xffd34d, 0.8, e.y + 0.1);
    sfx.portal();
    this.ui.toast('Trial complete! The shrine rewards you.', 2.4, '#ffd34d');
  };

  // ------------------------------------------------------- special enemies
  // A goblin got away: a puff of smoke and it's gone (no loot).
  P.escapeEnemy = function (e) {
    this.fxCtx = 'enemy';
    this.effects.smoke(e.x, e.z);
    this.effects.burst(e.x, e.y + 0.6, e.z, 0xffd34d, 20, 5, 0.15, 0.6);
    this.fxCtx = null;
    e.alive = false;
    e.startDeath(e.x, e.z);
    e.mesh.visible = false;
    this.corpses.push(e);
    this.enemies = this.enemies.filter((x) => x !== e);
    if (this.net.isHost && this.net.live) this.net.broadcast('ekill', { id: e.id, x: e.x, z: e.z, n: 1 });
    this.ui.toast('The Treasure Goblin escaped through a rift…', 2, '#ffd34d');
  };

  // The Hollow God calls echoes of the den lords as it weakens.
  P.summonEchoes = function (god, phase) {
    const n = phase;
    this.ui.toast(phase === 1 ? 'The Hollow God calls its echoes!' : 'The Hollow God tears open the void!', 2.4, '#d090ff');
    this.effects.ring(god.x, god.z, 8, 0xb04dff, 0.8);
    this.effects.shake(0.8);
    sfx.portal();
    for (let i = 0; i < n; i++) {
      const a = rng.next() * Math.PI * 2;
      const x = god.x + Math.cos(a) * 6;
      const z = god.z + Math.sin(a) * 6;
      const type = DEN_BOSSES[Math.floor(rng.next() * DEN_BOSSES.length)];
      const e = this.spawnEnemy(type, this.dungeon.blocked(x, z, 1, 1) ? god.x : x, this.dungeon.blocked(x, z, 1, 1) ? god.z + 3 : z, true, false, { echo: true, rise: false });
      e.maxHp *= 0.35;
      e.hp = e.maxHp;
      this.effects.smoke(e.x, e.z);
    }
  };

  // Local loot and rewards for special deaths (every player runs this).
  P.specialDeathLocal = function (e) {
    const p = this.player;
    const cls = p.clsId;
    if (e.elite) this.addShards(SHARDS.elite);
    if (e.type === 'goblin') {
      this.dropGold(e.x, e.z, Math.round((150 + this.floor * 40) * p.final.goldMult));
      this.dropGold(e.x, e.z, Math.round((150 + this.floor * 40) * p.final.goldMult));
      this.dropItem(e.x, e.z, this.gen(this.floor, cls, 10, 4));
      this.dropItem(e.x, e.z, this.gen(this.floor, cls, 8, 3));
      this.addShards(SHARDS.goblin, 'goblin caught', e.x, e.z);
      sfx.coin();
      return true;
    }
    if (e.def.cage) {
      const a = new Ally(this, e.captiveCls || 'knight', e.x, e.z);
      this.allies.push(a);
      this.effects.burst(e.x, 1, e.z, 0x9fc8ff, 24, 5, 0.18, 0.6);
      sfx.heal();
      this.ui.toast(`You freed a ${a.cls[0].toUpperCase() + a.cls.slice(1)}! They fight beside you this floor.`, 2.6, '#9fc8ff');
      return true;
    }
    if (e.def.boss && !e.echo) {
      if (e.def.den) this.addShards(SHARDS.den(this.floor), `${e.def.name} slain`, e.x, e.z);
      else this.addShards(SHARDS.throne(this.floor), `${e.def.name} slain`, e.x, e.z);
      if (e.def.final && this.floor === 20) this.schedule(2.2, () => this.victory());
    }
    if (e.echo) {
      this.dropItem(e.x, e.z, this.gen(this.floor, cls, 6, 3));
      return true;
    }
    return false;
  };

  // ---------------------------------------------------------------- victory
  P.victory = function () {
    if (!this.inRun || this.won) return;
    this.won = true;
    this.addShards(SHARDS.victory);
    jingle('clear');
    if (this.net.live) {
      this.ui.toast('★ VICTORY! The Hollow God is dead. The endless depths await below… ★', 5, '#ffd34d');
      return;
    }
    if (this.state !== 'play') return;
    this.state = 'victory';
    this.input.reset();
    if (document.pointerLockElement) document.exitPointerLock();
    const p = this.player;
    this.ui.showVictory(
      { cls: p.cls.name, kills: p.kills, gold: p.gold, time: this.runTime, shards: this.runShards },
      () => {
        // into the endless depths: the portal is open, walk in
        this.ui.hideVictory();
        this.state = 'play';
        this.input.reset();
        this.ui.toast('The portal leads into the endless depths. Every floor adds a curse.', 3.5, '#ff9a3a');
      },
      () => {
        // retire victorious: the run ends here, shards banked
        this.ui.hideVictory();
        this.state = 'dead';
        this.showDeath(true);
      },
    );
  };

  // ------------------------------------------------------------------ pings
  // Mark a spot for the party: where the camera looks (an enemy there means attack,
  // loot there means loot), or a call for help at your feet.
  P.sendPing = function (kind = 'auto') {
    if (!this.net.live || !this.inRun) return;
    const now = performance.now();
    if (now - (this.lastPing || 0) < 600) return;
    this.lastPing = now;
    const p = this.player;
    let x = p.x;
    let z = p.z;
    if (kind !== 'help') {
      const yaw = this.cam.yaw;
      const t = this.findTarget(p.x, p.z, yaw, 20, 0.3);
      let loot = null;
      if (!t) {
        let bd = 1e9;
        for (const pk of this.pickups) {
          if (pk.kind !== 'item') continue;
          const dx = pk.x - p.x;
          const dz = pk.z - p.z;
          const d = Math.hypot(dx, dz);
          if (d < 18 && Math.abs(Math.atan2(dx, dz) - yaw) < 0.4 && d < bd) {
            bd = d;
            loot = pk;
          }
        }
      }
      if (t) {
        x = t.x;
        z = t.z;
        if (kind === 'auto') kind = 'attack';
      } else if (loot) {
        x = loot.x;
        z = loot.z;
        if (kind === 'auto') kind = 'loot';
      } else {
        x = p.x + Math.sin(yaw) * 7;
        z = p.z + Math.cos(yaw) * 7;
        if (kind === 'auto') kind = 'here';
      }
    }
    x = Math.round(x * 10) / 10;
    z = Math.round(z * 10) / 10;
    this.showPing(this.net.myId ?? 0, kind, x, z, true);
    if (this.net.isHost) this.net.broadcast('ping', { id: this.net.myId ?? 0, k: kind, x, z });
    else this.net.send('ping', { k: kind, x, z });
  };

  P.showPing = function (id, kind, x, z, mine = false) {
    const k = { here: ['📍', 'Here!'], attack: ['⚔', 'Attack!'], loot: ['💎', 'Loot!'], help: ['🆘', 'Help!'] }[kind] || ['📍', 'Here!'];
    const col = partyColor(id);
    const hex = parseInt(col.replace('#', ''), 16);
    const y = this.dungeon ? this.dungeon.floorAt(x, z) : 0;
    const prev = this.fxCtx;
    this.fxCtx = 'remote';
    for (let i = 0; i < 3; i++) this.schedule(i * 0.35, () => this.effects.ring(x, z, 1.4, hex, 0.5, y + 0.1));
    this.effects.burst(x, y + 0.5, z, hex, 12, 4, 0.14, 0.6);
    this.fxCtx = prev;
    this.pings = (this.pings || []).filter((q) => q.t > 0);
    this.pings.push({ x, z, color: col, t: 5, kind });
    this.effects.damageNumber(x, y + 2.2, z, `${k[0]} ${k[1]}`, 'ping');
    const who = mine ? 'You' : this.net.remotes?.get(id)?.name || (id === 0 ? 'Host' : `P${id + 1}`);
    this.ui.toast(`${who}: ${k[0]} ${k[1]}`, 1.8, col);
    sfx.ui();
  };

  // HUD line for the floor: endless curses.
  P.floorModsDetail = function () {
    return this.floor > 20 ? modsDetail(this.floor) : [];
  };

  P.endlessFx = function () {
    return endlessEffects(this.floor);
  };
}
