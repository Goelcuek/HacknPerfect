// Visual feedback: pooled particles, expanding rings, slash arcs,
// floating damage numbers and camera shake.

import * as THREE from 'three';
import { G } from './rig.js';

const MAX_PARTICLES = 600;
const up = new THREE.Vector3(0, 1, 0);

export class Effects {
  constructor(scene, camera, container) {
    this.scene = scene;
    this.camera = camera;
    this.container = container;
    this.shakeAmt = 0;

    // particles: one instanced mesh, per-instance color
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
    this.pmesh = new THREE.InstancedMesh(geo, mat, MAX_PARTICLES);
    this.pmesh.frustumCulled = false;
    this.pmesh.count = 0;
    this.pmesh.setColorAt(0, new THREE.Color());
    scene.add(this.pmesh);
    this.particles = [];
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._c = new THREE.Color();
    this._e = new THREE.Euler();

    this.transients = []; // meshes with update(dt) -> alive
    this.numbers = [];
    this._v = new THREE.Vector3();
  }

  burst(x, y, z, color, n = 10, speed = 5, size = 0.15, life = 0.5, gravity = 12) {
    for (let i = 0; i < n; i++) {
      if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
      const a = Math.random() * Math.PI * 2;
      const u = Math.random() * 2 - 1;
      const s = speed * (0.4 + Math.random() * 0.6);
      const k = Math.sqrt(1 - u * u);
      this.particles.push({
        x,
        y,
        z,
        vx: Math.cos(a) * k * s,
        vy: Math.abs(u) * s + speed * 0.3,
        vz: Math.sin(a) * k * s,
        life: life * (0.6 + Math.random() * 0.4),
        max: life,
        size: size * (0.6 + Math.random() * 0.8),
        color,
        g: gravity,
        rot: Math.random() * 6,
      });
    }
  }

  // Trail puff that doesn't move much (dash trails, fire trails).
  puff(x, y, z, color, size = 0.3, life = 0.4) {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push({ x, y, z, vx: 0, vy: 0.8, vz: 0, life, max: life, size, color, g: 0, rot: Math.random() * 6 });
  }

  ring(x, z, radius, color, duration = 0.35, y = 0.08, thickness = 0.25) {
    const geo = new THREE.RingGeometry(0.85, 1, 40);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    let t = 0;
    this.transients.push({
      mesh,
      update: (dt) => {
        t += dt;
        const k = t / duration;
        const s = radius * (0.3 + 0.7 * Math.sqrt(k));
        mesh.scale.set(s, s, s);
        mat.opacity = 1 - k;
        return k < 1;
      },
    });
    void thickness;
  }

  // Filled telegraph disc that grows to warn the player (enemy windups).
  telegraph(x, z, radius, duration, color = 0xff3333) {
    const geo = new THREE.CircleGeometry(1, 32);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.05, z);
    this.scene.add(mesh);
    let t = 0;
    const handle = { dead: false };
    this.transients.push({
      mesh,
      update: (dt) => {
        t += dt;
        const k = Math.min(1, t / duration);
        const s = radius * k;
        mesh.scale.set(s, s, s);
        mat.opacity = 0.15 + 0.2 * k;
        return t < duration && !handle.dead;
      },
    });
    return handle;
  }

  // Sword arc in front of the attacker.
  slash(x, y, z, heading, radius, color = 0xffffff, arc = Math.PI * 0.75, tilt = 0) {
    const geo = new THREE.RingGeometry(radius * 0.35, radius, 24, 1, -arc / 2, arc);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    // ring lies in XY plane; tip +y onto +z (flat), then yaw to heading
    mesh.rotation.order = 'YXZ';
    mesh.rotation.set(Math.PI / 2 + tilt, heading, 0);
    // RingGeometry starts at +x; rotate so the arc centre points forward (+z local after flatten)
    geo.rotateZ(Math.PI / 2);
    this.scene.add(mesh);
    let t = 0;
    const dur = 0.18;
    this.transients.push({
      mesh,
      update: (dt) => {
        t += dt;
        mat.opacity = 0.8 * (1 - t / dur);
        mesh.scale.setScalar(0.9 + 0.3 * (t / dur));
        return t < dur;
      },
    });
  }

  disposeTransient(t) {
    if (t.dispose) return t.dispose();
    t.mesh.geometry.dispose();
    t.mesh.material.dispose();
  }

  // Stone spikes erupting from the ground.
  spikes(x, z, color, radius = 0.6) {
    const g = new THREE.Group();
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true, transparent: true });
    const n = 5 + Math.round(radius * 3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random();
      const r = radius * (0.3 + Math.random() * 0.7);
      const c = new THREE.Mesh(G.cone(0.18 + Math.random() * 0.12, 1, 5), m);
      c.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      c.rotation.set((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6);
      c.userData.h = 0.6 + Math.random() * 0.7;
      g.add(c);
    }
    g.position.set(x, 0, z);
    this.scene.add(g);
    let t = 0;
    this.transients.push({
      mesh: g,
      dispose: () => m.dispose(),
      update: (dt) => {
        t += dt;
        const up_ = t < 0.1 ? t / 0.1 : t > 0.45 ? Math.max(0, 1 - (t - 0.45) / 0.25) : 1;
        for (const c of g.children) {
          c.scale.set(1, c.userData.h * up_ + 0.01, 1);
          c.position.y = (c.userData.h * up_) / 2 - 0.1;
        }
        m.opacity = Math.min(1, up_ * 2);
        return t < 0.7;
      },
    });
  }

  fallingArrow(x, z) {
    if (!this.arrowMat) this.arrowMat = new THREE.MeshBasicMaterial({ color: 0xfff1c9 });
    const m = new THREE.Mesh(G.box(0.05, 0.9, 0.05), this.arrowMat);
    const y0 = 7 + Math.random() * 2;
    m.position.set(x, y0, z);
    this.scene.add(m);
    let t = 0;
    this.transients.push({
      mesh: m,
      dispose: () => {},
      update: (dt) => {
        t += dt;
        m.position.y = y0 - (y0 / 0.22) * t;
        if (m.position.y <= 0.3) {
          this.puff(x, 0.2, z, 0xb0a080, 0.2, 0.3);
          return false;
        }
        return true;
      },
    });
  }

  iceShards(x, z, R) {
    const m = new THREE.MeshStandardMaterial({ color: 0xbfefff, roughness: 0.1, emissive: 0x3388cc, emissiveIntensity: 0.5, transparent: true, opacity: 0.85, flatShading: true });
    const g = new THREE.Group();
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = R * (0.45 + Math.random() * 0.45);
      const c = new THREE.Mesh(G.octa(0.3), m);
      c.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      c.rotation.set((Math.random() - 0.5) * 0.8, a, (Math.random() - 0.5) * 0.8);
      c.userData.h = 1.5 + Math.random() * 1.5;
      g.add(c);
    }
    g.position.set(x, 0, z);
    this.scene.add(g);
    let t = 0;
    this.transients.push({
      mesh: g,
      dispose: () => m.dispose(),
      update: (dt) => {
        t += dt;
        const k = t < 0.12 ? t / 0.12 : 1;
        for (const c of g.children) c.scale.set(0.6 * k, c.userData.h * k, 0.6 * k);
        m.opacity = t < 0.5 ? 0.85 : Math.max(0, 0.85 - (t - 0.5) * 2.5);
        return t < 0.85;
      },
    });
  }

  meteor(x, z, dur) {
    const m = new THREE.MeshStandardMaterial({ color: 0x4a2a1a, emissive: 0xff5a1a, emissiveIntensity: 0.8, flatShading: true });
    const rock = new THREE.Mesh(G.ico(0.7, 0), m);
    this.scene.add(rock);
    let t = 0;
    const sx = x - 6;
    const sz = z - 3;
    this.transients.push({
      mesh: rock,
      dispose: () => m.dispose(),
      update: (dt) => {
        t += dt;
        const k = Math.min(1, t / dur);
        rock.position.set(sx + (x - sx) * k, 16 * (1 - k) + 0.3, sz + (z - sz) * k);
        rock.rotation.x += dt * 6;
        rock.rotation.z += dt * 4;
        this.puff(rock.position.x, rock.position.y, rock.position.z, Math.random() < 0.5 ? 0xff7a2e : 0xffc04a, 0.6, 0.35);
        return t < dur;
      },
    });
  }

  smoke(x, z) {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    const life = 1.2 + Math.random() * 0.8;
    const v = 0x70 + Math.floor(Math.random() * 0x30);
    this.particles.push({ x, y: 0.4 + Math.random() * 1.2, z, vx: (Math.random() - 0.5) * 1.5, vy: 0.4, vz: (Math.random() - 0.5) * 1.5, life, max: life, size: 0.9 + Math.random() * 0.7, color: (v << 16) | (v << 8) | (v + 10), g: 0, rot: Math.random() * 6, grow: true });
  }

  // Jagged bolt through a list of [x,y,z] points.
  lightning(pts, color = 0xaad4ff) {
    const g = new THREE.Group();
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const d = new THREE.Vector3();
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i];
      const p1 = pts[i + 1];
      const segs = 6;
      let prev = new THREE.Vector3(...p0);
      for (let s = 1; s <= segs; s++) {
        const k = s / segs;
        const next = new THREE.Vector3(p0[0] + (p1[0] - p0[0]) * k, p0[1] + (p1[1] - p0[1]) * k, p0[2] + (p1[2] - p0[2]) * k);
        if (s < segs) next.add(new THREE.Vector3((Math.random() - 0.5) * 0.7, (Math.random() - 0.5) * 0.7, (Math.random() - 0.5) * 0.7));
        a.copy(prev);
        b.copy(next);
        d.subVectors(b, a);
        const len = d.length();
        const c = new THREE.Mesh(G.cyl(0.05, 0.05, 1, 4), m);
        c.position.copy(a).addScaledVector(d, 0.5);
        c.quaternion.setFromUnitVectors(up, d.normalize());
        c.scale.set(1, len, 1);
        g.add(c);
        prev = next;
      }
      this.burst(p1[0], p1[1], p1[2], color, 6, 4, 0.08, 0.3, 2);
    }
    this.scene.add(g);
    let t = 0;
    this.transients.push({
      mesh: g,
      dispose: () => m.dispose(),
      update: (dt) => {
        t += dt;
        m.opacity = 1 - t / 0.25;
        for (const c of g.children) c.scale.x = c.scale.z = 1 + Math.random();
        return t < 0.25;
      },
    });
  }

  damageNumber(x, y, z, text, cls = '') {
    const el = document.createElement('div');
    el.className = 'dmg ' + cls;
    el.textContent = text;
    this.container.appendChild(el);
    this.numbers.push({ el, x: x + (Math.random() - 0.5) * 0.5, y, z: z + (Math.random() - 0.5) * 0.5, t: 0 });
    if (this.numbers.length > 40) {
      const old = this.numbers.shift();
      old.el.remove();
    }
  }

  shake(amount) {
    this.shakeAmt = Math.min(1.2, Math.max(this.shakeAmt, amount));
  }

  update(dt) {
    // particles
    const ps = this.particles;
    let n = 0;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) {
        ps.splice(i, 1);
        continue;
      }
      p.vy -= p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0.05) {
        p.y = 0.05;
        p.vy *= -0.3;
        p.vx *= 0.7;
        p.vz *= 0.7;
      }
      p.rot += dt * 6;
    }
    for (const p of ps) {
      const k = p.life / p.max;
      this._p.set(p.x, p.y, p.z);
      this._e.set(p.rot, p.rot * 0.7, 0);
      this._q.setFromEuler(this._e);
      const s = p.grow ? p.size * (0.5 + (1 - k) * 0.9) * Math.min(1, k * 4) : p.size * (0.3 + 0.7 * k);
      this._s.set(s, s, s);
      this._m.compose(this._p, this._q, this._s);
      this.pmesh.setMatrixAt(n, this._m);
      this._c.setHex(p.color);
      this.pmesh.setColorAt(n, this._c);
      n++;
    }
    this.pmesh.count = n;
    this.pmesh.instanceMatrix.needsUpdate = true;
    if (this.pmesh.instanceColor) this.pmesh.instanceColor.needsUpdate = true;

    // transient meshes
    for (let i = this.transients.length - 1; i >= 0; i--) {
      const t = this.transients[i];
      if (!t.update(dt)) {
        this.scene.remove(t.mesh);
        this.disposeTransient(t);
        this.transients.splice(i, 1);
      }
    }

    // floating numbers
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const d = this.numbers[i];
      d.t += dt;
      if (d.t > 0.8) {
        d.el.remove();
        this.numbers.splice(i, 1);
        continue;
      }
      this._v.set(d.x, d.y + d.t * 1.5, d.z).project(this.camera);
      if (this._v.z > 1) {
        d.el.style.display = 'none';
        continue;
      }
      d.el.style.display = '';
      const sx = (this._v.x * 0.5 + 0.5) * w;
      const sy = (-this._v.y * 0.5 + 0.5) * h;
      d.el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -50%) scale(${1 + Math.max(0, 0.15 - d.t) * 3})`;
      d.el.style.opacity = String(Math.min(1, (0.8 - d.t) * 4));
    }

    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 3);
  }

  clear() {
    for (const t of this.transients) {
      this.scene.remove(t.mesh);
      this.disposeTransient(t);
    }
    this.transients.length = 0;
    this.particles.length = 0;
    for (const d of this.numbers) d.el.remove();
    this.numbers.length = 0;
    this.pmesh.count = 0;
  }
}
