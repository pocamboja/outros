/* BeatVox — motor de áudio: microfone, gravação com metrónomo, calibração,
   sintetizador de bateria e reprodução em loop. */
(function (g) {
  const BV = (g.BV = g.BV || {});

  // ---------- efeitos da voz: barramento do lead ----------
  // lead → [garra: distorção em paralelo] → [vogais: filtro wah] → [volume: filtro + nível] → saída
  //                                                                   └→ [ar: envio para reverb]
  // + uma fonte constante ligada ao "detune" de cada oscilador do lead (glide e vibrato)
  function reverbImpulse(c, dur) {
    const len = Math.round(c.sampleRate * dur), b = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    return b;
  }
  function makeLeadBus(c, dest) {
    const input = c.createGain();
    const dry = c.createGain(), pre = c.createGain(), shaper = c.createWaveShaper(), tone = c.createBiquadFilter(), wet = c.createGain(), sum = c.createGain();
    const K = 2048, cv = new Float32Array(K);
    for (let i = 0; i < K; i++) { const x = (i / (K - 1)) * 2 - 1; cv[i] = Math.tanh(x * 9) / Math.tanh(9); }
    shaper.curve = cv; shaper.oversample = '2x';
    pre.gain.value = 1.6; tone.type = 'lowpass'; tone.frequency.value = 5200;
    dry.gain.value = 1; wet.gain.value = 0;
    input.connect(dry).connect(sum);
    input.connect(pre).connect(shaper).connect(tone).connect(wet).connect(sum);
    const wah = c.createBiquadFilter(); wah.type = 'peaking'; wah.Q.value = 3; wah.gain.value = 0; wah.frequency.value = 1000;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 20000; lp.Q.value = 0.8;
    const level = c.createGain(); level.gain.value = 1;
    sum.connect(wah).connect(lp).connect(level).connect(dest);
    const send = c.createGain(); send.gain.value = 0;
    const rev = c.createConvolver(); rev.buffer = reverbImpulse(c, 2.6);
    const revOut = c.createGain(); revOut.gain.value = 0.8;
    level.connect(send).connect(rev).connect(revOut).connect(dest);
    let bend = null;
    if (c.createConstantSource) { bend = c.createConstantSource(); bend.offset.value = 0; bend.start(); }
    return { input, bend, p: { wet: wet.gain, dry: dry.gain, wahF: wah.frequency, wahG: wah.gain, lpF: lp.frequency, level: level.gain, send: send.gain, bend: bend && bend.offset } };
  }
  const NEUTRAL = { wet: 0, dry: 1, wahF: 1000, wahG: 0, lpF: 20000, level: 1, send: 0, bend: 0 };
  function resetLeadBus(bus, t) {
    for (const k in bus.p) if (bus.p[k]) { bus.p[k].cancelScheduledValues(0); bus.p[k].setValueAtTime(NEUTRAL[k], t); }
  }
  /** Agenda as curvas de um loop (fx = BV.voicefx.build(...), ou null = tudo neutro) a partir de t0. */
  function scheduleLeadBus(bus, fx, t0, stepDur) {
    const P = bus.p;
    if (!fx) { for (const k in P) if (P[k]) { P[k].cancelScheduledValues(t0); P[k].setValueAtTime(NEUTRAL[k], t0); } return; }
    const N = fx.n * fx.res, dt = stepDur / fx.res;
    const auto = (param, arr, map, key) => {
      if (!param) return;
      param.cancelScheduledValues(t0);
      if (!arr) { param.setValueAtTime(NEUTRAL[key], t0); return; }
      param.setValueAtTime(map(arr[0]), t0);
      for (let k = 1; k < N; k++) param.linearRampToValueAtTime(map(arr[k]), t0 + k * dt);
    };
    auto(P.wet, fx.garra, (v) => v * 0.85, 'wet');
    auto(P.dry, fx.garra, (v) => 1 - 0.45 * v, 'dry');
    auto(P.wahF, fx.vogal, (v) => 350 * Math.pow(2, 3 * v), 'wahF');
    if (P.wahG) { P.wahG.cancelScheduledValues(t0); P.wahG.setValueAtTime(fx.vogal ? 13 : 0, t0); }
    auto(P.lpF, fx.vol, (v) => 500 * Math.pow(2, 5.3 * v), 'lpF');
    auto(P.level, fx.vol, (v) => 0.3 + 0.7 * v, 'level');
    auto(P.send, fx.ar, (v) => Math.min(1, v * 1.1), 'send');
    auto(P.bend, fx.bend, (v) => v * 100, 'bend');
  }

  class Engine {
    constructor() {
      this.ctx = null;
      this.stream = null;
      this.streamHeadphones = null;
      this.playing = false;
    }

    ensureCtx() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC({ latencyHint: 'interactive' });
        const len = this.ctx.sampleRate * 1;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.9;
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -10;
        comp.ratio.value = 4;
        this.master.connect(comp).connect(this.ctx.destination);
        // analisadores para a cena reagir ao som (saída e microfone)
        this.outAn = this.ctx.createAnalyser(); this.outAn.fftSize = 512;
        comp.connect(this.outAn);
        this.micAn = this.ctx.createAnalyser(); this.micAn.fftSize = 512;
        this.mixer = BV.mix ? BV.mix.build(this.ctx, this.master) : null;
        if (this.mixer && this.mixState) this.mixer.apply(this.mixState, this.mixBpm || 90, 4, this.ctx.currentTime, 0);
        this.leadBus = makeLeadBus(this.ctx, this.mixer ? this.mixer.strips.lead.input : this.master);
        this._lvlBuf = new Float32Array(512);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }

    /** Latência de saída estimada pelo browser (s) — ponto de partida antes da calibração */
    defaultLatency() {
      const c = this.ensureCtx();
      return (c.outputLatency || 0) + (c.baseLatency || 0) + 0.01;
    }

    async openMic(headphones) {
      const dev = this.deviceId || '';
      if (this.stream && this.streamHeadphones === headphones && this.streamDevice === dev && this.stream.active) return this.stream;
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      // com auscultadores: áudio "cru" (transientes intactos); sem: cancelamento de eco para não apanhar o metrónomo
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: !headphones,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
          ...(dev ? { deviceId: { exact: dev } } : {}),
        },
      });
      this.streamHeadphones = headphones;
      this.streamDevice = dev;
      return this.stream;
    }

    // ---------- Sons ----------
    click(t, accent, vol = 1) {
      const c = this.ctx;
      const o = c.createOscillator(), gn = c.createGain();
      o.type = 'square';
      o.frequency.value = accent ? 1760 : 1175;
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.exponentialRampToValueAtTime(0.25 * vol, t + 0.001);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
      o.connect(gn).connect(this.master);
      o.start(t);
      o.stop(t + 0.06);
    }

    noiseSrc(t, dur) {
      const s = this.ctx.createBufferSource();
      s.buffer = this.noise;
      s.start(t, Math.random() * 0.5);
      s.stop(t + dur);
      return s;
    }

    /** estado da mesa (BV.mix): aplicado já, e lido pelos sintetizadores (afinação, decaimento, tom) */
    setMix(state, bpm) {
      this.mixState = state; this.mixBpm = bpm;
      if (this.mixer && this.ctx) this.mixer.apply(state, bpm, 4, this.ctx.currentTime);
    }
    stripIn(id) { return this.mixer && this.mixer.strips[id] ? this.mixer.strips[id].input : this.master; }
    mixP(id) { return (this.mixState && this.mixState.els[id] && this.mixState.els[id].p) || {}; }

    /** 808: seno grave com "punch" de altura no ataque, decaimento longo e saturação no canal */
    playBass(pitch, t, dur, vel = 100) {
      const c = this.ctx, P = this.mixP('bass');
      const f = 440 * Math.pow(2, (pitch + (P.tune || 0) - 69) / 12);
      const v = 0.75 * Math.max(0.1, vel / 127), dk = P.decay || 0.8;
      const o = c.createOscillator(), gn = c.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(f * 2.2, t);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.045);
      const end = t + Math.max(0.12, dur);
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.exponentialRampToValueAtTime(v, t + 0.006);
      gn.gain.setTargetAtTime(v * 0.05, t + 0.02, 0.35 * dk);
      gn.gain.setTargetAtTime(0.0001, end, 0.03);
      o.connect(gn).connect(this.stripIn('bass'));
      o.start(t); o.stop(end + 0.2);
    }

    playDrum(id, t, vel = 100) {
      const c = this.ctx;
      const v = Math.max(0.05, vel / 127);
      const P = this.mixP(id), tn = P.tune || 0, dk = P.decay || 1, tone = P.tone || 1;
      const out = c.createGain();
      out.gain.value = v;
      out.connect(this.stripIn(id));
      if (id === 'kick') {
        const o = c.createOscillator(), gn = c.createGain();
        const kt = Math.pow(2, tn / 12);
        o.frequency.setValueAtTime(160 * kt, t);
        o.frequency.exponentialRampToValueAtTime(48 * kt, t + 0.12);
        gn.gain.setValueAtTime(1, t);
        gn.gain.exponentialRampToValueAtTime(0.001, t + 0.45 * dk);
        o.connect(gn).connect(out);
        o.start(t); o.stop(t + 0.5 * dk + 0.02);
        // clique de ataque
        const n = this.noiseSrc(t, 0.01), ng = c.createGain(), lp = c.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 3000;
        ng.gain.setValueAtTime(0.3, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.01);
        n.connect(lp).connect(ng).connect(out);
      } else if (id === 'snare') {
        const n = this.noiseSrc(t, 0.25 * dk + 0.05), ng = c.createGain(), hp = c.createBiquadFilter();
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
        this.noiseSrc(t, 0.06 + 0.2 * dk).connect(bp);
      } else if (id === 'hat' || id === 'openhat') {
        const dur = (id === 'hat' ? 0.05 : 0.32) * dk;
        const n = this.noiseSrc(t, dur + 0.02), hp = c.createBiquadFilter(), ng = c.createGain();
        hp.type = 'highpass'; hp.frequency.value = Math.min(16000, 7000 * tone);
        ng.gain.setValueAtTime(0.45, t); ng.gain.exponentialRampToValueAtTime(0.001, t + dur);
        n.connect(hp).connect(ng).connect(out);
      }
    }

    // ---------- Gravação ----------
    /**
     * Grava com contagem de entrada + metrónomo.
     * Resolve com { samples, sr, bar1Sample } onde bar1Sample é a amostra do tempo 1 do compasso 1
     * (já compensada pela latência).
     */
    /** Gravador num AudioWorklet (corre na linha de áudio, imune a quebras de ritmo da página). */
    async recorderNode(c) {
      if (!c.audioWorklet || typeof AudioWorkletNode === 'undefined') return null;
      if (!this._wl) {
        const src = `class BVRec extends AudioWorkletProcessor {
          constructor() { super(); this.b = new Float32Array(2048); this.n = 0; this.f0 = 0; this.on = true;
            this.port.onmessage = (e) => { if (e.data === 'stop') { if (this.n) this.port.postMessage({ f0: this.f0, d: this.b.slice(0, this.n) }); this.on = false; } }; }
          process(inputs) {
            if (!this.on) return false;
            const ch = inputs[0] && inputs[0][0];
            if (ch) {
              if (this.n === 0) this.f0 = currentFrame;
              this.b.set(ch, this.n); this.n += ch.length;
              if (this.n + ch.length > this.b.length) { this.port.postMessage({ f0: this.f0, d: this.b.slice(0, this.n) }); this.n = 0; }
            }
            return true;
          }
        }
        registerProcessor('bv-rec', BVRec);`;
        // blob: funciona em http(s); aberto como ficheiro (file://) só o data: é aceite
        const blob = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
        const data = 'data:application/javascript;charset=utf-8,' + encodeURIComponent(src);
        this._wl = c.audioWorklet.addModule(blob)
          .catch(() => c.audioWorklet.addModule(data))
          .then(() => true, (e) => { console.warn('BeatVox: AudioWorklet indisponível, a usar ScriptProcessor', e); return false; });
      }
      if (!(await this._wl)) return null;
      try { return new AudioWorkletNode(c, 'bv-rec', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' }); }
      catch (e) { return null; }
    }

    async record({ bpm, bars, countInBars = 1, metronome = true, headphones = true, latency = 0, onBeat, backing = null }) {
      const c = this.ensureCtx();
      await c.resume();
      const stream = await this.openMic(headphones);
      const src = c.createMediaStreamSource(stream);
      const mute = c.createGain();
      mute.gain.value = 0;
      // cada bloco gravado guarda o instante exato em que começou: se o browser estiver ocupado
      // (animações, outro separador) e um bloco atrasar, nada se desloca no tempo
      const chunks = [];
      let proc = await this.recorderNode(c);
      if (proc) {
        proc.port.onmessage = (e) => chunks.push({ t: e.data.f0 / c.sampleRate, d: e.data.d });
      } else {
        const bufSize = 2048;
        proc = c.createScriptProcessor(bufSize, 1, 1);
        proc.onaudioprocess = (e) => chunks.push({ t: e.playbackTime - bufSize / c.sampleRate, d: new Float32Array(e.inputBuffer.getChannelData(0)) });
      }
      src.connect(proc);
      src.connect(this.micAn);
      this.recording = true;
      proc.connect(mute).connect(c.destination);

      const beat = 60 / bpm;
      const start = c.currentTime + 0.35;
      const totalBeats = (countInBars + bars) * 4;
      for (let b = 0; b < totalBeats; b++) {
        const t = start + b * beat;
        const inCount = b < countInBars * 4;
        if (metronome || inCount) this.click(t, b % 4 === 0, inCount ? 1 : 0.6);
        if (onBeat) setTimeout(() => onBeat(b, inCount, totalBeats), Math.max(0, (t - c.currentTime) * 1000));
      }
      const bar1Time = start + countInBars * 4 * beat;
      // acompanhamento: toca o que já existe (bateria / lead) enquanto gravas
      if (backing) {
        const sd = beat / backing.stepsPerBeat;
        const n = bars * 4 * backing.stepsPerBeat;
        for (let o = 0; o < n; o += backing.totalSteps) {
          for (const x of backing.drums || []) if (x.step + o < n) this.playDrum(x.drum, bar1Time + (x.step + o) * sd, x.vel);
          for (const x of backing.lead || []) if (x.step + o < n) this.playLead(x.pitch, bar1Time + (x.step + o) * sd, x.len * sd, x.vel, backing.leadPreset);
        }
      }
      const end = start + totalBeats * beat + 0.3;

      await new Promise((res) => {
        const poll = () => (c.currentTime >= end ? res() : setTimeout(poll, 30));
        poll();
      });
      if (proc.port) { proc.port.postMessage('stop'); await new Promise((r) => setTimeout(r, 60)); proc.port.onmessage = null; }
      else proc.onaudioprocess = null;
      this.recording = false;
      src.disconnect();
      proc.disconnect();

      // monta a gravação pelos instantes de cada bloco (blocos repetidos ou perdidos não deslocam o resto)
      if (!chunks.length) throw new Error('O microfone não enviou som. Verifica se está ligado e autorizado.');
      const sr = c.sampleRate, firstChunkTime = chunks[0].t;
      const last = chunks[chunks.length - 1];
      const samples = new Float32Array(Math.round((last.t - firstChunkTime) * sr) + last.d.length);
      for (const ch of chunks) {
        const o = Math.round((ch.t - firstChunkTime) * sr);
        if (o >= 0 && o + ch.d.length <= samples.length) samples.set(ch.d, o);
      }
      const bar1Sample = Math.round((bar1Time + latency - firstChunkTime) * c.sampleRate);
      let rawPeak = 0;
      for (let i = 0; i < samples.length; i++) { const a = Math.abs(samples[i]); if (a > rawPeak) rawPeak = a; }
      normalize(samples);
      return { samples, sr: c.sampleRate, bar1Sample, rawPeak };
    }

    /** Teste do microfone: abre-o e liga-o ao medidor, sem gravar. */
    async startMonitor(headphones) {
      const c = this.ensureCtx();
      await c.resume();
      const stream = await this.openMic(headphones);
      this.stopMonitor();
      this.monSrc = c.createMediaStreamSource(stream);
      this.monSrc.connect(this.micAn);
      this.monitoring = true;
    }
    stopMonitor() {
      if (this.monSrc) { try { this.monSrc.disconnect(); } catch (e) {} }
      this.monSrc = null;
      this.monitoring = false;
    }
    /** Nível de pico do microfone (0..1) — para o medidor. */
    micLevel() {
      if (!this.ctx || !(this.monitoring || this.recording)) return 0;
      this.micAn.getFloatTimeDomainData(this._lvlBuf);
      let p = 0;
      for (let i = 0; i < this._lvlBuf.length; i++) p = Math.max(p, Math.abs(this._lvlBuf[i]));
      return p;
    }
    /** Espetro em n bandas logarítmicas (60 Hz – 12 kHz), 0..1 — para o equalizador 3D. */
    spectrum(n = 16) {
      const out = new Float32Array(n);
      if (!this.ctx) return out;
      const ans = this.recording || this.monitoring ? [this.outAn, this.micAn] : [this.outAn];
      // ganho automático: o pico recente fica perto do topo, quer o micro seja forte ou fraco
      const now = this.ctx.currentTime, dt = Math.min(0.2, Math.max(0, now - (this._specT || now)));
      this._specT = now;
      let peak = (this._specPeak ?? -40) - dt * 8; // desce 8 dB/s
      const raw = new Float32Array(n).fill(-140);
      for (const an of ans) {
        if (!an._buf || an._buf.length !== an.frequencyBinCount) an._buf = new Float32Array(an.frequencyBinCount);
        const buf = an._buf, binHz = this.ctx.sampleRate / an.fftSize;
        an.getFloatFrequencyData(buf);
        for (let b = 0; b < n; b++) {
          const lo = 60 * Math.pow(200, b / n), hi = 60 * Math.pow(200, (b + 1) / n);
          let m = -140;
          for (let k = Math.max(1, Math.floor(lo / binHz)); k <= Math.min(buf.length - 1, Math.ceil(hi / binHz)); k++) m = Math.max(m, buf[k]);
          m += b * 1.4; // inclinação de +3 dB/oitava, como nos analisadores de estúdio
          raw[b] = Math.max(raw[b], m);
        }
      }
      for (let b = 0; b < n; b++) peak = Math.max(peak, raw[b]);
      this._specPeak = peak = Math.max(peak, -62);
      for (let b = 0; b < n; b++) out[b] = Math.min(1, Math.max(0, (raw[b] - (peak - 42)) / 42));
      return out;
    }
    async listMics() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
      const all = await navigator.mediaDevices.enumerateDevices();
      return all.filter((d) => d.kind === 'audioinput');
    }

    /** Nível RMS atual (0..1) da saída e, a gravar, do microfone. */
    level() {
      if (!this.ctx) return 0;
      let m = 0;
      for (const an of this.recording || this.monitoring ? [this.outAn, this.micAn] : [this.outAn]) {
        an.getFloatTimeDomainData(this._lvlBuf);
        let s = 0;
        for (let i = 0; i < this._lvlBuf.length; i++) s += this._lvlBuf[i] * this._lvlBuf[i];
        m = Math.max(m, Math.sqrt(s / this._lvlBuf.length));
      }
      return m;
    }

    // ---------- Sintetizador de lead ----------
    playLead(pitch, t, dur, vel = 100, preset = 'synth') {
      const c = this.ctx;
      const f = 440 * Math.pow(2, (pitch - 69) / 12);
      const v = (0.12 + 0.18 * (vel / 127));
      const out = c.createGain();
      out.connect(this.leadBus ? this.leadBus.input : this.master);
      const bend = (o) => { if (this.leadBus && this.leadBus.bend) this.leadBus.bend.connect(o.detune); return o; };
      const end = t + Math.max(0.05, dur);
      if (preset === 'pluck') {
        const o = bend(c.createOscillator()), lp = c.createBiquadFilter();
        o.type = 'square'; o.frequency.value = f;
        lp.type = 'lowpass'; lp.Q.value = 2;
        lp.frequency.setValueAtTime(Math.min(12000, f * 14), t);
        lp.frequency.exponentialRampToValueAtTime(Math.max(200, f * 1.5), t + 0.25);
        const stopAt = Math.min(end + 0.1, t + 0.9);
        out.gain.setValueAtTime(0.0001, t);
        out.gain.exponentialRampToValueAtTime(v * 1.1, t + 0.004);
        out.gain.exponentialRampToValueAtTime(0.0001, stopAt);
        o.connect(lp).connect(out); o.start(t); o.stop(stopAt + 0.02);
      } else if (preset === 'sine') {
        const o = bend(c.createOscillator()), o2 = bend(c.createOscillator()), g2 = c.createGain();
        o.type = 'sine'; o.frequency.value = f;
        o2.type = 'triangle'; o2.frequency.value = f * 2; g2.gain.value = 0.15;
        out.gain.setValueAtTime(0.0001, t);
        out.gain.exponentialRampToValueAtTime(v * 1.3, t + 0.012);
        out.gain.setValueAtTime(v * 1.3, end);
        out.gain.exponentialRampToValueAtTime(0.0001, end + 0.12);
        o.connect(out); o2.connect(g2).connect(out);
        o.start(t); o2.start(t); o.stop(end + 0.15); o2.stop(end + 0.15);
      } else {
        const lp = c.createBiquadFilter();
        lp.type = 'lowpass'; lp.Q.value = 4;
        lp.frequency.setValueAtTime(f * 2, t);
        lp.frequency.exponentialRampToValueAtTime(Math.min(9000, f * 9), t + 0.03);
        lp.frequency.exponentialRampToValueAtTime(Math.min(5000, f * 4), t + 0.3);
        out.gain.setValueAtTime(0.0001, t);
        out.gain.exponentialRampToValueAtTime(v, t + 0.006);
        out.gain.setValueAtTime(v * 0.8, end);
        out.gain.exponentialRampToValueAtTime(0.0001, end + 0.09);
        lp.connect(out);
        [-7, 7].forEach((cents) => {
          const o = bend(c.createOscillator());
          o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = cents;
          o.connect(lp); o.start(t); o.stop(end + 0.12);
        });
      }
    }

    /** Calibração: o utilizador bate palmas em cada tempo durante 2 compassos. Devolve latência (s). */
    async calibrate({ headphones, onBeat }) {
      const bpm = 90;
      const rec = await this.record({ bpm, bars: 2, countInBars: 1, metronome: true, headphones, latency: 0, onBeat });
      const on = BV.dsp.detectOnsets(rec.samples, rec.sr, { sensitivity: 0.5 });
      const beat = 60 / bpm;
      const deltas = [];
      for (const o of on) {
        const rel = (o.sample - rec.bar1Sample) / rec.sr;
        if (rel < -beat / 2 || rel > 8 * beat - beat / 2) continue;
        const nearest = Math.round(rel / beat) * beat;
        deltas.push(rel - nearest);
      }
      if (deltas.length < 4) throw new Error('Só detetei ' + deltas.length + ' palmas. Bate palmas (ou "tá") bem marcadas em cada clique.');
      deltas.sort((a, b) => a - b);
      return { latency: deltas[Math.floor(deltas.length / 2)], hits: deltas.length };
    }

    // ---------- Reprodução em loop ----------
    /**
     * drums(): notas de bateria; lead(): notas de lead; voices: [{rec, offset, gain}]
     */
    play({ bpm, stepsPerBeat, totalSteps, drums = () => [], lead = () => [], bass = () => [], leadPreset = 'synth', voices = [], click = () => false, leadFx = () => null }) {
      const c = this.ensureCtx();
      if (this.mixer && this.mixState) this.mixer.apply(this.mixState, bpm, stepsPerBeat, c.currentTime, 0);
      this.stop();
      this.playing = true;
      const stepDur = 60 / bpm / stepsPerBeat;
      const loopDur = stepDur * totalSteps;
      const t0 = c.currentTime + 0.12;
      this.playT0 = t0;
      this.playLoopDur = loopDur;
      this.playStepDur = stepDur;
      let next = 0;
      this.voiceSrcs = [];
      this.bufCache = this.bufCache || new WeakMap();
      const tick = () => {
        if (!this.playing) return;
        const horizon = c.currentTime + 0.15;
        while (t0 + next * stepDur < horizon) {
          const t = t0 + next * stepDur;
          const step = next % totalSteps;
          if (step === 0) {
            if (this.leadBus) scheduleLeadBus(this.leadBus, leadFx(), t, stepDur);
            for (const v of voices) {
              let buf = this.bufCache.get(v.rec);
              if (!buf) {
                buf = c.createBuffer(1, v.rec.samples.length, v.rec.sr);
                buf.copyToChannel(v.rec.samples, 0);
                this.bufCache.set(v.rec, buf);
              }
              const s = c.createBufferSource();
              s.buffer = buf;
              const gn = c.createGain();
              gn.gain.value = v.gain ?? 1;
              s.connect(gn).connect(v.kind ? this.stripIn(v.kind) : this.master);
              s.start(t, Math.max(0, v.offset), loopDur);
              this.voiceSrcs.push(s);
            }
          }
          // metrónomo: um clique por tempo, com acento no primeiro tempo de cada compasso
          if (click() && step % stepsPerBeat === 0) this.click(t, step % (stepsPerBeat * 4) === 0, 0.75);
          for (const n of drums()) if (n.step === step && n.skipAt !== next) this.playDrum(n.drum, t, n.vel);
          for (const n of lead()) if (n.step === step) this.playLead(n.pitch, t, n.len * stepDur, n.vel, leadPreset);
          for (const n of bass()) if (n.step === step) this.playBass(n.pitch, t, n.len * stepDur, n.vel);
          next++;
        }
        this.timer = setTimeout(tick, 25);
      };
      tick();
    }

    position() {
      if (!this.playing) return null;
      const t = this.ctx.currentTime - this.playT0;
      if (t < 0) return 0;
      return (t % this.playLoopDur) / this.playStepDur;
    }

    /**
     * Renderiza o loop para um ficheiro de áudio, sem tocar nada (OfflineAudioContext), com os mesmos sons da reprodução.
     * o = { bpm, stepsPerBeat, totalSteps, drums, lead, leadPreset, loops }
     */
    async render(o) {
      const sr = 44100, stepDur = 60 / o.bpm / o.stepsPerBeat, loops = o.loops || 1;
      const loopDur = stepDur * o.totalSteps, tail = 1.2;
      const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const c = new OAC(2, Math.ceil((loopDur * loops + tail) * sr), sr);
      // um "motor" temporário que usa os mesmos sintetizadores, ligado ao contexto offline
      const r = Object.create(Engine.prototype);
      r.ctx = c;
      r.noise = c.createBuffer(1, sr, sr);
      const d = r.noise.getChannelData(0);
      for (let i = 0; i < sr; i++) d[i] = Math.random() * 2 - 1;
      r.master = c.createGain();
      r.master.gain.value = 0.9;
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -10; comp.ratio.value = 4;
      r.master.connect(comp).connect(c.destination);
      if (BV.mix && o.mix) {
        r.mixer = BV.mix.build(c, r.master);
        r.mixState = o.mix;
        r.mixer.apply(o.mix, o.bpm, o.stepsPerBeat, 0, 0);
      }
      r.leadBus = makeLeadBus(c, r.mixer ? r.mixer.strips.lead.input : r.master);
      const t0 = 0.005;
      for (let k = 0; k < loops; k++) {
        const base = t0 + k * loopDur;
        scheduleLeadBus(r.leadBus, o.leadFx || null, base, stepDur);
        for (const n of o.drums || []) r.playDrum(n.drum, base + n.step * stepDur, n.vel);
        for (const n of o.lead || []) r.playLead(n.pitch, base + n.step * stepDur, n.len * stepDur, n.vel, o.leadPreset);
        for (const n of o.bass || []) r.playBass(n.pitch, base + n.step * stepDur, n.len * stepDur, n.vel);
        for (const v of o.voices || []) {
          const b = c.createBuffer(1, v.rec.samples.length, v.rec.sr);
          b.copyToChannel(v.rec.samples, 0);
          const src = c.createBufferSource(); src.buffer = b;
          src.connect(r.stripIn(v.kind)); src.start(base, Math.max(0, v.offset), loopDur);
        }
      }
      const buf = await c.startRendering();
      // corta a cauda silenciosa e faz um fade-out curto no fim
      const L = buf.getChannelData(0), R = buf.getChannelData(1);
      // sem clipping: se passar de -1 dBFS, baixa o ganho de tudo por igual
      let pk = 0;
      for (let i = 0; i < L.length; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
      if (pk > 0.89 && !o.raw) { const g = 0.89 / pk; for (let i = 0; i < L.length; i++) { L[i] *= g; R[i] *= g; } }
      let end = L.length;
      const minEnd = Math.ceil((loopDur * loops + 0.05) * sr);
      while (end > minEnd && Math.abs(L[end - 1]) < 1e-4 && Math.abs(R[end - 1]) < 1e-4) end--;
      const fade = Math.min(end, Math.round(0.02 * sr));
      for (let i = 0; i < fade; i++) { const g = i / fade; L[end - 1 - i] *= g; R[end - 1 - i] *= g; }
      return { channels: [L.subarray(0, end), R.subarray(0, end)], sr };
    }

    stop() {
      this.playing = false;
      clearTimeout(this.timer);
      (this.voiceSrcs || []).forEach((s) => { try { s.stop(); } catch (e) {} });
      this.voiceSrcs = [];
      if (this.leadBus) resetLeadBus(this.leadBus, this.ctx.currentTime);
    }
  }

  /** Normaliza o volume (pico a 0,9): microfones de portátil gravam muitas vezes muito baixo. */
  function normalize(x) {
    let p = 0;
    for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > p) p = a; }
    if (p < 1e-5 || p > 0.9) return x;
    const g = Math.min(40, 0.9 / p);
    for (let i = 0; i < x.length; i++) x[i] *= g;
    return x;
  }
  BV.normalizeAudio = normalize;
  BV.Engine = Engine;

  /** WAV PCM 16 bits a partir de canais Float32 → Uint8Array */
  BV.encodeWav = function ({ channels, sr }) {
    const nc = channels.length, n = channels[0].length, bytes = 44 + n * nc * 2;
    const b = new ArrayBuffer(bytes), v = new DataView(b);
    const str = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, bytes - 8, true); str(8, 'WAVE'); str(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nc, true); v.setUint32(24, sr, true);
    v.setUint32(28, sr * nc * 2, true); v.setUint16(32, nc * 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, n * nc * 2, true);
    let o = 44;
    for (let i = 0; i < n; i++) for (let ch = 0; ch < nc; ch++) {
      const x = Math.max(-1, Math.min(1, channels[ch][i]));
      v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true); o += 2;
    }
    return new Uint8Array(b);
  };
})(typeof window !== 'undefined' ? window : globalThis);
