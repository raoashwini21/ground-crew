// Every sound is made live with Web Audio: no audio files, nothing to load,
// works offline. Quiet by design, and one switch turns it all off.

let ctx = null;
let master = null;
let noise = null;
let enabled = true;

export function setSound(on) {
  enabled = on;
  if (master) master.gain.value = on ? 0.55 : 0;
}
export function soundOn() { return enabled; }

function ac() {
  if (!enabled) return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function env(g, t, peak, attack, decay) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function tone(freq, { type = 'sine', at = 0, peak = 0.2, attack = 0.01, decay = 0.3, to = null } = {}) {
  const c = ac(); if (!c) return;
  const t = c.currentTime + at;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + attack + decay);
  env(g, t, peak, attack, decay);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + attack + decay + 0.05);
}

function burst({ at = 0, dur = 0.05, peak = 0.2, filter = 'bandpass', freq = 1500, q = 1, attack = 0.002 } = {}) {
  const c = ac(); if (!c) return;
  const t = c.currentTime + at;
  const s = c.createBufferSource();
  s.buffer = noise;
  s.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = c.createBiquadFilter();
  f.type = filter; f.frequency.value = freq; f.Q.value = q;
  const g = c.createGain();
  env(g, t, peak, attack, dur);
  s.connect(f).connect(g).connect(master);
  s.start(t, Math.random());
  s.stop(t + attack + dur + 0.05);
}

// The airport announcement "ding-dong" when you arrive at a station.
export function chime() {
  tone(659.3, { peak: 0.16, attack: 0.01, decay: 0.9 });
  tone(1318.5, { peak: 0.03, attack: 0.01, decay: 0.6 });
  tone(523.3, { at: 0.42, peak: 0.16, attack: 0.01, decay: 1.2 });
  tone(1046.5, { at: 0.42, peak: 0.03, attack: 0.01, decay: 0.8 });
}

// One split-flap tile landing.
let lastFlap = 0;
export function flap() {
  const c = ac(); if (!c) return;
  if (c.currentTime - lastFlap < 0.018) return;
  lastFlap = c.currentTime;
  burst({ dur: 0.018, peak: 0.12, freq: 1800 + Math.random() * 1600, q: 2.5 });
}

// Tower radio: a squelch, then a short pip.
export function radio() {
  burst({ dur: 0.12, peak: 0.07, freq: 1300, q: 0.8 });
  tone(1000, { at: 0.13, type: 'square', peak: 0.025, attack: 0.005, decay: 0.05 });
}
export function mayday() {
  radio();
  [0, 0.22, 0.44].forEach((at, i) => tone(i % 2 ? 660 : 880, { at: 0.2 + at, type: 'triangle', peak: 0.09, attack: 0.01, decay: 0.16 }));
}

// X-ray: a soft beep for a clear bag, a buzz for one that's held.
export function beep() { tone(1560, { peak: 0.035, attack: 0.004, decay: 0.05 }); }
export function buzz() {
  tone(170, { type: 'sawtooth', peak: 0.09, attack: 0.01, decay: 0.28 });
  tone(176, { type: 'sawtooth', peak: 0.06, attack: 0.01, decay: 0.28 });
}

// A suitcase dropping onto the belt, and a rubber stamp.
export function thunk() {
  tone(120, { peak: 0.22, attack: 0.004, decay: 0.16, to: 55 });
  burst({ dur: 0.04, peak: 0.08, filter: 'lowpass', freq: 900 });
}
export function stamp() {
  tone(90, { peak: 0.25, attack: 0.003, decay: 0.12, to: 45 });
  burst({ dur: 0.06, peak: 0.12, filter: 'lowpass', freq: 1400 });
}
export function tick() { burst({ dur: 0.008, peak: 0.06, filter: 'highpass', freq: 3000 }); }

// The belt motor: a low hum that fades out by itself.
export function hum(seconds = 3) {
  const c = ac(); if (!c) return;
  const t = c.currentTime;
  const o = c.createOscillator();
  o.type = 'sine'; o.frequency.value = 55;
  const s = c.createBufferSource();
  s.buffer = noise; s.loop = true;
  const f = c.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = 220;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.06, t + 0.4);
  g.gain.setValueAtTime(0.06, t + seconds - 0.8);
  g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
  o.connect(g); s.connect(f).connect(g); g.connect(master);
  o.start(t); s.start(t);
  o.stop(t + seconds + 0.1); s.stop(t + seconds + 0.1);
}

// Take-off: engines spool up, roar down the runway, and fade into the sky.
export function jet(seconds = 5.6) {
  const c = ac(); if (!c) return;
  const t = c.currentTime;
  const s = c.createBufferSource();
  s.buffer = noise; s.loop = true;
  const f = c.createBiquadFilter();
  f.type = 'lowpass'; f.Q.value = 0.7;
  f.frequency.setValueAtTime(250, t);
  f.frequency.exponentialRampToValueAtTime(2600, t + seconds * 0.6);
  f.frequency.exponentialRampToValueAtTime(700, t + seconds);
  const whine = c.createOscillator();
  whine.type = 'sine';
  whine.frequency.setValueAtTime(900, t);
  whine.frequency.exponentialRampToValueAtTime(2400, t + seconds * 0.6);
  const wg = c.createGain();
  env(wg, t, 0.025, seconds * 0.5, seconds * 0.5);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.28, t + seconds * 0.55);
  g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
  s.connect(f).connect(g).connect(master);
  whine.connect(wg).connect(master);
  s.start(t); whine.start(t);
  s.stop(t + seconds + 0.1); whine.stop(t + seconds + 0.1);
}
