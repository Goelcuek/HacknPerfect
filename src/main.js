// Entry point: renderer setup, main loop, menu wiring.

import * as THREE from 'three';
import { Input } from './input.js';
import { UI } from './ui.js';
import { Game, loadBest } from './game.js';
import { initAudio } from './audio.js';

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const isTouchDevice = matchMedia('(pointer: coarse)').matches;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouchDevice ? 1.5 : 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);

const input = new Input(canvas);
const ui = new UI();
ui.setTouch(input.isTouch);
input.onModeChange = (on) => ui.setTouch(on);

const game = new Game(renderer, ui, input);
window.__game = game; // handy for debugging from the console

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
});
toTitle();

window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  game.resize(w, h);
});

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
