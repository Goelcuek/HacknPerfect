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
  reset() {
    this.sum = 0;
    this.n = 0;
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

// Dynamic resolution: if frames average slower than ~48 fps for a second of play,
// render at a lower resolution (down to 1 pixel per CSS pixel, or 0.75 on Low).
function adaptResolution(ms) {
  if (game.state !== 'play' || document.hidden || ms > 250) return frameStats.reset();
  frameStats.sum += ms;
  if (++frameStats.n < 60) return;
  const avg = frameStats.sum / frameStats.n;
  frameStats.reset();
  const floor = game.quality === 'low' ? 0.75 : Math.min(1, maxPixelRatio);
  if (avg > 21 && pixelRatio > floor) {
    pixelRatio = Math.max(floor, pixelRatio - 0.25);
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(w, h, false);
    if (game.composer) {
      game.composer.setPixelRatio(pixelRatio);
      game.composer.setSize(w, h);
    }
  }
}

// Capped at 60 fps: on 90/120/144 Hz screens, skip display refreshes so that a frame
// is drawn every 1/60 s on average (keeping the cadence instead of just enforcing a
// minimum gap, which would fall to 48 fps at 144 Hz). Saves battery and heat.
const FRAME_MS = 1000 / 60;
let last = performance.now();
let lastDraw = last;
function frame(now) {
  requestAnimationFrame(frame);
  const since = now - lastDraw;
  if (since < FRAME_MS - 1.5) return;
  lastDraw = now - (since % FRAME_MS > FRAME_MS - 1.5 ? 0 : since % FRAME_MS);
  const ms = now - last;
  const dt = Math.min(0.05, ms / 1000);
  last = now;
  if (window.__manual) return;
  adaptResolution(ms);
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
