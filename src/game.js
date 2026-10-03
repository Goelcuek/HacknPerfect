// Game world: owns the dungeon, player, enemies, projectiles, zones, loot and
// camera, routes combat between them and runs the run's flow (class select →
// first skill → floors → skill/upgrade choice between floors).

import * as THREE from 'three';
import { Dungeon, T, denBossForFloor } from './dungeon.js';
import { Player } from './player.js';
import { Enemy, ENEMY_TYPES, sharedEnemyMaterials, throneBossForFloor } from './enemies.js';
import { installRunFeatures } from './gameplay.js';
import { installPvp, ARENA_FLOOR } from './pvp.js';
import { Effects, Trail } from './effects.js';
import { generateItem, rollBlessings, itemScore, RARITIES } from './items.js';
import { SKILLS, MAX_SKILL_LEVEL, skillDef } from './skills.js';
import { CLASSES } from './classes.js';
import { buildDropModel } from './gear.js';
import { G, mat } from './rig.js';
import { propModel, hingeLid, gearModel } from './assets.js';
import { sfx } from './audio.js';
import { jingle } from './music.js';
import { clamp, angleDiff, rng, fmtNum } from './utils.js';
import { Net } from './net.js';
import { readSave, writeSave, clearSave, packItem, unpackItem, replayBlessings } from './save.js';

const BEST_KEY = 'hacknperfect.best';

export function loadBest() {
  try {
    return JSON.parse(localStorage.getItem(BEST_KEY)) || { floor: 0, kills: 0 };
  } catch (_) {
    return { floor: 0, kills: 0 };
  }
}
function saveBest(b) {
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(b));
  } catch (_) {
    /* storage unavailable */
  }
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Light-space axes of the key light (it always shines along the same direction).
const SUN_FWD = new THREE.Vector3(-5, -14, -3).normalize();
const SUN_RIGHT = new THREE.Vector3().crossVectors(SUN_FWD, new THREE.Vector3(0, 1, 0)).normalize();
const SUN_UP = new THREE.Vector3().crossVectors(SUN_RIGHT, SUN_FWD).normalize();
const snapped = new THREE.Vector3();

// Round a point's position across the light's view to the shadow map's texel size,
// so the shadow map only ever shifts by whole texels.
function snapToShadowTexels(x, y, z, light) {
  const cam = light.shadow.camera;
  const texel = (cam.right - cam.left) / light.shadow.mapSize.x;
  snapped.set(x, y, z);
  const r = Math.round(snapped.dot(SUN_RIGHT) / texel) * texel;
  const u = Math.round(snapped.dot(SUN_UP) / texel) * texel;
  const f = snapped.dot(SUN_FWD);
  return snapped.copy(SUN_RIGHT).multiplyScalar(r).addScaledVector(SUN_UP, u).addScaledVector(SUN_FWD, f);
}

export class Game {
  constructor(renderer, ui, input) {
    this.renderer = renderer;
    this.ui = ui;
    this.input = input;
    this.scene = new THREE.Scene();
    // far plane just past the fog (solid fog colour from 46 m): nothing beyond it shows,
    // so there's no point drawing it
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 50);
    this.cam = { yaw: 0, pitch: 0.38, dist: 6.2, pos: new THREE.Vector3(), target: new THREE.Vector3() };
    this.effects = new Effects(this.scene, this.camera, document.getElementById('numbers'));
    this.effects.groundAt = (x, z) => (this.dungeon ? this.dungeon.floorAt(x, z) : 0);

    this.hemi = new THREE.HemisphereLight(0x9fb0d0, 0x302020, 1.1);
    this.scene.add(this.hemi);
    // cool key light from above; casts the character/prop shadows on High
    this.sun = new THREE.DirectionalLight(0xc8d4ff, 1.1);
    this.sun.position.set(5, 14, 3);
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -15;
    sc.right = sc.top = 15;
    sc.near = 1;
    sc.far = 40;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.radius = 2;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.playerLight = new THREE.PointLight(0xffc68a, 5, 14, 1.2);
    this.scene.add(this.playerLight);
    // a fixed pool of lights that hop to the torches / braziers / crystals nearest the player
    this.torchPool = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xff9a4a, 0, 11, 1.5);
      this.scene.add(l);
      this.torchPool.push(l);
    }
    this.quality = 'high';
    this.pointScale = 400;
    this.runTime = 0;
    this.state = 'title';
    this.hitStopT = 0;
    this.tipsShown = {};
    this.enemies = [];
    this.projectiles = [];
    this.pickups = [];
    this.chests = [];
    this.pots = [];
    this.traps = [];
    this.patches = [];
    this.zones = [];
    this.corpses = [];
    this.timers = [];
    this.events = [];
    this.allies = [];
    this.runShards = 0;
    // multiplayer: fxCtx says whose code is running ('local' hero, 'enemy' AI on
    // the host, 'remote' replayed visuals) so effects can be mirrored correctly
    this.fxCtx = null;
    this.enemySeq = 0;
    this.net = new Net(this);
  }

  // Everyone enemies may go after: this hero plus (on the host) remote players.
  targetFor(e) {
    const p = this.player;
    let best = p && !p.dead && (this.state === 'play' || !this.net.live) ? p : null;
    let bd = best ? (p.x - e.x) ** 2 + (p.z - e.z) ** 2 : Infinity;
    if (this.net.isHost)
      for (const r of this.net.remotes.values()) {
        if (!r.targetable) continue;
        const d = (r.x - e.x) ** 2 + (r.z - e.z) ** 2;
        if (d < bd) {
          bd = d;
          best = r;
        }
      }
    return best || p;
  }

  setQuality(q) {
    this.quality = q;
    this.sun.castShadow = q === 'high';
    // every lit pixel pays for each point light: fewer real torch lights on phones
    // (the torches still glow; only the nearest ones light the room)
    const torches = q === 'high' ? 4 : q === 'medium' ? 2 : 1;
    this.torchPool.forEach((l, i) => (l.visible = i < torches));
    if (this.player) this.applyShadows(this.player.mesh);
    for (const e of this.enemies) this.applyShadows(e.mesh);
    if (this.dungeon) this.dungeon.group.traverse((o) => o.isMesh && (o.castShadow = q === 'high' && !!o.userData.caster));
  }

  applyShadows(obj) {
    if (!obj) return;
    const on = this.quality === 'high';
    obj.traverse((o) => {
      if (o.isMesh && !o.material.transparent && !o.userData.noShadow) o.castShadow = on;
    });
    if (this.player && obj === this.player.mesh) this.player.shadow.visible = !on;
  }

  // ---------------------------------------------------------- title / select
  // A dungeon room with the chosen hero standing in it, used behind menus.
  setupBackdrop(clsId) {
    if (!this.dungeon || this.floor !== 1 || this.inRun) {
      this.inRun = false;
      this.setPlayer(new Player(this, clsId));
      this.loadFloor(1, true);
    } else if (!this.player || this.player.clsId !== clsId) {
      const old = this.player;
      this.setPlayer(new Player(this, clsId));
      this.player.x = old.x;
      this.player.z = old.z;
      this.player.heading = old.heading;
    }
    this.giveStarterWeapon(this.player);
    this.showcaseHeading = this.showcaseHeading ?? this.player.heading;
  }

  setPlayer(p) {
    if (this.player) {
      this.scene.remove(this.player.mesh);
      this.scene.remove(this.player.shadow);
      this.player.disposeTrails();
    }
    this.player = p;
    this.net.attachPlayer(p);
    this.applyShadows(p.mesh);
    this.scene.add(p.mesh);
    this.scene.add(p.shadow);
  }

  giveStarterWeapon(p) {
    const c = CLASSES[p.clsId];
    const names = { sword: 'Rusty Sword', bow: 'Rickety Crossbow', staff: 'Gnarled Staff', daggers: 'Chipped Daggers', axe: 'Notched Greataxe' };
    p.equip({ slot: 'weapon', wtype: c.weapon, rarity: RARITIES[0], name: names[c.weapon], stats: { damage: 2 }, level: 1, visual: { variant: 0, hue: 0.5 }, starter: true });
    p.hp = p.final.maxHp;
  }

  updateBackdrop(dt, mode) {
    const p = this.player;
    if (!p) return;
    const t = performance.now() / 1000;
    if (mode === 'classSelect') {
      p.heading = this.showcaseHeading + 0.35 + Math.sin(t * 0.5) * 0.3;
      p.showcase(dt);
      const h = this.showcaseHeading;
      const cx = p.x + Math.sin(h) * 4.6;
      const cz = p.z + Math.cos(h) * 4.6;
      const camYaw = h + Math.PI;
      const shift = this.camera.aspect > 1.2 ? 1.25 : 0;
      const rx = -Math.cos(camYaw);
      const rz = Math.sin(camYaw);
      this.cam.pos.lerp(new THREE.Vector3(cx, 1.6, cz), Math.min(1, dt * 4));
      this.camera.position.copy(this.cam.pos);
      this.camera.lookAt(p.x - rx * shift, 1.1, p.z - rz * shift);
      this.cam.yaw = camYaw;
    } else {
      p.showcase(dt);
      this.cam.yaw += dt * 0.15;
      this.updateCamera(dt, { x: 0, y: 0 });
    }
    this.playerLight.position.set(p.x + Math.sin(this.showcaseHeading) * 2, p.y + 3, p.z + Math.cos(this.showcaseHeading) * 2);
    this.runTime += dt;
    this.cam.target.set(p.x, 1.5, p.z);
    this.updateTorches();
    this.effects.update(dt);
  }

  // ------------------------------------------------------------------ run
  startRun(clsId) {
    if (!this.net.mode) clearSave();
    this.inRun = true;
    this.combo = 0;
    this.comboT = 0;
    this.bestCombo = 0;
    this.setPlayer(new Player(this, clsId));
    this.giveStarterWeapon(this.player);
    this.runShards = 0;
    this.won = false;
    this.floor = 0;
    this.runTime = 0;
    this.catchUp = 0;
    // a hosted PvP arena instead of the dungeon
    this.arena = this.net.isHost && this.net.gameMode === 'arena';
    if (this.arena) {
      this.arenaKit(this.player);
      this.loadFloor(ARENA_FLOOR, true);
      this.net.onRunStarted();
      this.beginArena();
      return;
    }
    this.applyForge(this.player, true);
    this.loadFloor(1);
    this.state = 'skillpick';
    this.input.reset();
    this.offerRewards(true);
    this.net.onRunStarted();
  }

  // Multiplayer: join the host's run on whatever floor they are on.
  startClientRun(w) {
    this.inRun = true;
    this.combo = 0;
    this.comboT = 0;
    this.bestCombo = 0;
    const cls = this.pendingClass || this.player?.clsId || 'knight';
    this.setPlayer(new Player(this, cls));
    this.giveStarterWeapon(this.player);
    this.runShards = 0;
    this.won = false;
    this.arena = !!w.arena;
    this.runTime = 0;
    if (this.arena) {
      this.arenaKit(this.player);
      this.ui.hideScreens?.();
      this.ui.hidePause?.();
      this.ui.hideSkillPick?.();
      this.ui.showHUD();
      this.loadFloor(w.floor, true, w.seed);
      this.beginArena();
      if (w.pvp) this.pvp = { scores: w.pvp.scores || {}, over: !!w.pvp.over };
      return;
    }
    this.applyForge(this.player, true);
    this.ui.hideScreens?.();
    this.ui.hidePause?.();
    this.ui.hideSkillPick?.();
    this.ui.showHUD();
    this.loadFloor(w.floor, false, w.seed);
    const p = this.player;
    if (typeof w.x === 'number' && !this.dungeon.blocked(w.x, w.z, p.radius, 1)) {
      p.x = w.x + 0.8;
      p.z = w.z + 0.8;
      if (this.dungeon.blocked(p.x, p.z, p.radius, 1)) {
        p.x = w.x;
        p.z = w.z;
      }
    }
    // catch up with the skills the rest of the party picked on earlier floors
    this.catchUp = Math.max(0, w.floor - 1);
    this.state = 'skillpick';
    this.input.reset();
    this.offerRewards(true);
    this.ui.refreshSkills(p);
  }

  gameOver() {
    if (this.state === 'dead') return;
    this.state = 'dead';
    this.ui.hidePause?.();
    this.ui.hideSkillPick?.();
    setTimeout(() => this.showDeath(), 1200);
  }

  revivePlayer() {
    const p = this.player;
    p.dead = false;
    p.hp = Math.max(1, Math.round(p.final.maxHp * 0.35));
    p.invuln = 2;
    const an = p.model.animator;
    an.stop(null, 0.1);
    an.play('Skeletons_Awaken_Floor', { speed: 1.5, dur: 1.5, fadeIn: 0.05, fadeOut: 0.3 });
    this.effects.ring(p.x, p.z, 2.5, 0x9fe8ff, 0.5, p.y + 0.1);
    this.effects.burst(p.x, p.y + 1, p.z, 0x9fe8ff, 20, 5, 0.14, 0.6);
    sfx.heal();
    this.ui.toast('Revived!', 1.6, '#9fe8ff');
    this.downToast = false;
  }

  clearFloor() {
    if (this.dungeon) {
      this.scene.remove(this.dungeon.group);
      this.dungeon.dispose();
    }
    // never let a previous level's meshes linger in the scene
    for (const c of this.scene.children.slice()) if (c.userData.isLevel) this.scene.remove(c);
    for (const list of [this.enemies, this.projectiles, this.pickups, this.chests, this.pots, this.patches, this.zones, this.corpses, this.traps]) {
      for (const o of list) {
        if (o.rival) continue;
        if (o.mesh) this.scene.remove(o.mesh);
        if (o.dispose) o.dispose();
        if (o.mesh && o.mesh.userData.dispose) o.mesh.userData.dispose();
      }
    }
    this.timers.length = 0;
    this.clearFloorFeatures();
    if (this.portal) this.scene.remove(this.portal.mesh);
    this.effects.clear();
  }

  // restore: a saved run's floor state (monsters killed, chests opened, barrels broken)
  loadFloor(n, quiet = false, seed = null, restore = null) {
    this.clearFloor();
    this.killedKeys = new Set(restore?.killed || []);
    this.openedChests = new Set(restore?.chests || []);
    this.brokenPots = new Set(restore?.pots || []);
    this.floor = n;
    this.floorSeed = seed ?? (Math.random() * 2 ** 31) | 0;
    this.nextSeed = null;
    this.enterSent = false;
    this.portalAsk = this.portalDeclined = false;
    this.ui.setPortalCard(null);
    const dg = new Dungeon(n, this.floorSeed, this.net.isHost ? this.net.partySize : 1, { arena: !!this.arena });
    this.dungeon = dg;
    const levelGroup = dg.buildMeshes(this.quality);
    levelGroup.userData.isLevel = true;
    this.scene.add(levelGroup);
    const th = dg.theme;
    this.scene.background = new THREE.Color(th.fog);
    this.scene.fog = new THREE.Fog(th.fog, th.fogNear ?? 16, th.fogFar ?? 46);
    this.hemi.color.setHex(0x9fb0d0).lerp(new THREE.Color(th.accent), 0.15);

    this.enemies = [];
    this.projectiles = [];
    this.pickups = [];
    this.chests = [];
    this.pots = [];
    this.traps = [];
    this.patches = [];
    this.zones = [];
    this.corpses = [];
    this.floorCleared = false;
    // the floor's boss: its death opens the portal (every floor has one)
    this.bossName = dg.isBoss ? ENEMY_TYPES[throneBossForFloor(n)].name : dg.denRoom ? ENEMY_TYPES[denBossForFloor(n)].name : null;
    this.boss = null;

    const p = this.player;
    const s = dg.worldCenter(dg.startRoom);
    p.resetState();
    p.x = s.x;
    p.z = s.z;
    // party members fan out around the start instead of stacking up
    if (this.net.mode && this.net.myId) {
      const a = this.net.myId * 2.1;
      const nx = s.x + Math.sin(a) * 1.5;
      const nz = s.z + Math.cos(a) * 1.5;
      if (!dg.blocked(nx, nz, p.radius, 1)) {
        p.x = nx;
        p.z = nz;
      }
    }
    const ex = dg.worldCenter(dg.exitRoom);
    p.heading = Math.atan2(ex.x - s.x, ex.z - s.z);
    this.showcaseHeading = p.heading;
    this.cam.yaw = p.heading;
    this.cam.pitch = 0.38;
    this.cam.pos.set(p.x - Math.sin(p.heading) * 6, 4, p.z - Math.cos(p.heading) * 6);

    // in multiplayer the host owns the monsters; clients get them over the network
    if (!this.net.isClient)
      dg.spawns.forEach((sp, i) => {
        if (this.killedKeys.has('s' + i)) return;
        this.spawnEnemy(sp.type, sp.x, sp.z, false, sp.elite, { dormant: sp.dormant }).saveKey = 's' + i;
      });
    dg.chests.forEach((c, i) => this.spawnChest(c.x, c.z, false, i));
    dg.pots.forEach((pt, i) => !this.brokenPots.has(i) && this.spawnPot(pt.x, pt.z, i));
    for (const tr of dg.traps || []) this.spawnTrap(tr);
    this.spawnPortal(ex.x, ex.z);
    if (this.arena) this.portal.mesh.visible = false;
    this.setupFloorFeatures(restore);
    this.flowTimer = 0;
    this.revealTimer = 0;
    this.prewarmShaders();

    if (!quiet) this.ui.toast(dg.isBoss ? `Floor ${n} — ☠ ${this.bossName}'s Throne ☠${n === 20 ? ' — the final battle' : ''}` : `Floor ${n}${n > 20 ? ' ∞' : ''} — ${th.name}${this.bossName ? ` · ${this.bossName} guards the portal` : ''}`, 3.2);
    if (this.net.isClient && this.inRun) this.net.send('sync', { f: n });
    if (this.net.mode && this.player && this.player.hp <= 0) this.player.hp = Math.round(this.player.final.maxHp * 0.35);
  }

  // --------------------------------------------------------------- spawning
  spawnEnemy(type, x, z, aggro = false, elite = false, opts = {}) {
    const e = new Enemy(this, type, x, z, this.floor, elite, opts);
    e.id = ++this.enemySeq;
    e.groundY = this.dungeon.floorAt(x, z);
    e.y += e.groundY;
    // tougher monsters for bigger parties
    if (this.net.live) {
      const k = 1 + 0.4 * (this.net.playerCount - 1);
      e.maxHp *= k;
      e.hp *= k;
    }
    // the endless depths' curses
    const en = this.dungeon.endless;
    if (en && en.loop) {
      e.maxHp *= en.hp;
      e.hp = e.maxHp;
      e.dmgMul *= en.dmg;
      e.speedMul *= en.speed;
    }
    if (opts.echo) e.echo = true;
    e.aggro = e.aggro || aggro;
    this.enemies.push(e);
    this.applyShadows(e.mesh);
    this.scene.add(e.mesh);
    e.render(0);
    if (ENEMY_TYPES[type].boss && !opts.echo) {
      this.boss = e;
      e.aggro = false;
    }
    this.net.onEnemySpawned(e);
    return e;
  }

  // Client: a monster the host is simulating, mirrored here.
  spawnPuppet(s) {
    if (!ENEMY_TYPES[s.type] || this.enemies.some((e) => e.id === s.id) || this.corpses.some((e) => e.id === s.id)) return null;
    const e = new Enemy(this, s.type, s.x, s.z, this.floor, !!s.elite, { puppet: true, affixes: s.af, dormant: !!s.dormant, mimic: !!s.mimic, rise: !!s.rise });
    e.id = s.id;
    e.groundY = this.dungeon.floorAt(s.x, s.z);
    e.y += e.groundY;
    e.maxHp = s.hp;
    e.hp = s.cur ?? s.hp;
    e.summoned = !!s.sum;
    e.echo = !!s.ec;
    e.heading = s.h || 0;
    this.enemies.push(e);
    this.applyShadows(e.mesh);
    this.scene.add(e.mesh);
    e.render(0);
    if (e.def.boss && !e.echo) this.boss = e;
    return e;
  }

  // Client: the host says this monster died.
  puppetKilled(e, fromX, fromZ, loot = true) {
    e.alive = false;
    e.startDeath(fromX ?? e.x, fromZ ?? e.z);
    this.corpses.push(e);
    if (loot) this.enemyDeathLocal(e);
    if (e === this.boss) this.boss = null;
    this.enemies = this.enemies.filter((x) => x !== e);
  }

  // Necromancy (Skeleton Mage, Bone King): stand fallen skeletons back up, and claw
  // fresh minions out of the floor for the rest.
  raiseDead(src, n) {
    const fx = this.effects;
    fx.ring(src.x, src.z, 3, 0x9a66ff, 0.5);
    fx.burst(src.x, 1.5, src.z, 0x9a66ff, 20, 5, 0.18, 0.6);
    sfx.portal();
    let raised = 0;
    const bodies = this.corpses
      .filter((c) => c.model && !c.def.boss && !c.affixes.includes('explosive') && c.deathT > 1 && c.deathT < 6.5 && Math.hypot(c.x - src.x, c.z - src.z) < 14)
      .sort((a, b) => Math.hypot(a.x - src.x, a.z - src.z) - Math.hypot(b.x - src.x, b.z - src.z));
    for (const c of bodies) {
      if (raised >= n) break;
      this.corpses.splice(this.corpses.indexOf(c), 1);
      c.resurrect();
      if (c.saveKey) this.killedKeys.delete(c.saveKey);
      this.enemies.push(c);
      if (this.net.live) this.net.broadcast('erez', { id: c.id });
      fx.ring(c.x, c.z, 1.4, 0x9a66ff, 0.5);
      raised++;
    }
    for (; raised < n; raised++) {
      const a = Math.random() * Math.PI * 2;
      const r = 2 + Math.random() * 2.5;
      let x = src.x + Math.sin(a) * r;
      let z = src.z + Math.cos(a) * r;
      if (this.dungeon.blocked(x, z, 0.5, 1.5)) {
        x = src.x;
        z = src.z;
      }
      const e = this.spawnEnemy(src.def.boss && Math.random() < 0.4 ? 'archer' : 'grunt', x, z, true, false, { rise: true });
      e.summoned = true;
    }
  }

  chestMats() {
    if (!this._chestMats)
      this._chestMats = {
        wood: mat(0x7a4f25, { rough: 0.85 }),
        rich: mat(0x4a2f7a, { rough: 0.7 }),
        iron: mat(0x55555e, { metal: 0.6, rough: 0.4 }),
        gold: mat(0xe8c14a, { metal: 0.7, rough: 0.3, emissive: 0x332200 }),
        clay: mat(0x9a6b45, { rough: 0.9 }),
        clayDark: mat(0x6a4a30, { rough: 0.9 }),
      };
    return this._chestMats;
  }

  spawnChest(x, z, rich = false, idx = -1) {
    // from floor 2 some chests have teeth
    // (decided from the position so every player in a session agrees)
    const roll = Math.abs(Math.sin(x * 12.9898 + z * 78.233 + this.floor * 37.719) * 43758.5453) % 1;
    if (!rich && this.floor >= 2 && roll < 0.15 + Math.min(0.1, this.floor * 0.01)) {
      if (!this.net.isClient && !this.killedKeys?.has('c' + idx)) this.spawnEnemy('mimic', x, z, false, false, { mimic: true }).saveKey = 'c' + idx;
      return;
    }
    const name = rich ? 'chest_gold' : 'chest';
    const g = propModel(name);
    g.scale.setScalar(0.62);
    const lid = hingeLid(g, name + '_lid', 0.6, -0.64);
    g.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    const y = this.dungeon.floorAt(x, z);
    g.position.set(x, y, z);
    g.rotation.y = rng.next() * Math.PI * 2;
    this.scene.add(g);
    const chest = { x, y, z, mesh: g, lid, open: false, rich, t: 0, idx };
    this.chests.push(chest);
    if (idx >= 0 && this.openedChests?.has(idx)) {
      chest.open = true;
      chest.t = 1;
      if (lid) lid.rotation.x = -1.75;
    }
  }

  // Breakables: barrels and crates that burst into gold, potions or splinters.
  spawnPot(x, z, id = -1) {
    const kinds = [
      ['barrel_small', 0.66],
      ['box_small', 0.62],
      ['box_small_decorated', 0.46],
      ['barrel_small', 0.58],
    ];
    const [name, s] = kinds[Math.floor(rng.next() * kinds.length)];
    const g = propModel(name);
    g.scale.setScalar(s * (0.9 + rng.next() * 0.2));
    g.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    const y = this.dungeon.floorAt(x, z);
    g.position.set(x, y, z);
    g.rotation.y = rng.next() * 6;
    this.scene.add(g);
    this.pots.push({ x, y, z, mesh: g, id });
  }

  // Spike trap: a whole floor tile of spikes on a cycle (warning rattle, then up).
  spawnTrap(tr) {
    const g = propModel('floor_tile_big_spikes');
    g.scale.set(0.5, 0.5, 0.5);
    g.position.set(tr.x, 0.012, tr.z);
    const spikes = g.getObjectByName('spikes');
    if (!this.trapTileMat) {
      const src = g.getObjectByName('Cube14376') || g.children[0];
      this.trapTileMat = src?.material?.clone();
      if (this.trapTileMat) this.trapTileMat.color.setHex(0x6e6e76);
    }
    g.traverse((o) => {
      if (o.isMesh) {
        o.receiveShadow = true;
        if (o !== spikes && this.trapTileMat) o.material = this.trapTileMat;
      }
    });
    this.scene.add(g);
    this.traps.push({ ...tr, mesh: g, spikes, baseY: spikes ? spikes.position.y : 0, t: tr.phase, hit: new Set(), up: false });
  }

  updateTraps(dt) {
    const P = 3.2; // cycle: down 1.9s, rattle 0.45s, up 0.6s, sink
    const p = this.player;
    for (const tr of this.traps) {
      tr.t = (tr.t + dt) % P;
      const t = tr.t;
      let h = 0; // 0 hidden .. 1 fully up
      if (t > 1.9 && t < 2.35) h = 0.12 + Math.sin(t * 60) * 0.03;
      else if (t >= 2.35 && t < 2.95) h = Math.min(1, (t - 2.35) / 0.06);
      else if (t >= 2.95) h = Math.max(0, 1 - (t - 2.95) / 0.25);
      if (tr.spikes) tr.spikes.position.y = tr.baseY - (1 - h) * 2.05;
      const armed = t >= 2.35 && t < 2.95;
      if (armed && !tr.up) {
        tr.hit.clear();
        if (Math.hypot(p.x - tr.x, p.z - tr.z) < 14) sfx.swing();
      }
      tr.up = armed;
      if (!armed) continue;
      const inside = (o) => Math.abs(o.x - tr.x) < 1.0 + (o.radius || 0) * 0.5 && Math.abs(o.z - tr.z) < 1.0 + (o.radius || 0) * 0.5;
      if (!tr.hit.has(p) && inside(p) && p.y < 0.6 && !p.dead) {
        tr.hit.add(p);
        if (p.takeDamage(10 + this.floor * 3, null, false)) {
          p.vy = Math.max(p.vy, 6);
          p.grounded = false;
          this.effects.burst(p.x, 0.3, p.z, 0xcccccc, 10, 4, 0.1, 0.35);
          if (!this.tipsShown.traps) {
            this.tipsShown.traps = true;
            this.ui.toast('Spike traps rattle before they fire. Lure enemies onto them!', 3);
          }
        }
      }
      if (this.net.isClient) continue;
      for (const e of this.enemies) {
        if (!e.alive || e.def.hover || e.def.boss || tr.hit.has(e) || !inside(e)) continue;
        tr.hit.add(e);
        this.damageEnemy(e, { amount: 20 + this.floor * 8, crit: false, knock: 0, launch: 5, noProc: true }, tr.x, tr.z);
      }
    }
  }

  spawnPortal(x, z) {
    const g = new THREE.Group();
    const ringMat = new THREE.MeshStandardMaterial({ color: 0x555566, emissive: 0x000000, roughness: 0.5, metalness: 0.4 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.18, 8, 32), ringMat);
    ring.position.y = 1.6;
    g.add(ring);
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x3a3a48, roughness: 0.9, flatShading: true });
    const runeMat = new THREE.MeshStandardMaterial({ color: 0x333344, emissive: 0x000000 });
    // short standing stones with runes ring the pad (low enough not to hide the hero)
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.5;
      const stone = new THREE.Mesh(G.cyl(0.16, 0.24, 0.8, 5), stoneMat);
      stone.position.set(Math.cos(a) * 2.2, 0.4, Math.sin(a) * 2.2);
      stone.rotation.y = a;
      g.add(stone);
      const rune = new THREE.Mesh(G.box(0.06, 0.3, 0.05), runeMat);
      rune.position.set(Math.cos(a) * 2.02, 0.5, Math.sin(a) * 2.02);
      rune.rotation.y = -a + Math.PI / 2;
      g.add(rune);
    }

    const discMat = new THREE.MeshBasicMaterial({ color: 0x222233, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.15, 32), discMat);
    disc.position.y = 1.6;
    g.add(disc);
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.0, 0.15, 24), stoneMat);
    pad.position.y = 0.07;
    g.add(pad);
    g.position.set(x, 0, z);
    this.scene.add(g);
    const light = new THREE.PointLight(0x9d7dff, 0, 10, 1.5);
    light.position.set(0, 1.8, 0);
    g.add(light);
    this.portal = { x, z, mesh: g, ring, ringMat, disc, discMat, light, runeMat, active: false };
  }

  portalInfo() {
    return {
      floor: this.floor + 1,
      chests: this.chests.filter((c) => !c.open).length,
      items: this.pickups.filter((k) => k.kind === 'item').length,
    };
  }

  declinePortal() {
    this.portalDeclined = true;
    this.portalAsk = false;
    this.ui.setPortalCard(null);
  }

  activatePortal(quiet = false) {
    const pt = this.portal;
    pt.active = true;
    pt.ringMat.color.setHex(0xb18cff);
    pt.ringMat.emissive.setHex(0x5a2fbf);
    pt.discMat.color.setHex(0x9d7dff);
    pt.runeMat.emissive.setHex(0x9d7dff);
    pt.light.intensity = 6;
    if (quiet) return;
    sfx.portal();
    jingle('clear');
    this.addShards(2);
    this.ui.toast(this.bossName ? `${this.bossName} falls! The portal is open ✦` : 'Floor cleared! Find the portal ✦', 2.5);
    if (this.net.isHost && this.net.live) this.net.broadcast('portal', { f: this.floor });
  }

  coinMaterial() {
    return (this.coinMat ||= mat(0xffd34d, { metal: 0.7, rough: 0.3, emissive: 0x664400 }));
  }
  potionMaterials() {
    return (this.potionMats ||= { red: mat(0xff3b5c, { emissive: 0x551020, rough: 0.2 }), cork: mat(0x8a6a4a), glass: mat(0xdddddd, { rough: 0.1, transparent: true, opacity: 0.5 }) });
  }

  dropGold(x, z, amount) {
    const coins = Math.min(8, Math.max(1, Math.round(amount / 4)));
    const per = amount / coins;
    for (let i = 0; i < coins; i++) {
      const m = new THREE.Mesh(G.cyl(0.16, 0.16, 0.05, 12), this.coinMaterial());
      m.rotation.x = Math.PI / 2;
      const a = rng.next() * Math.PI * 2;
      const s = 2 + rng.next() * 3;
      m.position.set(x, 0.8, z);
      this.scene.add(m);
      this.pickups.push({ kind: 'gold', value: per, x, y: 0.8, z, vx: Math.cos(a) * s, vy: 5 + rng.next() * 3, vz: Math.sin(a) * s, mesh: m, t: 0 });
    }
  }

  dropPotion(x, z) {
    const P = this.potionMaterials();
    const g = new THREE.Group();
    const b = new THREE.Mesh(G.sphere(0.22, 12, 9), P.red);
    g.add(b);
    const neck = new THREE.Mesh(G.cyl(0.07, 0.08, 0.16, 8), P.glass);
    neck.position.y = 0.26;
    g.add(neck);
    const cork = new THREE.Mesh(G.cyl(0.06, 0.06, 0.08, 8), P.cork);
    cork.position.y = 0.36;
    g.add(cork);
    g.position.set(x, 0.5, z);
    this.scene.add(g);
    this.pickups.push({ kind: 'potion', x, y: 0.5, z, vx: 0, vy: 4, vz: 0, mesh: g, t: 0 });
  }

  dropItem(x, z, item) {
    const g = new THREE.Group();
    const color = item.rarity.hex;
    const icon = buildDropModel(item);
    const holder = new THREE.Group();
    holder.position.y = 1.0;
    holder.add(icon);
    g.add(holder);
    const beam = new THREE.Mesh(G.cyl(0.08, 0.3, 4, 8, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    beam.position.y = 2;
    g.add(beam);
    g.userData.dispose = () => {
      icon.userData.dispose && icon.userData.dispose();
      beam.material.dispose();
    };
    const a = rng.next() * Math.PI * 2;
    const pk = { kind: 'item', item, x, y: 0, z, vx: Math.cos(a) * 2.5, vy: 0, vz: Math.sin(a) * 2.5, mesh: g, icon: holder, t: 0 };
    g.position.set(x, 0, z);
    this.scene.add(g);
    this.pickups.push(pk);
    if (item.rarity.tier >= 3) this.effects.ring(x, z, 2, color, 0.6);
    return pk;
  }

  // A shader program compiles the first time its material setup is drawn, which
  // freezes that frame: the first hit, kill, loot drop or skill of a run would
  // hitch (worst on High, where lit materials also get shadow variants). Keep one
  // hidden mesh per material setup that effects, projectiles, zones and loot use
  // (hidden meshes cost nothing to draw, and keep their programs from being freed)
  // and compile everything in the scene up front, for the render target it's
  // really drawn into.
  prewarmShaders() {
    const R = this.renderer;
    if (!R || !this.player || !this.dungeon) return;
    if (!this.warm) {
      const g = new THREE.Group();
      g.name = 'shader-warmup';
      g.visible = false;
      const geo = G.box(0.1, 0.1, 0.1);
      const add = (m) => g.add(new THREE.Mesh(geo, m));
      const both = THREE.DoubleSide;
      const glow = THREE.AdditiveBlending;
      // effects.js: rings / zone discs, telegraphs, slashes / loot beams, lightning / fire patches
      add(new THREE.MeshBasicMaterial({ transparent: true, side: both, depthWrite: false }));
      add(new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
      add(new THREE.MeshBasicMaterial({ transparent: true, side: both, depthWrite: false, blending: glow }));
      add(new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: glow }));
      add(new THREE.MeshBasicMaterial({ color: 0xffffff }));
      // spikes and ice shards; meteors
      add(new THREE.MeshStandardMaterial({ flatShading: true, transparent: true, emissive: 0x3388cc }));
      add(new THREE.MeshStandardMaterial({ flatShading: true, emissive: 0xff5a1a }));
      for (const m of Object.values(this.projMats())) add(m);
      for (const m of Object.values(this.chestMats())) add(m);
      for (const m of Object.values(this.potionMaterials())) add(m);
      add(this.coinMaterial());
      for (const m of sharedEnemyMaterials()) add(m);
      // weapon swing ribbons
      new Trail(g, 0xffffff).mesh.visible = true;
      // loot on the floor, in every rarity
      for (const tier of [0, 1, 2, 3, 4]) for (const slot of ['weapon', 'armor', 'charm']) g.add(buildDropModel(generateItem(Math.max(1, this.floor), this.player.clsId, 0, tier, slot)));
      g.traverse((o) => (o.frustumCulled = false));
      this.warm = g;
    }
    if (this.warm.parent !== this.scene) this.scene.add(this.warm);
    const target = this.composer ? this.composer.readBuffer : null;
    const prev = R.getRenderTarget();
    // Metal and Vulkan also build a pipeline per shader + blend/depth mode + target
    // format on the first real draw, so draw it all once, clipped to a single pixel
    // (the particle system too, which is empty until the first hit). A target's
    // scissor is read when it's bound, so set it first.
    if (target) {
      target.scissor.set(0, 0, 1, 1);
      target.scissorTest = true;
    }
    R.setRenderTarget(target);
    R.compile(this.scene, this.camera);
    if (!target) {
      R.setScissor(0, 0, 1, 1);
      R.setScissorTest(true);
    }
    const fx = this.effects.pmesh;
    const count = fx.count;
    fx.count = 1;
    this.warm.visible = true;
    R.render(this.scene, this.camera);
    this.warm.visible = false;
    fx.count = count;
    if (target) target.scissorTest = false;
    else {
      R.setScissor(0, 0, R.domElement.width, R.domElement.height);
      R.setScissorTest(false);
    }
    R.setRenderTarget(prev);
  }

  removePickup(pk) {
    this.scene.remove(pk.mesh);
    if (pk.mesh.userData.dispose) pk.mesh.userData.dispose();
    const i = this.pickups.indexOf(pk);
    if (i >= 0) this.pickups.splice(i, 1);
  }

  // --------------------------------------------------------- projectiles
  projMats() {
    if (!this._pm)
      this._pm = {
        wood: new THREE.MeshBasicMaterial({ color: 0xc8a878 }),
        steel: new THREE.MeshBasicMaterial({ color: 0xe8eef6 }),
        green: new THREE.MeshBasicMaterial({ color: 0x9dffb0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending }),
        fire: new THREE.MeshBasicMaterial({ color: 0xff7a2e }),
        fireCore: new THREE.MeshBasicMaterial({ color: 0xffe07a }),
        arcane: new THREE.MeshBasicMaterial({ color: 0xb58cff }),
        orb: new THREE.MeshBasicMaterial({ color: 0x9d6dff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }),
        orbCore: new THREE.MeshBasicMaterial({ color: 0xf0e0ff }),
        enemyArrow: new THREE.MeshBasicMaterial({ color: 0xfff1c9 }),
        enemyOrb: new THREE.MeshBasicMaterial({ color: 0xc04dff }),
      };
    return this._pm;
  }

  projectileMesh(kind, scale = 1) {
    const M = this.projMats();
    const g = new THREE.Group();
    const add = (geo, m, z = 0, r = null) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.z = z;
      if (r) mesh.rotation.set(r[0], r[1], r[2]);
      g.add(mesh);
      return mesh;
    };
    if (kind === 'arrow' || kind === 'bigarrow') {
      const big = kind === 'bigarrow';
      add(G.box(0.035, 0.035, 0.75), big ? M.green : M.wood);
      add(G.cone(0.05, 0.14, 4), big ? M.green : M.steel, 0.42, [Math.PI / 2, 0, 0]);
      add(G.box(0.1, 0.01, 0.14), M.steel, -0.33);
      if (big) g.scale.setScalar(1.5);
    } else if (kind === 'fire') {
      add(G.ico(0.26, 0), M.fire);
      add(G.ico(0.15, 0), M.fireCore, 0.06);
    } else if (kind === 'missile') {
      add(G.octa(0.16), M.arcane);
      add(G.octa(0.08), M.orbCore, 0.05);
    } else if (kind === 'knife') {
      add(G.box(0.06, 0.015, 0.3), M.steel);
      add(G.box(0.03, 0.03, 0.1), M.wood, -0.17);
    } else if (kind === 'axe' || kind === 'bigaxe') {
      // a real axe model tumbling end over end
      const ax = gearModel('axe_1handed');
      if (ax) {
        const holder = new THREE.Group();
        ax.position.y = -0.35;
        holder.add(ax);
        holder.scale.setScalar(kind === 'bigaxe' ? 1.4 : 0.9);
        g.add(holder);
        g.userData.dispose = () => ax.traverse((o) => o.isMesh && o.material.dispose());
      }
    } else if (kind === 'orb') {
      add(G.sphere(0.8, 16, 12), M.orb);
      add(G.ico(0.3, 1), M.orbCore);
      g.scale.setScalar(scale);
    }
    return g;
  }

  // Generic player projectile.
  shoot(o) {
    const from = o.from;
    const pr = {
      owner: 'player',
      x: from.x + Math.sin(o.heading) * 0.5,
      y: from.y + (o.kind === 'orb' ? 1.0 : 1.3),
      z: from.z + Math.cos(o.heading) * 0.5,
      heading: o.heading,
      speed: o.speed,
      life: o.life,
      kind: o.kind,
      radius: o.radius ?? 0.45,
      pierce: o.pierce ?? 0,
      hitSet: new Set(),
      homing: o.homing || null,
      dmg: o.dmg,
      knock: o.knock ?? 3,
      explode: o.explode || 0,
      explodeAtEnd: o.explodeAtEnd,
      onHit: o.onHit,
      tickDmg: o.tickDmg,
      pull: o.pull || 0,
      tickT: 0,
      spin: 0,
      boomerang: o.boomerang,
      rehit: o.rehit,
      maxLife: o.life,
    };
    // aim up or down at the monster it's heading for (platforms, stairs)
    pr.vy = o.boomerang ? 0 : this.aimVy(pr.x, pr.y, pr.z, pr.heading, pr.speed);
    pr.mesh = this.projectileMesh(o.kind, o.kind === 'orb' ? pr.radius / 1.5 : 1);
    pr.mesh.position.set(pr.x, pr.y, pr.z);
    pr.mesh.rotation.y = pr.heading;
    this.scene.add(pr.mesh);
    this.projectiles.push(pr);
    if (this.fxCtx === 'local' && this.net.live && this.inRun) this.net.outShoot.push({ kind: o.kind, x: pr.x, y: pr.y, z: pr.z, h: pr.heading, sp: pr.speed, life: pr.life, r: pr.radius, b: o.boomerang ? 1 : 0, vy: pr.vy });
    return pr;
  }

  // Vertical speed that takes a shot from (x, y, z) to the chest of the monster in its
  // path, when that monster stands higher or lower.
  aimVy(x, y, z, heading, speed) {
    const e = this.findTarget(x, z, heading, 30, 0.22);
    if (!e) return 0;
    const d = Math.max(1, Math.hypot(e.x - x, e.z - z));
    // upper body: a flatter arc to the chest can clip the edge of the ledge it stands on
    const dy = e.y - (e.def.hover || 0) + e.height * 0.7 - y;
    return Math.abs(dy) < 0.5 ? 0 : clamp(dy / (d / speed), -14, 14);
  }

  // Another player's projectile: looks the same, hits nothing here.
  shootGhost(o, owner) {
    const pr = { owner: 'ghost', kind: o.kind, x: o.x, y: o.y, z: o.z, vy: o.vy || 0, heading: o.h, speed: o.sp, life: o.life, maxLife: o.life, radius: o.r, boomerang: !!o.b, returnTo: owner };
    pr.mesh = this.projectileMesh(o.kind, o.kind === 'orb' ? pr.radius / 1.5 : 1);
    pr.mesh.position.set(pr.x, pr.y, pr.z);
    this.scene.add(pr.mesh);
    this.projectiles.push(pr);
  }

  // Another player's ground effect (rain, poison, totem…): visuals only.
  zoneGhost(o, owner) {
    this.zone({ kind: o.kind, x: o.x, z: o.z, r: o.r, life: o.life, delay: o.delay || 0, follow: o.fol && owner ? owner : null, ghost: true });
  }

  spawnEnemyProjectile(x, y, z, heading, speed, dmg, kind, vy = 0) {
    const M = this.projMats();
    let m;
    if (kind === 'arrow') {
      m = new THREE.Group();
      const s = new THREE.Mesh(G.box(0.04, 0.04, 0.8), M.enemyArrow);
      m.add(s);
      const h = new THREE.Mesh(G.cone(0.05, 0.14, 4), M.steel);
      h.rotation.x = Math.PI / 2;
      h.position.z = 0.45;
      m.add(h);
    } else {
      m = new THREE.Mesh(G.sphere(0.35, 12, 9), M.enemyOrb);
    }
    m.position.set(x, y, z);
    m.rotation.y = heading;
    this.scene.add(m);
    this.projectiles.push({ owner: 'enemy', kind, x, y, z, vy, heading, speed, dmg, life: 3, mesh: m });
    if (this.net.isHost && this.net.live) this.net.broadcast('eproj', { f: this.floor, x, y, z, h: heading, sp: speed, dmg, k: kind, vy });
  }

  explodeAt(pr, x, z) {
    const fire = pr.kind === 'fire';
    const col = fire ? 0xff7a2e : 0xb58cff;
    this.effects.burst(x, pr.y, z, col, 18, 6, 0.18, 0.45, 4);
    this.effects.ring(x, z, pr.explode, fire ? 0xff9a3d : 0xd0a8ff, 0.3, 0.1);
    sfx.boom();
    this.hitEnemiesInRadius(x, z, pr.explode, (e) => {
      if (pr.onHit) pr.onHit(e);
      return { ...pr.dmg(), knock: pr.knock };
    });
  }

  spawnFirePatch(x, z) {
    if (!this.patchMat) this.patchMat = new THREE.MeshBasicMaterial({ color: 0xff6a1a, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
    const m = new THREE.Mesh(G.cyl(0.9, 0.9, 0.02, 12), this.patchMat);
    m.position.set(x, this.dungeon.floorAt(x, z) + 0.06, z);
    this.scene.add(m);
    this.patches.push({ x, z, t: 2.0, tick: 0, mesh: m });
  }

  // ------------------------------------------------------- zones and timers
  schedule(delay, fn) {
    this.timers.push({ t: delay, fn, ctx: this.fxCtx });
  }

  zone(o) {
    const z = { t: 0, tickT: 0, delay: 0, arm: 0, started: false, ctx: this.fxCtx, ...o };
    if (this.fxCtx === 'local' && this.net.live && this.inRun && o.kind && !o.ghost) this.net.outZone.push({ kind: o.kind, x: o.x, z: o.z, r: o.r, life: o.life, delay: o.delay || 0, fol: o.follow === this.player ? 1 : 0 });
    const g = new THREE.Group();
    g.position.set(z.x, this.dungeon.floorAt(z.x, z.z) + 0.05, z.z);
    const mats = [];
    const addDisc = (color, opacity, r = z.r) => {
      const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
      mats.push(m);
      const d = new THREE.Mesh(G.cyl(r, r, 0.02, 32, false), m);
      g.add(d);
      return m;
    };
    if (z.kind === 'rain') {
      addDisc(0xcfe8ff, 0.12);
      const ring = new THREE.Mesh(G.torus(z.r, 0.05, Math.PI * 2, 4, 40), new THREE.MeshBasicMaterial({ color: 0xcfe8ff }));
      mats.push(ring.material);
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
    } else if (z.kind === 'poison') {
      z.mat = addDisc(0x5adf3a, 0.28);
    } else if (z.kind === 'totem') {
      addDisc(0xffb347, 0.12);
      const ring = new THREE.Mesh(G.torus(z.r, 0.05, Math.PI * 2, 4, 40), new THREE.MeshBasicMaterial({ color: 0xffb347 }));
      mats.push(ring.material);
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
      const post = propModel('post_skull');
      if (post) {
        post.scale.setScalar(0.62);
        g.add(post);
      }
    } else if (z.kind === 'blood') {
      z.mat = addDisc(0xb01020, 0.18);
    } else if (z.kind === 'trap') {
      const M = this.chestMats();
      const base = new THREE.Mesh(G.cyl(0.4, 0.45, 0.08, 12), M.iron);
      g.add(base);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const tooth = new THREE.Mesh(G.cone(0.05, 0.16, 4), M.iron);
        tooth.position.set(Math.cos(a) * 0.35, 0.1, Math.sin(a) * 0.35);
        g.add(tooth);
      }
      const lm = new THREE.MeshBasicMaterial({ color: 0xff3030 });
      mats.push(lm);
      z.light = new THREE.Mesh(G.sphere(0.07, 8, 6), lm);
      z.light.position.y = 0.1;
      g.add(z.light);
    }
    z.mesh = g;
    z.dispose = () => mats.forEach((m) => m.dispose());
    this.scene.add(g);
    this.zones.push(z);
    return z;
  }

  updateZones(dt) {
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const tm = this.timers[i];
      tm.t -= dt;
      if (tm.t <= 0) {
        this.timers.splice(i, 1);
        this.fxCtx = tm.ctx;
        tm.fn();
        this.fxCtx = null;
      }
    }
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      z.t += dt;
      if (z.follow) {
        z.x = z.follow.x;
        z.z = z.follow.z;
        z.mesh.position.set(z.x, this.dungeon.floorAt(z.x, z.z) + 0.05, z.z);
      }
      let done = z.t >= z.life + z.delay;
      this.fxCtx = z.ctx;
      if (z.t >= z.delay && !z.ghost) {
        if (!z.started) {
          z.started = true;
          if (z.onStart) z.onStart(z);
        }
        if (z.onTick) {
          z.tickT -= dt;
          if (z.tickT <= 0) {
            z.tickT = z.tick;
            z.onTick(z);
          }
        }
        if (z.onEnter && z.t > z.arm) {
          for (const e of this.enemies) {
            if (e.alive && Math.hypot(e.x - z.x, e.z - z.z) < z.r + e.radius && z.onEnter(z)) {
              done = true;
              break;
            }
          }
        }
      }
      if (z.kind === 'poison') {
        if (Math.random() < 0.5) this.effects.smoke(z.x + (Math.random() - 0.5) * z.r * 1.4, z.z + (Math.random() - 0.5) * z.r * 1.4);
        if (Math.random() < 0.4) this.effects.puff(z.x + (Math.random() - 0.5) * z.r * 1.5, 0.3, z.z + (Math.random() - 0.5) * z.r * 1.5, 0x6adf3a, 0.3, 0.8);
      }
      this.fxCtx = null;
      if (z.light) z.light.visible = z.t < z.arm || Math.floor(z.t * 3) % 2 === 0;
      if (done) {
        this.scene.remove(z.mesh);
        if (z.dispose) z.dispose();
        if (z.onEnd) z.onEnd(z);
        this.zones.splice(i, 1);
      }
    }
  }

  lightning(pts, color) {
    this.effects.lightning(pts, color);
  }

  // Bolt from the sky onto a point, damaging around it.
  skyStrike(x, z, r, hitFn, color = 0xaad4ff) {
    this.effects.lightning([[x + (Math.random() - 0.5) * 2, 11, z + (Math.random() - 0.5) * 2], [x, 0.1, z]], color);
    this.effects.ring(x, z, r, color, 0.3);
    this.effects.burst(x, 0.3, z, color, 12, 6, 0.12, 0.4);
    this.effects.shake(0.12);
    this.hitEnemiesInRadius(x, z, r, hitFn);
  }

  // Ground shockwave: hurts the player only if they are on the ground — jump over it!
  shockwave(x, z, r, dmg, src, big = false) {
    if (this.net.isHost && this.net.live && this.fxCtx === 'enemy') this.net.broadcast('shock', { f: this.floor, x, z, r, dmg, big: big ? 1 : 0, src: src?.id ?? -1 });
    const fx = this.effects;
    fx.ring(x, z, r, big ? 0xc04dff : 0xff9955, 0.4);
    fx.ring(x, z, r * 0.6, 0xffffff, 0.3);
    fx.burst(x, 0.2, z, 0x8a7a60, big ? 30 : 16, big ? 10 : 7, 0.2, 0.6);
    fx.spikes(x, z, 0x6a5a48, r * 0.35);
    fx.shake(big ? 0.6 : 0.35);
    sfx.slam();
    const p = this.player;
    const d = Math.hypot(p.x - x, p.z - z);
    const ground = this.dungeon.maxHeightUnder(p.x, p.z, p.radius);
    // it travels along the floor it started on: not up onto (or down off) a platform
    const level = src && src.groundY !== undefined ? src.groundY : this.dungeon.floorAt(x, z);
    if (d < r + p.radius && p.y - ground < 0.5 && Math.abs(ground - level) < 0.6) {
      if (p.takeDamage(dmg, src, true)) {
        src?.onHitPlayer?.(dmg);
        p.vy = 7;
        p.grounded = false;
        if (!this.tipsShown.jump) {
          this.tipsShown.jump = true;
          this.ui.toast('Tip: jump over red shockwaves!', 2.5);
        }
      }
    }
  }

  // ----------------------------------------------------------------- combat
  findTarget(x, z, heading, range, cone) {
    let best = null;
    let bestScore = Infinity;
    for (const e of this.enemies) {
      if (!e.alive || e.disguised || e.dormant) continue;
      const dx = e.x - x;
      const dz = e.z - z;
      const d = Math.hypot(dx, dz);
      if (d > range + e.radius) continue;
      const ad = Math.abs(angleDiff(heading, Math.atan2(dx, dz)));
      if (ad > cone && d > e.radius + 1) continue;
      if (!this.dungeon.lineOfSight(x, z, e.x, e.z)) continue;
      const score = d + ad * 3;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  hitEnemiesInRadius(x, z, r, fn) {
    // hits land on the floor at (x, z): monsters a level above or below are out of reach
    const floor = this.dungeon.floorAt(x, z);
    for (const e of this.enemies.slice()) {
      if (!e.alive) continue;
      if (Math.hypot(e.x - x, e.z - z) > r + e.radius) continue;
      if (Math.abs(e.y - (e.def.hover || 0) - floor) > 1.5) continue;
      const res = fn(e);
      if (res) this.damageEnemy(e, res, x, z);
    }
    for (let i = this.pots.length - 1; i >= 0; i--) {
      const pt = this.pots[i];
      if (Math.hypot(pt.x - x, pt.z - z) < r + 0.3 && Math.abs((pt.y || 0) - floor) < 1.5) {
        if (this.net.live) this.net.send('pot', { i: pt.id });
        this.breakPot(i);
      }
    }
  }

  hitCone(x, z, heading, range, arc, fn) {
    const hx = Math.sin(heading);
    const hz = Math.cos(heading);
    this.hitEnemiesInRadius(x, z, range, (e) => {
      const dx = e.x - x;
      const dz = e.z - z;
      const d = Math.hypot(dx, dz) || 1;
      if ((dx * hx + dz * hz) / d < Math.cos(arc / 2) && d > e.radius + 0.4) return null;
      return fn(e);
    });
  }

  damageEnemy(e, hit, fromX, fromZ) {
    if (!e.alive) return;
    if (e.rival) return this.damageRival(e, hit, fromX, fromZ);
    const p = this.player;
    let amount = hit.amount;
    // our own direct hits: wrath / shadow bonuses, and afterwards the gear's procs
    const proc = !hit.remote && !hit.dot && !hit.noProc && !hit.silent && p && !p.dead;
    if (proc) amount = p.pw.outgoing(amount);
    if (!hit.remote && this.curse) amount *= this.curse.dmgDealt || 1;
    if (!hit.remote && p.mods.execute > 0 && e.hp < e.maxHp * 0.3) amount *= 1 + p.mods.execute;
    // shield bearers block blows from the front unless they're mid-swing
    // (a remote player's hit arrives already reduced)
    if (e.def.guard && !hit.remote && !hit.dot && !['windup', 'attack', 'bosswind', 'bossact'].includes(e.state)) {
      const toSrc = Math.atan2(fromX - e.x, fromZ - e.z);
      if (Math.abs(angleDiff(e.heading, toSrc)) < 1.05) {
        amount *= 1 - e.def.guard;
        this.effects.burst(e.x + Math.sin(e.heading) * 0.6, e.y + e.height * 0.55, e.z + Math.cos(e.heading) * 0.6, 0xd8e0ff, 6, 5, 0.08, 0.25);
      }
    }
    // client: the host owns the monster; send the hit and show it right away
    if (e.puppet) {
      amount = Math.max(1, Math.round(amount));
      this.net.send('hit', { id: e.id, a: amount, c: hit.crit ? 1 : 0, k: hit.knock || 0, l: hit.launch || 0, d: hit.dot, s: hit.silent ? 1 : 0, x: Math.round(fromX * 100) / 100, z: Math.round(fromZ * 100) / 100 });
      const predictedKill = e.hp - amount <= 0;
      e.hp = Math.max(1, e.hp - amount);
      e.flash = 0.09;
      if (!hit.silent) {
        e.flinch = 0.2;
        this.addCombo();
        this.effects.burst(e.x, e.y + e.height * 0.5, e.z, hit.crit ? 0xffe066 : e.def.color, hit.crit ? 12 : 6, 5, 0.12, 0.35);
        if (hit.crit) sfx.crit();
        else sfx.hit();
        if (hit.crit) this.hitStop(0.035);
        if (p.final.lifesteal + p.buff.ls > 0) p.heal(amount * (p.final.lifesteal + p.buff.ls), false);
      }
      this.effects.damageNumber(e.x, e.y + e.height + 0.3, e.z, fmtNum(amount), hit.crit ? 'crit' : hit.dot === 'poison' ? 'poison' : hit.silent ? 'dot' : '');
      if (proc) {
        p.pw.onHit(e, amount, hit, this);
        if (predictedKill) p.pw.onKill(e, this);
      }
      return;
    }
    amount = Math.max(1, Math.round(e.absorb(amount)));
    e.hp -= amount;
    if (!hit.silent && !hit.remote) this.addCombo();
    e.flash = 0.09;
    e.aggro = true;
    if (!hit.silent) e.flinch = 0.2;
    const heavy = e.def.heavy;
    if (hit.knock) {
      const dx = e.x - fromX;
      const dz = e.z - fromZ;
      const d = Math.hypot(dx, dz) || 1;
      const k = e.def.cage ? 0 : hit.knock * (e.def.boss ? 0.05 : heavy ? 0.35 : 1);
      e.kx += (dx / d) * k * 2;
      e.kz += (dz / d) * k * 2;
      if (!e.def.boss) e.stun = Math.max(e.stun, heavy ? 0.06 : 0.22);
      if (!heavy && e.state === 'windup' && hit.knock >= 4) {
        e.state = 'recover';
        e.stateT = 0;
      }
    }
    if (hit.launch && !heavy) e.vy = hit.launch;
    if (!hit.silent) {
      this.effects.burst(e.x, e.y + e.height * 0.5, e.z, hit.crit ? 0xffe066 : e.def.color, hit.crit ? 12 : 6, 5, 0.12, 0.35);
      if (!hit.remote) {
        if (hit.crit) sfx.crit();
        else sfx.hit();
        if (hit.crit) this.hitStop(0.035);
        if (p.final.lifesteal + p.buff.ls > 0) p.heal(amount * (p.final.lifesteal + p.buff.ls), false);
      }
    }
    this.effects.damageNumber(e.x, e.y + e.height + 0.3, e.z, fmtNum(amount), hit.crit ? 'crit' : hit.dot === 'poison' ? 'poison' : hit.silent ? 'dot' : '');
    if (proc && e.alive && e.hp > 0) p.pw.onHit(e, amount, hit, this);
    if (e.hp <= 0 && e.alive) {
      this.killEnemy(e, fromX, fromZ);
      if (proc || (hit.noProc && !hit.remote)) p.pw.onKill(e, this);
    }
  }

  // Combo: hits within 2.5s of each other chain up; every 10 adds 2.5% damage (max 25%).
  addCombo() {
    this.combo = (this.comboT > 0 ? this.combo : 0) + 1;
    this.comboT = 2.5;
    this.bestCombo = Math.max(this.bestCombo || 0, this.combo);
    const shout = { 25: 'Rampage!', 50: 'Unstoppable!', 100: 'Godlike!', 200: 'Legendary!' }[this.combo];
    if (shout) {
      this.ui.toast(`${this.combo} hit combo — ${shout}`, 1.6, '#ff9a3a');
      sfx.crit();
    }
  }

  comboBonus() {
    return this.comboT > 0 ? Math.min(0.25, Math.floor(this.combo / 10) * 0.025) : 0;
  }

  killEnemy(e, fromX = e.x, fromZ = e.z) {
    e.alive = false;
    if (e.saveKey) this.killedKeys.add(e.saveKey);
    e.startDeath(fromX, fromZ);
    this.corpses.push(e);
    const net = this.net.isHost && this.net.live;
    if (net) this.net.broadcast('ekill', { id: e.id, x: Math.round(fromX * 100) / 100, z: Math.round(fromZ * 100) / 100 });
    this.enemyDeathLocal(e);
    // splitting elites burst into two
    if (e.affixes.includes('splitter') && !e.split) {
      for (const s of [-1, 1]) {
        const x = e.x + s * 0.8;
        const c = this.spawnEnemy(e.type, this.dungeon.blocked(x, e.z, 0.5, (e.groundY || 0) + 0.3) ? e.x : x, e.z, true, false);
        c.split = true;
        c.maxHp *= 0.5;
        c.hp = c.maxHp;
      }
    }
    // the endless Volatile curse: everything goes off
    if (this.endless?.volatile && !e.def.boss && !e.def.cage) {
      const x = e.x;
      const z = e.z;
      const dmg = e.def.dmg * e.dmgMul * 1.2;
      const prev = this.fxCtx;
      this.fxCtx = 'enemy';
      this.effects.telegraph(x, z, 3, 0.8, 0xff5020);
      this.fxCtx = prev;
      this.schedule(0.8, () => {
        const pv = this.fxCtx;
        this.fxCtx = 'enemy';
        this.effects.burst(x, 0.6, z, 0xff5020, 22, 8, 0.22, 0.5);
        this.shockwave(x, z, 3, dmg, null);
        this.fxCtx = pv;
      });
    }
    if (e.def.boss && !e.echo) {
      this.boss = null;
      for (const m of this.enemies) {
        if (m === e || !m.alive) continue;
        // a den lord takes only the dead it raised with it; the Bone King takes everything
        if (e.def.den && !m.summoned) continue;
        m.alive = false;
        m.startDeath(e.x, e.z);
        this.corpses.push(m);
        if (net) this.net.broadcast('ekill', { id: m.id, x: e.x, z: e.z, n: 1 });
      }
      this.enemies = this.enemies.filter((m) => m.alive || m === e);
    }
    this.enemies = this.enemies.filter((x) => x !== e);
    // the portal opens when the floor's boss falls (or, on a floor without one, when
    // everything is dead)
    const bossFloor = !!this.bossName;
    if (!this.floorCleared && (bossFloor ? e.def.boss && !e.echo : !this.enemies.some((x) => x.alive && !x.disguised && !x.dormant))) {
      this.floorCleared = true;
      this.activatePortal();
    }
  }

  // The part of a kill every player sees for themselves: feedback and their own loot.
  enemyDeathLocal(e) {
    const p = this.player;
    p.kills++;
    this.effects.burst(e.x, e.y + e.height * 0.5, e.z, e.def.color, 14, 5, 0.18, 0.6);
    sfx.enemyDie();
    const [g0, g1] = e.def.gold;
    const gold = (g0 + rng.next() * (g1 - g0)) * (1 + this.floor * 0.15) * (e.elite ? 3 : 1) * p.final.goldMult * (e.summoned ? 0.2 : 1) * (p.pw.has('midas') ? 3 : 1) * (this.curse?.gold || 1) * (e.def.goldMul || 1);
    if (gold >= 1) this.dropGold(e.x, e.z, Math.round(gold));
    const cls = p.clsId;
    if (this.specialDeathLocal(e)) return;
    if (e.def.boss) {
      // the den's treasure: a rich chest for everyone
      const cx = e.x + 1.8;
      const cz = e.z;
      this.spawnChest(this.dungeon.solidAt(cx, cz) ? e.x : cx, cz, true);
      for (let i = 0; i < (e.def.den ? 2 : 3); i++) this.dropItem(e.x, e.z, this.gen(this.floor, cls, 6, 2));
      // kings always leave something legendary or better
      if (!e.def.den) this.dropItem(e.x, e.z, this.gen(this.floor, cls, 10, 4));
      this.dropPotion(e.x, e.z);
      this.effects.shake(1);
      this.hitStop(0.25);
    } else if (e.type === 'mimic') {
      for (let i = 0; i < 2; i++) this.dropItem(e.x, e.z, this.gen(this.floor, cls, 5, 2));
      this.dropPotion(e.x, e.z);
    } else if (!e.summoned) {
      // parties find more (loot is per player, and there's more competition for it)
      const bonus = 1 + 0.35 * (this.net.live ? this.net.playerCount - 1 : 0);
      const itemChance = (e.elite ? 0.7 : e.def.heavy ? 0.22 : 0.09) * bonus;
      for (let k = 0; k < (this.curse?.loot || 1); k++) if (rng.next() < itemChance) this.dropItem(e.x, e.z, this.gen(this.floor, cls, e.elite ? 3 : 0, e.elite ? 1 : 0));
      if (rng.next() < 0.07 * bonus) this.dropPotion(e.x, e.z);
    }
  }

  alertNearby(src) {
    for (const e of this.enemies) if (!e.aggro && Math.hypot(e.x - src.x, e.z - src.z) < 9) e.aggro = true;
  }

  // Another player smashed it: it just breaks (loot is per player).
  breakPotById(id, remote = false) {
    const i = this.pots.findIndex((pt) => pt.id === id);
    if (i < 0) return;
    if (remote) {
      const pt = this.pots[i];
      this.pots.splice(i, 1);
      this.scene.remove(pt.mesh);
      this.effects.burst(pt.x, 0.4, pt.z, 0x9a6b45, 18, 6, 0.16, 0.55);
      return;
    }
    this.breakPot(i);
  }

  breakPot(i) {
    const pt = this.pots[i];
    if (pt.id >= 0) this.brokenPots?.add(pt.id);
    this.pots.splice(i, 1);
    this.scene.remove(pt.mesh);
    this.effects.burst(pt.x, 0.4, pt.z, 0x9a6b45, 18, 6, 0.16, 0.55);
    this.effects.burst(pt.x, 0.3, pt.z, 0x6a4a2a, 10, 3, 0.22, 0.6);
    this.effects.smoke(pt.x, pt.z);
    sfx.hit();
    const r = rng.next();
    if (r < 0.55) this.dropGold(pt.x, pt.z, Math.round((3 + this.floor * 2) * this.player.final.goldMult));
    else if (r < 0.75) this.dropPotion(pt.x, pt.z);
  }

  openChest(c) {
    c.open = true;
    if (c.idx >= 0) this.openedChests.add(c.idx);
    sfx.pickup();
    this.effects.burst(c.x, 0.8, c.z, 0xffd34d, 20, 6, 0.15, 0.7);
    this.dropGold(c.x, c.z, Math.round((12 + this.floor * 6) * this.player.final.goldMult * (c.rich ? 3 : 1)));
    const n = (c.rich ? 2 : 1) + (this.net.live && this.net.playerCount > 1 ? 1 : 0);
    for (let i = 0; i < n; i++) this.dropItem(c.x, c.z, this.gen(this.floor, this.player.clsId, c.rich ? 5 : 2, 1));
    if (rng.next() < 0.4) this.dropPotion(c.x, c.z);
  }

  hitStop(t) {
    this.hitStopT = Math.max(this.hitStopT, t);
  }

  // ----------------------------------------------------------------- update
  update(rawDt) {
    // in a live multiplayer session the world never stops: menus just take your hands off the hero
    const mp = this.net.live && this.inRun && this.dungeon && this.player;
    if (this.state !== 'play') {
      if (mp && ['pause', 'upgrade', 'skillpick', 'dead', 'event', 'victory'].includes(this.state)) return this.tick(rawDt, false);
      if (this.state === 'dead') {
        this.updateCorpses(rawDt);
        if (this.player) this.player.animate(rawDt);
      }
      if (this.player && this.state !== 'title' && this.state !== 'classSelect') this.updateCamera(rawDt, { x: 0, y: 0 });
      if (this.net.mode && this.inRun) this.net.update(rawDt);
      return;
    }
    this.tick(rawDt, true);
  }

  tick(rawDt, controls) {
    const input = this.input;
    if (controls) input.poll();
    let dt = rawDt;
    if (this.hitStopT > 0) {
      this.hitStopT -= rawDt;
      dt = rawDt * 0.08;
    }
    this.runTime += rawDt;
    const look = controls ? input.consumeLook() : { x: 0, y: 0 };
    this.updateCamera(rawDt, look);

    const p = this.player;
    this.fxCtx = 'local';
    if (!p.dead && controls) p.update(dt, input, this.cam);
    else {
      p.vx = p.vz = 0;
      p.speed = 0;
      if (!controls) p.invuln = Math.max(p.invuln, 0.3);
      p.animate(dt);
    }
    this.fxCtx = null;
    const dg = this.dungeon;

    this.flowTimer -= dt;
    if (this.flowTimer <= 0) {
      this.flowTimer = 0.25;
      dg.updateFlow(p.x, p.z);
    }
    this.revealTimer -= dt;
    if (this.revealTimer <= 0) {
      this.revealTimer = 0.2;
      dg.reveal(p.x, p.z);
    }

    if (!this.net.isClient) {
      this.fxCtx = 'enemy';
      this.enemyFrame = (this.enemyFrame || 0) + 1;
      for (const e of this.enemies.slice()) {
        if (!e.alive || e.rival) continue;
        // out of sight and far from every player: think at 20 Hz (with the time
        // they skipped), which matters with a whole floor chasing across the map
        e.far = !e.def.boss && !e.seen && this.nearestPlayerDist(e) > 28;
        if (e.far && (this.enemyFrame + e.id) % 3) {
          e.lodDt = (e.lodDt || 0) + dt;
          continue;
        }
        const step = dt + (e.lodDt || 0);
        e.lodDt = 0;
        e.update(Math.min(step, 0.1), this);
      }
      this.fxCtx = null;
      this.separateEnemies();
    }
    this.updateCorpses(dt);
    this.updateProjectiles(dt);
    this.updateZones(dt);
    this.updatePickups(dt);
    this.updateInteractables(dt);
    this.updateFloorFeatures(dt, controls);
    if (this.arena) this.updateArena(dt);
    this.updateTraps(dt);
    if (this.comboT > 0) this.comboT -= dt;
    this.updatePatches(dt);
    this.net.update(dt);
    this.effects.update(dt);
    this.updateTorches();

    this.playerLight.position.set(p.x, p.y + 3, p.z);
    if (!controls) return;

    this.nearItem = null;
    let bd = 2.0;
    for (const pk of this.pickups) {
      if (pk.kind !== 'item') continue;
      const d = Math.hypot(pk.x - p.x, pk.z - p.z);
      if (d < bd) {
        bd = d;
        this.nearItem = pk;
      }
    }
    // the portal question takes the card slot and F; loot on the ground beats a
    // merchant / altar / shrine card (step off the item to use them)
    if (this.portalAsk) this.nearItem = null;
    else if (this.nearItem && this.nearEvent) {
      this.nearEvent = null;
      this.ui.setEventCard(null);
    }
    this.ui.setItemCard(this.nearItem ? this.nearItem.item : null, this.nearItem ? p.equipment[this.nearItem.item.slot] : null, p.equipment);
    if (input.pressed.interact && this.portalAsk) this.enterPortal();
    else if (input.pressed.interact && this.nearEvent) this.useEvent();
    else if (input.pressed.interact && this.nearItem) this.equipNearItem();
    this.saveT = (this.saveT ?? 2) - rawDt;
    if (this.saveT <= 0) {
      this.saveT = 2;
      this.saveRun();
    }
    if (input.pressed.pause) this.pause();
    if (input.pressed.ping) this.sendPing('auto');
    if (input.pressed.help) this.sendPing('help');
    if (this.pings) for (const q of this.pings) q.t -= rawDt;

    if (p.dead && this.state === 'play' && !this.arena) {
      if (this.net.live) {
        // co-op: stay down until a teammate revives you (or everyone falls)
        if (!this.downToast) {
          this.downToast = true;
          this.ui.toast("You're down! A teammate can revive you by standing next to you.", 3.5, '#ff8080');
        }
      } else {
        this.state = 'dead';
        setTimeout(() => this.showDeath(), 1600);
      }
    }
    input.endFrame();
  }

  updateTorches() {
    const dg = this.dungeon;
    const spots = dg.lightSpots || [];
    const p = this.player;
    const t = this.runTime;
    this.torchPick = (this.torchPick || 0) - 1;
    if (this.torchPick <= 0) {
      this.torchPick = 12;
      this.nearTorches = spots
        .map((s) => ({ s, d: (s.x - p.x) ** 2 + (s.z - p.z) ** 2 }))
        .sort((a, b) => a.d - b.d)
        .slice(0, this.torchPool.filter((l) => l.visible).length)
        .map((o) => o.s);
    }
    this.torchPool.forEach((l, i) => {
      const s = this.nearTorches && this.nearTorches[i];
      if (!s) {
        l.intensity = 0;
        return;
      }
      l.position.set(s.x, s.y, s.z);
      l.color.setHex(s.color);
      l.intensity = 7 * (0.85 + Math.sin(t * 9 + i * 3.1) * 0.08 + Math.sin(t * 23 + i) * 0.06);
    });
    // key light + shadow frustum follow the player, snapped to whole shadow-map texels
    // (moving it by fractions of a texel makes every shadow edge crawl while walking)
    const c = snapToShadowTexels(p.x, p.y, p.z, this.sun);
    this.sun.position.set(c.x + 5, c.y + 14, c.z + 3);
    this.sun.target.position.copy(c);
    dg.env.update(t, this.cam.target.lengthSq() ? this.cam.target : new THREE.Vector3(p.x, 1, p.z), this.pointScale);
  }

  updateCorpses(dt) {
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const e = this.corpses[i];
      if (!e.updateDeath(dt)) {
        this.scene.remove(e.mesh);
        e.dispose();
        this.corpses.splice(i, 1);
      }
    }
  }

  equipNearItem() {
    const pk = this.nearItem;
    if (!pk) return;
    const p = this.player;
    const old = p.equip(pk.item);
    this.removePickup(pk);
    sfx.pickup();
    this.effects.burst(p.x, p.y + 1, p.z, pk.item.rarity.hex, 14, 4, 0.12, 0.5, 2);
    this.effects.ring(p.x, p.z, 1.6, pk.item.rarity.hex, 0.4, p.y + 0.1);
    this.ui.toast(`Equipped ${pk.item.name}`, 1.4, pk.item.rarity.color);
    if (old && !old.starter) {
      const dropped = this.dropItem(p.x, p.z, old);
      dropped.vx *= 0.5;
      dropped.vz *= 0.5;
    }
    this.nearItem = null;
  }

  salvageNearItem() {
    const pk = this.nearItem;
    if (!pk) return;
    const val = Math.round(5 + itemScore(pk.item) * 0.4);
    this.player.gold += val;
    this.removePickup(pk);
    sfx.coin();
    this.ui.toast(`Salvaged for ${val} gold`, 1.2, '#ffd34d');
    this.nearItem = null;
  }

  // Distance from a monster to the closest player (the host counts everyone).
  nearestPlayerDist(e) {
    const p = this.player;
    let d = Math.hypot(p.x - e.x, p.z - e.z);
    if (this.net.isHost) for (const r of this.net.remotes.values()) d = Math.min(d, Math.hypot(r.x - e.x, r.z - e.z));
    return d;
  }

  separateEnemies() {
    // monsters far from everyone aren't worth pushing apart every frame
    const es = this.enemies.filter((e) => !e.far && !e.rival);
    const dg = this.dungeon;
    const p = this.player;
    for (let i = 0; i < es.length; i++) {
      const a = es[i];
      for (let j = i + 1; j < es.length; j++) {
        const b = es[j];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const min = a.radius + b.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 < min * min && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const push = (min - d) * 0.5;
          const ax = (dx / d) * push;
          const az = (dz / d) * push;
          if (!a.def.cage) dg.move(a, -ax, -az, false);
          if (!b.def.cage) dg.move(b, ax, az, false);
        }
      }
      const dx = a.x - p.x;
      const dz = a.z - p.z;
      const min = a.radius + p.radius;
      const d = Math.hypot(dx, dz);
      if (d < min && d > 1e-4 && Math.abs(p.y - (a.y - (a.def.hover || 0))) < 1) {
        if (a.def.cage) dg.move(p, -(dx / d) * (min - d), -(dz / d) * (min - d), true);
        else dg.move(a, (dx / d) * (min - d), (dz / d) * (min - d), false);
      }
    }
  }

  updateProjectiles(dt) {
    const dg = this.dungeon;
    const p = this.player;
    const fx = this.effects;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.life -= dt;
      if (pr.owner === 'ghost') {
        // another player's shot: fly (and return) but hit nothing
        if (pr.boomerang && pr.returnTo && pr.life < pr.maxLife * 0.5) {
          const want = Math.atan2(pr.returnTo.x - pr.x, pr.returnTo.z - pr.z);
          pr.heading += clamp(angleDiff(pr.heading, want), -9 * dt, 9 * dt);
          if (Math.hypot(pr.returnTo.x - pr.x, pr.returnTo.z - pr.z) < 1.2) pr.life = -1;
          else pr.life = Math.max(pr.life, 0.05);
        }
        pr.x += Math.sin(pr.heading) * pr.speed * dt;
        pr.z += Math.cos(pr.heading) * pr.speed * dt;
        pr.y += pr.vy * dt;
        pr.mesh.position.set(pr.x, pr.y, pr.z);
        pr.mesh.rotation.y = pr.heading;
        if ((pr.kind === 'axe' || pr.kind === 'bigaxe') && pr.mesh.children[0]) pr.mesh.children[0].rotation.x += dt * 22;
        if (pr.life <= 0 || dg.heightAtPoint(pr.x, pr.z) > pr.y) {
          this.scene.remove(pr.mesh);
          pr.mesh.userData.dispose?.();
          this.projectiles.splice(i, 1);
        }
        continue;
      }
      this.fxCtx = pr.owner === 'player' ? 'local' : null;
      if (pr.owner === 'player' && pr.homing && pr.homing.alive) {
        const want = Math.atan2(pr.homing.x - pr.x, pr.homing.z - pr.z);
        pr.heading += clamp(angleDiff(pr.heading, want), -4.5 * dt, 4.5 * dt);
      }
      pr.x += Math.sin(pr.heading) * pr.speed * dt;
      pr.z += Math.cos(pr.heading) * pr.speed * dt;
      if (pr.vy) pr.y += pr.vy * dt;
      pr.mesh.position.set(pr.x, pr.y, pr.z);
      pr.mesh.rotation.y = pr.heading;
      let dead = pr.life <= 0;
      const wall = dg.heightAtPoint(pr.x, pr.z) > pr.y;
      if (pr.owner === 'player') {
        // trails
        if (pr.kind === 'fire') fx.puff(pr.x, pr.y, pr.z, Math.random() < 0.5 ? 0xffb347 : 0xff5a1f, 0.32, 0.25);
        else if (pr.kind === 'missile') fx.puff(pr.x, pr.y, pr.z, 0xb58cff, 0.18, 0.25);
        else if (pr.kind === 'bigarrow') fx.puff(pr.x, pr.y, pr.z, 0x9dffb0, 0.2, 0.3);
        else if (pr.kind === 'orb') {
          pr.mesh.rotation.x += dt * 3;
          if (Math.random() < 0.6) fx.puff(pr.x + (Math.random() - 0.5) * pr.radius, pr.y + (Math.random() - 0.5), pr.z + (Math.random() - 0.5) * pr.radius, 0xc0a0ff, 0.2, 0.4);
        } else if (pr.kind === 'knife') pr.mesh.children.forEach((c) => (c.rotation.y += dt * 25));
        else if (pr.kind === 'axe' || pr.kind === 'bigaxe') {
          if (pr.mesh.children[0]) pr.mesh.children[0].rotation.x += dt * 22;
          if (Math.random() < 0.5) fx.puff(pr.x, pr.y, pr.z, 0xdfe8ff, 0.2, 0.2);
        }
        // returning axes: turn around halfway and home back to the thrower's hand
        if (pr.boomerang) {
          if (!pr.returning && pr.life < pr.maxLife * 0.5) {
            pr.returning = true;
            if (pr.rehit) pr.hitSet.clear();
          }
          if (pr.returning) {
            const want = Math.atan2(p.x - pr.x, p.z - pr.z);
            pr.heading += clamp(angleDiff(pr.heading, want), -9 * dt, 9 * dt);
            pr.life = Math.max(pr.life, 0.05);
            if (Math.hypot(p.x - pr.x, p.z - pr.z) < 1.2) pr.life = -1;
          }
          if (pr.pull) {
            for (const e of this.enemies) {
              if (!e.alive || e.def.boss) continue;
              const dx = pr.x - e.x;
              const dz = pr.z - e.z;
              const d = Math.hypot(dx, dz);
              if (d < pr.pull && d > 0.3) {
                e.kx += (dx / d) * 20 * dt;
                e.kz += (dz / d) * 20 * dt;
              }
            }
          }
        }

        if (pr.tickDmg) {
          if (pr.pull) {
            for (const e of this.enemies) {
              if (!e.alive || e.def.boss) continue;
              const dx = pr.x - e.x;
              const dz = pr.z - e.z;
              const d = Math.hypot(dx, dz);
              if (d < pr.pull && d > 0.3) {
                e.kx += (dx / d) * 30 * dt;
                e.kz += (dz / d) * 30 * dt;
              }
            }
          }
          pr.tickT -= dt;
          if (pr.tickT <= 0) {
            pr.tickT = 0.25;
            this.hitEnemiesInRadius(pr.x, pr.z, pr.radius, () => ({ ...pr.tickDmg(), knock: 1 }));
          }
          if (wall || dead) {
            dead = true;
            if (pr.explodeAtEnd) this.explodeAt(pr, pr.x, pr.z);
          }
        } else {
          let hitE = null;
          for (const e of this.enemies) {
            if (!e.alive || pr.hitSet.has(e)) continue;
            if (Math.hypot(e.x - pr.x, e.z - pr.z) < e.radius + pr.radius && Math.abs(e.y + e.height * 0.5 - pr.y) < e.height * 0.5 + 0.8) {
              hitE = e;
              break;
            }
          }
          if (hitE) {
            pr.hitSet.add(hitE);
            if (pr.explode) {
              this.explodeAt(pr, pr.x, pr.z);
              dead = true;
            } else {
              this.damageEnemy(hitE, { ...pr.dmg(), knock: pr.knock }, pr.x - Math.sin(pr.heading), pr.z - Math.cos(pr.heading));
              if (pr.onHit) pr.onHit(hitE);
              fx.burst(pr.x, pr.y, pr.z, pr.kind === 'missile' ? 0xb58cff : 0xfff1c9, 5, 3, 0.08, 0.25, 3);
              if (pr.hitSet.size > pr.pierce) dead = true;
            }
          }
          if (!dead && (wall || pr.life <= 0)) {
            dead = true;
            if (pr.explode) this.explodeAt(pr, pr.x - Math.sin(pr.heading) * 0.3, pr.z - Math.cos(pr.heading) * 0.3);
            else fx.burst(pr.x, pr.y, pr.z, 0x9a8a70, 4, 2, 0.08, 0.25);
          }
        }
      } else {
        const d = Math.hypot(p.x - pr.x, p.z - pr.z);
        if (!p.dead && d < p.radius + (pr.kind === 'orb' ? 0.4 : 0.2) && pr.y > p.y - 0.2 && pr.y < p.y + 1.9) {
          if (p.takeDamage(pr.dmg, null, false)) dead = true;
        }
        if (wall) dead = true;
        if (pr.kind === 'orb' && Math.random() < 0.5) fx.puff(pr.x, pr.y, pr.z, 0xc04dff, 0.3, 0.3);
      }
      if (dead) {
        this.scene.remove(pr.mesh);
        pr.mesh.userData.dispose?.();
        this.projectiles.splice(i, 1);
      }
    }
    this.fxCtx = null;
  }

  updatePickups(dt) {
    const p = this.player;
    const dg = this.dungeon;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      pk.t += dt;
      if (pk.kind !== 'item') {
        pk.vy -= 22 * dt;
        pk.y += pk.vy * dt;
        const ground = dg.maxHeightUnder(pk.x, pk.z, 0.15) + (pk.kind === 'gold' ? 0.2 : 0.3);
        if (pk.y < ground) {
          pk.y = ground;
          pk.vy = Math.abs(pk.vy) > 2 ? -pk.vy * 0.35 : 0;
          pk.vx *= 0.6;
          pk.vz *= 0.6;
        }
      } else {
        pk.y = dg.maxHeightUnder(pk.x, pk.z, 0.15);
        pk.vx *= Math.exp(-4 * dt);
        pk.vz *= Math.exp(-4 * dt);
      }
      const tmp = { x: pk.x, z: pk.z, y: pk.y, radius: 0.2 };
      dg.move(tmp, pk.vx * dt, pk.vz * dt, true);
      pk.x = tmp.x;
      pk.z = tmp.z;

      const dx = p.x - pk.x;
      const dz = p.z - pk.z;
      const d = Math.hypot(dx, dz);
      if (pk.kind === 'gold') {
        if (pk.t > 0.4 && d < 4) {
          const s = 14 * dt;
          pk.x += (dx / (d || 1)) * s;
          pk.z += (dz / (d || 1)) * s;
          pk.y += (p.y + 0.8 - pk.y) * Math.min(1, 8 * dt);
        }
        if (pk.t > 0.4 && d < 0.6) {
          p.gold += Math.max(1, Math.round(pk.value));
          p.pw.onGold();
          sfx.coin();
          this.scene.remove(pk.mesh);
          this.pickups.splice(i, 1);
          continue;
        }
        pk.mesh.rotation.z = pk.t * 5;
      } else if (pk.kind === 'potion') {
        if (pk.t > 0.3 && d < 1.0 && Math.abs(p.y - pk.y) < 1.5) {
          p.heal(p.final.maxHp * 0.3);
          sfx.heal();
          this.effects.burst(p.x, p.y + 1, p.z, 0xff5a7a, 10, 3, 0.12, 0.5, 2);
          this.scene.remove(pk.mesh);
          this.pickups.splice(i, 1);
          continue;
        }
        pk.mesh.rotation.y = pk.t * 2;
      } else if (pk.kind === 'item') {
        pk.icon.rotation.y = pk.t * 1.8;
        pk.icon.position.y = 1.0 + Math.sin(pk.t * 3) * 0.12;
      }
      pk.mesh.position.set(pk.x, pk.y, pk.z);
    }
  }

  updateInteractables(dt) {
    const p = this.player;
    for (const c of this.chests) {
      if (c.open) {
        c.t = Math.min(1, c.t + dt * 4);
        if (c.lid) c.lid.rotation.x = -c.t * 1.75;
        continue;
      }
      if (Math.hypot(p.x - c.x, p.z - c.z) < 1.6 && p.y < (c.y || 0) + 1.5 && p.y > (c.y || 0) - 0.5) this.openChest(c);
    }
    const pt = this.portal;
    pt.ring.rotation.z += dt * (pt.active ? 2 : 0.2);
    pt.disc.rotation.z -= dt;
    if (pt.active) {
      pt.discMat.opacity = 0.55 + Math.sin(this.runTime * 4) * 0.2;
      if (Math.random() < 0.3) this.effects.puff(pt.x + (Math.random() - 0.5) * 2, 0.3, pt.z + (Math.random() - 0.5) * 2, 0xb18cff, 0.25, 0.8);
    }
    // Stepping into an open portal asks first (no more tumbling in before the room is
    // looted). "Not yet" keeps it quiet until you step out and back in.
    const inside = pt.active && !p.dead && this.state === 'play' && Math.hypot(p.x - pt.x, p.z - pt.z) < 1.6;
    if (!inside) this.portalDeclined = false;
    this.portalAsk = inside && !this.portalDeclined && !this.enterSent;
    this.ui.setPortalCard(this.portalAsk ? this.portalInfo() : null);
  }

  updatePatches(dt) {
    const p = this.player;
    for (let i = this.patches.length - 1; i >= 0; i--) {
      const f = this.patches[i];
      f.t -= dt;
      f.tick -= dt;
      if (f.tick <= 0) {
        f.tick = 0.3;
        for (const e of this.enemies) if (e.alive && Math.hypot(e.x - f.x, e.z - f.z) < 1.2 + e.radius) e.status({ burn: [2, p.final.damage * 0.3 * p.final.skillMult] });
      }
      if (Math.random() < 0.2) this.effects.puff(f.x + (Math.random() - 0.5), 0.2, f.z + (Math.random() - 0.5), 0xff8a2e, 0.25, 0.4);
      if (f.t <= 0) {
        this.scene.remove(f.mesh);
        this.patches.splice(i, 1);
      }
    }
    if (this.patchMat) this.patchMat.opacity = 0.45 + Math.sin(this.runTime * 10) * 0.1;
  }

  // ----------------------------------------------------------------- camera
  updateCamera(dt, look) {
    const cam = this.cam;
    const p = this.player;
    if (!p) return;
    const sens = this.input.isTouch ? 0.0055 : 0.0028;
    cam.yaw -= look.x * sens;
    cam.pitch = clamp(cam.pitch + look.y * sens, -0.25, 1.15);

    if (this.state === 'play' && this.input.isTouch && performance.now() - this.input.lastLookTime > 700) {
      const mv = Math.abs(this.input.moveY) * 0.3 + Math.abs(this.input.moveX) * 0.7;
      if (mv > 0.1 && !p.attack && !p.action) cam.yaw += angleDiff(cam.yaw, p.heading) * Math.min(1, dt * 1.6 * mv);
    }

    // a hero grown huge (Titan's Shell, the Giant-King's set) gets the camera pulled back
    const big = 1 + (p.mods?.size || 0) + (p.buff?.size || 0);
    const target = cam.target.set(p.x, p.y + 1.6 * big, p.z);
    const cp = Math.cos(cam.pitch);
    const dist = cam.dist * (0.6 + 0.4 * big);
    const desired = new THREE.Vector3(target.x - Math.sin(cam.yaw) * dist * cp, target.y + Math.sin(cam.pitch) * dist + 0.4, target.z - Math.cos(cam.yaw) * dist * cp);
    const frac = this.dungeon ? this.dungeon.raycastFraction(target, desired) : 1;
    // pull in quickly when something blocks the view, drift back out gently
    const want = Math.max(0.12, frac * 0.92);
    if (cam.frac === undefined) cam.frac = want;
    cam.frac += (want - cam.frac) * Math.min(1, dt * (want < cam.frac ? 22 : 2.5));
    desired.sub(target).multiplyScalar(cam.frac).add(target);
    if (desired.y < 0.4) desired.y = 0.4;
    cam.pos.lerp(desired, Math.min(1, dt * 18));
    // widen the view a touch when dashing or sprinting
    const fovT = 62 + (p.dashTime > 0 ? 7 : 0) + Math.min(3, p.speed * 0.3);
    if (Math.abs(this.camera.fov - fovT) > 0.05) {
      this.camera.fov += (fovT - this.camera.fov) * Math.min(1, dt * (p.dashTime > 0 ? 14 : 4));
      this.camera.updateProjectionMatrix();
    }
    this.camera.position.copy(cam.pos);
    const sh = this.effects.shakeAmt;
    if (sh > 0) this.camera.position.add(new THREE.Vector3((Math.random() - 0.5) * sh * 0.5, (Math.random() - 0.5) * sh * 0.5, (Math.random() - 0.5) * sh * 0.5));
    this.camera.lookAt(target.x + Math.sin(cam.yaw) * 1.5, target.y + 0.2, target.z + Math.cos(cam.yaw) * 1.5);
  }

  // ---------------------------------------------------------- state changes
  // fromNet: the host acting on a client's request, or a client told to move on.
  enterPortal(fromNet = false) {
    const net = this.net;
    this.portalAsk = false;
    this.ui.setPortalCard(null);
    if (net.isClient && !fromNet) {
      // clients ask the host; everyone moves on together
      if (!this.enterSent) {
        this.enterSent = true;
        net.send('enter');
        this.ui.toast('Portal! Taking the party down…', 2);
      }
      return;
    }
    if (this.state !== 'play' && !fromNet) return;
    if (net.isHost && net.live) {
      this.nextSeed = (Math.random() * 2 ** 31) | 0;
      net.broadcast('next', { f: this.floor + 1, seed: this.nextSeed });
    }
    if (this.state === 'upgrade' || this.state === 'skillpick') return;
    this.ui.hidePause?.();
    sfx.portal();
    this.state = 'upgrade';
    this.input.reset();
    if (document.pointerLockElement) document.exitPointerLock();
    this.rerolls = 0;
    this.shrine = rollBlessings(this.player, 2).map((b) => ({ b, sold: false }));
    this.offerRewards(false);
    this.saveRun();
  }

  // ------------------------------------------------------------ save / resume
  // Solo runs only (a multiplayer world belongs to the host's session).
  saveRun() {
    if (!this.inRun || this.net.mode || !this.dungeon || !this.player || this.state === 'dead' || this.player.dead) return;
    const p = this.player;
    writeSave({
      cls: p.clsId,
      floor: this.floor,
      seed: this.floorSeed,
      reward: this.state === 'upgrade' ? 1 : 0,
      shards: this.runShards || 0,
      won: this.won ? 1 : 0,
      used: (this.events || []).filter((e) => e.used).map((e) => e.i),
      runTime: this.runTime,
      killed: [...this.killedKeys],
      chests: [...this.openedChests],
      pots: [...this.brokenPots],
      loot: this.pickups.filter((pk) => pk.kind === 'item').map((pk) => ({ x: pk.x, z: pk.z, item: packItem(pk.item) })),
      p: {
        x: p.x,
        z: p.z,
        h: p.heading,
        hp: p.hp,
        gold: p.gold,
        kills: p.kills,
        sw: p.secondWindUsed ? 1 : 0,
        skills: p.skills,
        up: p.upgradeCounts,
        eq: { weapon: packItem(p.equipment.weapon), armor: packItem(p.equipment.armor), charm: packItem(p.equipment.charm) },
      },
    });
  }

  resumeRun(s = readSave()) {
    if (!s) return false;
    this.inRun = true;
    this.combo = 0;
    this.comboT = 0;
    this.bestCombo = 0;
    this.catchUp = 0;
    this.arena = false;
    this.setPlayer(new Player(this, s.cls));
    const p = this.player;
    this.runShards = s.shards || 0;
    this.won = !!s.won;
    this.applyForge(p, false);
    p.secondWindUsed = !!s.p.sw;
    replayBlessings(p, s.p.up);
    for (const slot of ['weapon', 'armor', 'charm']) p.equipment[slot] = unpackItem(s.p.eq?.[slot]);
    if (!p.equipment.weapon) this.giveStarterWeapon(p);
    p.recompute();
    p.dress();
    p.skills = (s.p.skills || [null, null, null, null]).map((k) => (k && k.id ? { id: k.id, level: k.level } : null));
    p.gold = s.p.gold || 0;
    p.kills = s.p.kills || 0;
    this.runTime = s.runTime || 0;
    this.loadFloor(s.floor, false, s.seed, s);
    // back where the hero stood (the level is rebuilt identically from the seed)
    if (typeof s.p.x === 'number' && !this.dungeon.blocked(s.p.x, s.p.z, p.radius, 1)) {
      p.x = s.p.x;
      p.z = s.p.z;
      p.heading = s.p.h || 0;
      this.cam.yaw = p.heading;
      this.cam.pos.set(p.x - Math.sin(p.heading) * 6, 4, p.z - Math.cos(p.heading) * 6);
    }
    p.hp = Math.max(1, Math.min(p.final.maxHp, s.p.hp ?? p.final.maxHp));
    for (const l of s.loot || []) {
      const pk = this.dropItem(l.x, l.z, unpackItem(l.item));
      pk.vx = pk.vz = 0;
    }
    if (this.bossName ? !this.enemies.some((e) => e.alive && e.def.boss) : !this.enemies.some((e) => e.alive && !e.disguised && !e.dormant)) {
      this.floorCleared = true;
      this.activatePortal(true);
    }
    this.ui.showHUD();
    this.input.reset();
    if (s.reward) {
      // closed on the reward screen: pick up right there
      this.state = 'upgrade';
      this.rerolls = 0;
      this.shrine = rollBlessings(p, 2).map((b) => ({ b, sold: false }));
      this.offerRewards(false);
    } else if (!p.skills.some(Boolean)) {
      this.state = 'skillpick';
      this.offerRewards(true);
    } else this.state = 'play';
    this.ui.refreshSkills(p);
    this.ui.toast(`Welcome back — floor ${this.floor}`, 2.2);
    return true;
  }

  // Client: the host moved the party to the next floor.
  beginNextFloor(f, seed) {
    if (!this.inRun || this.state === 'dead') return;
    this.nextSeed = seed;
    this.nextFloor = f;
    if (this.state === 'upgrade' || this.state === 'skillpick') return;
    if (this.player.dead) this.revivePlayer();
    this.enterPortal(true);
  }

  // Skill choices: a new skill (while a swipe slot is free), a level-up, or
  // an evolution for a skill that has reached level 5.
  skillOffers(first) {
    const p = this.player;
    const pool = p.cls.skills;
    const free = p.skills.includes(null);
    const news = free ? pool.filter((id) => !p.skillLevel(id)) : [];
    const ups = p.skills.filter((s) => s && s.level < MAX_SKILL_LEVEL).map((s) => s.id);
    const evos = p.skills.filter((s) => s && s.level === MAX_SKILL_LEVEL && SKILLS[s.id].evo).map((s) => s.id);
    const mk = (id) => {
      const lv = p.skillLevel(id);
      const kind = lv === MAX_SKILL_LEVEL ? 'evo' : lv ? 'up' : 'new';
      return { id, def: skillDef(id, lv + 1), base: SKILLS[id], kind, from: lv, to: lv + 1, slot: lv ? p.skills.findIndex((s) => s && s.id === id) : p.skills.indexOf(null) };
    };
    if (first) return news.map(mk);
    shuffle(news);
    shuffle(ups);
    shuffle(evos);
    const out = [];
    if (evos.length) out.push(evos.shift());
    if (news.length) out.push(news.shift());
    if (ups.length) out.push(ups.shift());
    const rest = shuffle([...news, ...ups, ...evos]);
    while (out.length < 3 && rest.length) out.push(rest.shift());
    return shuffle(out.slice(0, 3)).map(mk);
  }

  offerRewards(first, keep = null, advance = !first) {
    const p = this.player;
    const offers = keep || this.skillOffers(first);
    this.currentOffers = offers;
    const healCost = 20 + this.floor * 8;
    const rerollCost = 15 + this.floor * 5 + (this.rerolls || 0) * 10;
    const blessingCost = 30 + this.floor * 12;
    const proceed = () => {
      this.ui.hideSkillPick();
      // joining mid-run: one more pick per floor the party already cleared
      if (this.catchUp > 0) {
        this.catchUp--;
        this.shrine = rollBlessings(p, 2).map((b) => ({ b, sold: false }));
        this.offerRewards(false, null, false);
        return;
      }
      if (advance) this.loadFloor(this.nextFloor ?? this.floor + 1, false, this.nextSeed);
      this.nextFloor = null;
      this.state = 'play';
      this.saveRun();
      this.input.reset();
      this.ui.refreshSkills(p);
      if (first) {
        const slot = p.skills.findIndex(Boolean);
        const key = ['Q', 'E', 'R', 'C'][slot];
        const arrow = ['↑', '→', '↓', '←'][slot];
        setTimeout(() => this.state === 'play' && this.ui.toast(this.input.isTouch ? `Swipe ⚔ ${arrow} to use ${SKILLS[p.skills[slot].id].name}` : `Press ${key} to use ${SKILLS[p.skills[slot].id].name}`, 3), 2600);
      }
    };
    this.ui.showSkillPick({
      first,
      floor: this.floor,
      offers,
      player: p,
      gold: p.gold,
      healCost,
      rerollCost,
      blessingCost,
      shrine: first ? [] : this.shrine,
      hpFull: p.hp >= p.final.maxHp,
      onPick: (o) => {
        const slot = p.learnSkill(o.id);
        sfx.pickup();
        this.ui.toast(o.kind === 'new' ? `Learned ${o.def.name}` : o.kind === 'evo' ? `✦ ${o.base.name} evolved into ${o.def.name}! ✦` : `${o.def.name} → Lv ${o.to}`, 2.2, o.kind === 'evo' ? '#ffcf5a' : null);
        if (o.kind === 'evo') sfx.portal();
        void slot;
        proceed();
      },
      onSkip: offers.length ? null : proceed,
      onBuy: (entry) => {
        if (entry.sold || p.gold < blessingCost) return;
        p.gold -= blessingCost;
        p.applyUpgrade(entry.b);
        entry.sold = true;
        sfx.heal();
        this.offerRewards(first, offers, advance);
      },
      onHeal: () => {
        if (p.gold < healCost || p.hp >= p.final.maxHp) return;
        p.gold -= healCost;
        p.hp = p.final.maxHp;
        sfx.heal();
        this.offerRewards(first, offers, advance);
      },
      onReroll: () => {
        if (p.gold < rerollCost) return;
        p.gold -= rerollCost;
        this.rerolls = (this.rerolls || 0) + 1;
        sfx.ui();
        this.offerRewards(first, null, advance);
      },
    });
  }

  pause() {
    if (this.state !== 'play') return;
    this.state = 'pause';
    this.input.reset();
    if (document.pointerLockElement) document.exitPointerLock();
    this.ui.showPause(this);
  }

  resume() {
    if (this.state !== 'pause') return;
    this.ui.hidePause();
    this.state = 'play';
    this.input.reset();
  }

  showDeath(retired = false) {
    if (!this.net.mode) clearSave();
    const p = this.player;
    const won = !!this.won;
    const bank = this.bankRun(won);
    const best = loadBest();
    const newBest = this.floor > best.floor || (this.floor === best.floor && p.kills > best.kills);
    if (newBest) saveBest({ floor: this.floor, kills: p.kills, cls: p.clsId });
    if (document.pointerLockElement) document.exitPointerLock();
    const n = this.net;
    const mp = n.isHost && n.live ? 'Your party fell. Play again to start a new run together.' : n.isClient ? 'Your party fell. Pick a hero with Play again to join the host\'s next run.' : '';
    this.ui.showDeath({ floor: this.floor, kills: p.kills, gold: p.gold, time: this.runTime, cls: p.cls.name, newBest, best: newBest ? { floor: this.floor, kills: p.kills } : best, mp, shards: bank, won, retired });
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.pointScale = (h * this.renderer.getPixelRatio()) / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
  }

  render() {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  worldToTile(x) {
    return Math.floor(x / T);
  }
}

installRunFeatures(Game);
installPvp(Game);
