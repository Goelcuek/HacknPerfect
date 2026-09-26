// Enemy archetypes + a small state-machine AI (idle → chase → windup → attack → recover).

import * as THREE from 'three';
import { clamp, angleDiff, rng } from './utils.js';
import { sfx } from './audio.js';

export const ENEMY_TYPES = {
  grunt: { name: 'Goblin', hp: 34, dmg: 9, speed: 4.4, radius: 0.5, height: 1.3, range: 1.8, windup: 0.42, recover: 0.55, color: 0x6fae4a, gold: [2, 6] },
  archer: { name: 'Skeleton Archer', hp: 24, dmg: 8, speed: 3.6, radius: 0.45, height: 1.7, range: 13, keep: 7, windup: 0.65, recover: 1.3, color: 0xe3dccb, gold: [3, 7], ranged: true },
  brute: { name: 'Ogre', hp: 115, dmg: 20, speed: 2.8, radius: 0.9, height: 2.3, range: 3.0, windup: 0.85, recover: 1.1, color: 0x9a5a44, gold: [8, 15], heavy: true },
  wisp: { name: 'Wisp', hp: 18, dmg: 7, speed: 6.5, radius: 0.4, height: 0.8, hover: 1.3, range: 2.2, windup: 0.3, recover: 0.6, color: 0xa98bff, gold: [2, 5] },
  boss: { name: 'Dungeon Warden', hp: 1000, dmg: 22, speed: 3.6, radius: 1.5, height: 3.6, range: 3.8, windup: 0.8, recover: 0.9, color: 0x5a2a6a, gold: [120, 180], heavy: true, boss: true },
};

const geoCache = {};
const geo = (key, make) => geoCache[key] || (geoCache[key] = make());

export class Enemy {
  constructor(game, type, x, z, floor, elite = false) {
    const def = ENEMY_TYPES[type];
    this.game = game;
    this.type = type;
    this.def = def;
    this.elite = elite;
    const fm = floor - 1;
    const hpMul = (1 + 0.32 * fm + 0.025 * fm * fm) * (elite ? 2.6 : 1);
    this.dmgMul = (1 + 0.13 * fm) * (elite ? 1.4 : 1);
    this.maxHp = def.hp * hpMul;
    this.hp = this.maxHp;
    this.scale = elite ? 1.25 : 1;
    this.radius = def.radius * this.scale;
    this.height = def.height * this.scale;
    this.x = x;
    this.z = z;
    this.y = def.hover || 0;
    this.vy = 0;
    this.kx = 0;
    this.kz = 0;
    this.heading = rng.next() * Math.PI * 2;
    this.state = 'idle';
    this.stateT = rng.next();
    this.aggro = false;
    this.freeze = 0;
    this.stun = 0;
    this.flash = 0;
    this.alive = true;
    this.burn = 0;
    this.animT = rng.next() * 10;
    this.strafe = rng.next() < 0.5 ? 1 : -1;
    this.bossPhase = 0;
    this.bossMove = 0;
    this.buildMesh();
  }

  // --------------------------------------------------------------- visuals
  buildMesh() {
    const d = this.def;
    const g = new THREE.Group();
    const body = new THREE.Group();
    g.add(body);
    this.bodyMat = new THREE.MeshLambertMaterial({ color: d.color });
    const dark = new THREE.MeshLambertMaterial({ color: 0x222222 });
    const eyeMat = new THREE.MeshBasicMaterial({ color: this.type === 'archer' ? 0x66ccff : 0xffdd33 });
    this.mats = [this.bodyMat, dark];
    const add = (geometry, mat, x, y, z, parent = body) => {
      const m = new THREE.Mesh(geometry, mat);
      m.position.set(x, y, z);
      parent.add(m);
      return m;
    };
    this.limbs = [];
    if (this.type === 'grunt') {
      add(geo('g_body', () => new THREE.BoxGeometry(0.7, 0.6, 0.5)), this.bodyMat, 0, 0.75, 0);
      add(geo('g_head', () => new THREE.BoxGeometry(0.55, 0.45, 0.5)), this.bodyMat, 0, 1.25, 0.05);
      add(geo('g_ear', () => new THREE.ConeGeometry(0.1, 0.35, 4)), this.bodyMat, 0.35, 1.35, 0).rotation.z = -1.2;
      add(geo('g_ear', () => new THREE.ConeGeometry(0.1, 0.35, 4)), this.bodyMat, -0.35, 1.35, 0).rotation.z = 1.2;
      add(geo('eye', () => new THREE.BoxGeometry(0.1, 0.08, 0.05)), eyeMat, 0.12, 1.3, 0.3);
      add(geo('eye', () => new THREE.BoxGeometry(0.1, 0.08, 0.05)), eyeMat, -0.12, 1.3, 0.3);
      const club = new THREE.Group();
      club.position.set(-0.45, 0.9, 0.1);
      add(geo('g_club', () => new THREE.BoxGeometry(0.14, 0.14, 0.8)), new THREE.MeshLambertMaterial({ color: 0x6b4a2b }), 0, 0, 0.35, club);
      body.add(club);
      this.weapon = club;
      this.limbs.push(add(geo('g_leg', () => new THREE.BoxGeometry(0.2, 0.45, 0.2)), dark, 0.18, 0.22, 0), add(geo('g_leg', () => new THREE.BoxGeometry(0.2, 0.45, 0.2)), dark, -0.18, 0.22, 0));
    } else if (this.type === 'archer') {
      add(geo('a_rib', () => new THREE.BoxGeometry(0.5, 0.6, 0.3)), this.bodyMat, 0, 1.0, 0);
      add(geo('a_head', () => new THREE.BoxGeometry(0.4, 0.42, 0.4)), this.bodyMat, 0, 1.55, 0);
      add(geo('eye', () => new THREE.BoxGeometry(0.1, 0.08, 0.05)), eyeMat, 0.1, 1.58, 0.21);
      add(geo('eye', () => new THREE.BoxGeometry(0.1, 0.08, 0.05)), eyeMat, -0.1, 1.58, 0.21);
      const bow = new THREE.Group();
      bow.position.set(0.35, 1.1, 0.3);
      add(geo('a_bow', () => new THREE.TorusGeometry(0.45, 0.04, 4, 12, Math.PI)), new THREE.MeshLambertMaterial({ color: 0x7a5230 }), 0, 0, 0, bow).rotation.set(0, Math.PI / 2, Math.PI / 2);
      body.add(bow);
      this.weapon = bow;
      this.limbs.push(add(geo('a_leg', () => new THREE.BoxGeometry(0.14, 0.7, 0.14)), this.bodyMat, 0.14, 0.35, 0), add(geo('a_leg', () => new THREE.BoxGeometry(0.14, 0.7, 0.14)), this.bodyMat, -0.14, 0.35, 0));
    } else if (this.type === 'brute') {
      add(geo('b_body', () => new THREE.BoxGeometry(1.4, 1.1, 0.9)), this.bodyMat, 0, 1.3, 0);
      add(geo('b_belly', () => new THREE.BoxGeometry(1.1, 0.5, 0.95)), new THREE.MeshLambertMaterial({ color: 0xc08a6a }), 0, 0.95, 0.05);
      add(geo('b_head', () => new THREE.BoxGeometry(0.6, 0.55, 0.6)), this.bodyMat, 0, 2.05, 0.15);
      add(geo('eye', () => new THREE.BoxGeometry(0.1, 0.08, 0.05)), eyeMat, 0.14, 2.1, 0.46);
      add(geo('eye', () => new THREE.BoxGeometry(0.1, 0.08, 0.05)), eyeMat, -0.14, 2.1, 0.46);
      const arm = new THREE.Group();
      arm.position.set(-0.85, 1.6, 0);
      add(geo('b_arm', () => new THREE.BoxGeometry(0.4, 1.2, 0.4)), this.bodyMat, 0, -0.5, 0, arm);
      add(geo('b_fist', () => new THREE.BoxGeometry(0.6, 0.6, 0.6)), dark, 0, -1.15, 0, arm);
      body.add(arm);
      this.weapon = arm;
      const arm2 = new THREE.Group();
      arm2.position.set(0.85, 1.6, 0);
      add(geo('b_arm', () => new THREE.BoxGeometry(0.4, 1.2, 0.4)), this.bodyMat, 0, -0.5, 0, arm2);
      body.add(arm2);
      this.arm2 = arm2;
      this.limbs.push(add(geo('b_leg', () => new THREE.BoxGeometry(0.4, 0.75, 0.4)), dark, 0.35, 0.37, 0), add(geo('b_leg', () => new THREE.BoxGeometry(0.4, 0.75, 0.4)), dark, -0.35, 0.37, 0));
    } else if (this.type === 'wisp') {
      this.bodyMat.emissive = new THREE.Color(d.color).multiplyScalar(0.6);
      add(geo('w_core', () => new THREE.IcosahedronGeometry(0.38, 0)), this.bodyMat, 0, 0, 0);
      const shell = add(geo('w_shell', () => new THREE.IcosahedronGeometry(0.55, 0)), new THREE.MeshBasicMaterial({ color: d.color, wireframe: true, transparent: true, opacity: 0.5 }), 0, 0, 0);
      this.weapon = shell;
      add(geo('eye', () => new THREE.BoxGeometry(0.1, 0.08, 0.05)), eyeMat, 0.12, 0.05, 0.36);
      add(geo('eye', () => new THREE.BoxGeometry(0.1, 0.08, 0.05)), eyeMat, -0.12, 0.05, 0.36);
    } else if (this.type === 'boss') {
      add(geo('k_body', () => new THREE.BoxGeometry(2.2, 1.8, 1.4)), this.bodyMat, 0, 2.0, 0);
      add(geo('k_skirt', () => new THREE.CylinderGeometry(0.9, 1.3, 1.1, 8)), dark, 0, 0.9, 0);
      const headMat = new THREE.MeshLambertMaterial({ color: 0x3a3a4a });
      add(geo('k_head', () => new THREE.BoxGeometry(0.9, 0.9, 0.9)), headMat, 0, 3.3, 0.1);
      add(geo('k_horn', () => new THREE.ConeGeometry(0.15, 0.8, 5)), dark, 0.45, 3.9, 0).rotation.z = -0.5;
      add(geo('k_horn', () => new THREE.ConeGeometry(0.15, 0.8, 5)), dark, -0.45, 3.9, 0).rotation.z = 0.5;
      const bigEye = new THREE.MeshBasicMaterial({ color: 0xff3355 });
      add(geo('k_eye', () => new THREE.BoxGeometry(0.2, 0.1, 0.05)), bigEye, 0.2, 3.35, 0.56);
      add(geo('k_eye', () => new THREE.BoxGeometry(0.2, 0.1, 0.05)), bigEye, -0.2, 3.35, 0.56);
      const arm = new THREE.Group();
      arm.position.set(-1.35, 2.6, 0);
      add(geo('k_arm', () => new THREE.BoxGeometry(0.55, 1.6, 0.55)), this.bodyMat, 0, -0.7, 0, arm);
      const hammerMat = new THREE.MeshLambertMaterial({ color: 0x777788, emissive: 0x220011 });
      add(geo('k_handle', () => new THREE.BoxGeometry(0.15, 0.15, 2.2)), dark, 0, -1.5, 1.0, arm);
      add(geo('k_hammer', () => new THREE.BoxGeometry(0.9, 0.9, 1.3)), hammerMat, 0, -1.5, 2.1, arm);
      body.add(arm);
      this.weapon = arm;
      const arm2 = new THREE.Group();
      arm2.position.set(1.35, 2.6, 0);
      add(geo('k_arm', () => new THREE.BoxGeometry(0.55, 1.6, 0.55)), this.bodyMat, 0, -0.7, 0, arm2);
      body.add(arm2);
      this.arm2 = arm2;
    }
    body.scale.setScalar(this.scale);

    if (this.elite) {
      const aura = new THREE.Mesh(
        geo('aura', () => new THREE.RingGeometry(0.8, 1, 24)),
        new THREE.MeshBasicMaterial({ color: 0xffc94a, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
      );
      aura.rotation.x = -Math.PI / 2;
      aura.position.y = 0.06 - (this.def.hover || 0);
      aura.scale.setScalar(this.radius * 1.6);
      g.add(aura);
      this.aura = aura;
      this.bodyMat.emissive = new THREE.Color(0x553300);
    }

    // health bar (hidden until damaged; bosses use the HUD bar instead)
    if (!this.def.boss) {
      const bar = new THREE.Group();
      const bg = new THREE.Mesh(geo('hb', () => new THREE.PlaneGeometry(1, 0.12)), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6, depthTest: false }));
      const fillGeo = new THREE.PlaneGeometry(1, 0.12);
      fillGeo.translate(0.5, 0, 0);
      const fill = new THREE.Mesh(fillGeo, new THREE.MeshBasicMaterial({ color: this.elite ? 0xffc94a : 0xff4040, depthTest: false }));
      fill.position.x = -0.5;
      fill.position.z = 0.001;
      bar.add(bg, fill);
      bar.renderOrder = 10;
      bg.renderOrder = 10;
      fill.renderOrder = 11;
      bar.position.y = this.height + 0.45 - (this.def.hover || 0);
      bar.visible = false;
      g.add(bar);
      this.hpBar = bar;
      this.hpFill = fill;
    }

    this.body = body;
    this.mesh = g;
    g.position.set(this.x, this.y, this.z);
  }

  // --------------------------------------------------------------- update
  update(dt, game) {
    const p = game.player;
    const dg = game.dungeon;
    const def = this.def;
    this.animT += dt;
    this.flash = Math.max(0, this.flash - dt);
    this.stun = Math.max(0, this.stun - dt);
    if (this.burn > 0) {
      this.burn -= dt;
      this.burnTick = (this.burnTick || 0) - dt;
      if (this.burnTick <= 0) {
        this.burnTick = 0.35;
        game.damageEnemy(this, { amount: this.burnDmg || 3, crit: false, knock: 0, silent: true }, this.x, this.z);
        if (!this.alive) return;
      }
    }

    // knockback + vertical launch
    if (Math.abs(this.kx) + Math.abs(this.kz) > 0.05) {
      dg.move(this, this.kx * dt, this.kz * dt, false);
      const decay = Math.exp(-(def.heavy ? 10 : 7) * dt);
      this.kx *= decay;
      this.kz *= decay;
    }
    const baseY = def.hover || 0;
    if (this.y > baseY || this.vy > 0) {
      this.vy -= 26 * dt;
      this.y += this.vy * dt;
      if (this.y <= baseY) {
        this.y = baseY;
        this.vy = 0;
      }
    }

    const dx = p.x - this.x;
    const dz = p.z - this.z;
    const dist = Math.hypot(dx, dz);
    const toPlayer = Math.atan2(dx, dz);

    if (this.freeze > 0) {
      if (def.boss) this.freeze = Math.min(this.freeze, 0.8);
      this.freeze -= dt;
      this.render(dt, 0);
      return;
    }

    if (!this.aggro) {
      if (dist < 15 && dg.lineOfSight(this.x, this.z, p.x, p.z)) this.aggro = true;
      this.stateT -= dt;
      this.render(dt, 0);
      if (this.aggro) game.alertNearby(this);
      return;
    }

    if (this.stun > 0 || p.dead) {
      this.render(dt, 0);
      return;
    }

    if (def.boss && this.bossUpdate(dt, game)) return;

    let moveSpeed = 0;
    let mvx = 0;
    let mvz = 0;
    this.stateT += dt;
    const los = dist < 20 && dg.lineOfSight(this.x, this.z, p.x, p.z);
    const dy = p.y - (this.y - (def.hover || 0));

    switch (this.state) {
      case 'idle':
        this.state = 'chase';
        this.stateT = 0;
        break;
      case 'chase': {
        if (def.boss) return this.bossChase(dt, game, dist, toPlayer, los);
        let dirx = 0;
        let dirz = 0;
        if (los) {
          dirx = dx / (dist || 1);
          dirz = dz / (dist || 1);
        } else {
          const fd = dg.flowDir(this.x, this.z);
          if (fd) {
            dirx = fd.x;
            dirz = fd.z;
          }
        }
        if (def.ranged) {
          if (los && dist < def.range) {
            if (dist < def.keep - 1.5) {
              dirx = -dirx;
              dirz = -dirz;
            } else {
              // strafe while waiting to shoot
              const sx = -dirz * this.strafe;
              const sz = dirx * this.strafe;
              dirx = sx * 0.6;
              dirz = sz * 0.6;
            }
            if (this.stateT > 0.8) this.beginWindup(toPlayer);
          }
        } else if (dist < def.range + this.radius * 0.3 && Math.abs(dy) < 2 && los) {
          this.beginWindup(toPlayer);
          break;
        }
        if (this.type === 'wisp') {
          // erratic zig-zag
          const wob = Math.sin(this.animT * 5) * 0.6;
          const sx = dirx - dirz * wob;
          const sz = dirz + dirx * wob;
          dirx = sx;
          dirz = sz;
        }
        moveSpeed = def.speed;
        mvx = dirx;
        mvz = dirz;
        if (mvx || mvz) this.turnTo(Math.atan2(mvx, mvz), dt, 8);
        if (def.ranged && los) this.turnTo(toPlayer, dt, 10);
        break;
      }
      case 'windup': {
        const wd = def.windup;
        if (!def.heavy) this.turnTo(toPlayer, dt, 3);
        if (this.stateT >= wd) {
          this.performAttack(game, dist, toPlayer);
          this.state = 'attack';
          this.stateT = 0;
        }
        break;
      }
      case 'attack': {
        if (this.lunge > 0) {
          this.lunge -= dt;
          moveSpeed = this.type === 'wisp' ? 16 : 9;
          mvx = Math.sin(this.heading);
          mvz = Math.cos(this.heading);
          if (!this.lungeHit && this.lunge > 0) this.checkLungeHit(game);
        }
        if (this.stateT > 0.2) {
          this.state = 'recover';
          this.stateT = 0;
        }
        break;
      }
      case 'recover':
        if (this.stateT > def.recover * (this.elite ? 0.8 : 1)) {
          this.state = 'chase';
          this.stateT = 0;
          if (rng.next() < 0.3) this.strafe *= -1;
        }
        break;
      default:
        break;
    }

    if (moveSpeed > 0) dg.move(this, mvx * moveSpeed * dt, mvz * moveSpeed * dt, false);
    this.render(dt, moveSpeed > 0 ? 1 : 0);
  }

  turnTo(h, dt, rate) {
    this.heading += angleDiff(this.heading, h) * Math.min(1, dt * rate);
  }

  beginWindup(toPlayer) {
    this.state = 'windup';
    this.stateT = 0;
    this.heading = toPlayer;
    const g = this.game;
    if (this.type === 'brute') {
      const fx = this.x + Math.sin(this.heading) * 1.6 * this.scale;
      const fz = this.z + Math.cos(this.heading) * 1.6 * this.scale;
      this.slamAt = { x: fx, z: fz, r: 3.2 * this.scale };
      this.telegraph = g.effects.telegraph(fx, fz, this.slamAt.r, this.def.windup);
    } else if (this.type === 'grunt' || this.type === 'wisp') {
      this.telegraph = null;
    }
  }

  performAttack(game, dist, toPlayer) {
    const p = game.player;
    const dmg = this.def.dmg * this.dmgMul;
    if (this.type === 'grunt') {
      this.lunge = 0.12;
      this.lungeHit = false;
      sfx.swing();
    } else if (this.type === 'wisp') {
      this.lunge = 0.18;
      this.lungeHit = false;
    } else if (this.type === 'archer') {
      // lead the target slightly
      const t = dist / 16;
      const tx = p.x + p.vx * t * 0.5;
      const tz = p.z + p.vz * t * 0.5;
      const h = Math.atan2(tx - this.x, tz - this.z);
      this.heading = h;
      game.spawnEnemyProjectile(this.x, 1.2, this.z, h, 16, dmg, 'arrow');
      if (this.elite) {
        game.spawnEnemyProjectile(this.x, 1.2, this.z, h + 0.2, 16, dmg, 'arrow');
        game.spawnEnemyProjectile(this.x, 1.2, this.z, h - 0.2, 16, dmg, 'arrow');
      }
      sfx.arrow();
    } else if (this.type === 'brute') {
      const s = this.slamAt;
      game.shockwave(s.x, s.z, s.r, dmg, this);
    }
    void toPlayer;
  }

  checkLungeHit(game) {
    const p = game.player;
    const reach = this.def.range + this.radius;
    const dx = p.x - this.x;
    const dz = p.z - this.z;
    const d = Math.hypot(dx, dz);
    if (d > reach || Math.abs(p.y - (this.y - (this.def.hover || 0))) > 1.6) return;
    const dot = (dx * Math.sin(this.heading) + dz * Math.cos(this.heading)) / (d || 1);
    if (dot < 0.2 && d > this.radius + p.radius + 0.2) return;
    this.lungeHit = true;
    if (p.takeDamage(this.def.dmg * this.dmgMul, this, true)) {
      p.vx += (dx / (d || 1)) * 6;
      p.vz += (dz / (d || 1)) * 6;
    }
  }

  // ------------------------------------------------------------------- boss
  bossChase(dt, game, dist, toPlayer, los) {
    const dg = game.dungeon;
    const p = game.player;
    const enraged = this.hp < this.maxHp * 0.5;
    this.bossMove -= dt;
    this.turnTo(toPlayer, dt, 4);
    if (this.bossMove <= 0 && this.stateT > (enraged ? 0.6 : 1.1)) {
      // choose a move
      const moves = ['slam', 'volley', 'charge'];
      if (enraged) moves.push('nova', 'summon');
      let m = rng.pick(moves);
      if (dist < 5 && rng.next() < 0.5) m = 'slam';
      this.bossAttack = m;
      this.state = 'bosswind';
      this.stateT = 0;
      this.bossWind = m === 'charge' ? 0.7 : m === 'volley' ? 0.6 : m === 'summon' ? 0.8 : 1.0;
      if (enraged) this.bossWind *= 0.75;
      if (m === 'slam') {
        const fx = this.x + Math.sin(toPlayer) * 2.5;
        const fz = this.z + Math.cos(toPlayer) * 2.5;
        this.slamAt = { x: fx, z: fz, r: 6.5 };
        this.telegraph = game.effects.telegraph(fx, fz, 6.5, this.bossWind);
      } else if (m === 'nova') {
        this.telegraph = game.effects.telegraph(this.x, this.z, 9, this.bossWind, 0xaa44ff);
      }
      this.heading = toPlayer;
      return this.render(dt, 0);
    }
    const dir = los ? { x: Math.sin(toPlayer), z: Math.cos(toPlayer) } : dg.flowDir(this.x, this.z);
    if (dir && dist > 3) dg.move(this, dir.x * this.def.speed * (enraged ? 1.25 : 1) * dt, dir.z * this.def.speed * (enraged ? 1.25 : 1) * dt, false);
    this.render(dt, dist > 3 ? 1 : 0);
    void p;
  }

  bossUpdate(dt, game) {
    // runs for boss-specific states
    const p = game.player;
    const dmg = this.def.dmg * this.dmgMul;
    this.stateT += dt;
    if (this.state === 'bosswind') {
      if (this.bossAttack === 'charge') this.turnTo(Math.atan2(p.x - this.x, p.z - this.z), dt, 6);
      if (this.stateT >= this.bossWind) {
        const m = this.bossAttack;
        this.state = 'bossact';
        this.stateT = 0;
        if (m === 'slam') {
          game.shockwave(this.slamAt.x, this.slamAt.z, this.slamAt.r, dmg * 1.2, this, true);
        } else if (m === 'nova') {
          game.shockwave(this.x, this.z, 9, dmg, this, true);
        } else if (m === 'volley') {
          const n = this.hp < this.maxHp * 0.5 ? 11 : 7;
          for (let i = 0; i < n; i++) {
            const h = this.heading + (i - (n - 1) / 2) * 0.17;
            game.spawnEnemyProjectile(this.x, 1.3, this.z, h, 11, dmg * 0.7, 'orb');
          }
          sfx.fire();
        } else if (m === 'charge') {
          this.chargeT = 0.75;
          this.lungeHit = false;
          sfx.dash();
        } else if (m === 'summon') {
          for (let i = 0; i < 2; i++) game.spawnEnemy(rng.next() < 0.5 ? 'grunt' : 'wisp', this.x + (rng.next() - 0.5) * 6, this.z + (rng.next() - 0.5) * 6, true);
          game.effects.ring(this.x, this.z, 5, 0xaa44ff, 0.5);
        }
      }
      this.render(dt, 0);
      return true;
    }
    if (this.state === 'bossact') {
      if (this.chargeT > 0) {
        this.chargeT -= dt;
        const hit = game.dungeon.move(this, Math.sin(this.heading) * 20 * dt, Math.cos(this.heading) * 20 * dt, false);
        game.effects.puff(this.x, 0.5, this.z, 0x886699, 0.6, 0.3);
        const d = Math.hypot(p.x - this.x, p.z - this.z);
        if (!this.lungeHit && d < this.radius + 1 && p.y < 2.2) {
          this.lungeHit = true;
          if (p.takeDamage(dmg, this, true)) {
            p.vx += Math.sin(this.heading) * 14;
            p.vz += Math.cos(this.heading) * 14;
            p.vy = 6;
          }
        }
        if (hit) {
          this.chargeT = 0;
          game.effects.shake(0.4);
          sfx.slam();
          this.stun = 0.8;
        }
      }
      if (this.stateT > (this.hp < this.maxHp * 0.5 ? 0.5 : 0.9) && !(this.chargeT > 0)) {
        this.state = 'chase';
        this.stateT = 0;
      }
      this.render(dt, this.chargeT > 0 ? 2 : 0);
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- render
  render(dt, moving) {
    const m = this.mesh;
    m.position.set(this.x, this.y, this.z);
    m.rotation.y = this.heading;
    const t = this.animT;
    const body = this.body;
    body.rotation.set(0, 0, 0);
    body.position.set(0, 0, 0);
    if (this.type === 'wisp') {
      body.position.y = Math.sin(t * 3) * 0.15;
      this.weapon.rotation.y = t * 2;
      this.weapon.rotation.x = t * 1.3;
    } else if (moving) {
      body.position.y = Math.abs(Math.sin(t * 10)) * 0.08;
      const sw = Math.sin(t * 10) * 0.6;
      if (this.limbs[0]) {
        this.limbs[0].rotation.x = sw;
        this.limbs[1].rotation.x = -sw;
      }
    }

    // attack poses
    const s = this.state;
    const w = this.weapon;
    if (w && this.type !== 'wisp') {
      let rx = 0;
      if (s === 'windup' || s === 'bosswind') rx = -Math.min(1, this.stateT / (this.bossWind || this.def.windup)) * 2.2;
      else if (s === 'attack' || s === 'bossact') rx = 0.6;
      if (this.type === 'archer') {
        w.rotation.x = 0;
        body.rotation.y = s === 'windup' ? -0.3 : 0;
      } else {
        w.rotation.x = rx;
        if (this.arm2) this.arm2.rotation.x = s === 'bosswind' && this.bossAttack === 'slam' ? rx : moving ? Math.sin(t * 8) * 0.4 : 0;
      }
    }
    if (s === 'windup' || s === 'bosswind') {
      // shake / swell to telegraph
      body.position.x = Math.sin(t * 60) * 0.04;
      if (this.type === 'wisp') body.scale.setScalar(this.scale * (1 + this.stateT));
    } else if (this.type === 'wisp') body.scale.setScalar(this.scale);

    // flash / freeze tint
    const mat = this.bodyMat;
    if (this.flash > 0) mat.emissive.setHex(0xffffff);
    else if (this.freeze > 0) mat.emissive.setHex(0x2266aa);
    else if (this.burn > 0) mat.emissive.setHex(0x662200);
    else if (this.elite) mat.emissive.setHex(0x553300);
    else if (this.type === 'wisp') mat.emissive.setHex(0x3a2a77);
    else mat.emissive.setHex(0x000000);

    if (this.aura) this.aura.rotation.z = t;

    if (this.hpBar) {
      this.hpBar.visible = this.hp < this.maxHp;
      this.hpFill.scale.x = clamp(this.hp / this.maxHp, 0, 1);
      // billboard toward camera
      const cam = this.game.camera;
      this.hpBar.quaternion.copy(m.quaternion).invert().multiply(cam.quaternion);
    }
  }

  dispose() {
    this.mesh.traverse((o) => {
      if (o.material && o.material !== this.bodyMat) {
        /* shared / small materials are left for GC */
      }
    });
    this.bodyMat.dispose();
  }
}
