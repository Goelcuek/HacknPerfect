// Unified input: keyboard + mouse on PC, virtual joystick + buttons on touch.
// Gameplay code reads a single `Input` state object each frame.

import { initAudio } from './audio.js';

export const SKILL_DIRS = ['up', 'right', 'down', 'left'];
const SWIPE_THRESHOLD = 28; // px from the attack button's touch start

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.moveX = 0; // -1..1, right positive
    this.moveY = 0; // -1..1, forward positive
    this.lookDX = 0; // accumulated pixels since last frame
    this.lookDY = 0;
    this.lastLookTime = 0;
    this.attackHeld = false;
    this.pressed = { jump: false, dash: false, attack: false, interact: false, pause: false, ping: false, help: false };
    this.skillPressed = -1;
    this.isTouch = matchMedia('(pointer: coarse)').matches;
    this.onModeChange = null;
    this.enabled = true;

    // touch-tracking
    this.joy = null; // { id, ox, oy, x, y }
    this.lookTouch = null; // { id, x, y }
    this.attackTouch = null; // { id, ox, oy, dir, t0 }
    this.attackSwipeDir = -1;

    this._bindKeyboard();
    this._bindMouse();
    this._bindTouch();
  }

  setTouchMode(on) {
    if (this.isTouch === on) return;
    this.isTouch = on;
    if (this.onModeChange) this.onModeChange(on);
  }

  _bindKeyboard() {
    const map = {
      Space: 'jump',
      ShiftLeft: 'dash',
      ShiftRight: 'dash',
      KeyJ: 'attack',
      KeyF: 'interact',
      KeyG: 'ping',
      KeyH: 'help',
      Escape: 'pause',
      KeyP: 'pause',
    };
    const skillKeys = { KeyQ: 0, Digit1: 0, KeyE: 1, Digit2: 1, KeyR: 2, Digit3: 2, KeyC: 3, Digit4: 3 };
    window.addEventListener('keydown', (e) => {
      initAudio();
      if (e.code === 'Tab') e.preventDefault();
      this.setTouchMode(false);
      if (e.repeat) return;
      this.keys.add(e.code);
      if (map[e.code]) {
        this.pressed[map[e.code]] = true;
        if (map[e.code] === 'attack') this.attackHeld = true;
        if (e.code === 'Space') e.preventDefault();
      }
      if (e.code in skillKeys) this.skillPressed = skillKeys[e.code];
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'KeyJ') this.attackHeld = false;
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.attackHeld = false;
    });
  }

  _bindMouse() {
    const c = this.canvas;
    this.mouseDrag = false;
    c.addEventListener('mousedown', (e) => {
      initAudio();
      this.setTouchMode(false);
      if (!this.enabled) return;
      if (document.pointerLockElement !== c && c.requestPointerLock) {
        // First click only captures the mouse; fall back to drag-look if lock is unavailable.
        try {
          const p = c.requestPointerLock();
          if (p && p.catch) p.catch(() => {});
        } catch (_) {
          /* pointer lock not allowed (e.g. sandboxed iframe) */
        }
      }
      // Without pointer lock (e.g. sandboxed iframe) any held button drags the camera.
      if (document.pointerLockElement !== c) this.mouseDrag = true;
      if (e.button === 0) {
        this.pressed.attack = true;
        this.attackHeld = true;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.attackHeld = false;
      this.mouseDrag = false;
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (this.isTouch) return;
      if (document.pointerLockElement === c || this.mouseDrag) {
        this.lookDX += e.movementX;
        this.lookDY += e.movementY;
        this.lastLookTime = performance.now();
      }
    });
  }

  _bindTouch() {
    const opts = { passive: false };
    const zoneFor = (t) => {
      const el = document.elementFromPoint(t.clientX, t.clientY);
      if (!el) return 'look';
      const btn = el.closest('[data-btn]');
      if (btn) return btn.dataset.btn;
      if (el.closest('.ui-block')) return 'ui';
      return t.clientX < window.innerWidth * 0.45 ? 'move' : 'look';
    };

    window.addEventListener(
      'touchstart',
      (e) => {
        initAudio();
        this.setTouchMode(true);
        if (!this.enabled) return;
        for (const t of e.changedTouches) {
          const zone = zoneFor(t);
          if (zone === 'ui') continue;
          e.preventDefault();
          if (zone === 'move' && !this.joy) {
            this.joy = { id: t.identifier, ox: t.clientX, oy: t.clientY, x: t.clientX, y: t.clientY };
          } else if (zone === 'look' && !this.lookTouch) {
            this.lookTouch = { id: t.identifier, x: t.clientX, y: t.clientY };
          } else if (zone === 'attack' && !this.attackTouch) {
            this.attackTouch = { id: t.identifier, ox: t.clientX, oy: t.clientY, dir: -1, t0: performance.now() };
            this.pressed.attack = true;
            this.attackHeld = true;
          } else if (zone === 'jump') {
            this.pressed.jump = true;
          } else if (zone === 'dash') {
            this.pressed.dash = true;
          } else if (zone === 'pause') {
            this.pressed.pause = true;
          } else if (zone === 'interact') {
            this.pressed.interact = true;
          } else if (zone.startsWith('skill')) {
            // tapping a skill icon directly also works
            this.skillPressed = +zone.slice(5);
          }
        }
      },
      opts,
    );

    window.addEventListener(
      'touchmove',
      (e) => {
        for (const t of e.changedTouches) {
          if (this.joy && t.identifier === this.joy.id) {
            this.joy.x = t.clientX;
            this.joy.y = t.clientY;
            e.preventDefault();
          } else if (this.lookTouch && t.identifier === this.lookTouch.id) {
            this.lookDX += (t.clientX - this.lookTouch.x) * 1.6;
            this.lookDY += (t.clientY - this.lookTouch.y) * 1.6;
            this.lookTouch.x = t.clientX;
            this.lookTouch.y = t.clientY;
            this.lastLookTime = performance.now();
            e.preventDefault();
          } else if (this.attackTouch && t.identifier === this.attackTouch.id) {
            const dx = t.clientX - this.attackTouch.ox;
            const dy = t.clientY - this.attackTouch.oy;
            let dir = -1;
            if (Math.hypot(dx, dy) > SWIPE_THRESHOLD) {
              if (Math.abs(dx) > Math.abs(dy)) dir = dx > 0 ? 1 : 3;
              else dir = dy < 0 ? 0 : 2;
            }
            this.attackTouch.dir = dir;
            this.attackSwipeDir = dir;
            // once swiping, stop auto-repeating the basic attack
            if (dir !== -1) this.attackHeld = false;
            e.preventDefault();
          }
        }
      },
      opts,
    );

    const end = (e) => {
      for (const t of e.changedTouches) {
        if (this.joy && t.identifier === this.joy.id) this.joy = null;
        else if (this.lookTouch && t.identifier === this.lookTouch.id) this.lookTouch = null;
        else if (this.attackTouch && t.identifier === this.attackTouch.id) {
          if (this.attackTouch.dir !== -1) this.skillPressed = this.attackTouch.dir;
          this.attackTouch = null;
          this.attackSwipeDir = -1;
          this.attackHeld = false;
        }
      }
    };
    window.addEventListener('touchend', end, opts);
    window.addEventListener('touchcancel', end, opts);
  }

  // Called once per frame before gameplay reads the state.
  poll() {
    if (this.isTouch && this.joy) {
      const R = 55;
      let dx = (this.joy.x - this.joy.ox) / R;
      let dy = (this.joy.y - this.joy.oy) / R;
      const m = Math.hypot(dx, dy);
      if (m > 1) {
        dx /= m;
        dy /= m;
      }
      // small dead zone
      if (m < 0.12) dx = dy = 0;
      this.moveX = dx;
      this.moveY = -dy;
    } else if (!this.isTouch || !this.joy) {
      let x = 0;
      let y = 0;
      const k = this.keys;
      if (k.has('KeyW') || k.has('ArrowUp')) y += 1;
      if (k.has('KeyS') || k.has('ArrowDown')) y -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
      const m = Math.hypot(x, y) || 1;
      this.moveX = x / m;
      this.moveY = y / m;
    }
  }

  consumeLook() {
    const d = { x: this.lookDX, y: this.lookDY };
    this.lookDX = this.lookDY = 0;
    return d;
  }

  endFrame() {
    for (const k in this.pressed) this.pressed[k] = false;
    this.skillPressed = -1;
  }

  reset() {
    this.endFrame();
    this.keys.clear();
    this.joy = this.lookTouch = this.attackTouch = null;
    this.attackHeld = false;
    this.attackSwipeDir = -1;
    this.lookDX = this.lookDY = 0;
  }
}
