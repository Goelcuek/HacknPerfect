// Tiny synthesized sound effects via WebAudio — no asset files needed.

let ctx = null;
let master = null;
let muted = false;
let noiseBuf = null;

export function initAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.35;
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

export function setMuted(m) {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.35;
}
export const isMuted = () => muted;

function tone(type, f0, f1, dur, vol = 0.3, delay = 0) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur, freq, q = 1, vol = 0.3, type = 'bandpass', freqEnd = null) {
  if (!ctx || muted) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur + 0.02);
}

export const sfx = {
  step: () => noise(0.05, 300 + Math.random() * 200, 1.2, 0.06, 'lowpass'),
  swing: () => noise(0.12, 1800, 0.8, 0.25, 'bandpass', 600),
  hit: () => {
    tone('square', 220, 60, 0.1, 0.18);
    noise(0.08, 900, 1, 0.25);
  },
  crit: () => {
    tone('square', 440, 80, 0.15, 0.2);
    noise(0.12, 1400, 1, 0.3);
  },
  jump: () => tone('sine', 300, 600, 0.12, 0.15),
  djump: () => tone('sine', 500, 900, 0.12, 0.15),
  dash: () => noise(0.18, 600, 0.6, 0.3, 'bandpass', 3000),
  coin: () => {
    tone('square', 1200, 1200, 0.05, 0.08);
    tone('square', 1600, 1600, 0.08, 0.08, 0.05);
  },
  hurt: () => tone('sawtooth', 200, 50, 0.25, 0.25),
  boom: () => {
    noise(0.4, 300, 0.5, 0.5, 'lowpass', 60);
    tone('sine', 120, 30, 0.35, 0.3);
  },
  fire: () => noise(0.25, 800, 0.5, 0.25, 'bandpass', 2400),
  frost: () => {
    noise(0.4, 4000, 2, 0.2, 'highpass');
    tone('triangle', 1800, 600, 0.3, 0.1);
  },
  pickup: () => {
    tone('triangle', 500, 500, 0.06, 0.15);
    tone('triangle', 750, 750, 0.06, 0.15, 0.06);
    tone('triangle', 1000, 1000, 0.1, 0.15, 0.12);
  },
  portal: () => tone('sine', 200, 1200, 0.8, 0.2),
  death: () => tone('sawtooth', 300, 30, 1.2, 0.3),
  enemyDie: () => noise(0.2, 500, 0.7, 0.2, 'lowpass', 100),
  arrow: () => noise(0.1, 2500, 3, 0.12),
  slam: () => {
    noise(0.35, 200, 0.5, 0.45, 'lowpass', 40);
    tone('sine', 90, 30, 0.3, 0.35);
  },
  heal: () => {
    tone('sine', 600, 900, 0.2, 0.15);
    tone('sine', 900, 1300, 0.25, 0.12, 0.1);
  },
  ui: () => tone('triangle', 700, 900, 0.05, 0.12),
};
