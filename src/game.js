// Game world: owns the dungeon, player, enemies, projectiles, zones, loot and
// camera, routes combat between them and runs the run's flow (class select →
// first skill → floors → skill/upgrade choice between floors).

import * as THREE from 'three';
import { Dungeon, T } from './dungeon.js';
import { Player } from './player.js';
import { Enemy, ENEMY_TYPES } from './enemies.js';
import { Effects } from './effects.js';
import { generateItem, rollBlessings, itemScore, RARITIES } from './items.js';
import { SKILLS, MAX_SKILL_LEVEL, skillDef } from './skills.js';
import { CLASSES } from './classes.js';
import { buildDropModel } from './gear.js';
import { G, mat } from './rig.js';
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

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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
    this.patches = [];
    this.zones = [];
    this.corpses = [];
    this.timers = [];
  }

  setQuality(q) {
    this.quality = q;
    this.sun.castShadow = q === 'high';
    if (this.player) this.applyShadows(this.player.mesh);
    for (const e of this.enemies) this.applyShadows(e.mesh);
    if (this.dungeon) this.dungeon.group.traverse((o) => o.isMesh && (o.castShadow = q === 'high' && !!o.userData.caster));
  }

  applyShadows(obj) {
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
    this.applyShadows(p.mesh);
    this.scene.add(p.mesh);
    this.scene.add(p.shadow);
  }

  giveStarterWeapon(p) {
    const c = CLASSES[p.clsId];
    const names = { sword: 'Rusty Sword', bow: 'Frayed Shortbow', staff: 'Gnarled Staff', daggers: 'Chipped Daggers' };
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
      const cx = p.x + Math.sin(h) * 3.3;
      const cz = p.z + Math.cos(h) * 3.3;
      const camYaw = h + Math.PI;
      const shift = this.camera.aspect > 1.2 ? 0.95 : 0;
      const rx = -Math.cos(camYaw);
      const rz = Math.sin(camYaw);
      this.cam.pos.lerp(new THREE.Vector3(cx, 1.55, cz), Math.min(1, dt * 4));
      this.camera.position.copy(this.cam.pos);
      this.camera.lookAt(p.x - rx * shift, 1.05, p.z - rz * shift);
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
    this.inRun = true;
    this.setPlayer(new Player(this, clsId));
    this.giveStarterWeapon(this.player);
    this.floor = 0;
    this.runTime = 0;
    this.loadFloor(1);
    this.state = 'skillpick';
    this.input.reset();
    this.offerRewards(true);
  }

  clearFloor() {
    if (this.dungeon) {
      this.scene.remove(this.dungeon.group);
      this.dungeon.dispose();
    }
    // never let a previous level's meshes linger in the scene
    for (const c of this.scene.children.slice()) if (c.userData.isLevel) this.scene.remove(c);
    for (const list of [this.enemies, this.projectiles, this.pickups, this.chests, this.pots, this.patches, this.zones, this.corpses]) {
      for (const o of list) {
        if (o.mesh) this.scene.remove(o.mesh);
        if (o.dispose) o.dispose();
        if (o.mesh && o.mesh.userData.dispose) o.mesh.userData.dispose();
      }
    }
    this.timers.length = 0;
    if (this.portal) this.scene.remove(this.portal.mesh);
    this.effects.clear();
  }

  loadFloor(n, quiet = false) {
    this.clearFloor();
    this.floor = n;
    const dg = new Dungeon(n, (Math.random() * 2 ** 31) | 0);
    this.dungeon = dg;
    const levelGroup = dg.buildMeshes(this.quality);
    levelGroup.userData.isLevel = true;
    this.scene.add(levelGroup);
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
    this.zones = [];
    this.corpses = [];
    this.floorCleared = false;
    this.boss = null;

    const p = this.player;
    const s = dg.worldCenter(dg.startRoom);
    p.resetState();
    p.x = s.x;
    p.z = s.z;
    const ex = dg.worldCenter(dg.exitRoom);
    p.heading = Math.atan2(ex.x - s.x, ex.z - s.z);
    this.showcaseHeading = p.heading;
    this.cam.yaw = p.heading;
    this.cam.pitch = 0.38;
    this.cam.pos.set(p.x - Math.sin(p.heading) * 6, 4, p.z - Math.cos(p.heading) * 6);

    for (const sp of dg.spawns) this.spawnEnemy(sp.type, sp.x, sp.z, false, sp.elite);
    for (const c of dg.chests) this.spawnChest(c.x, c.z);
    for (const pt of dg.pots) this.spawnPot(pt.x, pt.z);
    this.spawnPortal(ex.x, ex.z);
    this.flowTimer = 0;
    this.revealTimer = 0;

    if (!quiet) this.ui.toast(dg.isBoss ? `Floor ${n} — ☠ Boss Lair ☠` : `Floor ${n} — ${th.name}`, 2.5);
  }

  // --------------------------------------------------------------- spawning
  spawnEnemy(type, x, z, aggro = false, elite = false) {
    const e = new Enemy(this, type, x, z, this.floor, elite);
    e.aggro = aggro;
    this.enemies.push(e);
    this.applyShadows(e.mesh);
    this.scene.add(e.mesh);
    e.render(0);
    if (ENEMY_TYPES[type].boss) {
      this.boss = e;
      e.aggro = false;
    }
    return e;
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

  spawnChest(x, z, rich = false) {
    const M = this.chestMats();
    const wood = rich ? M.rich : M.wood;
    const g = new THREE.Group();
    const add = (geo, m, px, py, pz, parent = g) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(px, py, pz);
      parent.add(mesh);
      return mesh;
    };
    add(G.box(1.1, 0.6, 0.75), wood, 0, 0.3, 0);
    for (const sx of [-0.52, 0.52]) for (const sz of [-0.35, 0.35]) add(G.box(0.08, 0.62, 0.08), M.iron, sx, 0.31, sz);
    for (let i = -2; i <= 2; i++) add(G.box(0.012, 0.56, 0.01), M.clayDark, i * 0.2, 0.3, 0.378);
    const lid = new THREE.Group();
    lid.position.set(0, 0.6, -0.37);
    g.add(lid);
    const lidTop = add(G.cyl(0.375, 0.375, 1.1, 12, false), wood, 0, 0.02, 0.37, lid);
    lidTop.rotation.z = Math.PI / 2;
    lidTop.scale.set(0.5, 1, 1);
    for (const sx of [-0.4, 0, 0.4]) {
      const band = add(G.cyl(0.385, 0.385, 0.07, 12, true), rich ? M.gold : M.iron, sx, 0.02, 0.37, lid);
      band.rotation.z = Math.PI / 2;
      band.scale.set(0.5, 1, 1);
    }
    add(G.box(0.18, 0.2, 0.06), M.gold, 0, -0.02, 0.77, lid);
    add(G.sphere(0.03, 6, 4), M.iron, 0, -0.05, 0.8, lid);
    g.position.set(x, 0, z);
    g.rotation.y = rng.next() * Math.PI * 2;
    this.scene.add(g);
    this.chests.push({ x, z, mesh: g, lid, open: false, rich, t: 0 });
  }

  spawnPot(x, z) {
    const M = this.chestMats();
    if (!this.potGeo) {
      const pts = [];
      const prof = [[0.0, 0], [0.18, 0.02], [0.28, 0.18], [0.3, 0.32], [0.24, 0.48], [0.13, 0.58], [0.12, 0.66], [0.17, 0.7]];
      for (const [r, y] of prof) pts.push(new THREE.Vector2(r, y));
      this.potGeo = new THREE.LatheGeometry(pts, 12);
    }
    const g = new THREE.Group();
    const body = new THREE.Mesh(this.potGeo, rng.next() < 0.5 ? M.clay : M.clayDark);
    g.add(body);
    const band = new THREE.Mesh(G.torus(0.29, 0.02, Math.PI * 2, 4, 14), M.clayDark);
    band.rotation.x = Math.PI / 2;
    band.position.y = 0.3;
    g.add(band);
    const s = 0.85 + rng.next() * 0.35;
    g.scale.setScalar(s);
    g.position.set(x, 0, z);
    g.rotation.y = rng.next() * 6;
    this.scene.add(g);
    this.pots.push({ x, z, mesh: g });
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

  activatePortal() {
    const pt = this.portal;
    pt.active = true;
    pt.ringMat.color.setHex(0xb18cff);
    pt.ringMat.emissive.setHex(0x5a2fbf);
    pt.discMat.color.setHex(0x9d7dff);
    pt.runeMat.emissive.setHex(0x9d7dff);
    pt.light.intensity = 6;
    sfx.portal();
    this.ui.toast(this.dungeon.isBoss ? 'The Warden falls! Portal open' : 'Floor cleared! Find the portal ✦', 2.5);
  }

  dropGold(x, z, amount) {
    const coins = Math.min(8, Math.max(1, Math.round(amount / 4)));
    const per = amount / coins;
    if (!this.coinMat) this.coinMat = mat(0xffd34d, { metal: 0.7, rough: 0.3, emissive: 0x664400 });
    for (let i = 0; i < coins; i++) {
      const m = new THREE.Mesh(G.cyl(0.16, 0.16, 0.05, 12), this.coinMat);
      m.rotation.x = Math.PI / 2;
      const a = rng.next() * Math.PI * 2;
      const s = 2 + rng.next() * 3;
      m.position.set(x, 0.8, z);
      this.scene.add(m);
      this.pickups.push({ kind: 'gold', value: per, x, y: 0.8, z, vx: Math.cos(a) * s, vy: 5 + rng.next() * 3, vz: Math.sin(a) * s, mesh: m, t: 0 });
    }
  }

  dropPotion(x, z) {
    if (!this.potionMats) this.potionMats = { red: mat(0xff3b5c, { emissive: 0x551020, rough: 0.2 }), cork: mat(0x8a6a4a), glass: mat(0xdddddd, { rough: 0.1, transparent: true, opacity: 0.5 }) };
    const P = this.potionMats;
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
    };
    pr.mesh = this.projectileMesh(o.kind, o.kind === 'orb' ? pr.radius / 1.5 : 1);
    pr.mesh.position.set(pr.x, pr.y, pr.z);
    pr.mesh.rotation.y = pr.heading;
    this.scene.add(pr.mesh);
    this.projectiles.push(pr);
    return pr;
  }

  spawnEnemyProjectile(x, y, z, heading, speed, dmg, kind) {
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
    this.projectiles.push({ owner: 'enemy', kind, x, y, z, heading, speed, dmg, life: 3, mesh: m });
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
    m.position.set(x, 0.06, z);
    this.scene.add(m);
    this.patches.push({ x, z, t: 2.0, tick: 0, mesh: m });
  }

  // ------------------------------------------------------- zones and timers
  schedule(delay, fn) {
    this.timers.push({ t: delay, fn });
  }

  zone(o) {
    const z = { t: 0, tickT: 0, delay: 0, arm: 0, started: false, ...o };
    const g = new THREE.Group();
    g.position.set(z.x, 0.05, z.z);
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
        tm.fn();
      }
    }
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      z.t += dt;
      if (z.follow) {
        z.x = z.follow.x;
        z.z = z.follow.z;
        z.mesh.position.set(z.x, 0.05, z.z);
      }
      let done = z.t >= z.life + z.delay;
      if (z.t >= z.delay) {
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
    for (let i = this.pots.length - 1; i >= 0; i--) {
      const pt = this.pots[i];
      if (Math.hypot(pt.x - x, pt.z - z) < r + 0.3) this.breakPot(i);
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
    const p = this.player;
    let amount = hit.amount;
    if (p.mods.execute > 0 && e.hp < e.maxHp * 0.3) amount *= 1 + p.mods.execute;
    amount = Math.max(1, Math.round(amount));
    e.hp -= amount;
    e.flash = 0.09;
    e.aggro = true;
    if (!hit.silent) e.flinch = 0.2;
    const heavy = e.def.heavy;
    if (hit.knock) {
      const dx = e.x - fromX;
      const dz = e.z - fromZ;
      const d = Math.hypot(dx, dz) || 1;
      const k = hit.knock * (e.def.boss ? 0.05 : heavy ? 0.35 : 1);
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
      this.effects.burst(e.x, e.y + e.height * 0.5, e.z, hit.crit ? 0xffe066 : e.type === 'archer' ? 0xe8e0c8 : e.type === 'wisp' ? 0xc0a0ff : 0xff5040, hit.crit ? 12 : 6, 5, 0.12, 0.35);
      if (hit.crit) sfx.crit();
      else sfx.hit();
      if (hit.crit) this.hitStop(0.035);
      if (p.final.lifesteal + p.buff.ls > 0) p.heal(amount * (p.final.lifesteal + p.buff.ls), false);
    }
    this.effects.damageNumber(e.x, e.y + e.height + 0.3, e.z, String(amount), hit.crit ? 'crit' : hit.dot === 'poison' ? 'poison' : hit.silent ? 'dot' : '');
    if (e.hp <= 0) this.killEnemy(e, fromX, fromZ);
  }

  killEnemy(e, fromX = e.x, fromZ = e.z) {
    e.alive = false;
    e.startDeath(fromX, fromZ);
    this.corpses.push(e);
    const p = this.player;
    p.kills++;
    this.effects.burst(e.x, e.y + e.height * 0.5, e.z, e.def.color, 14, 5, 0.18, 0.6);
    sfx.enemyDie();
    const [g0, g1] = e.def.gold;
    const gold = (g0 + rng.next() * (g1 - g0)) * (1 + this.floor * 0.15) * (e.elite ? 3 : 1) * p.final.goldMult;
    this.dropGold(e.x, e.z, Math.round(gold));
    const cls = p.clsId;
    if (e.def.boss) {
      for (let i = 0; i < 3; i++) this.dropItem(e.x, e.z, generateItem(this.floor, cls, 6, 2));
      this.dropPotion(e.x, e.z);
      this.effects.shake(1);
      this.hitStop(0.25);
      this.boss = null;
      for (const m of this.enemies) {
        if (m === e || !m.alive) continue;
        m.alive = false;
        m.startDeath(e.x, e.z);
        this.corpses.push(m);
      }
      this.enemies = [e];
    } else {
      const itemChance = e.elite ? 0.7 : e.def.heavy ? 0.22 : 0.09;
      if (rng.next() < itemChance) this.dropItem(e.x, e.z, generateItem(this.floor, cls, e.elite ? 3 : 0, e.elite ? 1 : 0));
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
    this.effects.burst(pt.x, 0.4, pt.z, 0x9a6b45, 12, 4, 0.15, 0.5);
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
    for (let i = 0; i < n; i++) this.dropItem(c.x, c.z, generateItem(this.floor, this.player.clsId, c.rich ? 5 : 2, 1));
    if (rng.next() < 0.4) this.dropPotion(c.x, c.z);
  }

  hitStop(t) {
    this.hitStopT = Math.max(this.hitStopT, t);
  }

  // ----------------------------------------------------------------- update
  update(rawDt) {
    if (this.state !== 'play') {
      if (this.state === 'dead') {
        this.updateCorpses(rawDt);
        if (this.player) this.player.animate(rawDt);
      }
      if (this.player && this.state !== 'title' && this.state !== 'classSelect') this.updateCamera(rawDt, { x: 0, y: 0 });
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

    for (const e of this.enemies.slice()) if (e.alive) e.update(dt, this);
    this.separateEnemies();
    this.updateCorpses(dt);
    this.updateProjectiles(dt);
    this.updateZones(dt);
    this.updatePickups(dt);
    this.updateInteractables(dt);
    this.updatePatches(dt);
    this.effects.update(dt);
    this.updateTorches();

    this.playerLight.position.set(p.x, p.y + 3, p.z);

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
      setTimeout(() => this.showDeath(), 1600);
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
        .slice(0, this.torchPool.length)
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
    // key light + shadow frustum follow the player
    this.sun.position.set(p.x + 5, p.y + 14, p.z + 3);
    this.sun.target.position.set(p.x, p.y, p.z);
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
    const fx = this.effects;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.life -= dt;
      if (pr.owner === 'player' && pr.homing && pr.homing.alive) {
        const want = Math.atan2(pr.homing.x - pr.x, pr.homing.z - pr.z);
        pr.heading += clamp(angleDiff(pr.heading, want), -4.5 * dt, 4.5 * dt);
      }
      pr.x += Math.sin(pr.heading) * pr.speed * dt;
      pr.z += Math.cos(pr.heading) * pr.speed * dt;
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

    const target = cam.target.set(p.x, p.y + 1.6, p.z);
    const cp = Math.cos(cam.pitch);
    const desired = new THREE.Vector3(target.x - Math.sin(cam.yaw) * cam.dist * cp, target.y + Math.sin(cam.pitch) * cam.dist + 0.4, target.z - Math.cos(cam.yaw) * cam.dist * cp);
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
  enterPortal() {
    if (this.state !== 'play') return;
    sfx.portal();
    this.state = 'upgrade';
    this.input.reset();
    if (document.pointerLockElement) document.exitPointerLock();
    this.rerolls = 0;
    this.shrine = rollBlessings(this.player, 2).map((b) => ({ b, sold: false }));
    this.offerRewards(false);
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

  offerRewards(first, keep = null) {
    const p = this.player;
    const offers = keep || this.skillOffers(first);
    this.currentOffers = offers;
    const healCost = 20 + this.floor * 8;
    const rerollCost = 15 + this.floor * 5 + (this.rerolls || 0) * 10;
    const blessingCost = 30 + this.floor * 12;
    const proceed = () => {
      this.ui.hideSkillPick();
      if (!first) this.loadFloor(this.floor + 1);
      this.state = 'play';
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
        this.offerRewards(first, offers);
      },
      onHeal: () => {
        if (p.gold < healCost || p.hp >= p.final.maxHp) return;
        p.gold -= healCost;
        p.hp = p.final.maxHp;
        sfx.heal();
        this.offerRewards(first, offers);
      },
      onReroll: () => {
        if (p.gold < rerollCost) return;
        p.gold -= rerollCost;
        this.rerolls = (this.rerolls || 0) + 1;
        sfx.ui();
        this.offerRewards(first);
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
    if (newBest) saveBest({ floor: this.floor, kills: p.kills, cls: p.clsId });
    if (document.pointerLockElement) document.exitPointerLock();
    this.ui.showDeath({ floor: this.floor, kills: p.kills, gold: p.gold, time: this.runTime, cls: p.cls.name, newBest, best: newBest ? { floor: this.floor, kills: p.kills } : best });
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
