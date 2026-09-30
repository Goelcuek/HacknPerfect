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
    // recycled particle objects and damage-number elements: effects fire constantly in
    // a fight, and fresh garbage for every spark means GC pauses (stutter) on phones
    this.freeParticles = [];
    this.freeNumbers = [];
    this._v = new THREE.Vector3();
    this.groundAt = () => 0; // floor height at (x, z), set by the game
  }

  // Heights under 0.35 mean "just above the ground": lift them onto the floor at (x, z)
  // (raised platforms, stairs). Real positions up there are always higher than that.
  gy(x, y, z) {
    return y < 0.35 ? this.groundAt(x, z) + y : y;
  }

  // A particle from the pool (null when the budget is used up: skip it).
  particle(x, y, z, vx, vy, vz, life, max, size, color, g, floor, grow = false) {
    if (this.particles.length >= MAX_PARTICLES) return null;
    const p = this.freeParticles.pop() || {};
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
    p.life = life;
    p.max = max;
    p.size = size;
    p.color = color;
    p.g = g;
    p.rot = Math.random() * 6;
    p.floor = floor;
    p.grow = grow;
    this.particles.push(p);
    return p;
  }

  burst(x, y, z, color, n = 10, speed = 5, size = 0.15, life = 0.5, gravity = 12) {
    y = this.gy(x, y, z);
    const floor = this.groundAt(x, z);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const u = Math.random() * 2 - 1;
      const s = speed * (0.4 + Math.random() * 0.6);
      const k = Math.sqrt(1 - u * u);
      this.particle(x, y, z, Math.cos(a) * k * s, Math.abs(u) * s + speed * 0.3, Math.sin(a) * k * s, life * (0.6 + Math.random() * 0.4), life, size * (0.6 + Math.random() * 0.8), color, gravity, floor);
    }
  }

  // Trail puff that doesn't move much (dash trails, fire trails).
  puff(x, y, z, color, size = 0.3, life = 0.4) {
    this.particle(x, this.gy(x, y, z), z, 0, 0.8, 0, life, life, size, color, 0, -99);
  }

  ring(x, z, radius, color, duration = 0.35, y = 0.08, thickness = 0.25) {
    const geo = new THREE.RingGeometry(0.85, 1, 40);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, this.gy(x, y, z), z);
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
    mesh.position.set(x, this.groundAt(x, z) + 0.05, z);
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
    g.position.set(x, this.groundAt(x, z), z);
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
    const ground = this.groundAt(x, z);
    const y0 = ground + 7 + Math.random() * 2;
    m.position.set(x, y0, z);
    this.scene.add(m);
    let t = 0;
    this.transients.push({
      mesh: m,
      dispose: () => {},
      update: (dt) => {
        t += dt;
        m.position.y = y0 - ((y0 - ground) / 0.22) * t;
        if (m.position.y <= ground + 0.3) {
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
    g.position.set(x, this.groundAt(x, z), z);
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
    const ground = this.groundAt(x, z);
    this.transients.push({
      mesh: rock,
      dispose: () => m.dispose(),
      update: (dt) => {
        t += dt;
        const k = Math.min(1, t / dur);
        rock.position.set(sx + (x - sx) * k, 16 * (1 - k) + 0.3 + ground, sz + (z - sz) * k);
        rock.rotation.x += dt * 6;
        rock.rotation.z += dt * 4;
        this.puff(rock.position.x, rock.position.y, rock.position.z, Math.random() < 0.5 ? 0xff7a2e : 0xffc04a, 0.6, 0.35);
        return t < dur;
      },
    });
  }

  smoke(x, z) {
    const life = 1.2 + Math.random() * 0.8;
    const v = 0x70 + Math.floor(Math.random() * 0x30);
    const floor = this.groundAt(x, z);
    this.particle(x, floor + 0.4 + Math.random() * 1.2, z, (Math.random() - 0.5) * 1.5, 0.4, (Math.random() - 0.5) * 1.5, life, life, 0.9 + Math.random() * 0.7, (v << 16) | (v << 8) | (v + 10), 0, floor, true);
  }

  // Jagged bolt through a list of [x,y,z] points.
  lightning(pts, color = 0xaad4ff) {
    pts = pts.map(([x, y, z]) => [x, this.gy(x, y, z), z]);
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
    if (this.numbers.length >= 40) this.releaseNumber(this.numbers.shift());
    let el = this.freeNumbers.pop();
    if (!el) {
      el = document.createElement('div');
      this.container.appendChild(el);
    }
    el.className = 'dmg ' + cls;
    el.textContent = text;
    el.style.display = '';
    this.numbers.push({ el, x: x + (Math.random() - 0.5) * 0.5, y, z: z + (Math.random() - 0.5) * 0.5, t: 0 });
  }

  releaseNumber(d) {
    d.el.style.display = 'none';
    this.freeNumbers.push(d.el);
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
        // swap-remove (order doesn't matter) and recycle
        ps[i] = ps[ps.length - 1];
        ps.pop();
        this.freeParticles.push(p);
        continue;
      }
      p.vy -= p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const fl = (p.floor ?? 0) + 0.05;
      if (p.y < fl) {
        p.y = fl;
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
    // upload only the live part of the instance buffers
    const im = this.pmesh.instanceMatrix;
    im.clearUpdateRanges();
    im.addUpdateRange(0, Math.max(1, n) * 16);
    im.needsUpdate = true;
    const ic = this.pmesh.instanceColor;
    if (ic) {
      ic.clearUpdateRanges();
      ic.addUpdateRange(0, Math.max(1, n) * 3);
      ic.needsUpdate = true;
    }

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
        this.releaseNumber(d);
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
    for (const p of this.particles) this.freeParticles.push(p);
    this.particles.length = 0;
    for (const d of this.numbers) this.releaseNumber(d);
    this.numbers.length = 0;
    this.pmesh.count = 0;
  }
}

// Ribbon that follows a weapon between its hilt and tip while swinging.
export class Trail {
  constructor(scene, color = 0xffffff, segs = 14) {
    this.segs = segs;
    this.pts = []; // [{a: Vector3, b: Vector3}]
    const n = segs * 2;
    this.pos = new Float32Array(n * 3);
    this.alpha = new Float32Array(n);
    const idx = [];
    for (let i = 0; i < segs - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    g.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 uColor; varying float vA; void main(){ gl_FragColor = vec4(uColor * vA, 1.0); }',
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.fade = 0;
  }

  setColor(hex) {
    this.mat.uniforms.uColor.value.setHex(hex);
  }

  // a/b: hilt and tip world positions; active: currently swinging
  update(dt, a, b, active) {
    this.fade = active ? Math.min(1, this.fade + dt * 12) : Math.max(0, this.fade - dt * 5);
    if (this.fade <= 0) {
      this.mesh.visible = false;
      this.pts.length = 0;
      return;
    }
    this.pts.unshift({ a: a.clone(), b: b.clone() });
    if (this.pts.length > this.segs) this.pts.length = this.segs;
    const n = this.pts.length;
    for (let i = 0; i < this.segs; i++) {
      const p = this.pts[Math.min(i, n - 1)];
      this.pos.set([p.a.x, p.a.y, p.a.z], i * 6);
      this.pos.set([p.b.x, p.b.y, p.b.z], i * 6 + 3);
      const k = i < n ? (1 - i / this.segs) ** 1.5 * this.fade * 0.7 : 0;
      this.alpha[i * 2] = k * 0.15;
      this.alpha[i * 2 + 1] = k;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.alpha.needsUpdate = true;
    this.mesh.visible = n > 1;
  }

  dispose() {
    this.mesh.parent && this.mesh.parent.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
