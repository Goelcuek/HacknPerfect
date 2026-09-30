// Entry point: renderer setup, main loop, menu wiring.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { Game, loadBest } from './game.js';
import { initAudio } from './audio.js';
import { loadAssets } from './assets.js';
import { readSave, clearSave } from './save.js';

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const isTouchDevice = matchMedia('(pointer: coarse)').matches;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.type = THREE.PCFShadowMap; // soft PCF costs noticeably more per pixel
renderer.setSize(window.innerWidth, window.innerHeight, false);

// Graphics quality: low (no bloom/shadows), medium (bloom), high (bloom + shadows)
const QUALITY_KEY = 'hacknperfect.quality';
const QUALITIES = ['low', 'medium', 'high'];
function loadQuality() {
  try {
    const q = localStorage.getItem(QUALITY_KEY);
    if (QUALITIES.includes(q)) return q;
  } catch (_) {
    /* storage unavailable */
  }
  return isTouchDevice ? 'medium' : 'high';
}

const input = new Input(canvas);
const ui = new UI();
ui.setTouch(input.isTouch);
input.onModeChange = (on) => ui.setTouch(on);

const game = new Game(renderer, ui, input);
window.__game = game; // handy for debugging from the console

// soft studio reflections so metal armor and weapons catch light
const pmrem = new THREE.PMREMGenerator(renderer);
game.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
game.scene.environmentIntensity = 0.28;

const frameStats = {
  sum: 0,
  n: 0,
  missed: 0,
  reset() {
    this.sum = 0;
    this.n = 0;
    this.missed = 0;
  },
};
let bloom = null;
// Render resolution (as a multiple of CSS pixels): the setting's ceiling, lowered
// automatically when the device can't keep up (see adaptResolution).
let maxPixelRatio = 1;
let pixelRatio = 1;
function applyQuality(q) {
  const dpr = window.devicePixelRatio;
  maxPixelRatio = Math.min(dpr, q === 'high' ? 1.5 : q === 'medium' ? (isTouchDevice ? 1.25 : 1.5) : 1);
  pixelRatio = maxPixelRatio;
  frameStats.reset();
  renderer.setPixelRatio(pixelRatio);
  renderer.shadowMap.enabled = q === 'high';
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  if (game.composer) {
    game.composer.dispose();
    game.composer = null;
  }
  if (q !== 'low') {
    // Post-processing renders offscreen, where the canvas's own antialiasing doesn't
    // apply: give its buffers 4x MSAA instead (WebGL2 multisampled render targets).
    const pr = renderer.getPixelRatio();
    const target = new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.HalfFloatType, samples: Math.min(4, renderer.capabilities.maxSamples || 0) });
    target.texture.name = 'EffectComposer.rt1';
    const composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(game.scene, game.camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.55, 0.45, 0.8);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
    game.composer = composer;
  }
  const rebuild = game.quality !== q && game.dungeon;
  game.setQuality(q);
  game.resize(w, h);
  if (rebuild && (game.state === 'title' || game.state === 'classSelect')) {
    // rebuild the backdrop floor at the new detail level (loadFloor clears the old one)
    game.loadFloor(1, true);
    game.setupBackdrop(chosenClass);
  }
  // shadows on/off and the new render target change every shader: compile them now
  game.prewarmShaders();
  ui.setQualityLabel(q);
  try {
    localStorage.setItem(QUALITY_KEY, q);
  } catch (_) {
    /* storage unavailable */
  }
}
function cycleQuality() {
  applyQuality(QUALITIES[(QUALITIES.indexOf(game.quality) + 1) % QUALITIES.length]);
}

let chosenClass = 'knight';

function toTitle() {
  if (game.net.mode) game.net.leave();
  game.state = 'title';
  game.setupBackdrop(chosenClass);
  ui.savedRun = readSave();
  ui.showTitle(loadBest());
}

function toClassSelect() {
  initAudio();
  game.state = 'classSelect';
  game.setupBackdrop(chosenClass);
  ui.showClassSelect(
    chosenClass,
    (id) => {
      chosenClass = id;
      game.setupBackdrop(id);
    },
    startRun,
    toTitle,
  );
}

function startRun() {
  initAudio();
  if (game.net.isClient) {
    // joining: the host answers with the floor to drop into
    game.pendingClass = chosenClass;
    game.net.sendHello(chosenClass);
    ui.toast('Joining the host…', 3);
    return;
  }
  ui.showHUD();
  game.startRun(chosenClass);
  ui.refreshSkills(game.player);
  input.reset();
}

ui.bindMenus({
  play: toClassSelect,
  again: toClassSelect,
  title: toTitle,
  resume: () => game.resume(),
  quit: () => {
    // abandoning a solo run throws its save away
    if (!game.net.mode) clearSave();
    ui.hidePause();
    toTitle();
  },
  saveQuit: () => {
    game.saveRun();
    ui.hidePause();
    toTitle();
  },
  resume_run: () => {
    initAudio();
    const s = readSave();
    if (!s) return toTitle();
    chosenClass = s.cls;
    game.resumeRun(s);
  },
  equip: () => game.equipNearItem(),
  salvage: () => game.salvageNearItem(),
  pause: () => game.pause(),
  quality: cycleQuality,
  fps: () => setPerf(!perf.on),
});
// ---- multiplayer lobby
game.net.onStatus = (msg) => {
  ui.mpStatus(msg);
  if (game.state === 'classSelect') ui.toast(msg, 3);
};
ui.bindMultiplayer({
  open: () => {
    initAudio();
    ui.showMultiplayer('choose');
  },
  back: toTitle,
  host: async () => {
    ui.showMultiplayer('host', { status: 'Opening a game…' });
    try {
      const pin = await game.net.host();
      ui.showMultiplayer('host', { pin, status: 'Ready! Friends can join now — or later, mid-run.' });
    } catch (e) {
      ui.showMultiplayer('host', {});
      ui.mpStatus(e.message, true);
    }
  },
  hostGo: toClassSelect,
  cancel: () => {
    game.net.leave();
    ui.showMultiplayer('choose');
  },
  join: async (pin) => {
    ui.mpStatus('Connecting…');
    try {
      await game.net.join(pin);
      toClassSelect();
      ui.toast('Connected! Choose your hero', 2.5, '#9fe8ff');
    } catch (e) {
      ui.mpStatus(e.message, true);
    }
  },
});

game.quality = null;
const loadEl = document.getElementById('loading');
loadAssets((f) => {
  if (loadEl) loadEl.style.setProperty('--p', f);
})
  .then(() => {
    applyQuality(loadQuality());
    let fps = /[?&]fps\b/.test(location.search);
    try {
      fps ||= localStorage.getItem('hacknperfect.fps') === '1';
    } catch (_) {
      /* storage unavailable */
    }
    setPerf(fps);
    toTitle();
    loadEl?.classList.add('done');
    setTimeout(() => loadEl?.remove(), 600);
  })
  .catch((err) => {
    console.error(err);
    if (loadEl) loadEl.querySelector('.ltext').textContent = 'Could not load the game assets. Check your connection and reload.';
  });

window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  if (game.composer) game.composer.setSize(w, h);
  game.resize(w, h);
});

// Android back button (called by the APK wrapper): pause / resume the run.
// Returns false when there is nothing to back out of, so the app can close.
window.__androidBack = () => {
  if (game.state === 'play') { game.pause(); return true; }
  if (game.state === 'pause') { game.resume(); return true; }
  return false;
};

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    game.saveRun();
    game.pause();
  }
});
// closing the tab / app keeps the run
window.addEventListener('pagehide', () => game.saveRun());
document.addEventListener('pointerlockchange', () => {
  // leaving pointer lock with Esc on desktop pauses the game
  if (!document.pointerLockElement && game.state === 'play' && !input.isTouch) game.pause();
});

// Frame pacing and dynamic resolution.
//
// The display's refresh interval is measured from requestAnimationFrame itself (a
// low percentile of recent gaps, so slow frames don't skew it). Frames are drawn on
// every Nth refresh, N = refresh rate / 60 rounded: 60 fps on 60/120/240 Hz, and an
// even 45/72/55 fps on 90/144/165 Hz screens. Always the same number of refreshes
// between frames, because uneven gaps (60 fps on a 90 Hz screen alternates 11 and
// 22 ms) read as stutter.
//
// Dynamic resolution: when more than 1 frame in 12 misses its slot (or frames run
// long on average), render at a lower resolution, 0.25 at a time, down to 0.75
// pixels per CSS pixel.
const gaps = [];
let vsync = 1000 / 60;
let lastRaf = performance.now();
function measureRefresh(now) {
  const g = now - lastRaf;
  lastRaf = now;
  if (g < 3 || g > 50) return;
  gaps.push(g);
  if (gaps.length > 60) gaps.shift();
  if (gaps.length >= 20 && gaps.length % 10 === 0) {
    const sorted = gaps.slice().sort((a, b) => a - b);
    vsync = sorted[Math.floor(sorted.length * 0.2)];
  }
}
const refreshesPerFrame = () => Math.max(1, Math.round(1000 / 60 / vsync));

let settleT = 0;
function adaptResolution(ms, budget) {
  if (game.state !== 'play' || document.hidden || ms > 250) return frameStats.reset();
  if (settleT > 0) return settleT--;
  frameStats.sum += ms;
  if (ms > budget * 1.5) frameStats.missed++;
  if (++frameStats.n < 96) return;
  const avg = frameStats.sum / frameStats.n;
  const missed = frameStats.missed;
  frameStats.reset();
  const floor = Math.min(0.75, maxPixelRatio);
  if ((avg > budget * 1.2 || missed >= 8) && pixelRatio > floor + 0.01) {
    pixelRatio = Math.max(floor, pixelRatio - 0.25);
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(w, h, false);
    if (game.composer) {
      game.composer.setPixelRatio(pixelRatio);
      game.composer.setSize(w, h);
    }
    settleT = 60; // resizing the buffers costs a frame or two: don't count those
  }
}

// Optional FPS meter (Graphics menu → "FPS" or ?fps): frame rate, worst frame and
// hitches in the last 2 s, a frame-time graph, resolution scale and refresh rate.
const perf = { on: false, ms: new Float32Array(120), i: 0, el: null, t: 0 };
function setPerf(on) {
  perf.on = on;
  try {
    localStorage.setItem('hacknperfect.fps', on ? '1' : '0');
  } catch (_) {
    /* storage unavailable */
  }
  ui.setFpsLabel?.(on);
  if (on && !perf.el) {
    perf.el = document.createElement('canvas');
    perf.el.id = 'perfMeter';
    perf.el.width = 240;
    perf.el.height = 64;
    document.body.appendChild(perf.el);
  }
  if (perf.el) perf.el.style.display = on ? 'block' : 'none';
}
function drawPerf(ms, budget) {
  perf.ms[perf.i++ % perf.ms.length] = ms;
  if (++perf.t % 10) return;
  const c = perf.el.getContext('2d');
  const n = Math.min(perf.i, perf.ms.length);
  let sum = 0;
  let worst = 0;
  let hitches = 0;
  for (let k = 0; k < n; k++) {
    const v = perf.ms[k];
    sum += v;
    worst = Math.max(worst, v);
    if (v > budget * 1.5) hitches++;
  }
  c.clearRect(0, 0, 240, 64);
  c.fillStyle = 'rgba(0,0,0,0.6)';
  c.fillRect(0, 0, 240, 64);
  for (let k = 0; k < perf.ms.length; k++) {
    const v = perf.ms[(perf.i + k) % perf.ms.length];
    c.fillStyle = v > budget * 1.5 ? '#ff5050' : v > budget * 1.15 ? '#ffc040' : '#50e070';
    const h = Math.min(40, (v / 50) * 40);
    c.fillRect(k * 2, 64 - h, 2, h);
  }
  c.fillStyle = '#fff';
  c.font = '11px monospace';
  c.fillText(`${(1000 / (sum / n)).toFixed(0)} fps  worst ${worst.toFixed(0)} ms  hitches ${hitches}`, 4, 12);
  c.fillText(`${Math.round(1000 / vsync)} Hz ÷${refreshesPerFrame()}  res ${pixelRatio.toFixed(2)}x  ${game.quality}`, 4, 24);
}

let last = performance.now();
let lastDraw = last;
function frame(now) {
  requestAnimationFrame(frame);
  measureRefresh(now);
  const every = refreshesPerFrame();
  // draw on every Nth refresh (half a refresh of slack for timestamp jitter)
  if (now - lastDraw < every * vsync - vsync * 0.5) return;
  lastDraw = now;
  const ms = now - last;
  const dt = Math.min(0.05, ms / 1000);
  last = now;
  if (window.__manual) return;
  const budget = every * vsync;
  adaptResolution(ms, budget);
  if (perf.on) drawPerf(ms, budget);
  step(dt);
  if (game.player) game.render();
}

// Test hook: set window.__manual = true to stop the clock, then __advance(seconds)
// steps the simulation at a fixed 60 Hz (used by the headless screenshot tests).
window.__advance = (sec) => {
  for (let t = 0; t < sec - 1e-6; t += 1 / 60) step(1 / 60);
  if (game.player) game.render();
};

function step(dt) {
  if (game.state === 'title' || game.state === 'classSelect') {
    game.updateBackdrop(dt, game.state);
  } else {
    game.update(dt);
    if (game.state === 'play') ui.update(dt, game, input);
    else if (game.state === 'dead') {
      game.effects.update(dt);
      ui.update(dt, game, input);
    }
  }
  if (game.state === 'pause' && input.pressed.pause) {
    input.endFrame();
    game.resume();
  }
}
requestAnimationFrame(frame);
