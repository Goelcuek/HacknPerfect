// A rigged character instance: the skinned model, its animator, and helpers for the
// things gameplay needs from it (flips/leans via a mid-body pivot, hurt flashes,
// weapon tips for swing trails, accessory toggles and rarity tints).

import * as THREE from 'three';
import { cloneCharacter } from './assets.js';
import { Animator } from './animator.js';

export class CharacterModel {
  constructor(name, { scale = 0.8, pivotY = 0.95 } = {}) {
    const c = cloneCharacter(name);
    this.name = name;
    this.bones = c.bones;
    this.parts = c.parts;
    this.group = new THREE.Group(); // positioned/rotated by gameplay
    this.pivot = new THREE.Group(); // flips, leans, squash
    this.pivot.position.y = pivotY;
    this.inner = new THREE.Group();
    this.inner.position.y = -pivotY;
    this.group.add(this.pivot);
    this.pivot.add(this.inner);
    c.root.scale.setScalar(scale);
    this.inner.add(c.root);
    this.root = c.root;
    this.scale = scale;
    this.animator = new Animator(c.root);
    this.mats = [...new Set(Object.values(this.parts).map((p) => p.material))];
    this.flashCol = new THREE.Color();
    this.flashT = 0;
    this.tips = [];
    this._v = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  show(names, on = true) {
    for (const n of names) if (this.parts[n]) this.parts[n].visible = on;
  }

  only(all, visible) {
    for (const n of all) if (this.parts[n]) this.parts[n].visible = visible.includes(n);
  }

  bone(n) {
    return this.bones[n.replace(/\./g, '')];
  }

  // World-space tip of a weapon part (its geometry spans -1..1 along local Y).
  tipOf(part, out, along = 1) {
    return part.localToWorld(out.set(0, along, 0));
  }

  setTips(names) {
    this.tips = names.map((n) => this.parts[n]).filter(Boolean);
  }

  // Solid recolour of an accessory (the KayKit palette is flat swatches anyway).
  tint(name, hex, emissive = 0) {
    const p = this.parts[name];
    if (!p) return;
    if (!p.userData.ownMat) {
      p.material = p.material.clone();
      p.userData.ownMat = true;
      this.mats.push(p.material);
    }
    const m = p.material;
    if (!m.userData.origMap) m.userData.origMap = m.map || 'none';
    if (hex === null) {
      m.map = m.userData.origMap === 'none' ? null : m.userData.origMap;
      m.color.setHex(0xffffff);
    } else {
      m.map = null;
      m.color.setHex(hex);
    }
    m.emissive.setHex(emissive ? hex : 0x000000);
    m.emissiveIntensity = emissive;
    m.userData.baseEmissive = m.emissive.clone();
    m.userData.baseEI = emissive;
    m.needsUpdate = true;
  }

  glow(name, hex, intensity) {
    const p = this.parts[name];
    if (!p) return;
    if (!p.userData.ownMat) {
      p.material = p.material.clone();
      p.userData.ownMat = true;
      this.mats.push(p.material);
    }
    p.material.emissive.setHex(hex);
    p.material.emissiveIntensity = intensity;
    p.material.userData.baseEmissive = p.material.emissive.clone();
    p.material.userData.baseEI = intensity;
  }

  // Emissive glow over the body (not the gear in `skip`): burning / frozen armour.
  bodyGlow(hex, intensity, skip = []) {
    const skipSet = new Set(skip.map((n) => this.parts[n]).filter(Boolean));
    this.root.traverse((o) => {
      if (!o.isMesh || skipSet.has(o)) return;
      if (!o.userData.ownMat) {
        o.material = o.material.clone();
        o.userData.ownMat = true;
        this.mats.push(o.material);
      }
      const m = o.material;
      if (!m.emissive) return;
      m.emissive.setHex(hex || 0x000000);
      m.emissiveIntensity = hex ? intensity : 0;
      m.userData.baseEmissive = m.emissive.clone();
      m.userData.baseEI = m.emissiveIntensity;
    });
  }

  flash(hex, dur = 0.15, power = 0.45) {
    this.flashPower = power;
    this.flashCol.setHex(hex);
    this.flashT = dur;
    this.flashDur = dur;
  }

  // Yaw the head toward a relative angle (after the mixer has posed it).
  look(yaw, pitch = 0) {
    const h = this.bones.head;
    if (!h || (Math.abs(yaw) < 1e-3 && Math.abs(pitch) < 1e-3)) return;
    this._q.setFromAxisAngle(this._up, yaw);
    h.quaternion.premultiply(this._q);
    if (pitch) h.rotateX(pitch);
  }

  // Twist/bend the upper body (aiming up or down, following targets).
  bend(yaw, pitch) {
    const c = this.bones.chest;
    const s = this.bones.spine;
    if (!c || !s) return;
    this._q.setFromAxisAngle(this._up, yaw * 0.5);
    s.quaternion.premultiply(this._q);
    c.quaternion.premultiply(this._q);
    if (pitch) {
      s.rotateX(-pitch * 0.5);
      c.rotateX(-pitch * 0.5);
    }
  }

  update(dt) {
    this.animator.update(dt);
    if (this.flashT > 0 || this._flashing) {
      this.flashT = Math.max(0, this.flashT - dt);
      const k = this.flashT > 0 ? this.flashT / this.flashDur : 0;
      for (const m of this.mats) {
        const base = m.userData.baseEmissive;
        if (base) m.emissive.copy(base).lerp(this.flashCol, k);
        else m.emissive.copy(this.flashCol).multiplyScalar(k);
        m.emissiveIntensity = Math.max(m.userData.baseEI || 0, k * this.flashPower);
      }
      this._flashing = this.flashT > 0;
    }
  }

  setOpacity(a) {
    for (const m of this.mats) {
      m.transparent = a < 1;
      m.opacity = a;
      m.depthWrite = a >= 1;
    }
  }

  dispose() {
    this.animator.dispose();
    for (const m of this.mats) m.dispose();
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}
