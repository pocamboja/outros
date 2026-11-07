/* BeatVox — mesa de mistura.
   Cada som tem o seu canal: EQ de 3 bandas → volume → pan → saída direta para o master, e envios para os efeitos.
   Os efeitos são instâncias que se acrescentam e removem (reverb, delay, chorus, flanger, phaser, distorção,
   lo-fi, filtro, tremolo). Cada um recebe envios dos sons e manda a saída para o master ou para outro efeito.
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

  // ---------- tipos de efeito ----------
  const pct = (v) => Math.round(v * 100) + '%';
  const sec = (v) => v.toFixed(1).replace('.', ',') + ' s';
  const msf = (v) => Math.round(v * 1000) + ' ms';
  const hzf = (v) => (v < 1 ? v.toFixed(2) : v.toFixed(1)).replace('.', ',') + ' Hz';
  const cutHz = (t) => 60 * Math.pow(2, t * 8.2); // 0..1 → 60 Hz .. 17 kHz
  const kHz = (f) => (f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 0 : 1).replace('.', ',') + ' kHz' : Math.round(f) + ' Hz');
  const lvl = (def) => ({ id: 'level', nome: 'Nível', min: 0, max: 1.5, step: 0.01, def, fmt: pct });
  /** params: slider (min/max/step/fmt), seg (opts: [[valor, nome]]) ou toggle */
  const FX_TYPES = {
    reverb: {
      nome: 'Reverb', cor: '#b9a6d6', dica: 'A sala onde os sons tocam: espaço e profundidade.',
      params: [
        { id: 'size', nome: 'Tamanho', min: 0.4, max: 6, step: 0.1, def: 2.4, fmt: sec },
        { id: 'pre', nome: 'Pré-atraso', min: 0, max: 0.12, step: 0.005, def: 0.015, fmt: msf },
        { id: 'tone', nome: 'Brilho', min: 0, max: 1, step: 0.01, def: 0.65, fmt: pct },
        lvl(0.8),
      ],
    },
    delay: {
      nome: 'Delay', cor: '#8fc1b5', dica: 'Eco no tempo do beat.',
      params: [
        { id: 'div', nome: 'Tempo', kind: 'seg', opts: [[2, '1/8'], [3, '1/8 pont.'], [4, '1/4'], [6, '1/4 pont.']], def: 3 },
        { id: 'fb', nome: 'Repetições', min: 0, max: 0.85, step: 0.01, def: 0.35, fmt: pct },
        { id: 'tone', nome: 'Brilho', min: 0, max: 1, step: 0.01, def: 0.55, fmt: pct },
        { id: 'pp', nome: 'Pingue-pongue', kind: 'toggle', def: 0 },
        lvl(0.7),
      ],
    },
    chorus: {
      nome: 'Chorus', cor: '#8fb3e0', dica: 'Duplica o som com pequenas variações: mais largo e mais cheio.',
      params: [
        { id: 'rate', nome: 'Velocidade', min: 0.1, max: 4, step: 0.05, def: 0.7, fmt: hzf },
        { id: 'depth', nome: 'Profundidade', min: 0, max: 1, step: 0.01, def: 0.5, fmt: pct },
        lvl(0.9),
      ],
    },
    flanger: {
      nome: 'Flanger', cor: '#79c9d4', dica: 'Um "jato" metálico que sobe e desce.',
      params: [
        { id: 'rate', nome: 'Velocidade', min: 0.05, max: 2, step: 0.01, def: 0.2, fmt: hzf },
        { id: 'depth', nome: 'Profundidade', min: 0, max: 1, step: 0.01, def: 0.7, fmt: pct },
        { id: 'fb', nome: 'Ressonância', min: 0, max: 0.9, step: 0.01, def: 0.55, fmt: pct },
        lvl(0.9),
      ],
    },
    phaser: {
      nome: 'Phaser', cor: '#a3d39c', dica: 'Ondas que rodam pelo som quando se junta ao original.',
      params: [
        { id: 'rate', nome: 'Velocidade', min: 0.05, max: 4, step: 0.05, def: 0.4, fmt: hzf },
        { id: 'depth', nome: 'Profundidade', min: 0, max: 1, step: 0.01, def: 0.8, fmt: pct },
        { id: 'res', nome: 'Ressonância', min: 0.3, max: 6, step: 0.1, def: 1.2, fmt: (v) => v.toFixed(1).replace('.', ',') },
        lvl(1),
      ],
    },
    drive: {
      nome: 'Distorção', cor: '#e07a5f', dica: 'Saturação e garra. Em paralelo, o som original mantém o corpo.',
      params: [
        { id: 'drive', nome: 'Garra', min: 0, max: 1, step: 0.01, def: 0.5, fmt: pct },
        { id: 'tone', nome: 'Brilho', min: 0, max: 1, step: 0.01, def: 0.5, fmt: pct },
        lvl(0.6),
      ],
    },
    lofi: {
      nome: 'Lo-fi', cor: '#c9b458', dica: 'Menos bits e menos agudos: cassete ou sampler antigo.',
      params: [
        { id: 'bits', nome: 'Bits', min: 3, max: 12, step: 1, def: 6, fmt: (v) => v + ' bits' },
        { id: 'tone', nome: 'Brilho', min: 0, max: 1, step: 0.01, def: 0.35, fmt: pct },
        lvl(0.8),
      ],
    },
    filter: {
      nome: 'Filtro', cor: '#e3a0c8', dica: 'Corta graves ou agudos, parado ou a varrer no tempo do beat.',
      params: [
        { id: 'mode', nome: 'Tipo', kind: 'seg', opts: [['lp', 'Passa-baixo'], ['hp', 'Passa-alto'], ['bp', 'Banda']], def: 'lp' },
        { id: 'cut', nome: 'Corte', min: 0, max: 1, step: 0.005, def: 0.5, fmt: (v) => kHz(cutHz(v)) },
        { id: 'res', nome: 'Ressonância', min: 0.5, max: 12, step: 0.1, def: 3, fmt: (v) => v.toFixed(1).replace('.', ',') },
        { id: 'rate', nome: 'Varrer', kind: 'seg', opts: [[0, 'Fixo'], [4, '1/4'], [8, '1/2'], [16, '1 comp.'], [32, '2 comp.']], def: 16 },
        { id: 'depth', nome: 'Amplitude', min: 0, max: 1, step: 0.01, def: 0.5, fmt: pct },
        lvl(1),
      ],
    },
    tremolo: {
      nome: 'Tremolo', cor: '#f0b86e', dica: 'O volume pulsa no tempo do beat.',
      params: [
        { id: 'rate', nome: 'Ritmo', kind: 'seg', opts: [[1, '1/16'], [2, '1/8'], [4, '1/4'], [8, '1/2']], def: 2 },
        { id: 'depth', nome: 'Profundidade', min: 0, max: 1, step: 0.01, def: 0.8, fmt: pct },
        { id: 'shape', nome: 'Forma', kind: 'seg', opts: [['sine', 'Suave'], ['square', 'Corte']], def: 'sine' },
        lvl(1),
      ],
    },
  };
  const FX_ORDER = ['reverb', 'delay', 'chorus', 'flanger', 'phaser', 'drive', 'lofi', 'filter', 'tremolo'];
  const MAX_FX = 8;

  function elements() {
    return (BV.DRUMS || []).map((d) => ({ id: d.id, nome: d.nome.replace(/ \(.*\)/, ''), cor: d.cor })).concat(EXTRA);
  }
  function fxDefaults(type) {
    const p = {};
    for (const q of FX_TYPES[type].params) p[q.id] = q.def;
    return p;
  }
  function defaultFx() {
    return [
      { id: 'rev', type: 'reverb', on: true, out: 'master', p: fxDefaults('reverb') },
      { id: 'dly', type: 'delay', on: true, out: 'master', p: fxDefaults('delay') },
    ];
  }
  function defaultState() {
    const els = {};
    for (const e of elements()) {
      const p = {};
      for (const q of PARAMS[e.id] || []) p[q.id] = q.def;
      const sends = {};
      if (DEFAULT_REV[e.id]) sends.rev = DEFAULT_REV[e.id];
      // as gravações da tua voz começam fora da mistura (liga-as no palco se as quiseres no beat)
      els[e.id] = { vol: DEFAULT_VOL[e.id] ?? 0, pan: 0, mute: e.id === 'vdrums' || e.id === 'vlead', solo: false, eq: [0, 0, 0], dry: true, sends, p };
    }
    return { els, fx: defaultFx(), bassOn: false, dims: 3 };
  }

  /** o efeito `from` pode mandar a saída para `to` sem criar um ciclo? */
  function canRoute(st, from, to) {
    if (to === 'master') return true;
    if (to === from) return false;
    const byId = new Map(st.fx.map((f) => [f.id, f]));
    if (!byId.has(to)) return false;
    for (let cur = to, n = 0; cur && cur !== 'master' && n < 32; n++) {
      if (cur === from) return false;
      const f = byId.get(cur);
      cur = f ? f.out : null;
    }
    return true;
  }
  function cleanP(type, src) {
    const p = fxDefaults(type);
    if (!src || typeof src !== 'object') return p;
    for (const q of FX_TYPES[type].params) {
      const v = src[q.id];
      if (v == null) continue;
      if (q.kind === 'seg') { const o = q.opts.find((x) => String(x[0]) === String(v)); if (o) p[q.id] = o[0]; }
      else if (q.kind === 'toggle') p[q.id] = v ? 1 : 0;
      else if (isFinite(+v)) p[q.id] = Math.max(q.min, Math.min(q.max, +v));
    }
    return p;
  }
  /** junta um estado guardado (talvez de uma versão antiga) com os valores por omissão */
  function merge(saved) {
    const d = defaultState();
    if (!saved || typeof saved !== 'object') return d;
    // efeitos: lista nova, ou o formato antigo { rev: {...}, dly: {...} }
    if (Array.isArray(saved.fx)) {
      const seen = new Set();
      d.fx = saved.fx.filter((f) => f && FX_TYPES[f.type] && typeof f.id === 'string' && !seen.has(f.id) && seen.add(f.id)).slice(0, MAX_FX).map((f) => ({
        id: f.id, type: f.type, on: f.on !== false, out: typeof f.out === 'string' ? f.out : 'master', p: cleanP(f.type, f.p),
        ...(f.pos && isFinite(f.pos.x) && isFinite(f.pos.z) ? { pos: { x: +f.pos.x, z: +f.pos.z } } : {}),
      }));
      for (const f of d.fx) if (!canRoute(d, f.id, f.out)) f.out = 'master';
    } else if (saved.fx && typeof saved.fx === 'object') {
      const [rev, dly] = d.fx;
      if (saved.fx.rev) { if (isFinite(saved.fx.rev.size)) rev.p.size = +saved.fx.rev.size; if (isFinite(saved.fx.rev.level)) rev.p.level = +saved.fx.rev.level; }
      if (saved.fx.dly) for (const k of ['div', 'fb', 'level']) if (isFinite(saved.fx.dly[k])) dly.p[k] = +saved.fx.dly[k];
      if (![2, 3, 4, 6].includes(dly.p.div)) dly.p.div = 3;
    }
    const ids = new Set(d.fx.map((f) => f.id));
    for (const id in d.els) if (saved.els && saved.els[id]) {
      const s = saved.els[id], e = d.els[id];
      Object.assign(e, { vol: +s.vol || 0, pan: +s.pan || 0, mute: !!s.mute, solo: !!s.solo, dry: s.dry !== false });
      if (Array.isArray(s.eq)) e.eq = [0, 1, 2].map((i) => +s.eq[i] || 0);
      if (s.p) for (const k in e.p) if (s.p[k] != null) e.p[k] = +s.p[k];
      e.sends = {};
      if (s.sends && typeof s.sends === 'object') { for (const k in s.sends) if (ids.has(k) && +s.sends[k] > 0) e.sends[k] = Math.min(1, +s.sends[k]); }
      else { // formato antigo: envios rev e dly
        if (ids.has('rev') && +s.rev > 0) e.sends.rev = +s.rev;
        if (ids.has('dly') && +s.dly > 0) e.sends.dly = +s.dly;
      }
    }
    if (saved.bassOn != null) d.bassOn = !!saved.bassOn;
    if ([3, 6].includes(saved.dims)) d.dims = saved.dims;
    return d;
  }
  /** acrescenta um efeito ao estado e devolve-o (null se já houver demasiados) */
  function addFx(st, type) {
    if (!FX_TYPES[type] || st.fx.length >= MAX_FX) return null;
    let n = 1;
    while (st.fx.some((f) => f.id === 'fx' + n)) n++;
    const f = { id: 'fx' + n, type, on: true, out: 'master', p: fxDefaults(type) };
    st.fx.push(f);
    return f;
  }
  function removeFx(st, id) {
    const f = st.fx.find((x) => x.id === id);
    if (!f) return;
    st.fx = st.fx.filter((x) => x.id !== id);
    for (const x of st.fx) if (x.out === id) x.out = f.out !== id && canRoute(st, x.id, f.out) ? f.out : 'master';
    for (const k in st.els) delete st.els[k].sends[id];
  }

  // ---------- áudio ----------
  /** gerador pseudo-aleatório com semente: o reverb soa igual a tocar, no WAV e nos stems */
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function impulse(c, dur) {
    const len = Math.max(1, Math.round(c.sampleRate * dur)), b = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const x = b.getChannelData(ch), r = rng(1013 + ch * 7919 + Math.round(dur * 10));
      for (let i = 0; i < len; i++) x[i] = (r() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return b;
  }
  function driveCurve(k) {
    const n = 1024, cv = new Float32Array(n), a = 1 + k * 10;
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; cv[i] = Math.tanh(a * x) / Math.tanh(a); }
    return cv;
  }
  function crushCurve(bits) {
    const n = 8192, cv = new Float32Array(n), q = Math.pow(2, bits - 1);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; cv[i] = Math.round(x * q) / q; }
    return cv;
  }
  /** onda de LFO que começa no máximo: cosseno, ou quadrado suave (harmónicos ímpares, sem estalos) */
  function lfoWave(c, shape) {
    const N = 16, re = new Float32Array(N), im = new Float32Array(N);
    if (shape === 'square') {
      for (let k = 1; k < N; k += 2) { const s = Math.sin(Math.PI * k / N) / (Math.PI * k / N); im[k] = (4 / (Math.PI * k)) * s; }
    } else re[1] = 1;
    return c.createPeriodicWave(re, im);
  }

  /** cada tipo devolve { in, tail, set(p, k), sync?(t) } — k = { set(param, v), stepSec } */
  const FXB = {
    reverb(c) {
      const inp = c.createGain(), pre = c.createDelay(0.5), hp = c.createBiquadFilter(), conv = c.createConvolver(), lp = c.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 110; lp.type = 'lowpass';
      inp.connect(pre).connect(hp).connect(conv).connect(lp);
      let size = 0;
      return {
        in: inp, tail: lp,
        set(p, k) {
          const sz = Math.round(p.size * 10) / 10;
          if (sz !== size) { conv.buffer = impulse(c, sz); size = sz; }
          k.set(pre.delayTime, p.pre); k.set(lp.frequency, 1500 * Math.pow(2, p.tone * 3.5));
        },
      };
    },
    delay(c) {
      const inp = c.createGain(), sum = c.createGain();
      // eco normal
      const d = c.createDelay(5), lp = c.createBiquadFilter(), fb = c.createGain(), mono = c.createGain();
      lp.type = 'lowpass';
      inp.connect(mono); mono.connect(d); d.connect(lp).connect(fb).connect(d); lp.connect(sum);
      // pingue-pongue: esquerda, direita, esquerda…
      const ppIn = c.createGain(), dl = c.createDelay(5), dr = c.createDelay(5), lpl = c.createBiquadFilter(), lpr = c.createBiquadFilter();
      const fbl = c.createGain(), fbr = c.createGain(), mg = c.createChannelMerger(2);
      lpl.type = lpr.type = 'lowpass';
      inp.connect(ppIn).connect(dl);
      dl.connect(lpl); lpl.connect(mg, 0, 0); lpl.connect(fbl).connect(dr);
      dr.connect(lpr); lpr.connect(mg, 0, 1); lpr.connect(fbr).connect(dl);
      mg.connect(sum);
      return {
        in: inp, tail: sum,
        set(p, k) {
          const t = Math.min(4.9, p.div * k.stepSec), f = 1000 * Math.pow(2, p.tone * 3.6), r = Math.min(0.85, p.fb);
          for (const x of [d, dl, dr]) k.set(x.delayTime, t);
          for (const x of [lp, lpl, lpr]) k.set(x.frequency, f);
          k.set(fb.gain, r); k.set(fbl.gain, r); k.set(fbr.gain, r);
          k.set(mono.gain, p.pp ? 0 : 1); k.set(ppIn.gain, p.pp ? 1 : 0);
        },
      };
    },
    chorus(c) {
      const inp = c.createGain(), dL = c.createDelay(0.1), dR = c.createDelay(0.1), mg = c.createChannelMerger(2);
      const lfo = c.createOscillator(), aL = c.createGain(), aR = c.createGain();
      dL.delayTime.value = 0.012; dR.delayTime.value = 0.018;
      inp.connect(dL); inp.connect(dR);
      dL.connect(mg, 0, 0); dR.connect(mg, 0, 1);
      lfo.connect(aL).connect(dL.delayTime); lfo.connect(aR).connect(dR.delayTime);
      lfo.start();
      return {
        in: inp, tail: mg, oscs: [lfo],
        set(p, k) { k.set(lfo.frequency, p.rate); k.set(aL.gain, p.depth * 0.005); k.set(aR.gain, -p.depth * 0.005); },
      };
    },
    flanger(c) {
      // no ciclo de realimentação o atraso nunca desce de ~3 ms (regra da Web Audio): varre entre 3 e 10 ms
      const inp = c.createGain(), sum = c.createGain(), d = c.createDelay(0.05), fb = c.createGain(), lfo = c.createOscillator(), amt = c.createGain();
      inp.connect(sum).connect(d); d.connect(fb).connect(sum);
      lfo.connect(amt).connect(d.delayTime); lfo.start();
      return {
        in: inp, tail: d, oscs: [lfo],
        set(p, k) {
          k.set(lfo.frequency, p.rate); k.set(d.delayTime, 0.003 + p.depth * 0.0035); k.set(amt.gain, p.depth * 0.0035);
          k.set(fb.gain, Math.min(0.9, p.fb));
        },
      };
    },
    phaser(c) {
      const inp = c.createGain(), lfo = c.createOscillator(), amt = c.createGain(), aps = [];
      let head = inp;
      for (let i = 0; i < 6; i++) {
        const a = c.createBiquadFilter(); a.type = 'allpass'; a.frequency.value = 650;
        head.connect(a); head = a; aps.push(a);
        amt.connect(a.detune);
      }
      lfo.connect(amt); lfo.start();
      return {
        in: inp, tail: head, oscs: [lfo],
        set(p, k) { k.set(lfo.frequency, p.rate); k.set(amt.gain, p.depth * 2200); for (const a of aps) k.set(a.Q, p.res); },
      };
    },
    drive(c) {
      const inp = c.createGain(), sh = c.createWaveShaper(), lp = c.createBiquadFilter(), post = c.createGain();
      sh.oversample = '4x'; lp.type = 'lowpass';
      inp.connect(sh).connect(lp).connect(post);
      let dk = -1;
      return {
        in: inp, tail: post,
        set(p, k) {
          const q = Math.round(p.drive * 50) / 50;
          if (q !== dk) { sh.curve = driveCurve(q); dk = q; }
          const a = 1 + q * 10;
          k.set(post.gain, 1 / Math.pow(a / Math.tanh(a), 0.6));
          k.set(lp.frequency, 1200 * Math.pow(2, p.tone * 3.8));
        },
      };
    },
    lofi(c) {
      const inp = c.createGain(), hp = c.createBiquadFilter(), sh = c.createWaveShaper(), lp = c.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 90; lp.type = 'lowpass'; lp.Q.value = 0.9;
      inp.connect(hp).connect(sh).connect(lp);
      let bits = 0;
      return {
        in: inp, tail: lp,
        set(p, k) {
          if (p.bits !== bits) { sh.curve = crushCurve(p.bits); bits = p.bits; }
          k.set(lp.frequency, 700 * Math.pow(2, p.tone * 4.6));
        },
      };
    },
    filter(c) {
      const inp = c.createGain(), f = c.createBiquadFilter(), amt = c.createGain();
      inp.connect(f);
      amt.connect(f.detune);
      let lfo = null, period = 0, mode = '';
      return {
        in: inp, tail: f,
        set(p, k) {
          if (p.mode !== mode) { f.type = { lp: 'lowpass', hp: 'highpass', bp: 'bandpass' }[p.mode] || 'lowpass'; mode = p.mode; }
          k.set(f.frequency, cutHz(p.cut)); k.set(f.Q, p.res);
          period = p.rate ? p.rate * k.stepSec : 0;
          k.set(amt.gain, period ? p.depth * 2400 : 0);
          if (lfo) k.set(lfo.frequency, period ? 1 / period : 0);
        },
        /** recomeça o LFO no tempo t (o varrimento fica alinhado com o compasso) */
        sync(t) {
          if (lfo) { try { lfo.stop(t); } catch (e) {} }
          lfo = c.createOscillator(); lfo.setPeriodicWave(lfoWave(c, 'sine'));
          lfo.frequency.value = period ? 1 / period : 0;
          lfo.connect(amt); lfo.start(t);
        },
      };
    },
    tremolo(c) {
      const inp = c.createGain(), vca = c.createGain(), amt = c.createGain();
      inp.connect(vca); amt.connect(vca.gain);
      let lfo = null, period = 0, shape = 'sine';
      return {
        in: inp, tail: vca,
        set(p, k) {
          period = p.rate * k.stepSec;
          k.set(vca.gain, 1 - p.depth / 2); k.set(amt.gain, p.depth / 2);
          if (lfo) k.set(lfo.frequency, 1 / period);
          if (lfo && p.shape !== shape) lfo.setPeriodicWave(lfoWave(c, p.shape));
          shape = p.shape;
        },
        sync(t) {
          if (lfo) { try { lfo.stop(t); } catch (e) {} }
          lfo = c.createOscillator(); lfo.setPeriodicWave(lfoWave(c, shape));
          lfo.frequency.value = period ? 1 / period : 2;
          lfo.connect(amt); lfo.start(t);
        },
      };
    },
  };

  /** Monta a mesa num contexto (tempo real ou offline). dest = entrada do master. */
  function build(c, dest) {
    const strips = {}, buses = new Map();
    const an = () => { const a = c.createAnalyser(); a.fftSize = 256; return a; };
    for (const e of elements()) {
      const s = { input: c.createGain(), sends: new Map() };
      let head = s.input;
      if (e.id === 'bass') { s.drive = c.createWaveShaper(); s.drive.oversample = '2x'; s.driveK = -1; head.connect(s.drive); head = s.drive; }
      s.eqL = c.createBiquadFilter(); s.eqL.type = 'lowshelf'; s.eqL.frequency.value = 200;
      s.eqM = c.createBiquadFilter(); s.eqM.type = 'peaking'; s.eqM.frequency.value = 1000; s.eqM.Q.value = 0.8;
      s.eqH = c.createBiquadFilter(); s.eqH.type = 'highshelf'; s.eqH.frequency.value = 4000;
      s.fader = c.createGain();
      s.pan = c.createStereoPanner ? c.createStereoPanner() : null;
      head.connect(s.eqL).connect(s.eqM).connect(s.eqH).connect(s.fader);
      s.post = s.pan ? (s.fader.connect(s.pan), s.pan) : s.fader;
      s.dry = c.createGain(); s.post.connect(s.dry).connect(dest);
      s.an = an(); s.post.connect(s.an);
      strips[e.id] = s;
    }
    function makeBus(f) {
      const b = FXB[f.type](c);
      b.type = f.type; b.out = c.createGain(); b.out.gain.value = 0;
      b.tail.connect(b.out);
      b.an = an(); b.out.connect(b.an);
      b.target = null;
      return b;
    }
    function dropBus(id) {
      const b = buses.get(id);
      if (!b) return;
      for (const s of Object.values(strips)) { const sg = s.sends.get(id); if (sg) { sg.disconnect(); s.sends.delete(id); } }
      for (const o of buses.values()) if (o.target === b.in) { o.out.disconnect(b.in); o.target = null; }
      try { b.in.disconnect(); } catch (e) {}
      try { b.out.disconnect(); } catch (e) {}
      for (const o of b.oscs || []) { try { o.stop(); } catch (e) {} }
      if (b.sync) b.sync = null;
      buses.delete(id);
    }
    const lvlBuf = new Float32Array(256);
    const level = (a) => { a.getFloatTimeDomainData(lvlBuf); let q = 0; for (let i = 0; i < lvlBuf.length; i++) q += lvlBuf[i] * lvlBuf[i]; return Math.sqrt(q / lvlBuf.length); };
    let lastNow = 0;
    return {
      strips, buses,
      /** aplica o estado (suave em tempo real, imediato no offline) */
      apply(st, bpm, stepsPerBeat = 4, now = 0, glide = 0.03) {
        lastNow = now;
        const set = (param, v) => { if (!isFinite(v)) return; if (glide > 0) param.setTargetAtTime(v, now, glide); else param.setValueAtTime(v, now); };
        const stepSec = 60 / bpm / 4; // passos de 1/16 (independente da grelha)
        const k = { set, stepSec };
        // efeitos: cria os novos, retira os que saíram (ou mudaram de tipo)
        const want = new Map(st.fx.map((f) => [f.id, f]));
        for (const [id, b] of [...buses]) if (!want.has(id) || want.get(id).type !== b.type) dropBus(id);
        for (const f of st.fx) if (!buses.has(f.id)) { const b = makeBus(f); buses.set(f.id, b); if (b.sync) b.sync(now); }
        for (const f of st.fx) {
          const b = buses.get(f.id);
          b.set(f.p, k);
          set(b.out.gain, f.on ? f.p.level : 0);
          const tb = f.out !== 'master' && buses.get(f.out);
          const to = tb && canRoute(st, f.id, f.out) ? tb.in : dest;
          if (b.target !== to) { if (b.target) b.out.disconnect(b.target); b.out.connect(to); b.target = to; }
        }
        // canais
        const anySolo = Object.values(st.els).some((e) => e.solo);
        for (const id in strips) {
          const s = strips[id], e = st.els[id];
          if (!e) continue;
          const on = !e.mute && (!anySolo || e.solo);
          set(s.fader.gain, on ? Math.pow(10, e.vol / 20) : 0);
          if (s.pan) set(s.pan.pan, Math.max(-1, Math.min(1, e.pan)));
          set(s.eqL.gain, e.eq[0]); set(s.eqM.gain, e.eq[1]); set(s.eqH.gain, e.eq[2]);
          set(s.dry.gain, e.dry === false ? 0 : 1);
          for (const [fid, b] of buses) {
            const amt = (e.sends && e.sends[fid]) || 0;
            let sg = s.sends.get(fid);
            if (!sg && amt > 0) { sg = c.createGain(); sg.gain.value = 0; s.post.connect(sg).connect(b.in); s.sends.set(fid, sg); }
            if (sg) set(sg.gain, amt);
          }
          if (s.drive && e.p && s.driveK !== e.p.drive) { s.drive.curve = driveCurve(e.p.drive); s.driveK = e.p.drive; }
        }
      },
      /** recomeça os LFOs no tempo do beat (filtro e tremolo) a partir de t */
      sync(t = lastNow) { for (const b of buses.values()) if (b.sync) b.sync(t); },
      level(id) { const b = buses.get(id); return b ? level(b.an) : strips[id] ? level(strips[id].an) : 0; },
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

  BV.mix = { elements, PARAMS, FX_TYPES, FX_ORDER, MAX_FX, BANDS6, BANDS3, defaultState, merge, addFx, removeFx, canRoute, fxDefaults, build, spectrumProfile };
  if (typeof module !== 'undefined') module.exports = BV;
})(typeof window !== 'undefined' ? window : globalThis);
