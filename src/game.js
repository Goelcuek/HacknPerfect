// Game world: owns the dungeon, player, enemies, projectiles, loot and camera,
// and routes combat between them.

import * as THREE from 'three';
import { Dungeon, T } from './dungeon.js';
import { Player } from './player.js';
import { Enemy, ENEMY_TYPES } from './enemies.js';
import { Effects } from './effects.js';
import { generateItem, rollUpgrades, itemScore } from './items.js';
import { sfx } from './audio.js';
import { clamp, angleDiff, rng } from './utils.js';

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

export class Game {
  constructor(renderer, ui, input) {
    this.renderer = renderer;
    this.ui = ui;
    this.input = input;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 120);
    this.cam = { yaw: 0, pitch: 0.38, dist: 6.2, pos: new THREE.Vector3(), target: new THREE.Vector3() };
    this.effects = new Effects(this.scene, this.camera, document.getElementById('numbers'));

    this.hemi = new THREE.HemisphereLight(0x9fb0d0, 0x302020, 1.4);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0dd, 0.7);
    this.sun.position.set(0.4, 1, 0.25);
    this.scene.add(this.sun);
    this.playerLight = new THREE.PointLight(0xffc68a, 4, 16, 1.2);
    this.scene.add(this.playerLight);

    this.state = 'title';
    this.hitStopT = 0;
    this.tipsShown = {};
  }

  // ------------------------------------------------------------------ run
  startRun() {
    this.player = new Player(this);
    this.scene.add(this.player.mesh);
    this.scene.add(this.player.shadow);
    // starter weapon so the gear screen isn't empty
    this.player.equip({ slot: 'weapon', rarity: { id: 'common', name: 'Common', color: '#d8d8d8', hex: 0xd8d8d8 }, name: 'Rusty Sword', stats: { damage: 2 }, level: 1 });
    this.player.hp = this.player.final.maxHp;
    this.floor = 0;
    this.runTime = 0;
    this.loadFloor(1);
    this.state = 'play';
  }

  clearFloor() {
    if (this.dungeon) {
      this.scene.remove(this.dungeon.group);
      this.dungeon.dispose();
    }
    for (const list of [this.enemies, this.projectiles, this.pickups, this.chests, this.pots, this.patches]) {
      if (!list) continue;
      for (const o of list) if (o.mesh) this.scene.remove(o.mesh);
    }
    if (this.portal) this.scene.remove(this.portal.mesh);
    this.effects.clear();
  }

  loadFloor(n) {
    this.clearFloor();
    this.floor = n;
    const dg = new Dungeon(n, (Math.random() * 2 ** 31) | 0);
    this.dungeon = dg;
    this.scene.add(dg.buildMeshes());
    const th = dg.theme;
    this.scene.background = new THREE.Color(th.fog);
    this.scene.fog = new THREE.Fog(th.fog, 16, 46);
    this.hemi.color.setHex(0x9fb0d0).lerp(new THREE.Color(th.accent), 0.15);

    this.enemies = [];
    this.projectiles = [];
    this.pickups = [];
    this.chests = [];
    this.pots = [];
    this.patches = [];
    this.floorCleared = false;
    this.boss = null;

    const p = this.player;
    const s = dg.worldCenter(dg.startRoom);
    p.resetState();
    p.x = s.x;
    p.z = s.z;
    // face toward the level's centre
    const ex = dg.worldCenter(dg.exitRoom);
    p.heading = Math.atan2(ex.x - s.x, ex.z - s.z);
    this.cam.yaw = p.heading;
    this.cam.pitch = 0.38;
    this.cam.pos.set(p.x - Math.sin(p.heading) * 6, 4, p.z - Math.cos(p.heading) * 6);

    for (const sp of dg.spawns) this.spawnEnemy(sp.type, sp.x, sp.z, false, sp.elite);
    for (const c of dg.chests) this.spawnChest(c.x, c.z);
    for (const pt of dg.pots) this.spawnPot(pt.x, pt.z);
    this.spawnPortal(ex.x, ex.z);
    this.flowTimer = 0;
    this.revealTimer = 0;

    this.ui.toast(dg.isBoss ? `Floor ${n} — ☠ Boss Lair ☠` : `Floor ${n} — ${th.name}`, 2.5);
    if (n === 1) {
      setTimeout(() => this.ui.toast(this.input.isTouch ? 'Swipe the ⚔ button to use skills' : 'Q / E / R / C — skills · Shift — dash', 3.5), 2600);
    }
  }

  // --------------------------------------------------------------- spawning
  spawnEnemy(type, x, z, aggro = false, elite = false) {
    const e = new Enemy(this, type, x, z, this.floor, elite);
    e.aggro = aggro;
    this.enemies.push(e);
    this.scene.add(e.mesh);
    if (ENEMY_TYPES[type].boss) {
      this.boss = e;
      e.aggro = false;
    }
    return e;
  }

  spawnChest(x, z, rich = false) {
    const g = new THREE.Group();
    const wood = new THREE.MeshLambertMaterial({ color: rich ? 0x5a3d8a : 0x7a4f25 });
    const trim = new THREE.MeshLambertMaterial({ color: 0xe8c14a, emissive: 0x332200 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.6, 0.75), wood);
    base.position.y = 0.3;
    g.add(base);
    const lid = new THREE.Group();
    lid.position.set(0, 0.6, -0.37);
    const lidM = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.28, 0.77), wood);
    lidM.position.set(0, 0.14, 0.37);
    lid.add(lidM);
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.06), trim);
    lock.position.set(0, 0.05, 0.77);
    lid.add(lock);
    g.add(lid);
    const band = new THREE.Mesh(new THREE.BoxGeometry(1.14, 0.08, 0.79), trim);
    band.position.y = 0.55;
    g.add(band);
    g.position.set(x, 0, z);
    g.rotation.y = rng.next() * Math.PI * 2;
    this.scene.add(g);
    this.chests.push({ x, z, mesh: g, lid, open: false, rich, t: 0 });
  }

  spawnPot(x, z) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.2, 0.6, 8), new THREE.MeshLambertMaterial({ color: 0x9a6b45 }));
    m.position.set(x, 0.3, z);
    this.scene.add(m);
    this.pots.push({ x, z, mesh: m });
  }

  spawnPortal(x, z) {
    const g = new THREE.Group();
    const ringMat = new THREE.MeshLambertMaterial({ color: 0x555566, emissive: 0x000000 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.18, 8, 32), ringMat);
    ring.position.y = 1.5;
    g.add(ring);
    const discMat = new THREE.MeshBasicMaterial({ color: 0x222233, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.15, 32), discMat);
    disc.position.y = 1.5;
    g.add(disc);
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.8, 0.15, 24), new THREE.MeshLambertMaterial({ color: 0x3a3a48 }));
    pad.position.y = 0.07;
    g.add(pad);
    g.position.set(x, 0, z);
    this.scene.add(g);
    const light = new THREE.PointLight(0x9d7dff, 0, 10, 1.5);
    light.position.set(0, 1.8, 0);
    g.add(light);
    this.portal = { x, z, mesh: g, ring, ringMat, disc, discMat, light, active: false };
  }

  activatePortal() {
    const pt = this.portal;
    pt.active = true;
    pt.ringMat.color.setHex(0xb18cff);
    pt.ringMat.emissive.setHex(0x5a2fbf);
    pt.discMat.color.setHex(0x9d7dff);
    pt.light.intensity = 6;
    sfx.portal();
    this.ui.toast(this.dungeon.isBoss ? 'The Warden falls! Portal open' : 'Floor cleared! Find the portal ✦', 2.5);
  }

  dropGold(x, z, amount) {
    const coins = Math.min(8, Math.max(1, Math.round(amount / 4)));
    const per = amount / coins;
    for (let i = 0; i < coins; i++) {
      const m = new THREE.Mesh(this.coinGeo || (this.coinGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.05, 10)), this.coinMat || (this.coinMat = new THREE.MeshLambertMaterial({ color: 0xffd34d, emissive: 0x664400 })));
      m.rotation.x = Math.PI / 2;
      const a = rng.next() * Math.PI * 2;
      const s = 2 + rng.next() * 3;
      const pk = { kind: 'gold', value: per, x, y: 0.8, z, vx: Math.cos(a) * s, vy: 5 + rng.next() * 3, vz: Math.sin(a) * s, mesh: m, t: 0 };
      m.position.set(x, 0.8, z);
      this.scene.add(m);
      this.pickups.push(pk);
    }
  }

  dropPotion(x, z) {
    const g = new THREE.Group();
    const bottle = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8), new THREE.MeshLambertMaterial({ color: 0xff3b5c, emissive: 0x551020 }));
    g.add(bottle);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.18, 6), new THREE.MeshLambertMaterial({ color: 0xcccccc }));
    neck.position.y = 0.28;
    g.add(neck);
    g.position.set(x, 0.5, z);
    this.scene.add(g);
    this.pickups.push({ kind: 'potion', x, y: 0.5, z, vx: 0, vy: 4, vz: 0, mesh: g, t: 0 });
  }

  dropItem(x, z, item) {
    const g = new THREE.Group();
    const color = item.rarity.hex;
    let icon;
    if (item.slot === 'weapon') {
      icon = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 0.06), new THREE.MeshLambertMaterial({ color, emissive: new THREE.Color(color).multiplyScalar(0.4) }));
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.07, 0.07), new THREE.MeshLambertMaterial({ color: 0x333333 }));
      guard.position.y = -0.3;
      icon.add(guard);
    } else if (item.slot === 'armor') {
      icon = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.6, 0.25), new THREE.MeshLambertMaterial({ color, emissive: new THREE.Color(color).multiplyScalar(0.3) }));
    } else {
      icon = new THREE.Mesh(new THREE.OctahedronGeometry(0.3), new THREE.MeshLambertMaterial({ color, emissive: new THREE.Color(color).multiplyScalar(0.5) }));
    }
    icon.position.y = 1.0;
    g.add(icon);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.3, 4, 8, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    beam.position.y = 2;
    g.add(beam);
    const a = rng.next() * Math.PI * 2;
    const pk = { kind: 'item', item, x, y: 0, z, vx: Math.cos(a) * 2.5, vy: 0, vz: Math.sin(a) * 2.5, mesh: g, icon, t: 0 };
    g.position.set(x, 0, z);
    this.scene.add(g);
    this.pickups.push(pk);
    if (item.rarity.id === 'legendary' || item.rarity.id === 'epic') this.effects.ring(x, z, 2, color, 0.6);
    return pk;
  }

  spawnBolt(x, y, z, heading, dmg, target) {
    const m = new THREE.Mesh(this.boltGeo || (this.boltGeo = new THREE.IcosahedronGeometry(0.28, 0)), this.boltMat || (this.boltMat = new THREE.MeshBasicMaterial({ color: 0xff7a2e })));
    m.position.set(x, y, z);
    this.scene.add(m);
    this.projectiles.push({ owner: 'player', kind: 'bolt', x, y, z, heading, speed: 22, dmg, target, life: 1.4, mesh: m });
  }

  spawnEnemyProjectile(x, y, z, heading, speed, dmg, kind) {
    let m;
    if (kind === 'arrow') {
      m = new THREE.Mesh(this.arrowGeo || (this.arrowGeo = new THREE.BoxGeometry(0.06, 0.06, 0.8)), this.arrowMat || (this.arrowMat = new THREE.MeshBasicMaterial({ color: 0xfff1c9 })));
    } else {
      m = new THREE.Mesh(this.orbGeo || (this.orbGeo = new THREE.SphereGeometry(0.35, 10, 8)), this.orbMat || (this.orbMat = new THREE.MeshBasicMaterial({ color: 0xc04dff })));
    }
    m.position.set(x, y, z);
    m.rotation.y = heading;
    this.scene.add(m);
    this.projectiles.push({ owner: 'enemy', kind, x, y, z, heading, speed, dmg, life: 3, mesh: m });
  }

  spawnFirePatch(x, z) {
    if (!this.patchGeo) {
      this.patchGeo = new THREE.CircleGeometry(0.9, 12);
      this.patchMat = new THREE.MeshBasicMaterial({ color: 0xff6a1a, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
    }
    const m = new THREE.Mesh(this.patchGeo, this.patchMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.06, z);
    this.scene.add(m);
    this.patches.push({ x, z, t: 2.0, tick: 0, mesh: m });
  }

  // Ground shockwave: hurts the player only if they are on the ground — jump over it!
  shockwave(x, z, r, dmg, src, big = false) {
    const fx = this.effects;
    fx.ring(x, z, r, big ? 0xc04dff : 0xff9955, 0.4);
    fx.ring(x, z, r * 0.6, 0xffffff, 0.3);
    fx.burst(x, 0.2, z, 0x8a7a60, big ? 30 : 16, big ? 10 : 7, 0.2, 0.6);
    fx.shake(big ? 0.6 : 0.35);
    sfx.slam();
    const p = this.player;
    const d = Math.hypot(p.x - x, p.z - z);
    const ground = this.dungeon.maxHeightUnder(p.x, p.z, p.radius);
    if (d < r + p.radius && p.y - ground < 0.5) {
      if (p.takeDamage(dmg, src, true)) {
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
      if (!e.alive) continue;
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
    for (const e of this.enemies.slice()) {
      if (!e.alive) continue;
      if (Math.hypot(e.x - x, e.z - z) > r + e.radius) continue;
      const res = fn(e);
      if (res) this.damageEnemy(e, res, x, z);
    }
    // breakables
    for (let i = this.pots.length - 1; i >= 0; i--) {
      const pt = this.pots[i];
      if (Math.hypot(pt.x - x, pt.z - z) < r + 0.3) this.breakPot(i);
    }
  }

  damageEnemy(e, hit, fromX, fromZ) {
    if (!e.alive) return;
    const p = this.player;
    let amount = hit.amount;
    if (p.mods.execute > 0 && e.hp < e.maxHp * 0.3) amount *= 1 + p.mods.execute;
    amount = Math.max(1, Math.round(amount));
    e.hp -= amount;
    e.flash = 0.09;
    e.aggro = true;
    const heavy = e.def.heavy;
    if (hit.knock) {
      const dx = e.x - fromX;
      const dz = e.z - fromZ;
      const d = Math.hypot(dx, dz) || 1;
      const k = hit.knock * (e.def.boss ? 0.05 : heavy ? 0.35 : 1);
      e.kx += (dx / d) * k * 2;
      e.kz += (dz / d) * k * 2;
      if (!e.def.boss) e.stun = Math.max(e.stun, heavy ? 0.06 : 0.22);
      // interrupt a windup on light enemies
      if (!heavy && e.state === 'windup' && hit.knock >= 4) {
        e.state = 'recover';
        e.stateT = 0;
      }
    }
    if (hit.launch && !heavy) e.vy = hit.launch;
    if (!hit.silent) {
      this.effects.burst(e.x, e.y + e.height * 0.5, e.z, hit.crit ? 0xffe066 : 0xff5040, hit.crit ? 12 : 6, 5, 0.12, 0.35);
      if (hit.crit) sfx.crit();
      else sfx.hit();
      if (hit.crit) this.hitStop(0.035);
      if (p.final.lifesteal > 0) p.heal(amount * p.final.lifesteal, false);
    }
    this.effects.damageNumber(e.x, e.y + e.height + 0.3, e.z, String(amount), hit.crit ? 'crit' : hit.silent ? 'dot' : '');
    if (e.hp <= 0) this.killEnemy(e);
  }

  killEnemy(e) {
    e.alive = false;
    this.scene.remove(e.mesh);
    e.dispose();
    const p = this.player;
    p.kills++;
    this.effects.burst(e.x, e.y + e.height * 0.5, e.z, e.def.color, 18, 6, 0.2, 0.7);
    sfx.enemyDie();
    const [g0, g1] = e.def.gold;
    const gold = (g0 + rng.next() * (g1 - g0)) * (1 + this.floor * 0.15) * (e.elite ? 3 : 1) * p.final.goldMult;
    this.dropGold(e.x, e.z, Math.round(gold));
    if (e.def.boss) {
      for (let i = 0; i < 3; i++) this.dropItem(e.x, e.z, generateItem(this.floor, 6, 2));
      this.dropPotion(e.x, e.z);
      this.effects.shake(1);
      this.hitStop(0.25);
      this.boss = null;
      // the Warden's summons crumble with it
      for (const m of this.enemies) {
        if (m === e || !m.alive) continue;
        m.alive = false;
        this.scene.remove(m.mesh);
        m.dispose();
        this.effects.burst(m.x, m.y + m.height * 0.5, m.z, m.def.color, 12, 5, 0.2, 0.6);
      }
      this.enemies = [e];
    } else {
      const itemChance = e.elite ? 0.7 : e.def.heavy ? 0.22 : 0.09;
      if (rng.next() < itemChance) this.dropItem(e.x, e.z, generateItem(this.floor, e.elite ? 3 : 0, e.elite ? 1 : 0));
      if (rng.next() < 0.07) this.dropPotion(e.x, e.z);
    }
    this.enemies = this.enemies.filter((x) => x !== e);
    if (!this.floorCleared && this.enemies.length === 0) {
      this.floorCleared = true;
      this.activatePortal();
    }
  }

  alertNearby(src) {
    for (const e of this.enemies) if (!e.aggro && Math.hypot(e.x - src.x, e.z - src.z) < 9) e.aggro = true;
  }

  breakPot(i) {
    const pt = this.pots[i];
    this.pots.splice(i, 1);
    this.scene.remove(pt.mesh);
    this.effects.burst(pt.x, 0.4, pt.z, 0x9a6b45, 10, 4, 0.15, 0.5);
    sfx.hit();
    const r = rng.next();
    if (r < 0.55) this.dropGold(pt.x, pt.z, Math.round((3 + this.floor * 2) * this.player.final.goldMult));
    else if (r < 0.75) this.dropPotion(pt.x, pt.z);
  }

  openChest(c) {
    c.open = true;
    sfx.pickup();
    this.effects.burst(c.x, 0.8, c.z, 0xffd34d, 20, 6, 0.15, 0.7);
    this.dropGold(c.x, c.z, Math.round((12 + this.floor * 6) * this.player.final.goldMult * (c.rich ? 3 : 1)));
    const n = c.rich ? 2 : 1;
    for (let i = 0; i < n; i++) this.dropItem(c.x, c.z, generateItem(this.floor, c.rich ? 5 : 2, 1));
    if (rng.next() < 0.4) this.dropPotion(c.x, c.z);
  }

  hitStop(t) {
    this.hitStopT = Math.max(this.hitStopT, t);
  }

  // ----------------------------------------------------------------- update
  update(rawDt) {
    if (this.state !== 'play') {
      this.updateCamera(rawDt, { x: 0, y: 0 });
      return;
    }
    const input = this.input;
    input.poll();
    let dt = rawDt;
    if (this.hitStopT > 0) {
      this.hitStopT -= rawDt;
      dt = rawDt * 0.08;
    }
    this.runTime += rawDt;
    const look = input.consumeLook();
    this.updateCamera(rawDt, look);

    const p = this.player;
    if (!p.dead) p.update(dt, input, this.cam);
    const dg = this.dungeon;

    // flow field for pathing, fog-of-war reveal
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

    // enemies
    for (const e of this.enemies.slice()) if (e.alive) e.update(dt, this);
    this.separateEnemies();

    this.updateProjectiles(dt);
    this.updatePickups(dt);
    this.updateInteractables(dt);
    this.updatePatches(dt);
    this.effects.update(dt);

    this.playerLight.position.set(p.x, p.y + 3, p.z);

    // item near the player?
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
    this.ui.setItemCard(this.nearItem ? this.nearItem.item : null, this.nearItem ? p.equipment[this.nearItem.item.slot] : null);
    if (input.pressed.interact && this.nearItem) this.equipNearItem();

    if (input.pressed.pause) this.pause();

    if (p.dead && this.state === 'play') {
      this.state = 'dead';
      setTimeout(() => this.showDeath(), 1200);
    }
    input.endFrame();
  }

  equipNearItem() {
    const pk = this.nearItem;
    if (!pk) return;
    const p = this.player;
    const old = p.equip(pk.item);
    this.scene.remove(pk.mesh);
    this.pickups = this.pickups.filter((x) => x !== pk);
    sfx.pickup();
    this.effects.burst(p.x, p.y + 1, p.z, pk.item.rarity.hex, 14, 4, 0.12, 0.5, 2);
    this.ui.toast(`Equipped ${pk.item.name}`, 1.4, pk.item.rarity.color);
    if (old) {
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
    this.scene.remove(pk.mesh);
    this.pickups = this.pickups.filter((x) => x !== pk);
    sfx.coin();
    this.ui.toast(`Salvaged for ${val} gold`, 1.2, '#ffd34d');
    this.nearItem = null;
  }

  separateEnemies() {
    const es = this.enemies;
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
          dg.move(a, -ax, -az, false);
          dg.move(b, ax, az, false);
        }
      }
      // keep enemies from standing inside the player (unless the player is above)
      const dx = a.x - p.x;
      const dz = a.z - p.z;
      const min = a.radius + p.radius;
      const d = Math.hypot(dx, dz);
      if (d < min && d > 1e-4 && Math.abs(p.y - (a.y - (a.def.hover || 0))) < 1) dg.move(a, (dx / d) * (min - d), (dz / d) * (min - d), false);
    }
  }

  updateProjectiles(dt) {
    const dg = this.dungeon;
    const p = this.player;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.life -= dt;
      if (pr.owner === 'player' && pr.target && pr.target.alive) {
        // gentle homing
        const want = Math.atan2(pr.target.x - pr.x, pr.target.z - pr.z);
        pr.heading += clamp(angleDiff(pr.heading, want), -4 * dt, 4 * dt);
      }
      pr.x += Math.sin(pr.heading) * pr.speed * dt;
      pr.z += Math.cos(pr.heading) * pr.speed * dt;
      pr.mesh.position.set(pr.x, pr.y, pr.z);
      pr.mesh.rotation.y = pr.heading;
      let dead = pr.life <= 0;
      const wall = dg.heightAtPoint(pr.x, pr.z) > pr.y;
      if (pr.owner === 'player') {
        if (Math.random() < 0.8) this.effects.puff(pr.x, pr.y, pr.z, Math.random() < 0.5 ? 0xffb347 : 0xff5a1f, 0.35, 0.25);
        let hit = wall;
        if (!hit)
          for (const e of this.enemies) {
            if (e.alive && Math.hypot(e.x - pr.x, e.z - pr.z) < e.radius + 0.45 && Math.abs(e.y + e.height * 0.5 - pr.y) < e.height * 0.5 + 0.8) {
              hit = true;
              break;
            }
          }
        if (hit || dead) {
          dead = true;
          this.effects.burst(pr.x, pr.y, pr.z, 0xff7a2e, 16, 6, 0.18, 0.45, 4);
          this.effects.ring(pr.x, pr.z, 2.4, 0xff9a3d, 0.3, 0.1);
          sfx.boom();
          const px = pr.x - Math.sin(pr.heading) * 0.3;
          const pz = pr.z - Math.cos(pr.heading) * 0.3;
          this.hitEnemiesInRadius(px, pz, 2.4, (e) => {
            e.burn = Math.max(e.burn, 1.5);
            e.burnDmg = p.final.damage * 0.15 * p.final.skillMult;
            return { ...pr.dmg, knock: 5 };
          });
        }
      } else {
        const d = Math.hypot(p.x - pr.x, p.z - pr.z);
        if (!p.dead && d < p.radius + (pr.kind === 'orb' ? 0.4 : 0.2) && pr.y > p.y - 0.2 && pr.y < p.y + 1.9) {
          if (p.takeDamage(pr.dmg, null, false)) dead = true;
        }
        if (wall) dead = true;
        if (pr.kind === 'orb' && Math.random() < 0.5) this.effects.puff(pr.x, pr.y, pr.z, 0xc04dff, 0.3, 0.3);
      }
      if (dead) {
        this.scene.remove(pr.mesh);
        this.projectiles.splice(i, 1);
      }
    }
  }

  updatePickups(dt) {
    const p = this.player;
    const dg = this.dungeon;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      pk.t += dt;
      // physics bounce for freshly dropped loot
      if (pk.kind !== 'item') {
        pk.vy -= 22 * dt;
        pk.y += pk.vy * dt;
        const ground = dg.maxHeightUnder(pk.x, pk.z, 0.15) + (pk.kind === 'gold' ? 0.2 : 0.35);
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
          // magnet
          const s = 14 * dt;
          pk.x += (dx / (d || 1)) * s;
          pk.z += (dz / (d || 1)) * s;
          pk.y += (p.y + 0.8 - pk.y) * Math.min(1, 8 * dt);
        }
        if (pk.t > 0.4 && d < 0.6) {
          p.gold += Math.max(1, Math.round(pk.value));
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
      pk.mesh.position.set(pk.x, pk.kind === 'item' ? pk.y : pk.y, pk.z);
    }
  }

  updateInteractables(dt) {
    const p = this.player;
    for (const c of this.chests) {
      if (c.open) {
        c.t = Math.min(1, c.t + dt * 4);
        c.lid.rotation.x = -c.t * 1.9;
        continue;
      }
      if (Math.hypot(p.x - c.x, p.z - c.z) < 1.6 && p.y < 1.5) this.openChest(c);
    }
    const pt = this.portal;
    pt.ring.rotation.z += dt * (pt.active ? 2 : 0.2);
    pt.disc.rotation.z -= dt;
    if (pt.active) {
      pt.discMat.opacity = 0.55 + Math.sin(this.runTime * 4) * 0.2;
      if (Math.random() < 0.3) this.effects.puff(pt.x + (Math.random() - 0.5) * 2, 0.3, pt.z + (Math.random() - 0.5) * 2, 0xb18cff, 0.25, 0.8);
      if (Math.hypot(p.x - pt.x, p.z - pt.z) < 1.6 && !p.dead) this.enterPortal();
    }
  }

  updatePatches(dt) {
    const p = this.player;
    for (let i = this.patches.length - 1; i >= 0; i--) {
      const f = this.patches[i];
      f.t -= dt;
      f.tick -= dt;
      if (f.tick <= 0) {
        f.tick = 0.3;
        for (const e of this.enemies) {
          if (e.alive && Math.hypot(e.x - f.x, e.z - f.z) < 1.2 + e.radius) {
            e.burn = Math.max(e.burn, 2);
            e.burnDmg = p.final.damage * 0.3 * p.final.skillMult;
          }
        }
      }
      if (Math.random() < 0.15) this.effects.puff(f.x, 0.2, f.z, 0xff8a2e, 0.25, 0.4);
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

    // auto-follow behind the character on touch when the player isn't steering the camera
    if (this.state === 'play' && this.input.isTouch && performance.now() - this.input.lastLookTime > 700) {
      const mv = Math.abs(this.input.moveY) * 0.3 + Math.abs(this.input.moveX) * 0.7;
      if (mv > 0.1 && !p.attack) cam.yaw += angleDiff(cam.yaw, p.heading) * Math.min(1, dt * 1.6 * mv);
    }

    const target = cam.target.set(p.x, p.y + 1.6, p.z);
    const cp = Math.cos(cam.pitch);
    const desired = new THREE.Vector3(
      target.x - Math.sin(cam.yaw) * cam.dist * cp,
      target.y + Math.sin(cam.pitch) * cam.dist + 0.4,
      target.z - Math.cos(cam.yaw) * cam.dist * cp,
    );
    const frac = this.dungeon ? this.dungeon.raycastFraction(target, desired) : 1;
    desired.sub(target).multiplyScalar(Math.max(0.12, frac * 0.92)).add(target);
    if (desired.y < 0.4) desired.y = 0.4;
    cam.pos.lerp(desired, Math.min(1, dt * 18));
    this.camera.position.copy(cam.pos);
    const sh = this.effects.shakeAmt;
    if (sh > 0) this.camera.position.add(new THREE.Vector3((Math.random() - 0.5) * sh * 0.5, (Math.random() - 0.5) * sh * 0.5, (Math.random() - 0.5) * sh * 0.5));
    this.camera.lookAt(target.x + Math.sin(cam.yaw) * 1.5, target.y + 0.2, target.z + Math.cos(cam.yaw) * 1.5);
  }

  // ---------------------------------------------------------- state changes
  enterPortal() {
    if (this.state !== 'play') return;
    sfx.portal();
    this.state = 'upgrade';
    this.input.reset();
    if (document.pointerLockElement) document.exitPointerLock();
    this.rerolls = 0;
    this.offerUpgrades();
  }

  offerUpgrades(keep = null) {
    const p = this.player;
    const choices = keep || rollUpgrades(p, 3);
    const healCost = 20 + this.floor * 8;
    const rerollCost = 15 + this.floor * 5 + this.rerolls * 10;
    this.ui.showUpgrade({
      floor: this.floor,
      choices,
      gold: p.gold,
      healCost,
      rerollCost,
      hpFull: p.hp >= p.final.maxHp,
      onPick: (u) => {
        p.applyUpgrade(u);
        this.ui.hideUpgrade();
        this.loadFloor(this.floor + 1);
        this.state = 'play';
        this.input.reset();
      },
      onHeal: () => {
        if (p.gold < healCost || p.hp >= p.final.maxHp) return;
        p.gold -= healCost;
        p.hp = p.final.maxHp;
        sfx.heal();
        this.offerUpgrades(choices);
      },
      onReroll: () => {
        if (p.gold < rerollCost) return;
        p.gold -= rerollCost;
        this.rerolls++;
        sfx.ui();
        this.offerUpgrades();
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

  showDeath() {
    const p = this.player;
    const best = loadBest();
    const newBest = this.floor > best.floor || (this.floor === best.floor && p.kills > best.kills);
    if (newBest) saveBest({ floor: this.floor, kills: p.kills });
    if (document.pointerLockElement) document.exitPointerLock();
    this.ui.showDeath({ floor: this.floor, kills: p.kills, gold: p.gold, time: this.runTime, newBest, best: newBest ? { floor: this.floor, kills: p.kills } : best });
  }

  quitToTitle() {
    this.clearFloor();
    if (this.player) {
      this.scene.remove(this.player.mesh);
      this.scene.remove(this.player.shadow);
    }
    this.player = null;
    this.dungeon = null;
    this.state = 'title';
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  worldToTile(x) {
    return Math.floor(x / T);
  }
}
