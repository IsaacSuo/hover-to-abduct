// All sound is synthesised in the browser. Browsers keep audio muted until a user gesture, so the
// listeners below exist only to unlock the AudioContext; nothing here feeds gameplay.
const Ctx = window.AudioContext || window.webkitAudioContext;
const ctx = new Ctx();
const master = ctx.createGain();
master.gain.value = 0.7;
const limiter = ctx.createDynamicsCompressor();
master.connect(limiter).connect(ctx.destination);

const unlock = () => ctx.state === 'suspended' && ctx.resume();
for (const ev of ['keydown', 'pointerdown', 'touchstart']) addEventListener(ev, unlock);

function tone(freq, start, dur, { type = 'triangle', gain = 0.16, slide = 0 } = {}) {
  const t = ctx.currentTime + start;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(start, dur, gain, cutoff) {
  const n = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = cutoff;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(master);
  src.start(ctx.currentTime + start);
}

// Minor pentatonic: spooky, and any two notes sound fine together.
const SCALE = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];
const note = (step) => 392 * 2 ** (SCALE[Math.min(step, SCALE.length - 1)] / 12);

// Beam hum: two detuned oscillators under a slow wobble, gain follows the beam level.
const humGain = ctx.createGain();
humGain.gain.value = 0;
const humFilter = ctx.createBiquadFilter();
humFilter.type = 'lowpass';
humFilter.frequency.value = 420;
humFilter.connect(humGain).connect(master);
for (const [f, type] of [[82, 'sawtooth'], [82.9, 'sawtooth'], [164.5, 'sine']]) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = f;
  o.connect(humFilter);
  o.start();
}
const wobble = ctx.createOscillator();
const wobbleDepth = ctx.createGain();
wobble.frequency.value = 3.2;
wobbleDepth.gain.value = 90;
wobble.connect(wobbleDepth).connect(humFilter.frequency);
wobble.start();

export const audio = {
  setHum(level) {
    humGain.gain.setTargetAtTime(level * 0.085, ctx.currentTime, 0.05);
  },
  // Every grab gets a tone; the pricier the loot, the longer the jingle.
  grab(value, mult) {
    const len = value >= 2000 ? 9 : value >= 800 ? 7 : value >= 400 ? 5 : value >= 150 ? 3 : value >= 80 ? 2 : 1;
    const base = Math.min(mult - 1, 4);
    for (let i = 0; i < len; i++) {
      const step = base + (i % 2 ? i + 1 : i);
      tone(note(step), i * 0.075, i === len - 1 ? 0.38 : 0.13, { gain: 0.15 });
      if (len >= 5) tone(note(step) / 2, i * 0.075, 0.12, { type: 'square', gain: 0.035 });
    }
  },
  tick() {
    tone(1400 + Math.random() * 500, 0, 0.05, { type: 'sine', gain: 0.018 });
  },
  bulk() {
    [0, 2, 4, 5, 7].forEach((s, i) => tone(note(s), 0.06 * i, 0.2, { type: 'square', gain: 0.06 }));
  },
  drop() {
    tone(620, 0, 0.5, { type: 'sawtooth', gain: 0.07, slide: 0.18 });
  },
  thud(size) {
    tone(95, 0, 0.3 + size * 0.3, { type: 'sine', gain: 0.22 + size * 0.2, slide: 0.45 });
    noise(0, 0.14 + size * 0.2, 0.12 + size * 0.2, 500 + size * 500);
  },
  quack() {
    tone(620, 0, 0.1, { type: 'sawtooth', gain: 0.06, slide: 0.55 });
    tone(560, 0.13, 0.13, { type: 'sawtooth', gain: 0.06, slide: 0.5 });
  },
  boo() {
    tone(240, 0, 0.8, { type: 'sine', gain: 0.1, slide: 1.9 });
    tone(247, 0, 0.8, { type: 'sine', gain: 0.08, slide: 1.8 });
  },
  count(n) {
    tone(n > 0 ? 440 : 880, 0, n > 0 ? 0.18 : 0.45, { type: 'square', gain: 0.06 });
  },
  win() {
    [0, 2, 3, 4, 5, 7, 8, 10].forEach((s, i) => tone(note(s), 0.11 * i, 0.3, { gain: 0.15 }));
  },
  lose() {
    [5, 4, 3, 1, 0].forEach((s, i) => tone(note(s) / 2, 0.2 * i, 0.4, { type: 'sawtooth', gain: 0.05 }));
  },
};
