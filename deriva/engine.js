// Deriva DSP — JavaScript port of Source/Engine.cpp (+ chorus/reverb from the processor).
// Runs inside an AudioWorklet, or on the main thread as a ScriptProcessor fallback.

const DERIVA_MAX_VOICES = 8;

function derivaTimeToCoef(seconds, sr) {
  return Math.exp(Math.log(0.001) / Math.max(1, seconds * sr));
}

class DerivaEnvelope {
  constructor(sr) {
    this.sr = sr; this.stage = 0; this.level = 0;
    this.attackInc = 1; this.decayCoef = 0; this.releaseCoef = 0; this.sustain = 1;
  }
  set(a, d, s, r) {
    this.attackInc = 1 / Math.max(1, a * this.sr);
    this.decayCoef = derivaTimeToCoef(d, this.sr);
    this.releaseCoef = derivaTimeToCoef(r, this.sr);
    this.sustain = Math.min(1, Math.max(0, s));
  }
  noteOn() { this.stage = 1; }
  noteOff() { if (this.stage !== 0) this.stage = 4; }
  reset() { this.stage = 0; this.level = 0; }
  active() { return this.stage !== 0; }
  next() {
    switch (this.stage) {
      case 0: return 0;
      case 1: this.level += this.attackInc; if (this.level >= 1) { this.level = 1; this.stage = 2; } break;
      case 2: this.level = this.sustain + (this.level - this.sustain) * this.decayCoef;
        if (Math.abs(this.level - this.sustain) < 1e-4) { this.level = this.sustain; this.stage = 3; } break;
      case 3: this.level = this.sustain; break;
      case 4: this.level *= this.releaseCoef; if (this.level < 1e-4) { this.level = 0; this.stage = 0; } break;
    }
    return this.level;
  }
}

function derivaPolyBlep(t, dt) {
  if (dt <= 0) return 0;
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}
function derivaTri(ph) { let q = ph + 0.25; if (q >= 1) q -= 1; return 1 - 4 * Math.abs(q - 0.5); }
function derivaShape(shape, ph, dt) {
  switch (shape) {
    case 0: return Math.sin(2 * Math.PI * ph);
    case 1: return derivaTri(ph);
    case 2: return 2 * ph - 1 - derivaPolyBlep(ph, dt);
    default: {
      let v = ph < 0.5 ? 1 : -1;
      v += derivaPolyBlep(ph, dt);
      let h = ph + 0.5; if (h >= 1) h -= 1;
      return v - derivaPolyBlep(h, dt);
    }
  }
}

// --- Freeverb (same structure as juce::Reverb) ---------------------------------
class DerivaComb {
  constructor(size) { this.buf = new Float32Array(size); this.i = 0; this.last = 0; }
  process(x, damp, fb) {
    const out = this.buf[this.i];
    this.last = out * (1 - damp) + this.last * damp;
    this.buf[this.i] = x + this.last * fb;
    if (++this.i >= this.buf.length) this.i = 0;
    return out;
  }
}
class DerivaAllpass {
  constructor(size) { this.buf = new Float32Array(size); this.i = 0; }
  process(x) {
    const b = this.buf[this.i];
    this.buf[this.i] = x + b * 0.5;
    if (++this.i >= this.buf.length) this.i = 0;
    return b - x;
  }
}
class DerivaReverb {
  constructor(sr) {
    const combT = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
    const apT = [556, 441, 341, 225];
    const k = sr / 44100, spread = 23;
    this.combL = combT.map(t => new DerivaComb(Math.round(t * k)));
    this.combR = combT.map(t => new DerivaComb(Math.round((t + spread) * k)));
    this.apL = apT.map(t => new DerivaAllpass(Math.round(t * k)));
    this.apR = apT.map(t => new DerivaAllpass(Math.round((t + spread) * k)));
  }
  process(L, R, n, room, wetLevel, dryLevel) {
    const fb = room * 0.28 + 0.7, damp = 0.45 * 0.4;
    const wet = wetLevel * 3, dry = dryLevel * 2, wet1 = wet, wet2 = 0;
    for (let s = 0; s < n; s++) {
      const input = (L[s] + R[s]) * 0.015;
      let oL = 0, oR = 0;
      for (let j = 0; j < 8; j++) { oL += this.combL[j].process(input, damp, fb); oR += this.combR[j].process(input, damp, fb); }
      for (let j = 0; j < 4; j++) { oL = this.apL[j].process(oL); oR = this.apR[j].process(oR); }
      L[s] = oL * wet1 + oR * wet2 + L[s] * dry;
      R[s] = oR * wet1 + oL * wet2 + R[s] * dry;
    }
  }
}

// --- simple stereo chorus ----------------------------------------------------
class DerivaChorus {
  constructor(sr) {
    this.sr = sr; this.size = Math.ceil(sr * 0.06);
    this.bL = new Float32Array(this.size); this.bR = new Float32Array(this.size);
    this.w = 0; this.ph = 0;
  }
  read(buf, delay) {
    let pos = this.w - delay; while (pos < 0) pos += this.size;
    const i0 = Math.floor(pos), f = pos - i0, i1 = (i0 + 1) % this.size;
    return buf[i0] + (buf[i1] - buf[i0]) * f;
  }
  process(L, R, n, amount) {
    const mix = amount * 0.6, depth = 0.15 + 0.35 * amount, sr = this.sr;
    const inc = 0.33 / sr;
    for (let s = 0; s < n; s++) {
      this.bL[this.w] = L[s]; this.bR[this.w] = R[s];
      const m1 = Math.sin(2 * Math.PI * this.ph), m2 = Math.sin(2 * Math.PI * this.ph + Math.PI / 2);
      const dL = Math.max(1, 9 + 10 * depth * m1) * 0.001 * sr;
      const dR = Math.max(1, 9 + 10 * depth * m2) * 0.001 * sr;
      const wl = this.read(this.bL, dL), wr = this.read(this.bR, dR);
      L[s] = L[s] * (1 - mix) + wl * mix;
      R[s] = R[s] * (1 - mix) + wr * mix;
      if (++this.w >= this.size) this.w = 0;
      this.ph += inc; if (this.ph >= 1) this.ph -= 1;
    }
  }
}

// --- the synth ---------------------------------------------------------------
class DerivaDSP {
  constructor(sr) {
    this.sr = sr;
    this.p = {
      glideTime: 0.55, glideCurve: 3, glideMode: 0, glideFrom: 1, cascade: 0.15, cascadeDir: 0, voices: 8,
      wave: 1.6, detune: 8, octave: 0, sub: 0.2, noise: 0,
      cutoff: 2200, resonance: 0.15, filterEnv: 0.25, keyTrack: 0.4,
      ampA: 0.03, ampD: 0.6, ampS: 0.8, ampR: 1.2, modA: 0.01, modD: 0.8, modS: 0.2, modR: 0.8,
      lfoShape: 0, lfoRate: 0.4, lfoAmount: 0.2, lfoTarget: 1,
      chorus: 0.25, reverb: 0.3, roomSize: 0.6, spread: 0.6, gain: -3,
    };
    this.voices = [];
    for (let i = 0; i < DERIVA_MAX_VOICES; i++) {
      this.voices.push({
        note: -1, hasPitch: false, velocity: 0,
        pitch: 60, startPitch: 60, targetPitch: 60, gliding: false, delay: 0, glideSamples: 1, glidePos: 0,
        ph1: 0, ph2: 0.25, phSub: 0, ic1: 0, ic2: 0, pan: 0, panTarget: 0,
        amp: new DerivaEnvelope(sr), mod: new DerivaEnvelope(sr),
      });
    }
    this.held = []; this.heldVel = new Float32Array(128);
    this.sustain = false; this.sustained = new Set(); this.bend = 0;
    this.queue = []; // [{time, events}] sorted by time (audio-context seconds)
    this.lastVoiceLimit = DERIVA_MAX_VOICES;
    this.lfoPhase = 0; this.sh = 0; this.rndFrom = 0; this.rndTo = 0;
    this.chorus = new DerivaChorus(sr); this.reverb = new DerivaReverb(sr);
    this.gainSmooth = Math.pow(10, -3 / 20);
  }

  setParams(p) { Object.assign(this.p, p); }

  // events: [{type:'on', note, vel}, {type:'off', note}, {type:'allOff'}] — applied as one group
  handleEvents(events) {
    let anyOn = false, change = false;
    for (const e of events) {
      if (e.type === 'on') {
        this.held = this.held.filter(n => n !== e.note); this.held.push(e.note);
        this.heldVel[e.note] = e.vel; this.sustained.delete(e.note); anyOn = change = true;
      } else if (e.type === 'off') {
        if (this.sustain) { if (this.held.includes(e.note)) this.sustained.add(e.note); continue; }
        const before = this.held.length;
        this.held = this.held.filter(n => n !== e.note);
        if (this.held.length !== before) change = true;
      } else if (e.type === 'sustain') {
        this.sustain = !!e.on;
        if (!this.sustain && this.sustained.size) {
          this.held = this.held.filter(n => !this.sustained.has(n)); this.sustained.clear(); change = true;
        }
      } else if (e.type === 'bend') {
        this.bend = e.value || 0;
      } else if (e.type === 'allOff') {
        this.held = []; this.sustained.clear(); change = true;
      } else if (e.type === 'prime') {
        // start voices at given pitches (silent) so the first chord already glides
        e.pitches.forEach((pitch, i) => {
          const v = this.voices[i];
          if (v && pitch !== null && !v.hasPitch) { v.pitch = v.targetPitch = pitch; v.hasPitch = true; }
        });
      }
    }
    if (change) this.reallocate(anyOn);
  }

  // timed events: applied at the start of the audio block that contains their time
  enqueue(time, events) {
    const item = { time, events };
    let i = this.queue.length;
    while (i > 0 && this.queue[i - 1].time > time) i--;
    this.queue.splice(i, 0, item);
  }
  clearQueue() { this.queue.length = 0; }

  startGlide(v, to, delay, duration) {
    v.startPitch = v.pitch; v.targetPitch = to;
    if (duration <= 1 || Math.abs(to - v.pitch) < 1e-3) {
      if (delay <= 0) { v.pitch = to; v.gliding = false; return; }
      duration = 1;
    }
    v.delay = Math.max(0, delay); v.glideSamples = Math.max(1, duration); v.glidePos = 0; v.gliding = true;
  }

  reallocate(chordChange) {
    const p = this.p, V = this.voices;
    const maxV = Math.min(DERIVA_MAX_VOICES, Math.max(1, Math.round(p.voices)));
    const always = p.glideFrom === 1;
    const target = this.held.slice(Math.max(0, this.held.length - maxV)).sort((a, b) => a - b);
    const isTarget = n => target.includes(n);

    for (let i = 0; i < DERIVA_MAX_VOICES; i++) {
      const v = V[i];
      if (v.note >= 0 && (i >= maxV || !isTarget(v.note))) { v.note = -1; v.amp.noteOff(); v.mod.noteOff(); }
    }

    const newNotes = target.filter(n => !V.some(v => v.note === n));

    const updatePans = () => {
      const active = [];
      for (let i = 0; i < maxV; i++) if (V[i].note >= 0) active.push(i);
      active.sort((a, b) => V[a].note - V[b].note);
      const cnt = active.length;
      active.forEach((vi, r) => { V[vi].panTarget = p.spread * (cnt > 1 ? 2 * r / (cnt - 1) - 1 : 0); });
    };

    if (newNotes.length === 0) { updatePans(); return; }

    const cand = [], fresh = [], refs = [];
    for (let i = 0; i < DERIVA_MAX_VOICES; i++) {
      const v = V[i];
      const usable = v.hasPitch && (always || v.amp.active());
      if (usable) refs.push(v.pitch);
      if (i >= maxV || v.note >= 0) continue;
      (usable ? cand : fresh).push(i);
    }
    cand.sort((a, b) => V[a].pitch - V[b].pitch);

    const k = newNotes.length, m = cand.length;
    const cost = (ni, ci) => Math.abs(newNotes[ni] - V[cand[ci]].pitch);
    const notesShorter = k <= m;
    const a = notesShorter ? k : m, b = notesShorter ? m : k;
    const INF = 1e30;
    const dp = [], took = [];
    for (let i = 0; i <= a; i++) { dp.push(new Float64Array(b + 1).fill(i === 0 ? 0 : INF)); took.push(new Uint8Array(b + 1)); }
    for (let i = 1; i <= a; i++) {
      for (let j = i; j <= b; j++) {
        const skip = dp[i][j - 1];
        const c = notesShorter ? cost(i - 1, j - 1) : cost(j - 1, i - 1);
        const use = dp[i - 1][j - 1] + c;
        if (use <= skip) { dp[i][j] = use; took[i][j] = 1; } else { dp[i][j] = skip; took[i][j] = 0; }
      }
    }

    const assigns = [], candUsed = new Array(m).fill(false), noteDone = new Array(k).fill(false);
    for (let i = a, j = b; i > 0 && j > 0;) {
      if (took[i][j]) {
        const ni = notesShorter ? i - 1 : j - 1, ci = notesShorter ? j - 1 : i - 1;
        assigns.push({ voice: cand[ci], note: newNotes[ni], from: V[cand[ci]].pitch });
        candUsed[ci] = true; noteDone[ni] = true; i--; j--;
      } else j--;
    }

    let fi = 0;
    for (let ni = 0; ni < k; ni++) {
      if (noteDone[ni] || fi >= fresh.length) continue;
      const note = newNotes[ni];
      let from = note, best = INF;
      for (const r of refs) { const d = Math.abs(r - note); if (d < best) { best = d; from = r; } }
      assigns.push({ voice: fresh[fi++], note, from });
    }

    const wasIdle = [];
    for (const as of assigns) {
      const v = V[as.voice];
      if (!v.amp.active()) { v.ic1 = v.ic2 = 0; wasIdle.push(as.voice); }
      v.pitch = as.from; v.gliding = false; v.note = as.note;
      v.velocity = 0.35 + 0.65 * this.heldVel[as.note]; v.hasPitch = true;
      v.amp.noteOn(); v.mod.noteOn();
    }

    const glides = [];
    for (const as of assigns) {
      if (Math.abs(as.from - as.note) > 1e-3) glides.push(as);
      else this.startGlide(V[as.voice], as.note, 0, 0);
    }
    glides.sort((x, y) => x.note - y.note);
    const gs = Math.floor(p.glideTime * this.sr), ng = glides.length;
    glides.forEach((g, r) => {
      let frac = ng > 1 ? r / (ng - 1) : 0;
      if (p.cascadeDir === 1) frac = 1 - frac;
      this.startGlide(V[g.voice], g.note, Math.floor(p.cascade * frac * gs), gs);
    });

    if (chordChange && target.length) {
      for (let ci = 0; ci < m; ci++) {
        if (candUsed[ci]) continue;
        const v = V[cand[ci]];
        if (!v.amp.active()) continue;
        let nearest = target[0];
        for (const n of target) if (Math.abs(n - v.pitch) < Math.abs(nearest - v.pitch)) nearest = n;
        this.startGlide(v, nearest, 0, gs);
      }
    }

    updatePans();
    for (const vi of wasIdle) V[vi].pan = V[vi].panTarget;
  }

  glideShape(x) {
    switch (this.p.glideCurve) {
      case 0: return x;
      case 1: { const y = 1 - x; return 1 - y * y * y; }
      case 2: return x * x * x;
      default: return x * x * (3 - 2 * x);
    }
  }

  nextLfo() {
    const p = this.p; let raw;
    switch (p.lfoShape) {
      case 0: raw = Math.sin(2 * Math.PI * this.lfoPhase); break;
      case 1: raw = derivaTri(this.lfoPhase); break;
      case 2: raw = 1 - 2 * this.lfoPhase; break;
      case 3: raw = this.lfoPhase < 0.5 ? 1 : -1; break;
      case 4: raw = this.sh; break;
      default: { const x = this.lfoPhase; raw = this.rndFrom + (this.rndTo - this.rndFrom) * (x * x * (3 - 2 * x)); }
    }
    this.lfoPhase += p.lfoRate / this.sr;
    if (this.lfoPhase >= 1) {
      this.lfoPhase -= Math.floor(this.lfoPhase);
      this.sh = Math.random() * 2 - 1; this.rndFrom = this.rndTo; this.rndTo = Math.random() * 2 - 1;
    }
    return raw;
  }

  process(L, R, n, now) {
    if (now !== undefined && this.queue.length) {
      const blockEnd = now + n / this.sr;
      while (this.queue.length && this.queue[0].time < blockEnd) this.handleEvents(this.queue.shift().events);
    }
    const p = this.p, V = this.voices, sr = this.sr;
    for (const v of V) { v.amp.set(p.ampA, p.ampD, p.ampS, p.ampR); v.mod.set(p.modA, p.modD, p.modS, p.modR); }
    if (Math.round(p.voices) !== this.lastVoiceLimit) { this.lastVoiceLimit = Math.round(p.voices); this.reallocate(false); }

    const seg = Math.min(2, Math.max(0, Math.floor(p.wave)));
    const frac = Math.min(1, Math.max(0, p.wave - seg));
    const detR = Math.pow(2, p.detune / 2400);
    const k = 2 - 1.94 * p.resonance;
    const panCoef = 1 - Math.exp(-1 / (0.08 * sr));
    const steps = p.glideMode === 1;
    const oct = 12 * Math.round(p.octave);
    const maxFc = 0.45 * sr;

    for (let s = 0; s < n; s++) {
      const lfoRaw = this.nextLfo(), lfo = lfoRaw * p.lfoAmount;
      const lfoPitch = p.lfoTarget === 0 ? lfo : 0;
      const lfoFilt = p.lfoTarget === 1 ? lfo * 4 : 0;
      const lfoVol = p.lfoTarget === 2 ? 1 - p.lfoAmount * 0.5 * (1 + lfoRaw) : 1;
      const lfoPan = p.lfoTarget === 3 ? lfo : 0;
      let oL = 0, oR = 0;

      for (const v of V) {
        if (v.gliding) {
          if (v.delay > 0) v.delay--;
          else {
            v.glidePos++;
            const x = Math.min(1, v.glidePos / v.glideSamples);
            const d = (v.targetPitch - v.startPitch) * this.glideShape(x);
            v.pitch = v.startPitch + (steps ? Math.round(d) : d);
            if (x >= 1) { v.pitch = v.targetPitch; v.gliding = false; }
          }
        }
        if (!v.amp.active()) {
          if (v.gliding && v.delay <= 0) { v.pitch = v.targetPitch; v.gliding = false; }
          continue;
        }
        const freq = 440 * Math.pow(2, (v.pitch + oct + lfoPitch + this.bend - 69) / 12);
        const inc = freq / sr, i1 = inc * detR, i2 = inc / detR;
        let a1 = derivaShape(seg, v.ph1, i1), a2 = derivaShape(seg, v.ph2, i2);
        if (frac > 1e-4) {
          a1 += (derivaShape(seg + 1, v.ph1, i1) - a1) * frac;
          a2 += (derivaShape(seg + 1, v.ph2, i2) - a2) * frac;
        }
        let x = 0.5 * (a1 + a2) + p.sub * Math.sin(2 * Math.PI * v.phSub);
        if (p.noise > 0) x += p.noise * (Math.random() * 2 - 1);
        v.ph1 += i1; if (v.ph1 >= 1) v.ph1 -= Math.floor(v.ph1);
        v.ph2 += i2; if (v.ph2 >= 1) v.ph2 -= Math.floor(v.ph2);
        v.phSub += inc * 0.5; if (v.phSub >= 1) v.phSub -= Math.floor(v.phSub);

        const mod = v.mod.next();
        let fc = p.cutoff * Math.pow(2, p.filterEnv * mod * 6 + p.keyTrack * (v.pitch - 60) / 12 + lfoFilt);
        fc = Math.min(maxFc, Math.max(20, fc));
        const g = Math.tan(Math.PI * fc / sr);
        const c1 = 1 / (1 + g * (g + k)), c2 = g * c1, c3 = g * c2;
        const v3 = x - v.ic2, v1 = c1 * v.ic1 + c2 * v3, v2 = v.ic2 + c2 * v.ic1 + c3 * v3;
        v.ic1 = 2 * v1 - v.ic1; v.ic2 = 2 * v2 - v.ic2;

        const amp = v.amp.next() * v.velocity * 0.33 * lfoVol;
        v.pan += (v.panTarget - v.pan) * panCoef;
        const pp = Math.min(1, Math.max(-1, v.pan + lfoPan));
        const ang = (pp + 1) * Math.PI / 4;
        oL += v2 * amp * Math.cos(ang); oR += v2 * amp * Math.sin(ang);
      }
      L[s] = oL; R[s] = oR;
    }

    if (p.chorus > 0.001) this.chorus.process(L, R, n, p.chorus);
    this.reverb.process(L, R, n, 0.3 + 0.69 * p.roomSize, p.reverb * 0.55, 1 - p.reverb * 0.45);

    const target = Math.pow(10, p.gain / 20), gc = 1 - Math.exp(-1 / (0.05 * sr));
    for (let s = 0; s < n; s++) {
      this.gainSmooth += (target - this.gainSmooth) * gc;
      L[s] = Math.tanh(L[s] * this.gainSmooth); R[s] = Math.tanh(R[s] * this.gainSmooth);
    }
  }

  getView() {
    return {
      voices: this.voices.map(v => ({
        pitch: v.pitch, level: v.amp.level * v.velocity, target: v.gliding ? v.targetPitch : v.pitch,
        note: v.note, gliding: v.gliding,
      })),
      held: this.held.slice(),
    };
  }
}

if (typeof registerProcessor === 'function') {
  class DerivaWorklet extends AudioWorkletProcessor {
    constructor() {
      super();
      this.dsp = new DerivaDSP(sampleRate);
      this.frame = 0;
      this.port.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'params') this.dsp.setParams(m.params);
        else if (m.type === 'events') {
          if (typeof m.time === 'number' && m.time > currentTime) this.dsp.enqueue(m.time, m.events);
          else this.dsp.handleEvents(m.events);
        } else if (m.type === 'clearQueue') this.dsp.clearQueue();
      };
    }
    process(inputs, outputs) {
      const out = outputs[0];
      const L = out[0];
      if (!L) return true;
      const R = out[1] || new Float32Array(L.length);
      this.dsp.process(L, R, L.length, currentTime);
      if (!out[1]) for (let i = 0; i < L.length; i++) L[i] = 0.5 * (L[i] + R[i]);
      if (++this.frame % 6 === 0) this.port.postMessage({ type: 'view', view: this.dsp.getView() });
      return true;
    }
  }
  registerProcessor('deriva', DerivaWorklet);
}
