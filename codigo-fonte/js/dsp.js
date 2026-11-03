/* BeatVox — DSP: FFT, deteção de ataques (onsets) e extração de características.
   Funciona no browser (global BV) e em Node (para testes). */
(function (g) {
  const BV = (g.BV = g.BV || {});

  // ---------- FFT radix-2 in-place ----------
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len;
      const wr = Math.cos(ang), wi = Math.sin(ang);
      const half = len >> 1;
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < half; k++) {
          const a = i + k, b = a + half;
          const tr = re[b] * cr - im[b] * ci;
          const ti = re[b] * ci + im[b] * cr;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
          const t = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = t;
        }
      }
    }
  }

  const hannCache = {};
  function hann(n) {
    if (!hannCache[n]) {
      const w = new Float32Array(n);
      for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
      hannCache[n] = w;
    }
    return hannCache[n];
  }

  // Espetro de magnitude de um excerto (com janela de Hann e zero-padding)
  function magSpectrum(x, start, len, n) {
    const re = new Float32Array(n), im = new Float32Array(n);
    const w = hann(len);
    for (let i = 0; i < len; i++) {
      const s = start + i;
      re[i] = s >= 0 && s < x.length ? x[s] * w[i] : 0;
    }
    fft(re, im);
    const mag = new Float32Array(n / 2);
    for (let k = 0; k < n / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
    return mag;
  }

  /**
   * Deteta ataques por fluxo espetral (log-magnitude) + refinamento no domínio do tempo.
   * @param {Float32Array} x  sinal mono
   * @param {number} sr       sample rate
   * @param {object} opt      { sensitivity: 0..1, minGapMs }
   * @returns {Array<{sample:number,time:number,peak:number}>}
   */
  function detectOnsets(x, sr, opt = {}) {
    const sensitivity = opt.sensitivity ?? 0.5;
    const minGap = Math.round(((opt.minGapMs ?? 70) / 1000) * sr);
    const N = 1024, hop = 256;
    const frames = Math.max(0, Math.floor((x.length - N) / hop) + 1);
    if (frames < 3) return [];

    // Envelope RMS por frame (porta de ruído)
    const rms = new Float32Array(frames);
    let maxRms = 0;
    for (let f = 0; f < frames; f++) {
      let s = 0;
      const o = f * hop;
      for (let i = 0; i < N; i++) s += x[o + i] * x[o + i];
      rms[f] = Math.sqrt(s / N);
      if (rms[f] > maxRms) maxRms = rms[f];
    }
    if (maxRms < 0.003) return []; // silêncio

    // Fluxo espetral
    const flux = new Float32Array(frames);
    // energia por bandas: <300 Hz, 300–3000 Hz, >3000 Hz
    const bands = [new Float32Array(frames), new Float32Array(frames), new Float32Array(frames)];
    const k1 = Math.round((300 / sr) * N), k2 = Math.round((3000 / sr) * N);
    const bflux = [new Float32Array(frames), new Float32Array(frames), new Float32Array(frames)];
    let prev = null;
    const C = 100;
    for (let f = 0; f < frames; f++) {
      const mag = magSpectrum(x, f * hop, N, N);
      for (let k = 1; k < mag.length; k++) {
        const e = mag[k] * mag[k];
        bands[k < k1 ? 0 : k < k2 ? 1 : 2][f] += e;
      }
      const lm = new Float32Array(mag.length);
      for (let k = 0; k < mag.length; k++) lm[k] = Math.log1p(C * mag[k]);
      if (prev) {
        for (let k = 1; k < lm.length; k++) {
          const d = lm[k] - prev[k];
          if (d > 0) bflux[k < k1 ? 0 : k < k2 ? 1 : 2][f] += d;
        }
      }
      prev = lm;
    }
    // fluxo por banda, dividido pelo número de frequências da banda: um ataque grave (poucos bins)
    // pesa tanto como um agudo, sem amplificar o ruído de bandas que estão vazias nesta gravação
    // Cada banda é normalizada pelo seu máximo, mas só conta tanto quanto tiver energia a sério
    // nesta gravação (uma banda só com ruído — p.ex. os agudos numa gravação só de bombos — fica de fora)
    const bfMax = bflux.map((F) => F.reduce((m, v) => (v > m ? v : m), 0));
    const bE = bands.map((E) => E.reduce((m, v) => (v > m ? v : m), 0));
    const eMax = Math.max(...bE);
    const sig = bE.map((e) => Math.min(1, e / (eMax * 0.02 + 1e-20)));
    for (let f = 0; f < frames; f++) {
      let m = 0;
      for (let b = 0; b < 3; b++) if (bfMax[b] > 0) m = Math.max(m, (bflux[b][f] / bfMax[b]) * sig[b]);
      flux[f] = m;
    }
    let maxFlux = 0;
    for (let f = 0; f < frames; f++) if (flux[f] > maxFlux) maxFlux = flux[f];
    if (maxFlux <= 0) return [];
    const bandMax = bands.map((E) => E.reduce((m, v) => (v > m ? v : m), 0));
    // ruído típico (mediana) das bandas média e aguda: um "ts" fraco no total destaca-se bem nos agudos
    // (microfones de portátil cortam agudos e gravam baixo). A banda grave tem poucos bins e flutua demais.
    const bandMed = bands.map((E) => { const a = Array.from(E).sort((x, y) => x - y); return a[Math.floor(a.length * 0.5)] + 1e-12; });
    const bandSnr = [Infinity, 3.4 - sensitivity * 1.4, 2.7 - sensitivity * 1.1]; // em energia

    // Limiar adaptativo: média local * multiplicador + mínimo global
    const mult = 1.9 - sensitivity * 1.0;          // 1.9 (pouco sensível) .. 0.9 (muito)
    const floor = (0.30 - sensitivity * 0.24) * maxFlux; // 30% .. 6% do máximo
    // piso de ruído = percentil 20 do RMS; um golpe tem de se destacar claramente dele
    const sortedRms = Array.from(rms).sort((a, b) => a - b);
    const noiseFloor = sortedRms[Math.floor(sortedRms.length * 0.2)];
    const gate = Math.max(maxRms * (0.12 - sensitivity * 0.09) + 0.002, noiseFloor * (2.5 + (1 - sensitivity) * 3));
    const W = 10;
    const cands = [];
    for (let f = 1; f < frames - 1; f++) {
      // limiar local pela mediana (não pela média): um "bum" com o tom a descer mantém o fluxo
      // alto durante várias tramas e puxaria a média para cima, escondendo o próximo bombo
      const win = [];
      for (let j = Math.max(0, f - W); j <= Math.min(frames - 1, f + W); j++) win.push(flux[j]);
      win.sort((p, q) => p - q);
      const med = win[Math.floor(win.length / 2)];
      const thr = Math.max(med * mult + 0.05 * maxFlux, floor);
      let isMax = true;
      for (let j = Math.max(0, f - 3); j <= Math.min(frames - 1, f + 3); j++) {
        if (j !== f && flux[j] > flux[f]) { isMax = false; break; }
      }
      const rmsAround = Math.max(rms[f], rms[Math.min(frames - 1, f + 1)], rms[Math.min(frames - 1, f + 2)]);
      // um ataque verdadeiro tem de fazer subir a energia (evita falsos ataques na cauda de um som)
      let rises = false;
      for (let b = 0; b < 3 && !rises; b++) {
        const E = bands[b];
        const now = Math.max(E[f], E[Math.min(frames - 1, f + 1)], E[Math.min(frames - 1, f + 2)]);
        const pre = Math.min(E[Math.max(0, f - 1)], E[Math.max(0, f - 2)]);
        if (now > pre * 2.2 && now > bandMax[b] * 0.01) rises = true;
      }
      let bandPass = false;
      for (let b = 0; b < 3 && !bandPass; b++) {
        const E = bands[b];
        const now = Math.max(E[f], E[Math.min(frames - 1, f + 1)], E[Math.min(frames - 1, f + 2)]);
        if (now > bandMed[b] * bandSnr[b] && now > bandMax[b] * 0.004) bandPass = true;
      }
      if (opt.debug) opt.debug({ f, t: (f * hop) / sr, flux: flux[f], thr, isMax, rmsAround, gate, bandPass, rises });
      if (isMax && flux[f] > thr && (rmsAround > gate || bandPass) && rises) cands.push(f);
    }

    // Disparos duplos: a cauda de um som soprado ("pf", "tsss") pode criar um 2.º ataque falso.
    // Um ataque a menos de 140 ms do anterior só conta se a energia baixou entre os dois, nalguma banda.
    const dipWin = Math.round((0.14 * sr) / hop);
    for (let i = 1; i < cands.length; i++) {
      const fp = cands[i - 1], f = cands[i];
      if (f - fp > dipWin) continue;
      // procura a pausa banda a banda: um "ts" por cima da cauda de um "bum" tem pausa nos agudos
      let dip = false;
      for (let b = 0; b < 3 && !dip; b++) {
        const E = bands[b];
        let minB = Infinity;
        for (let j = fp + 1; j < f; j++) minB = Math.min(minB, E[j]);
        const now = Math.max(E[f], E[Math.min(frames - 1, f + 1)], E[Math.min(frames - 1, f + 2)]);
        if (now > bandMax[b] * 0.01 && minB < now * 0.3) dip = true;
      }
      if (!dip) { cands.splice(i, 1); i--; }
    }
    // Refinamento temporal: procura o início do ataque no envelope
    const out = [];
    for (const f of cands) {
      const a = Math.max(0, f * hop - hop);
      const b = Math.min(x.length, f * hop + N + hop);
      let peak = 0, peakI = a;
      for (let i = a; i < b; i++) {
        const v = Math.abs(x[i]);
        if (v > peak) { peak = v; peakI = i; }
      }
      // envelope suavizado (janela de 1 ms) para trás a partir do pico
      const win = Math.max(1, Math.round(sr * 0.001));
      let onset = peakI;
      const lim = Math.max(0, peakI - Math.round(sr * 0.04));
      let minM = Infinity;
      for (let i = peakI; i > lim; i -= win) {
        let m = 0;
        for (let j = Math.max(0, i - win); j < i; j++) m = Math.max(m, Math.abs(x[j]));
        if (m < peak * 0.15) { onset = i; break; }
        // o envelope voltou a subir: estamos na cauda do som anterior → parar
        if (m > minM * 1.15 && minM < peak * 0.6) break;
        if (m < minM) { minM = m; onset = i; }
      }
      if (out.length && onset - out[out.length - 1].sample < minGap) {
        // demasiado perto do anterior: mantém o mais forte
        if (peak > out[out.length - 1].peak) out[out.length - 1] = { sample: onset, time: onset / sr, peak };
        continue;
      }
      out.push({ sample: onset, time: onset / sr, peak });
    }
    return out;
  }

  /**
   * Características espetrais de um golpe (primeiros ~45 ms).
   * Devolve { centroid, low, mid, high, zcr, vec }
   */
  const BAND_EDGES = [0, 300, 800, 2000, 4500, 8000, 1e9];
  function features(x, sr, sample, maxLen) {
    const gap = maxLen || 4096;
    const len = Math.min(2048, Math.max(256, gap));
    const n = 2048;
    const mag = magSpectrum(x, sample, len, n);
    // subtração espetral: retira a cauda do som anterior (espetro logo antes do ataque)
    const preLen = Math.min(len, 1024);
    const pre = magSpectrum(x, sample - preLen - Math.round(sr * 0.002), preLen, n);
    const scale = len / preLen;
    for (let k = 0; k < mag.length; k++) mag[k] = Math.max(0, mag[k] - pre[k] * scale);
    const binHz = sr / n;
    let tot = 1e-12, cen = 0, low = 0, mid = 0, high = 0;
    for (let k = 1; k < mag.length; k++) {
      const e = mag[k] * mag[k];
      const hz = k * binHz;
      tot += e;
      cen += hz * e;
      if (hz < 250) low += e;
      else if (hz < 4000) mid += e;
      else high += e;
    }
    let zc = 0;
    for (let i = sample + 1; i < Math.min(x.length, sample + len); i++) {
      if ((x[i - 1] >= 0) !== (x[i] >= 0)) zc++;
    }
    const centroid = cen / tot;

    // "corpo" do som: salta os primeiros 12 ms (o estalo da consoante: b, p, k, t),
    // que é parecido em todos os sons; o que os distingue é o que vem a seguir ("um", "f", "a", "s").
    const skip = Math.round(sr * 0.012);
    const bodyLen = Math.max(256, Math.min(2048, gap - skip));
    const bm = magSpectrum(x, sample + skip, bodyLen, n);
    for (let k = 0; k < bm.length; k++) bm[k] = Math.max(0, bm[k] - pre[k] * (bodyLen / preLen));
    const bands = new Array(6).fill(1e-12);
    let bt = 1e-12, bc = 0, lg = 0, am = 0, cnt = 0;
    for (let k = 1; k < bm.length; k++) {
      const hz = k * binHz, e = bm[k] * bm[k];
      bt += e; bc += hz * e;
      let bi = 0; while (hz >= BAND_EDGES[bi + 1]) bi++;
      bands[bi] += e;
      if (hz > 200 && hz < 10000) { lg += Math.log(bm[k] + 1e-9); am += bm[k]; cnt++; }
    }
    const bodyCentroid = bc / bt;
    // frequência mediana do corpo (metade da energia abaixo): não se deixa puxar por um resto de agudos
    let acc = 0, median = binHz;
    for (let k = 1; k < bm.length; k++) { acc += bm[k] * bm[k]; if (acc >= bt * 0.5) { median = k * binHz; break; } }
    // planura espetral: perto de 1 = ruído soprado ("f", "s"); perto de 0 = som vozeado ("um", "a")
    const flat = cnt ? Math.exp(lg / cnt) / (am / cnt + 1e-12) : 0;
    // duração: tempo até a energia cair 12 dB abaixo do pico
    const win = Math.round(sr * 0.005), maxT = Math.min(gap, Math.round(sr * 0.35));
    let peak = 0, peakAt = 0, decay = maxT / sr;
    const env = [];
    for (let o = 0; o + win <= maxT && sample + o + win < x.length; o += win) {
      let e = 0;
      for (let i = sample + o; i < sample + o + win; i++) e += x[i] * x[i];
      env.push(e);
      if (e > peak) { peak = e; peakAt = env.length - 1; }
    }
    for (let i = peakAt; i < env.length; i++) if (env[i] < peak * 0.063) { decay = (i * win) / sr; break; }

    const f = {
      centroid,
      low: low / tot,
      mid: mid / tot,
      high: high / tot,
      zcr: zc / len,
      bodyCentroid,
      median,
      bands: bands.map((e) => e / bt),
      flat,
      decay,
    };
    // vetor para o classificador treinado (k-vizinhos): todas as dimensões em escalas parecidas
    f.vec = [Math.log2(Math.max(60, bodyCentroid)) / 14, ...f.bands.map((v) => Math.sqrt(v)), Math.min(1, flat * 2), Math.min(1, decay / 0.3)];
    return f;
  }


  BV.dsp = { fft, magSpectrum, detectOnsets, features };
  if (typeof module !== 'undefined') module.exports = BV;
})(typeof window !== 'undefined' ? window : globalThis);
