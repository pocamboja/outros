/* BeatVox — sons.
   - Kits de bateria sintetizados (BeatVox, 808, 909, Trap, Acústico, Lo-fi) e instrumentos para a melodia.
   - Sampler: os teus samples (bombo, tarola, palmas, hi-hats, 808, melodia), afinados e com decaimento.
   - Biblioteca: os samples que importas ficam guardados neste browser (IndexedDB) e são arrumados pelo nome.
   Tudo é gerado no browser: funciona sem internet e o WAV sai com os mesmos sons. */
(function (g) {
  const BV = (g.BV = g.BV || {});

  const KITS = [
    { id: 'beatvox', nome: 'BeatVox', dica: 'O kit original: limpo e equilibrado.' },
    { id: '808', nome: '808', dica: 'Bombo redondo e longo, hi-hats metálicos, palmas clássicas.' },
    { id: '909', nome: '909', dica: 'Bombo seco com estalo e tarola brilhante: house e techno.' },
    { id: 'trap', nome: 'Trap', dica: 'Bombo 808 saturado, hi-hats curtíssimos, tarola com palmas.' },
    { id: 'acoustic', nome: 'Acústico', dica: 'Pele, bordão e pratos: bateria de verdade.' },
    { id: 'lofi', nome: 'Lo-fi', dica: 'Abafado e saturado, como de cassete.' },
  ];
  /** instrumentos da melodia; gm = programa General MIDI (0-127) que vai no MIDI */
  const LEADS = [
    { id: 'synth', nome: 'Synth', gm: 81 },
    { id: 'pluck', nome: 'Pluck', gm: 45 },
    { id: 'sine', nome: 'Suave', gm: 79 },
    { id: 'epiano', nome: 'Piano elétrico', gm: 4 },
    { id: 'bell', nome: 'Sinos', gm: 10 },
    { id: 'organ', nome: 'Órgão', gm: 16 },
    { id: 'pad', nome: 'Pad', gm: 89 },
    { id: 'supersaw', nome: 'Supersaw', gm: 81 },
    { id: 'strings', nome: 'Cordas', gm: 48 },
    { id: 'flute', nome: 'Flauta', gm: 73 },
    { id: 'bass', nome: 'Baixo', gm: 38 },
    { id: 'chip', nome: 'Chiptune', gm: 80 },
    { id: 'sample', nome: 'O teu sample', gm: null },
  ];

  // ---------- peças comuns ----------
  const exp0 = 0.0001;
  function env(param, t, peak, attack, end) {
    param.setValueAtTime(exp0, t);
    param.exponentialRampToValueAtTime(peak, t + attack);
    param.exponentialRampToValueAtTime(exp0, Math.max(t + attack + 0.002, end));
  }
  function osc(c, type, f, t, stop) {
    const o = c.createOscillator();
    o.type = type; o.frequency.setValueAtTime(f, t);
    o.start(t); o.stop(stop);
    return o;
  }
  function filt(c, type, f, q) {
    const b = c.createBiquadFilter();
    b.type = type; b.frequency.value = Math.min(20000, f); if (q != null) b.Q.value = q;
    return b;
  }
  const curves = {};
  function shaper(c, k) {
    const s = c.createWaveShaper();
    if (!curves[k]) {
      const n = 1024, cv = new Float32Array(n);
      for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; cv[i] = Math.tanh(k * x) / Math.tanh(k); }
      curves[k] = cv;
    }
    s.curve = curves[k];
    return s;
  }
  function gainNode(c, v = 1) { const n = c.createGain(); n.gain.value = v; return n; }
  /** palmas: rajadas de ruído filtrado e uma cauda */
  function clapCore(e, t, out, f, q, tail, peak = 0.9) {
    const c = e.ctx, bp = filt(c, 'bandpass', f, q), ng = c.createGain();
    bp.connect(ng).connect(out);
    ng.gain.setValueAtTime(exp0, t);
    [0, 0.011, 0.022, 0.033].forEach((d) => { ng.gain.setValueAtTime(peak, t + d); ng.gain.exponentialRampToValueAtTime(peak * 0.12, t + d + 0.009); });
    ng.gain.setValueAtTime(peak * 0.75, t + 0.034);
    ng.gain.exponentialRampToValueAtTime(exp0, t + 0.034 + tail);
    e.noiseSrc(t, 0.05 + tail).connect(bp);
  }
  /** hi-hat metálico (6 ondas quadradas em razões não harmónicas, como na 808) */
  function metal(e, t, dur, tone, out, peak) {
    const c = e.ctx, sum = gainNode(c, 0.3), bp = filt(c, 'bandpass', 10000 * tone, 0.7), hp = filt(c, 'highpass', 7000 * tone), gn = c.createGain();
    env(gn.gain, t, peak, 0.001, t + dur);
    sum.connect(bp).connect(hp).connect(gn).connect(out);
    for (const r of [2, 3, 4.16, 5.43, 6.79, 8.21]) osc(c, 'square', 40 * r * tone, t, t + dur + 0.02).connect(sum);
  }
  function noiseHit(e, t, out, type, f, q, peak, dur, attack = 0.001) {
    const c = e.ctx, n = e.noiseSrc(t, dur + 0.03), fl = filt(c, type, f, q), gn = c.createGain();
    env(gn.gain, t, peak, attack, t + dur);
    n.connect(fl).connect(gn).connect(out);
  }
  function sweep(c, t, f0, f1, time, type = 'sine') {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + time);
    return o;
  }

  // ---------- kits ----------
  const DRUM = {
    /** o kit original (o mesmo som de sempre) */
    beatvox(e, id, t, out, P) {
      const c = e.ctx, tn = P.tune || 0, dk = P.decay || 1, tone = P.tone || 1;
      if (id === 'kick') {
        const o = c.createOscillator(), gn = c.createGain();
        const kt = Math.pow(2, tn / 12);
        o.frequency.setValueAtTime(160 * kt, t);
        o.frequency.exponentialRampToValueAtTime(48 * kt, t + 0.12);
        gn.gain.setValueAtTime(1, t);
        gn.gain.exponentialRampToValueAtTime(0.001, t + 0.45 * dk);
        o.connect(gn).connect(out);
        o.start(t); o.stop(t + 0.5 * dk + 0.02);
        const n = e.noiseSrc(t, 0.01), ng = c.createGain(), lp = c.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 3000;
        ng.gain.setValueAtTime(0.3, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.01);
        n.connect(lp).connect(ng).connect(out);
      } else if (id === 'snare') {
        const n = e.noiseSrc(t, 0.25 * dk + 0.05), ng = c.createGain(), hp = c.createBiquadFilter();
        hp.type = 'highpass'; hp.frequency.value = 1200 * tone;
        ng.gain.setValueAtTime(0.7, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.2 * dk);
        n.connect(hp).connect(ng).connect(out);
        const o = c.createOscillator(), og = c.createGain();
        o.type = 'triangle'; o.frequency.setValueAtTime(220 * tone, t); o.frequency.exponentialRampToValueAtTime(160 * tone, t + 0.08);
        og.gain.setValueAtTime(0.6, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.1 * dk);
        o.connect(og).connect(out); o.start(t); o.stop(t + 0.1 * dk + 0.02);
      } else if (id === 'clap') {
        const bp = c.createBiquadFilter(), ng = c.createGain();
        bp.type = 'bandpass'; bp.frequency.value = 1400 * tone; bp.Q.value = 0.8;
        bp.connect(ng).connect(out);
        ng.gain.setValueAtTime(0.0001, t);
        [0, 0.012, 0.024].forEach((d) => {
          ng.gain.setValueAtTime(0.9, t + d);
          ng.gain.exponentialRampToValueAtTime(0.1, t + d + 0.01);
        });
        ng.gain.setValueAtTime(0.6, t + 0.034);
        ng.gain.exponentialRampToValueAtTime(0.001, t + 0.034 + 0.19 * dk);
        e.noiseSrc(t, 0.06 + 0.2 * dk).connect(bp);
      } else if (id === 'hat' || id === 'openhat') {
        const dur = (id === 'hat' ? 0.05 : 0.32) * dk;
        const n = e.noiseSrc(t, dur + 0.02), hp = c.createBiquadFilter(), ng = c.createGain();
        hp.type = 'highpass'; hp.frequency.value = Math.min(16000, 7000 * tone);
        ng.gain.setValueAtTime(0.45, t); ng.gain.exponentialRampToValueAtTime(0.001, t + dur);
        n.connect(hp).connect(ng).connect(out);
      }
    },
    '808'(e, id, t, out, P) {
      const c = e.ctx, kt = Math.pow(2, (P.tune || 0) / 12), dk = P.decay || 1, tone = P.tone || 1;
      if (id === 'kick') {
        const f = 49 * kt, o = sweep(c, t, f * 2.6, f, 0.07), gn = c.createGain();
        env(gn.gain, t, 1, 0.003, t + 1.0 * dk);
        o.connect(gn).connect(out); o.start(t); o.stop(t + 1.0 * dk + 0.05);
        const k = osc(c, 'triangle', 1200, t, t + 0.01), kg = c.createGain();
        env(kg.gain, t, 0.15, 0.0005, t + 0.006); k.connect(kg).connect(out);
      } else if (id === 'snare') {
        [[238, 0.5], [476, 0.25]].forEach(([f, p]) => { const o = osc(c, 'triangle', f * tone, t, t + 0.2 * dk + 0.05), og = c.createGain(); env(og.gain, t, p, 0.002, t + 0.15 * dk); o.connect(og).connect(out); });
        noiseHit(e, t, out, 'highpass', 1800 * tone, null, 0.6, 0.2 * dk);
      } else if (id === 'clap') clapCore(e, t, out, 1100 * tone, 1.1, 0.3 * dk);
      else if (id === 'hat') metal(e, t, 0.06 * dk, tone, out, 1.5);
      else if (id === 'openhat') metal(e, t, 0.45 * dk, tone, out, 1.4);
    },
    '909'(e, id, t, out, P) {
      const c = e.ctx, kt = Math.pow(2, (P.tune || 0) / 12), dk = P.decay || 1, tone = P.tone || 1;
      if (id === 'kick') {
        const f = 52 * kt, o = sweep(c, t, 230 * kt, f, 0.035), gn = c.createGain(), sh = shaper(c, 2.2);
        env(gn.gain, t, 0.95, 0.002, t + 0.55 * dk);
        o.connect(gn).connect(sh).connect(out); o.start(t); o.stop(t + 0.55 * dk + 0.05);
        noiseHit(e, t, out, 'lowpass', 7000, null, 0.45, 0.006);
      } else if (id === 'snare') {
        [[185, 0.45], [330, 0.3]].forEach(([f, p]) => { const o = osc(c, 'triangle', f * tone, t, t + 0.12 * dk + 0.05), og = c.createGain(); env(og.gain, t, p, 0.001, t + 0.09 * dk); o.connect(og).connect(out); });
        noiseHit(e, t, out, 'highpass', 900 * tone, null, 0.75, 0.28 * dk);
      } else if (id === 'clap') clapCore(e, t, out, 1500 * tone, 1.6, 0.22 * dk);
      else if (id === 'hat' || id === 'openhat') {
        const dur = (id === 'hat' ? 0.07 : 0.45) * dk;
        noiseHit(e, t, out, 'highpass', 7500 * tone, null, 0.45, dur);
        metal(e, t, dur, tone, out, 0.35);
      }
    },
    trap(e, id, t, out, P) {
      const c = e.ctx, kt = Math.pow(2, (P.tune || 0) / 12), dk = P.decay || 1, tone = P.tone || 1;
      if (id === 'kick') {
        const f = 44 * kt, o = sweep(c, t, f * 1.8, f, 0.09), gn = c.createGain(), sh = shaper(c, 3), post = gainNode(c, 1.1);
        env(gn.gain, t, 1, 0.003, t + 1.6 * dk);
        o.connect(gn).connect(sh).connect(post).connect(out); o.start(t); o.stop(t + 1.6 * dk + 0.05);
        noiseHit(e, t, out, 'bandpass', 2500, 0.8, 0.35, 0.008);
      } else if (id === 'snare') {
        noiseHit(e, t, out, 'highpass', 1500 * tone, null, 0.8, 0.22 * dk);
        clapCore(e, t, out, 1700 * tone, 1.2, 0.18 * dk, 0.95);
        const o = osc(c, 'triangle', 200 * tone, t, t + 0.1), og = c.createGain();
        env(og.gain, t, 0.55, 0.001, t + 0.06); o.connect(og).connect(out);
      } else if (id === 'clap') clapCore(e, t, out, 1250 * tone, 1, 0.35 * dk);
      else if (id === 'hat') metal(e, t, 0.035 * dk, tone * 1.1, out, 1.6);
      else if (id === 'openhat') metal(e, t, 0.3 * dk, tone * 1.1, out, 1.4);
    },
    acoustic(e, id, t, out, P) {
      const c = e.ctx, kt = Math.pow(2, (P.tune || 0) / 12), dk = P.decay || 1, tone = P.tone || 1;
      if (id === 'kick') {
        const o = sweep(c, t, 110 * kt, 58 * kt, 0.05), gn = c.createGain();
        env(gn.gain, t, 0.95, 0.002, t + 0.38 * dk);
        o.connect(gn).connect(out); o.start(t); o.stop(t + 0.38 * dk + 0.05);
        noiseHit(e, t, out, 'lowpass', 400, 0.7, 0.6, 0.07);
        noiseHit(e, t, out, 'bandpass', 3000, 0.8, 0.3, 0.005);
      } else if (id === 'snare') {
        const o = sweep(c, t, 195 * tone, 170 * tone, 0.05, 'triangle'), og = c.createGain();
        env(og.gain, t, 0.5, 0.001, t + 0.11 * dk); o.connect(og).connect(out); o.start(t); o.stop(t + 0.11 * dk + 0.05);
        noiseHit(e, t, out, 'bandpass', 4000 * tone, 0.5, 0.75, 0.32 * dk);
        noiseHit(e, t, out, 'highpass', 2000, null, 0.4, 0.015);
      } else if (id === 'clap') DRUM.beatvox(e, id, t, out, P);
      else if (id === 'hat' || id === 'openhat') {
        const dur = (id === 'hat' ? 0.09 : 0.7) * dk;
        const n = e.noiseSrc(t, dur + 0.03), bp = filt(c, 'bandpass', 9000 * tone, 1.2), hp = filt(c, 'highpass', 6500 * tone), gn = c.createGain();
        env(gn.gain, t, 0.5, 0.002, t + dur);
        n.connect(bp).connect(hp).connect(gn).connect(out);
        metal(e, t, dur, tone * 1.3, out, 0.12);
      }
    },
    lofi(e, id, t, out, P) {
      // o kit original, mais curto, abafado e saturado (por golpe: não suja o resto da mistura)
      const hat = id === 'hat' || id === 'openhat';
      const c = e.ctx, lp = filt(c, 'lowpass', hat ? 6500 : 3800, 0.9), sh = shaper(c, 1.8), post = gainNode(c, { kick: 0.95, snare: 0.85, clap: 0.6, hat: 0.72, openhat: 0.6 }[id] || 0.85);
      lp.connect(sh).connect(post).connect(out);
      DRUM.beatvox(e, id, t, lp, { ...P, decay: (P.decay || 1) * 0.85, tone: (P.tone || 1) * 0.8 });
    },
  };

  /** toca um sample (com afinação = velocidade e decaimento = fade antes do fim) */
  function playSample(c, buf, t, out, { rate = 1, decay = 1, gain = 1, detuneSrc = null, end = null, release = 0.06 } = {}) {
    const s = c.createBufferSource(), gn = c.createGain();
    s.buffer = buf; s.playbackRate.value = rate;
    if (detuneSrc && s.detune) detuneSrc.connect(s.detune);
    const len = buf.duration / rate;
    let stop = t + len;
    gn.gain.setValueAtTime(gain, t);
    if (decay < 0.999) {
      const e1 = t + len * decay;
      gn.gain.setValueAtTime(gain, t + len * decay * 0.4);
      gn.gain.exponentialRampToValueAtTime(exp0, e1);
      stop = e1 + 0.01;
    }
    if (end != null && end < stop) {
      gn.gain.setTargetAtTime(exp0, end, release);
      stop = Math.min(stop, end + release * 6);
    }
    s.connect(gn).connect(out);
    s.start(t); s.stop(stop);
  }

  /**
   * Bateria: sample do slot, se houver, senão o kit.
   * e = motor (ctx, noiseSrc), S = sons ({ kit, drums: {id: AudioBuffer} }), P = parâmetros do canal (afinação, decaimento, tom)
   */
  function drum(e, S, id, t, out, P) {
    const buf = S && S.drums && S.drums[id];
    if (buf) {
      const rate = Math.pow(2, (P.tune || 0) / 12) * (P.tone || 1);
      return playSample(e.ctx, buf, t, out, { rate, decay: Math.min(1, P.decay || 1) });
    }
    (DRUM[S && S.kit] || DRUM.beatvox)(e, id, t, out, P);
  }

  let pulseWaves = new WeakMap();
  function pulseWave(c) {
    let w = pulseWaves.get(c);
    if (!w) {
      const N = 40, re = new Float32Array(N), im = new Float32Array(N), d = 0.25;
      for (let n = 1; n < N; n++) re[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * d);
      w = c.createPeriodicWave(re, im);
      pulseWaves.set(c, w);
    }
    return w;
  }
  function vibrato(c, t, stop, rate, cents, delay, targets) {
    const l = osc(c, 'sine', rate, t, stop), a = c.createGain();
    a.gain.setValueAtTime(0, t); a.gain.linearRampToValueAtTime(0, t + delay); a.gain.linearRampToValueAtTime(cents, t + delay + 0.3);
    l.connect(a);
    for (const o of targets) a.connect(o.detune);
  }

  /**
   * Melodia: um instrumento a tocar uma nota.
   * o = { pitch, t, dur, vel, preset, out (ganho já ligado ao barramento do lead), bend(o) (liga o pitch bend), sample: {buf, root} }
   */
  function lead(c, o) {
    const { t, out, bend } = o;
    const f = 440 * Math.pow(2, (o.pitch - 69) / 12);
    const v = 0.12 + 0.18 * (o.vel / 127);
    const end = t + Math.max(0.05, o.dur);
    const G = out.gain;
    switch (o.preset) {
      case 'pluck': {
        const a = bend(c.createOscillator()), lp = c.createBiquadFilter();
        a.type = 'square'; a.frequency.value = f;
        lp.type = 'lowpass'; lp.Q.value = 2;
        lp.frequency.setValueAtTime(Math.min(12000, f * 14), t);
        lp.frequency.exponentialRampToValueAtTime(Math.max(200, f * 1.5), t + 0.25);
        const stopAt = Math.min(end + 0.1, t + 0.9);
        G.setValueAtTime(0.0001, t);
        G.exponentialRampToValueAtTime(v * 1.1, t + 0.004);
        G.exponentialRampToValueAtTime(0.0001, stopAt);
        a.connect(lp).connect(out); a.start(t); a.stop(stopAt + 0.02);
        return;
      }
      case 'sine': {
        const a = bend(c.createOscillator()), b = bend(c.createOscillator()), g2 = c.createGain();
        a.type = 'sine'; a.frequency.value = f;
        b.type = 'triangle'; b.frequency.value = f * 2; g2.gain.value = 0.15;
        G.setValueAtTime(0.0001, t);
        G.exponentialRampToValueAtTime(v * 1.3, t + 0.012);
        G.setValueAtTime(v * 1.3, end);
        G.exponentialRampToValueAtTime(0.0001, end + 0.12);
        a.connect(out); b.connect(g2).connect(out);
        a.start(t); b.start(t); a.stop(end + 0.15); b.stop(end + 0.15);
        return;
      }
      case 'epiano': { // FM: portadora e moduladora 1:1, mais o "tine" agudo no ataque
        const stop = end + 0.6, car = bend(osc(c, 'sine', f, t, stop)), m1 = bend(osc(c, 'sine', f, t, stop)), m2 = bend(osc(c, 'sine', f * 14, t, t + 0.2));
        const i1 = c.createGain(), i2 = c.createGain();
        i1.gain.setValueAtTime(f * 2.2, t); i1.gain.exponentialRampToValueAtTime(f * 0.25, t + 0.8);
        i2.gain.setValueAtTime(f * 1.2, t); i2.gain.exponentialRampToValueAtTime(f * 0.01, t + 0.12);
        m1.connect(i1).connect(car.frequency); m2.connect(i2).connect(car.frequency);
        G.setValueAtTime(0.0001, t); G.exponentialRampToValueAtTime(v * 1.5, t + 0.003);
        G.setTargetAtTime(v * 0.35, t + 0.003, 0.5); G.setTargetAtTime(0.0001, end, 0.1);
        car.connect(out);
        return;
      }
      case 'bell': { // FM 1:3,5, toca até ao fim mesmo com notas curtas
        const stop = t + Math.max(2.6, o.dur + 0.8), car = bend(osc(c, 'sine', f, t, stop)), m = bend(osc(c, 'sine', f * 3.5, t, stop)), i = c.createGain();
        i.gain.setValueAtTime(f * 4, t); i.gain.exponentialRampToValueAtTime(f * 0.2, t + 1.4);
        m.connect(i).connect(car.frequency);
        G.setValueAtTime(0.0001, t); G.exponentialRampToValueAtTime(v * 1.3, t + 0.002); G.setTargetAtTime(0.0001, t + 0.002, 0.55);
        car.connect(out);
        return;
      }
      case 'organ': { // tubos (registos) somados, com percussão no 3.º harmónico
        const stop = end + 0.1;
        [[0.5, 0.35], [1, 0.6], [2, 0.45], [3, 0.2], [4, 0.18]].forEach(([r, a]) => { const x = bend(osc(c, 'sine', f * r, t, stop)); x.connect(gainNode(c, a)).connect(out); });
        const p = bend(osc(c, 'sine', f * 3, t, t + 0.3)), pg = c.createGain();
        env(pg.gain, t, 0.4, 0.002, t + 0.25); p.connect(pg).connect(out);
        G.setValueAtTime(0.0001, t); G.exponentialRampToValueAtTime(v * 1.1, t + 0.008);
        G.setValueAtTime(v * 1.1, end); G.exponentialRampToValueAtTime(0.0001, end + 0.06);
        return;
      }
      case 'pad': {
        const stop = end + 1.3, lp = filt(c, 'lowpass', Math.min(4000, f * 6), 0.7);
        lp.connect(out);
        for (const [d, r, a] of [[-12, 1, 0.65], [0, 1, 0.65], [12, 1, 0.65], [0, 0.5, 0.45]]) {
          const x = bend(osc(c, 'sawtooth', f * r, t, stop)); x.detune.value = d; x.connect(gainNode(c, a)).connect(lp);
        }
        G.setValueAtTime(0.0001, t); G.linearRampToValueAtTime(v * 0.8, t + 0.35);
        G.setValueAtTime(v * 0.8, end); G.setTargetAtTime(0.0001, end, 0.3);
        return;
      }
      case 'supersaw': {
        const stop = end + 0.3, lp = filt(c, 'lowpass', 7000, 0.5);
        lp.connect(out);
        for (const d of [-28, -17, -8, 0, 8, 17, 28]) { const x = bend(osc(c, 'sawtooth', f, t, stop)); x.detune.value = d; x.connect(gainNode(c, 0.55)).connect(lp); }
        G.setValueAtTime(0.0001, t); G.exponentialRampToValueAtTime(v, t + 0.008);
        G.setValueAtTime(v * 0.85, end); G.setTargetAtTime(0.0001, end, 0.06);
        return;
      }
      case 'strings': {
        const stop = end + 0.9, lp = filt(c, 'lowpass', 3200, 0.6), xs = [];
        lp.connect(out);
        for (const d of [-7, 7]) { const x = bend(osc(c, 'sawtooth', f, t, stop)); x.detune.value = d; x.connect(gainNode(c, 1)).connect(lp); xs.push(x); }
        vibrato(c, t, stop, 5.5, 9, 0.25, xs);
        G.setValueAtTime(0.0001, t); G.linearRampToValueAtTime(v * 0.9, t + 0.15);
        G.setValueAtTime(v * 0.9, end); G.setTargetAtTime(0.0001, end, 0.18);
        return;
      }
      case 'flute': {
        const stop = end + 0.3, a = bend(osc(c, 'sine', f, t, stop)), b = bend(osc(c, 'sine', f * 2, t, stop));
        a.connect(out); b.connect(gainNode(c, 0.12)).connect(out);
        const n = c.createBufferSource(); n.buffer = o.noise; n.loop = true; n.start(t); n.stop(stop);
        const bp = filt(c, 'bandpass', Math.min(12000, f * 2), 2), ng = c.createGain();
        ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(0.09, t + 0.04); ng.gain.setTargetAtTime(0.03, t + 0.04, 0.1);
        n.connect(bp).connect(ng).connect(out);
        vibrato(c, t, stop, 5, 10, 0.2, [a, b]);
        G.setValueAtTime(0.0001, t); G.exponentialRampToValueAtTime(v * 1.2, t + 0.05);
        G.setValueAtTime(v * 1.2, end); G.setTargetAtTime(0.0001, end, 0.04);
        return;
      }
      case 'bass': {
        const stop = end + 0.2, a = bend(osc(c, 'sawtooth', f, t, stop)), s = bend(osc(c, 'sine', f / 2, t, stop)), lp = c.createBiquadFilter();
        lp.type = 'lowpass'; lp.Q.value = 5;
        lp.frequency.setValueAtTime(Math.min(12000, f * 10), t); lp.frequency.exponentialRampToValueAtTime(Math.max(120, f * 2.2), t + 0.18);
        a.connect(lp).connect(out); s.connect(gainNode(c, 0.6)).connect(out);
        G.setValueAtTime(0.0001, t); G.exponentialRampToValueAtTime(v * 1.3, t + 0.004);
        G.setValueAtTime(v * 1.1, end); G.setTargetAtTime(0.0001, end, 0.03);
        return;
      }
      case 'chip': {
        const stop = end + 0.15, a = bend(c.createOscillator());
        a.setPeriodicWave(pulseWave(c)); a.frequency.value = f; a.start(t); a.stop(stop);
        a.connect(out);
        G.setValueAtTime(0.0001, t); G.exponentialRampToValueAtTime(v * 1.8, t + 0.002);
        G.setTargetAtTime(v * 1.2, t + 0.002, 0.05); G.setTargetAtTime(0.0001, end, 0.015);
        return;
      }
      case 'sample': {
        if (o.sample && o.sample.buf) {
          G.value = 1;
          playSample(c, o.sample.buf, t, out, { rate: Math.pow(2, (o.pitch - o.sample.root) / 12), gain: v * 2.6, detuneSrc: o.bendSrc, end, release: 0.08 });
          return;
        }
      } // sem sample: cai no synth
      // falls through
      default: {
        const lp = c.createBiquadFilter();
        lp.type = 'lowpass'; lp.Q.value = 4;
        lp.frequency.setValueAtTime(f * 2, t);
        lp.frequency.exponentialRampToValueAtTime(Math.min(9000, f * 9), t + 0.03);
        lp.frequency.exponentialRampToValueAtTime(Math.min(5000, f * 4), t + 0.3);
        G.setValueAtTime(0.0001, t);
        G.exponentialRampToValueAtTime(v, t + 0.006);
        G.setValueAtTime(v * 0.8, end);
        G.exponentialRampToValueAtTime(0.0001, end + 0.09);
        lp.connect(out);
        [-7, 7].forEach((cents) => {
          const x = bend(c.createOscillator());
          x.type = 'sawtooth'; x.frequency.value = f; x.detune.value = cents;
          x.connect(lp); x.start(t); x.stop(end + 0.12);
        });
      }
    }
  }

  // ---------- biblioteca: os teus samples ----------
  /** lugares onde um sample pode entrar (as peças de bateria, o 808 e a melodia) */
  const SLOTS = ['kick', 'snare', 'clap', 'hat', 'openhat', 'bass', 'lead'];
  const MELODIC = new Set(['bass', 'lead']);
  const b = '(^|[^a-z0-9])', e_ = '([^a-z0-9]|$)';
  const GUESS = [
    ['openhat', new RegExp(`open|${b}oh${e_}|${b}o[-_ ]?hh|hh[-_ ]?o${e_}|aberto|crash|ride|cymbal`)],
    ['hat', new RegExp(`hat|${b}hh${e_}|${b}ch${e_}|closed|chimbal|shaker|tamb`)],
    ['clap', /clap|palma|snap/],
    ['snare', new RegExp(`snare|${b}(sd|sn|snr)${e_}|tarola|${b}rim`)],
    ['kick', new RegExp(`kick|${b}(bd|kk|kck)${e_}|bombo|bass ?drum`)],
    ['bass', new RegExp(`808|${b}sub${e_}|bass|baixo|reese`)],
    ['lead', /lead|synth|piano|keys|pluck|bell|pad|guitar|guitarra|vocal|vox|chord|melod|flute|string|brass|horn/],
  ];
  /** adivinha o lugar pelo nome do ficheiro (ou, se não der, pela pasta onde está) */
  function guess(name, path = '') {
    const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\.[a-z0-9]{2,4}$/, '');
    const parts = norm(path).split('/').filter(Boolean);
    for (const s of [norm(name), parts.length > 1 ? parts[parts.length - 2] : '']) {
      if (!s) continue;
      for (const [cat, rx] of GUESS) if (rx.test(s)) return cat;
    }
    return 'other';
  }
  const PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  /** nota no nome do ficheiro ("808 C#1.wav", "Bass (F).wav") → { pc, oct } */
  function nameNote(name) {
    const s = String(name).replace(/\.[a-z0-9]{2,4}$/i, '');
    const m = s.match(/(?:^|[^a-z0-9])([a-g])(#|♯|s|b|♭)?(-?[0-8])?(?=[^a-z0-9]|$)/i);
    if (!m) return null;
    let pc = PC[m[1].toLowerCase()];
    if (m[2] && /[#♯s]/.test(m[2])) pc += 1; else if (m[2]) pc -= 1;
    return { pc: (pc + 12) % 12, oct: m[3] != null ? +m[3] : null };
  }
  function mono(buf) {
    const x = buf.getChannelData(0), y = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;
    if (!y) return x;
    const m = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) m[i] = (x[i] + y[i]) / 2;
    return m;
  }
  /** a nota em que o sample está gravado (MIDI): nome do ficheiro + o que se ouve */
  function detectRoot(buf, cat, name) {
    const nn = nameNote(name);
    let det = null;
    try {
      const x = mono(buf), sr = buf.sampleRate;
      if (cat === 'bass') { // 808 e sub: o pico mais forte entre 25 e 250 Hz, depois do ataque
        const n = 8192, st = Math.min(Math.round(0.04 * sr), Math.max(0, x.length - n));
        if (x.length >= 2048 && BV.dsp && BV.dsp.magSpectrum) {
          const mag = BV.dsp.magSpectrum(x, st, Math.min(n, x.length - st), n), hz = sr / n;
          let bi = 0;
          for (let k = Math.ceil(25 / hz); k < Math.min(mag.length - 1, 250 / hz); k++) if (mag[k] > mag[bi]) bi = k;
          if (bi > 0) {
            const a = mag[bi - 1], b0 = mag[bi], c0 = mag[bi + 1], p = 0.5 * (a - c0) / (a - 2 * b0 + c0 || 1);
            det = 69 + 12 * Math.log2(((bi + p) * hz) / 440);
          }
        }
      } else if (BV.pitch && BV.pitch.track) {
        const fr = BV.pitch.track(x.length > sr * 3 ? x.subarray(0, sr * 3) : x, sr).frames.filter((f) => f.midi != null && f.conf > 0.6).map((f) => f.midi).sort((p, q) => p - q);
        if (fr.length >= 3) det = fr[Math.floor(fr.length / 2)];
      }
    } catch (err) { det = null; }
    if (nn && det != null) { let m = nn.pc + 12 * Math.round((det - nn.pc) / 12); return m; }
    if (nn && nn.oct != null) return 12 * (nn.oct + 1) + nn.pc;
    if (det != null && isFinite(det)) return Math.round(det);
    if (nn) return (cat === 'bass' ? 24 : 60) + nn.pc;
    return cat === 'bass' ? 36 : 60;
  }

  // IndexedDB: os samples ficam guardados neste browser
  let dbp = null;
  function db() {
    if (!dbp) dbp = new Promise((res, rej) => {
      if (!g.indexedDB) { rej(new Error('IndexedDB indisponível')); return; }
      const r = g.indexedDB.open('beatvox', 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('samples')) r.result.createObjectStore('samples', { keyPath: 'id' }); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function idb(mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction('samples', mode), req = fn(t.objectStore('samples'));
      t.oncomplete = () => res(req && 'result' in req ? req.result : undefined);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  }
  async function decode(ab) {
    const OAC = g.OfflineAudioContext || g.webkitOfflineAudioContext;
    const c = new OAC(2, 1, 44100);
    const buf = await new Promise((res, rej) => { const p = c.decodeAudioData(ab.slice(0), res, rej); if (p && p.catch) p.catch(rej); });
    // no máximo 20 s; pico a 0,9 (samples gravados baixo ou alto soam ao mesmo nível)
    const max = Math.min(buf.length, Math.round(buf.sampleRate * 20));
    let pk = 0;
    for (let ch = 0; ch < buf.numberOfChannels; ch++) { const x = buf.getChannelData(ch); for (let i = 0; i < max; i++) pk = Math.max(pk, Math.abs(x[i])); }
    if (pk < 1e-5) throw new Error('sample em silêncio');
    const out = c.createBuffer(buf.numberOfChannels, max, buf.sampleRate), k = 0.9 / pk;
    for (let ch = 0; ch < buf.numberOfChannels; ch++) { const x = buf.getChannelData(ch), y = out.getChannelData(ch); for (let i = 0; i < max; i++) y[i] = x[i] * k; }
    return out;
  }
  const AUDIO_EXT = /\.(wav|wave|aif|aiff|mp3|m4a|aac|ogg|oga|opus|flac|webm)$/i;

  const library = {
    items: [],        // { id, name, path, cat, root, buf }
    stored: true,     // false se o browser não deixar guardar (fica só nesta sessão)
    ready: null,
    onChange: null,
    get(id) { return this.items.find((x) => x.id === id) || null; },
    byName(name) { return this.items.find((x) => x.name === name) || null; },
    /** carrega o que ficou guardado da última vez */
    init() {
      if (!this.ready) this.ready = (async () => {
        let rows = [];
        try { rows = (await idb('readonly', (s) => s.getAll())) || []; } catch (err) { this.stored = false; return; }
        rows.sort((a, b2) => (a.added || 0) - (b2.added || 0));
        for (const r of rows) {
          try { this.items.push({ id: r.id, name: r.name, path: r.path || '', cat: r.cat, root: r.root, buf: await decode(r.data) }); }
          catch (err) { /* ficheiro que deixou de ser lido: fica de fora */ }
        }
        if (this.onChange) this.onChange();
      })();
      return this.ready;
    },
    /**
     * Importa ficheiros de áudio ({ file, path }). Devolve { added, skipped }.
     * onProgress(i, n) vai sendo chamado.
     */
    async add(entries, onProgress) {
      await this.init();
      const added = [], skipped = [];
      const list = entries.filter((x) => AUDIO_EXT.test(x.file.name) || /^audio\//.test(x.file.type)).slice(0, 300);
      skipped.push(...entries.filter((x) => !list.includes(x)).map((x) => x.file.name));
      for (let i = 0; i < list.length; i++) {
        const { file, path } = list[i];
        if (onProgress) onProgress(i, list.length);
        if (file.size > 25 * 1024 * 1024) { skipped.push(file.name); continue; }
        try {
          const data = await file.arrayBuffer(), buf = await decode(data);
          const cat = guess(file.name, path || file.webkitRelativePath || '');
          const root = MELODIC.has(cat) || cat === 'other' ? detectRoot(buf, cat, file.name) : null;
          const id = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
          const item = { id, name: file.name, path: path || file.webkitRelativePath || '', cat, root, buf };
          if (this.stored) {
            try { await idb('readwrite', (s) => s.put({ id, name: item.name, path: item.path, cat, root, data, added: Date.now() + i })); }
            catch (err) { this.stored = false; }
          }
          this.items.push(item); added.push(item);
        } catch (err) { skipped.push(file.name); }
      }
      if (this.onChange) this.onChange();
      return { added, skipped };
    },
    async update(id, patch) {
      const it = this.get(id);
      if (!it) return;
      Object.assign(it, patch);
      if (patch.cat && (MELODIC.has(patch.cat) || patch.cat === 'other') && it.root == null) it.root = detectRoot(it.buf, patch.cat, it.name);
      if (this.stored) {
        try {
          const row = await idb('readonly', (s) => s.get(id));
          if (row) await idb('readwrite', (s) => s.put({ ...row, cat: it.cat, root: it.root }));
        } catch (err) { /* fica só nesta sessão */ }
      }
      if (this.onChange) this.onChange();
    },
    async remove(id) {
      this.items = this.items.filter((x) => x.id !== id);
      if (this.stored) { try { await idb('readwrite', (s) => s.delete(id)); } catch (err) {} }
      if (this.onChange) this.onChange();
    },
    async clear() {
      this.items = [];
      if (this.stored) { try { await idb('readwrite', (s) => s.clear()); } catch (err) {} }
      if (this.onChange) this.onChange();
    },
  };

  /** lê ficheiros e pastas largados (arrastar e largar) → [{ file, path }] */
  async function fromDrop(dt) {
    const out = [], items = [...(dt.items || [])];
    const walk = async (entry, path) => {
      if (!entry) return;
      if (entry.isFile) { const f = await new Promise((res, rej) => entry.file(res, rej)); out.push({ file: f, path: path + f.name }); }
      else if (entry.isDirectory) {
        const reader = entry.createReader();
        let batch;
        do {
          batch = await new Promise((res, rej) => reader.readEntries(res, rej));
          for (const ch of batch) await walk(ch, path + entry.name + '/');
        } while (batch.length && out.length < 2000);
      }
    };
    if (items.length && items[0].webkitGetAsEntry) {
      const entries = items.map((it) => it.webkitGetAsEntry());
      for (const en of entries) await walk(en, '');
    } else for (const f of dt.files || []) out.push({ file: f, path: f.name });
    return out;
  }

  BV.sounds = { KITS, LEADS, SLOTS, drum, lead, playSample, guess, nameNote, detectRoot, library, fromDrop };
})(typeof window !== 'undefined' ? window : globalThis);
