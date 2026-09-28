// Layered animation controller for the rigged (KayKit) characters.
//
// A locomotion "base" (a speed-driven blend of idle / walk / run clips) always plays.
// One-shot or looping "overlays" (attacks, casts, hits, dodges) sit on top, either
// full-body or upper-body only; for upper-body overlays the legs keep running via a
// lower-body copy of the base clips. Weights are managed by hand so every bone's
// weights always sum to 1:
//   upper bones: base·(1-F-U) + fullOverlays·F + upperOverlays·U
//   lower bones: base·(1-F-U) + baseLower·U   + fullOverlays·F

import * as THREE from 'three';
import { clip as getClip } from './assets.js';

const UPPER = new Set(['spine', 'chest', 'head', 'upperarml', 'lowerarml', 'wristl', 'handl', 'handslotl', 'upperarmr', 'lowerarmr', 'wristr', 'handr', 'handslotr']);

const maskCache = new Map();
function masked(name, part) {
  const key = name + '|' + part;
  if (maskCache.has(key)) return maskCache.get(key);
  const src = getClip(name);
  if (!src) return null;
  const tracks = src.tracks.filter((t) => {
    const bone = t.name.split('.')[0];
    return part === 'upper' ? UPPER.has(bone) : !UPPER.has(bone);
  });
  const c = new THREE.AnimationClip(`${name}#${part}`, src.duration, tracks);
  maskCache.set(key, c);
  return c;
}

function clipFor(name, part) {
  return part === 'full' ? getClip(name) : masked(name, part);
}

export class Animator {
  constructor(root) {
    this.root = root;
    this.mixer = new THREE.AnimationMixer(root);
    this.base = new Map(); // name -> { w, target, full, lower, rate }
    this.overlays = []; // { name, part, action, w, target, fadeIn, fadeOut, t, dur, loop, hold }
    this.phase = 0; // shared normalized locomotion phase (0..1)
  }

  _action(name, part) {
    const c = clipFor(name, part);
    if (!c) return null;
    const a = this.mixer.clipAction(c);
    a.enabled = true;
    a.setEffectiveWeight(0);
    a.play();
    return a;
  }

  // Set the locomotion blend: { Idle: 1 } or { Walking_A: 0.3, Running_A: 0.7 }.
  // `cycle` (seconds per loop, for synced walk/run) advances the shared phase.
  setBase(weights, rates = {}) {
    for (const [name, w] of Object.entries(weights)) {
      let b = this.base.get(name);
      if (!b) {
        const full = this._action(name, 'full');
        if (!full) continue;
        b = { w: 0, target: 0, full, lower: null, rate: 1, synced: false };
        this.base.set(name, b);
      }
      b.target = w;
      b.rate = rates[name] ?? 1;
      b.synced = rates.sync?.includes(name) ?? false;
    }
    for (const [name, b] of this.base) if (!(name in weights)) b.target = 0;
  }

  // Play an overlay. part: 'full' | 'upper'. Returns the overlay record.
  play(name, o = {}) {
    const part = o.part || 'full';
    const c = clipFor(name, part);
    if (!c) return null;
    // re-triggering the same clip restarts it (combo chains of the same swing)
    if (!o.keep) for (const ov of this.overlays) if (ov.target > 0) ov.target = 0;
    const action = this.mixer.clipAction(c);
    action.reset();
    action.enabled = true;
    action.setLoop(o.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = true;
    action.setEffectiveWeight(0);
    const from = o.from ?? 0;
    action.time = from * c.duration;
    // fit the clip (or the part from `from` to `to`) into `dur` seconds
    const span = ((o.to ?? 1) - from) * c.duration;
    action.timeScale = o.speed ?? (o.dur ? span / o.dur : 1);
    action.play();
    const ov = {
      name,
      part,
      action,
      w: o.instant ? (o.weight ?? 1) : 0,
      target: o.weight ?? 1,
      fadeIn: o.fadeIn ?? 0.08,
      fadeOut: o.fadeOut ?? 0.15,
      t: 0,
      dur: o.dur ?? (o.loop ? Infinity : span / Math.abs(action.timeScale)),
      loop: !!o.loop,
      hold: !!o.hold,
    };
    // an overlay of the same clip+part replaces the old record
    this.overlays = this.overlays.filter((x) => x.action !== action);
    this.overlays.push(ov);
    return ov;
  }

  // Fade out every overlay (or those matching a name).
  stop(name = null, fade = 0.15) {
    for (const ov of this.overlays) {
      if (name && ov.name !== name) continue;
      ov.target = 0;
      ov.fadeOut = fade;
    }
  }

  active(name) {
    return this.overlays.some((o) => o.name === name && o.target > 0);
  }

  update(dt) {
    // overlays: advance and fade
    let F = 0;
    let U = 0;
    for (const ov of this.overlays) {
      ov.t += dt;
      if (!ov.loop && !ov.hold && ov.t >= ov.dur - ov.fadeOut * 0.5) ov.target = 0;
      const rate = ov.target > ov.w ? 1 / Math.max(1e-3, ov.fadeIn) : 1 / Math.max(1e-3, ov.fadeOut);
      ov.w += Math.sign(ov.target - ov.w) * Math.min(Math.abs(ov.target - ov.w), rate * dt);
    }
    this.overlays = this.overlays.filter((ov) => {
      if (ov.w <= 0 && ov.target <= 0) {
        ov.action.setEffectiveWeight(0);
        ov.action.stop();
        return false;
      }
      return true;
    });
    for (const ov of this.overlays) {
      if (ov.part === 'full') F += ov.w;
      else U += ov.w;
    }
    const tot = F + U;
    const norm = tot > 1 ? 1 / tot : 1;
    F *= norm;
    U *= norm;
    for (const ov of this.overlays) ov.action.setEffectiveWeight(ov.w * norm);

    // base: move weights toward targets, normalise
    let sum = 0;
    for (const b of this.base.values()) {
      b.w += (b.target - b.w) * Math.min(1, dt * 10);
      if (b.w < 0.001 && b.target === 0) b.w = 0;
      sum += b.w;
    }
    const baseW = 1 - F - U;
    for (const b of this.base.values()) {
      const w = sum > 0 ? b.w / sum : 0;
      b.full.setEffectiveWeight(w * baseW);
      b.full.timeScale = b.rate;
      if (U > 0.001 || b.lower) {
        if (!b.lower) b.lower = this._action(b.full.getClip().name, 'lower');
        if (b.lower) {
          b.lower.setEffectiveWeight(w * U);
          b.lower.timeScale = b.rate;
          b.lower.time = b.full.time;
        }
      }
    }
    // synced locomotion clips share a normalized phase so feet don't jump when blending
    let lead = null;
    for (const b of this.base.values()) if (b.synced && (!lead || b.w > lead.w)) lead = b;
    if (lead) {
      const d = lead.full.getClip().duration;
      const p = (lead.full.time % d) / d;
      for (const b of this.base.values()) if (b.synced && b !== lead) b.full.time = p * b.full.getClip().duration;
    }

    this.mixer.update(dt);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
  }
}
