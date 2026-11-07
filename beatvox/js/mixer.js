/* BeatVox — mesa de mistura.
   Cada som tem o seu canal: EQ de 3 bandas → volume → pan → saída, com envios para reverb e delay.
   O mesmo código monta a mistura no contexto em tempo real e no render do WAV (OfflineAudioContext),
   por isso o que ouves é o que exportas. */
(function (g) {
  const BV = (g.BV = g.BV || {});

  // sons da mistura (as peças de bateria vêm de BV.DRUMS; aqui ficam os parâmetros de "carácter")
  const EXTRA = [
    { id: 'lead',   nome: 'Melodia',        cor: '#f1dcae' },
    { id: 'bass',   nome: '808',            cor: '#c9895b' },
    { id: 'vdrums', nome: 'Voz (bateria)',  cor: '#a8958a' },
    { id: 'vlead',  nome: 'Voz (melodia)',  cor: '#cbb8a6' },
  ];
  const PARAMS = {
    kick:    [{ id: 'tune', nome: 'Afinação', min: -12, max: 12, step: 1, def: 0, fmt: (v) => (v > 0 ? '+' : '') + v + ' st' },
              { id: 'decay', nome: 'Decaimento', min: 0.4, max: 2.5, step: 0.05, def: 1, fmt: (v) => '×' + v.toFixed(2) }],
    snare:   [{ id: 'tone', nome: 'Tom', min: 0.5, max: 2, step: 0.05, def: 1, fmt: (v) => '×' + v.toFixed(2) },
              { id: 'decay', nome: 'Decaimento', min: 0.4, max: 2.5, step: 0.05, def: 1, fmt: (v) => '×' + v.toFixed(2) }],
    clap:    [{ id: 'tone', nome: 'Tom', min: 0.5, max: 2, step: 0.05, def: 1, fmt: (v) => '×' + v.toFixed(2) },
              { id: 'decay', nome: 'Decaimento', min: 0.4, max: 2.5, step: 0.05, def: 1, fmt: (v) => '×' + v.toFixed(2) }],
    hat:     [{ id: 'tone', nome: 'Brilho', min: 0.5, max: 1.6, step: 0.05, def: 1, fmt: (v) => '×' + v.toFixed(2) },
              { id: 'decay', nome: 'Decaimento', min: 0.4, max: 3, step: 0.05, def: 1, fmt: (v) => '×' + v.toFixed(2) }],
    openhat: [{ id: 'tone', nome: 'Brilho', min: 0.5, max: 1.6, step: 0.05, def: 1, fmt: (v) => '×' + v.toFixed(2) },
              { id: 'decay', nome: 'Decaimento', min: 0.4, max: 2, step: 0.05, def: 1, fmt: (v) => '×' + v.toFixed(2) }],
    bass:    [{ id: 'tune', nome: 'Afinação', min: -12, max: 12, step: 1, def: 0, fmt: (v) => (v > 0 ? '+' : '') + v + ' st' },
              { id: 'decay', nome: 'Decaimento', min: 0.2, max: 1.5, step: 0.05, def: 0.8, fmt: (v) => '×' + v.toFixed(2) },
              { id: 'drive', nome: 'Saturação', min: 0, max: 1, step: 0.01, def: 0.35, fmt: (v) => Math.round(v * 100) + '%' }],
  };
  const DEFAULT_VOL = { kick: 0, snare: -2, clap: -3, hat: -6, openhat: -6, lead: -2, bass: -4, vdrums: -6, vlead: -6 };
  const DEFAULT_REV = { snare: 0.12, clap: 0.18, lead: 0.22, vlead: 0.15 };
  const DIV = [{ v: 2, nome: '1/8' }, { v: 3, nome: '1/8 pontuada' }, { v: 4, nome: '1/4' }]; // em passos de 1/16

  function elements() {
    return (BV.DRUMS || []).map((d) => ({ id: d.id, nome: d.nome.replace(/ \(.*\)/, ''), cor: d.cor })).concat(EXTRA);
  }
  function defaultState() {
    const els = {};
    for (const e of elements()) {
      const p = {};
      for (const q of PARAMS[e.id] || []) p[q.id] = q.def;
      // as gravações da tua voz começam fora da mistura (liga-as no palco se as quiseres no beat)
      els[e.id] = { vol: DEFAULT_VOL[e.id] ?? 0, pan: 0, mute: e.id === 'vdrums' || e.id === 'vlead', solo: false, eq: [0, 0, 0], rev: DEFAULT_REV[e.id] || 0, dly: 0, p };
    }
    return { els, fx: { rev: { size: 2.4, level: 0.8 }, dly: { div: 3, fb: 0.35, level: 0.7 } }, bassOn: false, dims: 3 };
  }
  /** junta um estado guardado (talvez de uma versão antiga) com os valores por omissão */
  function merge(saved) {
    const d = defaultState();
    if (!saved || typeof saved !== 'object') return d;
    for (const id in d.els) if (saved.els && saved.els[id]) {
      const s = saved.els[id], e = d.els[id];
      Object.assign(e, { vol: +s.vol || 0, pan: +s.pan || 0, mute: !!s.mute, solo: !!s.solo, rev: +s.rev || 0, dly: +s.dly || 0 });
      if (Array.isArray(s.eq)) e.eq = [0, 1, 2].map((i) => +s.eq[i] || 0);
      if (s.p) for (const k in e.p) if (s.p[k] != null) e.p[k] = +s.p[k];
    }
    if (saved.fx) {
      if (saved.fx.rev) Object.assign(d.fx.rev, saved.fx.rev);
      if (saved.fx.dly) Object.assign(d.fx.dly, saved.fx.dly);
    }
    if (saved.bassOn != null) d.bassOn = !!saved.bassOn;
    if ([3, 6].includes(saved.dims)) d.dims = saved.dims;
    return d;
  }

  function impulse(c, dur) {
    const len = Math.max(1, Math.round(c.sampleRate * dur)), b = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const x = b.getChannelData(ch);
      for (let i = 0; i < len; i++) x[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return b;
  }
  function driveCurve(k) {
    const n = 1024, cv = new Float32Array(n), a = 1 + k * 10;
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; cv[i] = Math.tanh(a * x) / Math.tanh(a); }
    return cv;
  }

  /** Monta a mesa num contexto (tempo real ou offline). dest = entrada do master. */
  function build(c, dest) {
    const strips = {};
    // FX: reverb e delay (retornos para o master)
    const rev = { in: c.createGain(), conv: c.createConvolver(), out: c.createGain(), size: 0 };
    rev.in.connect(rev.conv).connect(rev.out).connect(dest);
    const dly = { in: c.createGain(), d: c.createDelay(2), fb: c.createGain(), lp: c.createBiquadFilter(), out: c.createGain() };
    dly.lp.type = 'lowpass'; dly.lp.frequency.value = 4500;
    dly.in.connect(dly.d); dly.d.connect(dly.lp).connect(dly.fb).connect(dly.d); dly.lp.connect(dly.out).connect(dest);
    // analisadores dos retornos (para o palco 3D)
    rev.an = c.createAnalyser(); rev.an.fftSize = 256; rev.out.connect(rev.an);
    dly.an = c.createAnalyser(); dly.an.fftSize = 256; dly.out.connect(dly.an);
    for (const e of elements()) {
      const s = { input: c.createGain() };
      let head = s.input;
      if (e.id === 'bass') { s.drive = c.createWaveShaper(); s.drive.oversample = '2x'; s.driveK = -1; head.connect(s.drive); head = s.drive; }
      s.eqL = c.createBiquadFilter(); s.eqL.type = 'lowshelf'; s.eqL.frequency.value = 200;
      s.eqM = c.createBiquadFilter(); s.eqM.type = 'peaking'; s.eqM.frequency.value = 1000; s.eqM.Q.value = 0.8;
      s.eqH = c.createBiquadFilter(); s.eqH.type = 'highshelf'; s.eqH.frequency.value = 4000;
      s.fader = c.createGain();
      s.pan = c.createStereoPanner ? c.createStereoPanner() : null;
      head.connect(s.eqL).connect(s.eqM).connect(s.eqH).connect(s.fader);
      const post = s.pan ? (s.fader.connect(s.pan), s.pan) : s.fader;
      post.connect(dest);
      s.sendR = c.createGain(); s.sendR.gain.value = 0; post.connect(s.sendR).connect(rev.in);
      s.sendD = c.createGain(); s.sendD.gain.value = 0; post.connect(s.sendD).connect(dly.in);
      s.an = c.createAnalyser(); s.an.fftSize = 256; post.connect(s.an);
      strips[e.id] = s;
    }
    const lvlBuf = new Float32Array(256);
    const level = (an) => { an.getFloatTimeDomainData(lvlBuf); let q = 0; for (let i = 0; i < lvlBuf.length; i++) q += lvlBuf[i] * lvlBuf[i]; return Math.sqrt(q / lvlBuf.length); };
    return {
      strips, rev, dly,
      /** aplica o estado (suave em tempo real, imediato no offline) */
      apply(st, bpm, stepsPerBeat = 4, now = 0, glide = 0.03) {
        const set = (param, v) => { if (glide > 0) param.setTargetAtTime(v, now, glide); else param.setValueAtTime(v, now); };
        const anySolo = Object.values(st.els).some((e) => e.solo);
        for (const id in strips) {
          const s = strips[id], e = st.els[id];
          if (!e) continue;
          const on = !e.mute && (!anySolo || e.solo);
          set(s.fader.gain, on ? Math.pow(10, e.vol / 20) : 0);
          if (s.pan) set(s.pan.pan, Math.max(-1, Math.min(1, e.pan)));
          set(s.eqL.gain, e.eq[0]); set(s.eqM.gain, e.eq[1]); set(s.eqH.gain, e.eq[2]);
          set(s.sendR.gain, e.rev); set(s.sendD.gain, e.dly);
          if (s.drive && e.p && s.driveK !== e.p.drive) { s.drive.curve = driveCurve(e.p.drive); s.driveK = e.p.drive; }
        }
        // FX
        const sz = Math.round(st.fx.rev.size * 10) / 10;
        if (rev.size !== sz) { rev.conv.buffer = impulse(c, sz); rev.size = sz; }
        set(rev.out.gain, st.fx.rev.level);
        const stepSec = 60 / bpm / 4; // passos de 1/16 (independente da grelha)
        set(dly.d.delayTime, Math.min(1.9, st.fx.dly.div * stepSec));
        set(dly.fb.gain, Math.min(0.85, st.fx.dly.fb));
        set(dly.out.gain, st.fx.dly.level);
      },
      level(id) { return id === 'rev' ? level(rev.an) : id === 'dly' ? level(dly.an) : strips[id] ? level(strips[id].an) : 0; },
    };
  }

  /** espetro médio de um sinal → energia por banda (6 bandas) e centroide */
  const BANDS6 = [
    { nome: 'Sub', lo: 20, hi: 60 }, { nome: 'Graves', lo: 60, hi: 250 }, { nome: 'Médios-graves', lo: 250, hi: 800 },
    { nome: 'Médios', lo: 800, hi: 2500 }, { nome: 'Agudos', lo: 2500, hi: 8000 }, { nome: 'Ar', lo: 8000, hi: 20000 },
  ];
  const BANDS3 = [
    { nome: 'Graves', lo: 20, hi: 250, of: [0, 1] }, { nome: 'Médios', lo: 250, hi: 2500, of: [2, 3] }, { nome: 'Agudos', lo: 2500, hi: 20000, of: [4, 5] },
  ];
  function spectrumProfile(chs, sr) {
    const n = 4096, x = chs[0], y = chs[1] || chs[0];
    const mono = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) mono[i] = (x[i] + y[i]) / 2;
    const acc = new Float64Array(n / 2);
    let frames = 0, peak = 0;
    for (let i = 0; i < mono.length; i++) peak = Math.max(peak, Math.abs(mono[i]));
    if (peak < 1e-5) return null;
    for (let st = 0; st + n <= mono.length; st += n / 2) {
      let e = 0;
      for (let i = st; i < st + n; i += 8) e += mono[i] * mono[i];
      if (Math.sqrt(e / (n / 8)) < peak * 0.02) continue;
      const mag = BV.dsp.magSpectrum(mono, st, n, n);
      for (let k = 0; k < mag.length; k++) acc[k] += mag[k] * mag[k];
      frames++;
    }
    if (!frames) { const mag = BV.dsp.magSpectrum(mono, 0, Math.min(n, mono.length), n); for (let k = 0; k < mag.length; k++) acc[k] += mag[k] * mag[k]; frames = 1; }
    const binHz = sr / n, bands = BANDS6.map(() => 0);
    let sw = 0, tot = 0;
    for (let k = 1; k < acc.length; k++) {
      const f = k * binHz, p = acc[k];
      if (f < 20) continue;
      tot += p; sw += p * Math.log2(f);
      const b = BANDS6.findIndex((q) => f >= q.lo && f < q.hi);
      if (b >= 0) bands[b] += p;
    }
    const share = bands.map((b) => b / (tot + 1e-20));
    return { share, centroid: Math.pow(2, sw / (tot + 1e-20)) };
  }

  BV.mix = { elements, PARAMS, DIV, BANDS6, BANDS3, defaultState, merge, build, spectrumProfile };
  if (typeof module !== 'undefined') module.exports = BV;
})(typeof window !== 'undefined' ? window : globalThis);
