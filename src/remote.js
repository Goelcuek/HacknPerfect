// Another player in a multiplayer session, as seen on this machine: their hero
// model driven by the state packets they send (interpolated ~100ms behind),
// replaying the exact animation calls their own client made. On the host it
// also stands in as a target for enemy AI: hurting it sends the damage to them.

import * as THREE from 'three';
import { buildHero, dressHero } from './hero.js';
import { CLASSES } from './classes.js';
import { clamp, partyColor } from './utils.js';

const DELAY = 0.1; // seconds of interpolation delay
const TAU = Math.PI * 2;

function label(text, color = '#9fe8ff') {
  const c = document.createElement('canvas');
  const x = c.getContext('2d');
  const font = 'bold 30px system-ui, sans-serif';
  x.font = font;
  c.width = Math.ceil(x.measureText(text).width + 24);
  c.height = 56;
  x.font = font;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.lineWidth = 6;
  x.strokeStyle = 'rgba(0,0,0,0.85)';
  x.strokeText(text, c.width / 2, 28);
  x.fillStyle = color;
  x.fillText(text, c.width / 2, 28);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(0.45 * (c.width / 56), 0.45, 1);
  s.renderOrder = 12;
  return s;
}

// Fake equipment from a look summary, enough for dressHero.
function lookToEquipment(look) {
  const it = (o) => (o ? { rarity: { tier: o.t, hex: o.h } } : null);
  return { weapon: it(look.w), armor: it(look.a), charm: it(look.c) };
}

export class RemotePlayer {
  constructor(game, id, info) {
    this.game = game;
    this.id = id;
    this.name = info.name || `P${id + 1}`;
    this.clsId = CLASSES[info.cls] ? info.cls : 'knight';
    this.radius = 0.45;
    this.x = info.x ?? 0;
    this.y = 0;
    this.z = info.z ?? 0;
    this.heading = 0;
    this.vx = 0;
    this.vz = 0;
    this.speed = 0;
    this.dead = false;
    this.inMenu = false;
    this.floor = info.floor ?? 0;
    this.hpFrac = 1;
    this.buf = [];
    this.model = buildHero(this.clsId);
    this.mesh = this.model.group;
    this.setLook(info.look || {});
    this.tag = label(`${this.name} · ${CLASSES[this.clsId].name}`, partyColor(id));
    this.tag.position.y = 2.55;
    this.mesh.add(this.tag);
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    game.scene.add(this.mesh);
    game.scene.add(this.shadow);
    game.applyShadows?.(this.mesh);
    this.localT = 0;
  }

  setLook(look) {
    this.look = look;
    dressHero(this.model, lookToEquipment(look));
  }

  // A state packet from the network (timestamped on arrival).
  push(st) {
    this.localT = this.localT || 0;
    this.buf.push({ ...st, t: this.localT });
    if (this.buf.length > 20) this.buf.shift();
    this.dead = !!st.d;
    this.inMenu = !!st.m;
    this.floor = st.f;
    this.hpFrac = st.hp ?? 1;
    // replay their animation calls in order
    const an = this.model.animator;
    for (const ev of st.a || []) {
      if (ev[0] === 'p') an.play(ev[1], ev[2] || {});
      else if (ev[0] === 's') an.stop(ev[1] || null, ev[2] ?? 0.15);
    }
  }

  // Host side: an enemy hit this player. The damage is theirs to apply.
  takeDamage(amount, source = null, melee = false) {
    if (this.dead || this.inMenu) return false;
    const n = this.game.net;
    const kx = source ? this.x - source.x : 0;
    const kz = source ? this.z - source.z : 0;
    n?.sendTo(this.id, 'hurt', { a: amount, m: melee ? 1 : 0, kx, kz, src: source?.id ?? -1 });
    return true;
  }

  get targetable() {
    return !this.dead && !this.inMenu && this.floor === this.game.floor;
  }

  update(dt) {
    this.localT += dt;
    const onFloor = this.floor === this.game.floor && !this.inMenu;
    this.mesh.visible = onFloor;
    this.shadow.visible = onFloor;
    if (!this.buf.length) return;
    // interpolate between the two packets around (now - DELAY)
    const rt = this.localT - DELAY;
    let a = this.buf[0];
    let b = this.buf[this.buf.length - 1];
    for (let i = 0; i < this.buf.length - 1; i++) {
      if (this.buf[i].t <= rt && this.buf[i + 1].t >= rt) {
        a = this.buf[i];
        b = this.buf[i + 1];
        break;
      }
    }
    const span = Math.max(1e-3, b.t - a.t);
    const k = clamp((rt - a.t) / span, 0, 1);
    const px = this.x;
    const pz = this.z;
    this.x = a.x + (b.x - a.x) * k;
    this.y = a.y + (b.y - a.y) * k;
    this.z = a.z + (b.z - a.z) * k;
    let dh = (b.h - a.h) % TAU;
    if (dh > Math.PI) dh -= TAU;
    if (dh < -Math.PI) dh += TAU;
    this.heading = a.h + dh * k;
    const inst = Math.hypot(this.x - px, this.z - pz) / Math.max(dt, 1e-3);
    this.speed += (Math.min(inst, 30) - this.speed) * Math.min(1, dt * 10);
    this.vx = (this.x - px) / Math.max(dt, 1e-3);
    this.vz = (this.z - pz) / Math.max(dt, 1e-3);
    const s = b;

    // locomotion base, as the owner's client would pick it
    const model = this.model;
    const an = model.animator;
    const cfg = model.cfg;
    const idle = this.clsId === 'barbarian' ? '2H_Melee_Idle' : 'Idle';
    if (!s.g) an.setBase({ Jump_Idle: 1 });
    else if (this.speed < 0.35) an.setBase({ [idle]: 1 });
    else {
      const hs = this.speed;
      const wr = clamp((hs - 2.2) / 2.8, 0, 1);
      const w = { Walking_A: 1 - wr, [cfg.run]: wr };
      if (hs < 1.2) w[idle] = 1 - hs / 1.2;
      an.setBase(w, { Walking_A: clamp(hs / 2.4, 0.6, 1.5), [cfg.run]: clamp(hs / 5.5, 0.7, 1.6), sync: ['Walking_A', cfg.run] });
    }
    const g = model.group;
    g.position.set(this.x, this.y, this.z);
    g.rotation.y = this.heading;
    g.scale.setScalar(s.s || 1);
    model.update(dt);
    model.pivot.rotation.set(s.px || 0, s.py || 0, s.pz || 0);
    if (model.orbit) {
      const t = this.localT;
      model.orbit.position.set(Math.cos(t * 2) * 0.7, 1.6 + Math.sin(t * 3) * 0.12, Math.sin(t * 2) * 0.7);
    }
    const ground = this.game.dungeon ? this.game.dungeon.maxHeightUnder(this.x, this.z, 0.2) : 0;
    this.shadow.position.set(this.x, ground + 0.03, this.z);
    this.tag.material.opacity = this.dead ? 0.5 : 1;
  }

  dispose() {
    this.game.scene.remove(this.mesh);
    this.game.scene.remove(this.shadow);
    this.tag.material.map?.dispose();
    this.tag.material.dispose();
    this.shadow.geometry.dispose();
    this.shadow.material.dispose();
    this.model.dispose();
  }
}
