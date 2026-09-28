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

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const isTouchDevice = matchMedia('(pointer: coarse)').matches;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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

let bloom = null;
function applyQuality(q) {
  const dpr = window.devicePixelRatio;
  renderer.setPixelRatio(Math.min(dpr, q === 'high' ? 2 : q === 'medium' ? (isTouchDevice ? 1.25 : 1.5) : 1));
  renderer.shadowMap.enabled = q === 'high';
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  if (game.composer) {
    game.composer.dispose();
    game.composer = null;
  }
  if (q !== 'low') {
    const composer = new EffectComposer(renderer);
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
  game.state = 'title';
  game.setupBackdrop(chosenClass);
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
    ui.hidePause();
    toTitle();
  },
  equip: () => game.equipNearItem(),
  salvage: () => game.salvageNearItem(),
  pause: () => game.pause(),
  quality: cycleQuality,
});
game.quality = null;
applyQuality(loadQuality());
toTitle();

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
  if (document.hidden) game.pause();
});
document.addEventListener('pointerlockchange', () => {
  // leaving pointer lock with Esc on desktop pauses the game
  if (!document.pointerLockElement && game.state === 'play' && !input.isTouch) game.pause();
});

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
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
  if (game.player) game.render();
}
requestAnimationFrame(frame);
