// Soundtrack: an original score in the spirit of old RuneScape tunes — harp arpeggios,
// flute / oboe / brass leads over string pads, pizzicato bass and timpani, all in a
// hall reverb. Nothing is recorded: every track is written from a small recipe (key,
// mode, tempo, chords, instruments) and a seeded melody generator gives each one its
// own tune in an AABA form, played by a look-ahead scheduler on the sound-effect
// context. One track per floor setting, plus the title, the den-boss fight and the
// throne of every fifth floor.

import { audioCtx } from './audio.js';

const PREF = 'hacknperfect.music';
const VOLUME = 0.55;

const MODES = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixo: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  harmonic: [0, 2, 3, 5, 7, 8, 11],
  phrydom: [0, 1, 4, 5, 7, 8, 10],
};

// Drum patterns: one character per eighth note of a 4/4 bar.
const DRUMS = {
  soft: { timp: 'x.......' },
  march: { timp: 'x...x...', snare: '......x.', shaker: '.x.x.x.x' },
  tribal: { timp: 'x..x..x.', shaker: '..x...x.' },
  festive: { timp: 'x...x...', snare: '..x..xx.', shaker: '.x.x.x.x' },
  war: { kick: 'x...x.x.', snare: '..x...x.', shaker: 'xxxxxxxx', timp: 'x.......' },
  doom: { timp: 'x..x....', kick: 'x.......', snare: '......xx' },
};

// Recipes. root is a MIDI note (the melody sits an octave above it), prog the chord
// on each bar of the A phrase as scale degrees (B turns it around to lead home), vol
// evens out loudness between sparse and dense arrangements.
export const TRACKS = {
  title: { bpm: 92, vol: 0.95, root: 53, mode: 'ionian', prog: [0, 4, 5, 3], lead: 'flute', arp: 'harp', arpPat: 'up8', pad: 'strings', bass: 'pizz', bassPat: 'half', seed: 11 },
  crypt: { bpm: 80, vol: 0.95, root: 50, mode: 'dorian', prog: [0, 6, 0, 4], lead: 'oboe', arp: 'harp', arpPat: 'up4', pad: 'strings', bass: 'bass', bassPat: 'whole', drums: 'soft', seed: 23 },
  flooded: { bpm: 72, vol: 0.7, root: 52, mode: 'aeolian', prog: [0, 5, 3, 4], lead: 'flute', arp: 'harp', arpPat: 'wave8', pad: 'choir', bass: 'bass', bassPat: 'whole', seed: 37 },
  ember: { bpm: 104, vol: 1.25, root: 45, mode: 'phrygian', prog: [0, 1, 0, 6], lead: 'brass', arp: 'harp', arpPat: 'up4', pad: 'strings', bass: 'pizz', bassPat: 'pulse', drums: 'tribal', seed: 41 },
  ossuary: { bpm: 86, vol: 1.3, root: 55, mode: 'harmonic', prog: [0, 3, 4, 0], lead: 'oboe', arp: 'harp', arpPat: 'wave8', pad: 'strings', bass: 'pizz', bassPat: 'pulse', drums: 'soft', seed: 53 },
  fungal: { bpm: 88, vol: 1.5, root: 48, mode: 'lydian', prog: [0, 1, 0, 4], lead: 'glock', arp: 'harp', arpPat: 'up8', pad: 'choir', bass: 'pizz', bassPat: 'half', seed: 67 },
  frozen: { bpm: 70, vol: 0.9, root: 47, mode: 'aeolian', prog: [0, 5, 2, 6], lead: 'glock', arp: 'harp', arpPat: 'wave8', pad: 'choir', bass: 'bass', bassPat: 'whole', seed: 71 },
  blood: { bpm: 96, vol: 0.85, root: 49, mode: 'phrydom', prog: [0, 1, 0, 6], lead: 'oboe', arp: 'harp', arpPat: 'up4', pad: 'strings', bass: 'bass', bassPat: 'half', drums: 'doom', seed: 83 },
  void: { bpm: 66, vol: 0.7, root: 54, mode: 'aeolian', prog: [0, 5, 1, 4], lead: 'flute', arp: 'glock', arpPat: 'up4', pad: 'choir', bass: 'bass', bassPat: 'whole', seed: 97 },
  library: { bpm: 90, vol: 1.6, root: 50, mode: 'dorian', prog: [0, 3, 0, 4], lead: 'harp', arp: 'harp', arpPat: 'wave8', pad: 'strings', bass: 'pizz', bassPat: 'half', seed: 101 },
  treasury: { bpm: 100, vol: 1.3, root: 46, mode: 'mixo', prog: [0, 6, 3, 0], lead: 'brass', arp: 'harp', arpPat: 'up8', pad: 'strings', bass: 'pizz', bassPat: 'half', drums: 'festive', seed: 113 },
  boss: { bpm: 132, vol: 1, root: 52, mode: 'harmonic', prog: [0, 5, 3, 4], lead: 'brass', arp: 'harp', arpPat: 'up8', pad: 'strings', bass: 'bass', bassPat: 'drive', drums: 'war', seed: 127 },
  throne: { bpm: 118, vol: 1, root: 50, mode: 'harmonic', prog: [0, 1, 5, 4], lead: 'brass', arp: 'harp', arpPat: 'wave8', pad: 'choir', bass: 'bass', bassPat: 'drive', drums: 'doom', seed: 131 },
};

// ---- melody writer ------------------------------------------------------------

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Bar rhythms as [position, length] in eighths.
const RHYTHMS = [
  [[0, 2], [2, 2], [4, 2], [6, 2]],
  [[0, 3], [3, 1], [4, 4]],
  [[0, 2], [2, 1], [3, 1], [4, 2], [6, 2]],
  [[0, 4], [4, 2], [6, 2]],
  [[0, 1], [1, 1], [2, 2], [4, 3], [7, 1]],
  [[0, 3], [3, 1], [4, 2], [6, 2]],
  [[0, 2], [2, 2], [4, 4]],
  [[0, 3], [4, 4]],
];
const ENDINGS = [
  [[0, 2], [2, 2], [4, 4]],
  [[0, 3], [3, 1], [4, 4]],
  [[0, 8]],
  [[0, 2], [2, 6]],
];

const isChordTone = (d, c) => [0, 2, 4].includes((((d - c) % 7) + 7) % 7);

function nearest(target, ok, r) {
  let best = target;
  for (let k = 0; k < 7; k++) {
    const up = target + k;
    const dn = target - k;
    const a = ok(up);
    const b = ok(dn);
    if (a && b) return r() < 0.5 ? up : dn;
    if (a) return up;
    if (b) return dn;
  }
  return best;
}

// Four bars of melody over `prog`, in scale degrees (7 = an octave above the root).
function phrase(r, prog, lift, endHome, motif) {
  const lo = 5 + lift;
  const hi = 15 + lift;
  const mid = (lo + hi) / 2;
  const notes = [];
  let p = Math.round(mid);
  const rhythms = [motif[0], motif[1], motif[0], ENDINGS[(r() * ENDINGS.length) | 0]];
  for (let b = 0; b < 4; b++) {
    const c = prog[b];
    const rh = rhythms[b];
    for (let i = 0; i < rh.length; i++) {
      const [pos, len] = rh[i];
      let d;
      if (b === 3 && i === rh.length - 1) {
        d = endHome ? nearest(p, (x) => ((x % 7) + 7) % 7 === 0, r) : nearest(p, (x) => isChordTone(x, c), r);
      } else if (pos === 0 || pos === 4) {
        // leap to a chord tone, but not the note just played
        const dir = p > mid + 2 ? -1 : p < mid - 2 ? 1 : r() < 0.5 ? -1 : 1;
        d = nearest(p + dir * (1 + ((r() * 3) | 0)), (x) => x !== p && isChordTone(x, c), r);
      } else {
        // stepwise, leaning back toward the middle of the range
        const dir = p > mid + 2 ? -1 : p < mid - 2 ? 1 : r() < 0.5 ? -1 : 1;
        d = p + dir * (r() < 0.75 ? 1 : 2);
      }
      while (d > hi) d -= 7;
      while (d < lo) d += 7;
      notes.push({ step: b * 8 + pos, deg: d, len, strong: pos === 0 });
      p = d;
    }
  }
  return notes;
}

// The whole 16-bar loop: A, A' (home cadence), B (lifted, turned-around chords), A'.
export function compose(spec) {
  const r = rng(spec.seed);
  const pickR = () => RHYTHMS[(r() * RHYTHMS.length) | 0];
  const p = spec.prog;
  const progA2 = [p[0], p[1], p[2], 0];
  const progB = [p[2], p[3], p[0], p[1]];
  const motifA = [pickR(), pickR()];
  const motifB = [pickR(), pickR()];
  const A = phrase(r, p, 0, false, motifA);
  const A2 = A.filter((n) => n.step < 24).concat(phrase(r, progA2, 0, true, motifA).filter((n) => n.step >= 24));
  const B = phrase(r, progB, 2, false, motifB);
  const bars = [...p, ...progA2, ...progB, ...progA2];
  const mel = new Map();
  [A, A2, B, A2].forEach((ph, k) => {
    for (const n of ph) {
      const s = k * 32 + n.step;
      mel.set(s, n);
    }
  });
  return { bars, mel, steps: bars.length * 8 };
}

// ---- instruments ----------------------------------------------------------------

let ctx = null;
let out = null;
let reverb = null;
let noiseBuf = null;
let lfo = null;
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

function osc(type, f, t, end, detune = 0) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (detune) o.detune.value = detune;
  o.start(t);
  o.stop(end);
  return o;
}

function lowpass(f, q = 0.7) {
  const n = ctx.createBiquadFilter();
  n.type = 'lowpass';
  n.frequency.value = f;
  n.Q.value = q;
  return n;
}

// plucked: instant attack, exponential decay
function pluck(g, t, peak, decay) {
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
}

// held: attack, sustain for the note, release
function held(g, t, peak, dur, a, rel) {
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.setValueAtTime(peak, t + Math.max(a, dur));
  g.gain.linearRampToValueAtTime(0, t + Math.max(a, dur) + rel);
}

function noiseHit(bus, t, type, f, decay, peak) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const fl = ctx.createBiquadFilter();
  fl.type = type;
  fl.frequency.value = f;
  const g = ctx.createGain();
  pluck(g, t, peak, decay);
  s.connect(fl).connect(g).connect(bus);
  s.start(t, Math.random() * 0.5);
  s.stop(t + decay + 0.02);
}

function play(bus, inst, m, t, dur, v = 1) {
  const f = hz(m);
  const g = ctx.createGain();
  g.connect(bus);
  switch (inst) {
    case 'harp': {
      const decay = Math.min(2.2, dur * 2 + 0.8);
      const f1 = lowpass(2600);
      osc('triangle', f, t, t + decay).connect(f1);
      const o2 = osc('sine', f * 2, t, t + decay);
      const g2 = ctx.createGain();
      g2.gain.value = 0.35;
      o2.connect(g2).connect(f1);
      f1.connect(g);
      pluck(g, t, 0.13 * v, decay);
      break;
    }
    case 'glock': {
      const decay = 1.4;
      osc('sine', f * 2, t, t + decay).connect(g);
      const o2 = osc('sine', f * 5.4, t, t + 0.4);
      const g2 = ctx.createGain();
      pluck(g2, t, 0.25, 0.35);
      o2.connect(g2).connect(g);
      pluck(g, t, 0.12 * v, decay);
      break;
    }
    case 'pizz': {
      const decay = 0.7;
      osc('triangle', f, t, t + decay).connect(lowpass(900)).connect(g);
      pluck(g, t, 0.34 * v, decay);
      break;
    }
    case 'bass': {
      const o = osc('triangle', f, t, t + dur + 0.3);
      o.connect(lowpass(600)).connect(g);
      held(g, t, 0.18 * v, dur, 0.03, 0.25);
      break;
    }
    case 'flute':
    case 'oboe': {
      const flute = inst === 'flute';
      const o = osc(flute ? 'triangle' : 'sawtooth', f, t, t + dur + 0.3);
      lfo.connect(o.detune);
      o.connect(lowpass(flute ? 2400 : 1500, flute ? 0.7 : 3)).connect(g);
      held(g, t, (flute ? 0.2 : 0.085) * v, dur, flute ? 0.06 : 0.04, 0.16);
      break;
    }
    case 'brass': {
      const o = osc('sawtooth', f, t, t + dur + 0.25);
      const fl = lowpass(500, 1.5);
      fl.frequency.setValueAtTime(500, t);
      fl.frequency.linearRampToValueAtTime(2600, t + 0.07);
      fl.frequency.linearRampToValueAtTime(1500, t + 0.3);
      o.connect(fl).connect(g);
      held(g, t, 0.075 * v, dur, 0.035, 0.14);
      break;
    }
    case 'strings':
    case 'choir': {
      const s = inst === 'strings';
      const fl = lowpass(s ? 1300 : 1000);
      for (const d of [-9, 9]) osc(s ? 'sawtooth' : 'triangle', f, t, t + dur + 1.1, d).connect(fl);
      fl.connect(g);
      held(g, t, (s ? 0.022 : 0.03) * v, dur, s ? 0.35 : 0.55, 0.9);
      break;
    }
    case 'timp': {
      const o = osc('sine', f * 1.4, t, t + 1);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
      o.connect(g);
      pluck(g, t, 0.34 * v, 0.9);
      noiseHit(bus, t, 'lowpass', 300, 0.12, 0.12 * v);
      break;
    }
    case 'kick': {
      const o = osc('sine', 120, t, t + 0.3);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.22);
      o.connect(g);
      pluck(g, t, 0.36 * v, 0.28);
      break;
    }
    case 'snare':
      noiseHit(bus, t, 'bandpass', 1700, 0.16, 0.16 * v);
      osc('triangle', 190, t, t + 0.1).connect(g);
      pluck(g, t, 0.08 * v, 0.08);
      break;
    case 'shaker':
      noiseHit(bus, t, 'highpass', 7000, 0.05, 0.05 * v);
      break;
  }
}

// ---- player ------------------------------------------------------------------------

let on = (() => {
  try {
    return window.localStorage.getItem(PREF) !== 'off';
  } catch (_) {
    return true;
  }
})();
let cur = null; // { key, spec, song, bus, next, step }
let last = TRACKS.title; // the key of the last track, for jingles after it stopped
let duck = 1;
const cache = new Map();

function song(key) {
  if (!cache.has(key)) cache.set(key, compose(TRACKS[key]));
  return cache.get(key);
}

function impulse(sec) {
  const n = Math.floor(ctx.sampleRate * sec);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2);
  }
  return buf;
}

// Build the graph on a context: bus → out (dry) and bus → reverb → out.
export function attach(c, dest = c.destination) {
  ctx = c;
  out = ctx.createGain();
  out.gain.value = on ? VOLUME : 0;
  out.connect(dest);
  reverb = ctx.createConvolver();
  reverb.buffer = impulse(2.4);
  const wet = ctx.createGain();
  wet.gain.value = 0.4;
  reverb.connect(wet).connect(out);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  // one shared vibrato for the wind leads
  const l = ctx.createOscillator();
  l.frequency.value = 5.2;
  lfo = ctx.createGain();
  lfo.gain.value = 11; // cents
  l.connect(lfo);
  l.start();
}

function newBus(level) {
  const b = ctx.createGain();
  b.gain.value = level;
  b.connect(out);
  b.connect(reverb);
  return b;
}

const deg = (spec, d) => {
  const sc = MODES[spec.mode];
  return spec.root + 12 * Math.floor(d / 7) + sc[((d % 7) + 7) % 7];
};

// Everything that sounds on one eighth-note step.
function stepAt(c, t) {
  const { spec, song: s } = c;
  const eighth = 30 / spec.bpm;
  const i = c.step % s.steps;
  const bar = Math.floor(i / 8);
  const pos = i % 8;
  const ch = s.bars[bar];
  const bus = c.bus;
  if (pos === 0) {
    for (const k of [0, 2, 4]) play(bus, spec.pad, deg(spec, ch + k), t, eighth * 8);
  }
  // bass
  const root = deg(spec, ch) - 12;
  const fifth = deg(spec, ch + 4) - 12;
  const bp = spec.bassPat;
  if (bp === 'whole' && pos === 0) play(bus, spec.bass, root, t, eighth * 7.5);
  else if (bp === 'half' && pos % 4 === 0) play(bus, spec.bass, pos ? fifth : root, t, eighth * 3.6);
  else if (bp === 'pulse' && pos % 2 === 0) play(bus, spec.bass, pos === 4 ? fifth : root, t, eighth * 1.6, pos ? 0.8 : 1);
  else if (bp === 'drive') play(bus, spec.bass, pos === 3 || pos === 7 ? root + 12 : root, t, eighth * 0.85, pos % 2 ? 0.75 : 1);
  // arpeggio
  const tones = [ch, ch + 2, ch + 4, ch + 7];
  const ap = spec.arpPat;
  if (ap === 'up8') play(bus, spec.arp, deg(spec, tones[[0, 1, 2, 3, 2, 1, 2, 3][pos]]), t, eighth, 0.55);
  else if (ap === 'wave8') play(bus, spec.arp, deg(spec, tones[[0, 2, 1, 3, 2, 1, 3, 2][pos]]), t, eighth, 0.5);
  else if (ap === 'up4' && pos % 2 === 0) play(bus, spec.arp, deg(spec, tones[pos / 2]), t, eighth * 2, 0.6);
  // melody
  const n = s.mel.get(i);
  if (n) play(bus, spec.lead, deg(spec, n.deg), t, eighth * n.len * 0.94, n.strong ? 1 : 0.85);
  // drums
  const dr = spec.drums && DRUMS[spec.drums];
  if (dr) {
    for (const kind in dr) {
      if (dr[kind][pos] !== 'x') continue;
      if (kind === 'timp') play(bus, 'timp', pos === 0 ? spec.root - 12 : spec.root - 5, t, 1, pos ? 0.7 : 1);
      else play(bus, kind, 0, t, 0.1, kind === 'shaker' && pos % 2 === 0 ? 1.2 : 1);
    }
  }
}

// Schedule every step that starts before `until` (seconds on the context clock).
export function renderUntil(until) {
  const c = cur;
  if (!c) return;
  const eighth = 30 / c.spec.bpm;
  if (c.next < ctx.currentTime) c.next = ctx.currentTime + 0.05; // fell behind: skip ahead
  while (c.next < until) {
    if (on) stepAt(c, c.next);
    c.next += eighth;
    c.step++;
  }
}

function tick() {
  if (!ctx) return;
  renderUntil(ctx.currentTime + (document.hidden ? 1.5 : 0.3));
}

function start(key) {
  const now = ctx.currentTime;
  if (cur) {
    const old = cur.bus;
    old.gain.cancelScheduledValues(now);
    old.gain.setValueAtTime(old.gain.value, now);
    old.gain.linearRampToValueAtTime(0, now + 1.2);
    setTimeout(() => old.disconnect(), 4000);
  }
  cur = null;
  if (!key || !TRACKS[key]) return;
  const bus = newBus(0);
  bus.gain.setValueAtTime(0, now);
  bus.gain.linearRampToValueAtTime(TRACKS[key].vol, now + 1.5);
  last = TRACKS[key];
  cur = { key, spec: TRACKS[key], song: song(key), bus, next: now + 0.1, step: 0 };
}

// Called every frame with the track the game wants (null = silence).
export function setTrack(key) {
  if (!ctx) {
    const c = audioCtx();
    if (!c) return;
    attach(c);
    setInterval(tick, 60);
  }
  if ((cur ? cur.key : null) !== key) start(key);
}

export function setDuck(d) {
  if (d === duck || !out) {
    duck = d;
    return;
  }
  duck = d;
  const now = ctx.currentTime;
  out.gain.cancelScheduledValues(now);
  out.gain.setTargetAtTime(on ? VOLUME * duck : 0, now, 0.15);
}

export const isMusicOn = () => on;

export function setMusicOn(v) {
  on = v;
  try {
    window.localStorage.setItem(PREF, v ? 'on' : 'off');
  } catch (_) {
    /* unavailable: the choice lasts this session */
  }
  if (out) {
    const now = ctx.currentTime;
    out.gain.cancelScheduledValues(now);
    out.gain.setTargetAtTime(on ? VOLUME * duck : 0, now, 0.1);
  }
}

// Short fanfares over the track: 'clear' when a floor's portal opens, 'death' on a fall.
export function jingle(kind) {
  if (!ctx || !on) return;
  const t = ctx.currentTime + 0.05;
  const bus = newBus(1);
  setTimeout(() => bus.disconnect(), 6000);
  const spec = last;
  if (cur) {
    const g = cur.bus.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.2, t + 0.1);
    g.setValueAtTime(0.2, t + 2.4);
    g.linearRampToValueAtTime(cur.spec.vol, t + 3.4);
  }
  if (kind === 'clear') {
    // a bright major rising call and a held chord, in the track's key
    const r = spec.root + 12;
    const e = 0.13;
    [0, 4, 7, 12].forEach((iv, i) => {
      play(bus, 'brass', r + iv, t + i * e, e * 0.9, 1.1);
      play(bus, 'harp', r + iv + 12, t + i * e, e, 0.8);
    });
    for (const iv of [0, 4, 7]) {
      play(bus, 'brass', r + 12 + iv - 12, t + 4 * e, 1.3, 0.8);
      play(bus, 'strings', r + iv, t + 4 * e, 1.4, 2);
    }
    play(bus, 'glock', r + 12, t + 4 * e, 1, 1.2);
    play(bus, 'timp', spec.root - 12, t + 4 * e, 1);
  } else if (kind === 'death') {
    const r = spec.root + 12;
    [7, 3, 2, 0].forEach((iv, i) => play(bus, 'harp', r + iv, t + i * 0.32, 0.5, 0.9));
    for (const iv of [0, 3, 7]) play(bus, 'strings', r - 12 + iv, t + 1.2, 2.4, 2);
    play(bus, 'timp', spec.root - 12, t + 1.2, 1);
  }
}

// Test hook: start a track right away on an attached (offline) context.
export function startNow(key) {
  start(key);
}
export const currentTrack = () => (cur ? cur.key : null);
