/* BeatVox — deteção de altura (pitch) da voz e conversão em notas.
   YIN (de Cheveigné & Kawahara) sobre áudio reduzido para ~16 kHz,
   segmentação em notas, deteção de tom e ajuste à escala. */
(function (g) {
  const BV = (g.BV = g.BV || {});

  const NOMES = ['Dó', 'Dó#', 'Ré', 'Ré#', 'Mi', 'Fá', 'Fá#', 'Sol', 'Sol#', 'Lá', 'Lá#', 'Si'];
  const NOMES_EN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const SCALES = {
    chromatic: { nome: 'Cromática (sem ajuste)', iv: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
    major:     { nome: 'Maior',                  iv: [0, 2, 4, 5, 7, 9, 11] },
    minor:     { nome: 'Menor',                  iv: [0, 2, 3, 5, 7, 8, 10] },
    pentmin:   { nome: 'Pentatónica menor',      iv: [0, 3, 5, 7, 10] },
    pentmaj:   { nome: 'Pentatónica maior',      iv: [0, 2, 4, 7, 9] },
    blues:     { nome: 'Blues',                  iv: [0, 3, 5, 6, 7, 10] },
  };

  const hzToMidi = (hz) => 69 + 12 * Math.log2(hz / 440);
  const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const noteName = (m, en) => (en ? NOMES_EN : NOMES)[((Math.round(m) % 12) + 12) % 12] + (Math.floor(Math.round(m) / 12) - 1);

  // ---------- redução de taxa de amostragem (passa-baixo FIR + dizimação) ----------
  function downsample(x, sr) {
    const d = Math.max(1, Math.floor(sr / 16000));
    if (d === 1) return { y: x, sr };
    const taps = 31, fc = 0.45 / d, h = new Float32Array(taps);
    let sum = 0;
    for (let i = 0; i < taps; i++) {
      const n = i - (taps - 1) / 2;
      const sinc = n === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * n) / (Math.PI * n);
      const w = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (taps - 1));
      h[i] = sinc * w;
      sum += h[i];
    }
    for (let i = 0; i < taps; i++) h[i] /= sum;
    const n = Math.floor(x.length / d), y = new Float32Array(n), half = (taps - 1) / 2;
    for (let k = 0; k < n; k++) {
      const c = k * d;
      let s = 0;
      for (let i = 0; i < taps; i++) {
        const j = c + i - half;
        if (j >= 0 && j < x.length) s += x[j] * h[i];
      }
      y[k] = s;
    }
    return { y, sr: sr / d };
  }

  /**
   * Segue a altura ao longo do tempo.
   * @returns {{frames: Array<{t:number, midi:number|null, conf:number, rms:number}>, hop:number}}
   */
  function track(x, sr, opt = {}) {
    const fmin = opt.fmin || 65, fmax = opt.fmax || 1100;
    const { y, sr: s2 } = downsample(x, sr);
    const W = Math.round(s2 * 0.025);              // janela de integração 25 ms
    const tauMin = Math.floor(s2 / fmax), tauMax = Math.ceil(s2 / fmin);
    const hopSec = 0.01, hop = Math.round(s2 * hopSec);
    const frames = [];
    const d = new Float32Array(tauMax + 2), cm = new Float32Array(tauMax + 2);
    for (let start = 0; start + W + tauMax + 1 < y.length; start += hop) {
      let e = 0;
      for (let j = 0; j < W; j++) e += y[start + j] * y[start + j];
      const rms = Math.sqrt(e / W);
      // função de diferença
      for (let tau = 1; tau <= tauMax + 1; tau++) {
        let s = 0;
        for (let j = 0; j < W; j++) {
          const v = y[start + j] - y[start + j + tau];
          s += v * v;
        }
        d[tau] = s;
      }
      // diferença média normalizada cumulativa
      cm[0] = 1;
      let run = 0;
      for (let tau = 1; tau <= tauMax + 1; tau++) {
        run += d[tau];
        cm[tau] = run > 0 ? (d[tau] * tau) / run : 1;
      }
      let best = -1;
      for (let tau = tauMin; tau <= tauMax; tau++) {
        if (cm[tau] < 0.15) {
          while (tau + 1 <= tauMax && cm[tau + 1] < cm[tau]) tau++;
          best = tau;
          break;
        }
      }
      if (best < 0) {
        // sem mínimo abaixo do limiar: usa o mínimo global (confiança baixa)
        let m = Infinity;
        for (let tau = tauMin; tau <= tauMax; tau++) if (cm[tau] < m) { m = cm[tau]; best = tau; }
      }
      // interpolação parabólica
      let tauF = best;
      if (best > 1 && best < tauMax) {
        const a = cm[best - 1], b = cm[best], c = cm[best + 1];
        const den = a - 2 * b + c;
        if (den !== 0) tauF = best + (0.5 * (a - c)) / den;
      }
      const conf = 1 - cm[best];
      frames.push({ t: (start + W / 2) / s2, midi: hzToMidi(s2 / tauF), conf, rms });
    }
    return { frames, hop: hopSec };
  }

  function median(a) {
    if (!a.length) return NaN;
    const s = [...a].sort((p, q) => p - q);
    return s[Math.floor(s.length / 2)];
  }

  /**
   * Converte a curva de altura em notas.
   * @param frames resultado de track()
   * @param onsets tempos (s) de ataques detetados (para separar notas repetidas)
   * @returns {{notes: Array<{t0,t1,pitch,vel}>, curve: Array<{t,midi}>}}
   */
  function segment(frames, onsets = [], opt = {}) {
    const sensitivity = opt.sensitivity ?? 0.5;
    if (!frames.length) return { notes: [], curve: [] };
    const sorted = frames.map((f) => f.rms).sort((a, b) => a - b);
    const maxRms = sorted[sorted.length - 1];
    const noise = sorted[Math.floor(sorted.length * 0.15)];
    const gate = Math.max(maxRms * (0.10 - sensitivity * 0.07), noise * 3, 0.004);
    const confMin = 0.80 - sensitivity * 0.1;

    // vozeamento + filtro de mediana (5 tramas) para tirar erros de oitava pontuais
    const v = frames.map((f) => (f.rms > gate && f.conf > confMin ? f.midi : null));
    const sm = v.map((m, i) => {
      if (m == null) return null;
      const win = [];
      for (let j = i - 2; j <= i + 2; j++) if (v[j] != null) win.push(v[j]);
      return median(win);
    });
    const curve = frames.map((f, i) => ({ t: f.t, midi: sm[i] }));

    const notes = [];
    let cur = null;
    let devRun = 0, devStart = -1, gapRun = 0;
    const onsetSet = onsets.slice().sort((a, b) => a - b);
    let oi = 0, pendingOnset = false;
    const close = (endIdx) => {
      if (!cur) return;
      const t1 = frames[endIdx].t + 0.005;
      // ignora os primeiros 30 ms (o "ataque" da voz costuma vir de baixo)
      const body = cur.vals.filter((p) => p.t >= cur.t0 + 0.03).map((p) => p.m);
      const pitch = median(body.length >= 3 ? body : cur.vals.map((p) => p.m));
      if (t1 - cur.t0 >= 0.06) notes.push({ t0: cur.t0, t1, pitch, peak: cur.peak });
      cur = null;
    };
    const open = (i) => {
      cur = { t0: frames[i].t - 0.005, vals: [{ t: frames[i].t, m: sm[i] }], peak: frames[i].rms };
      devRun = 0; gapRun = 0;
    };

    for (let i = 0; i < frames.length; i++) {
      const m = sm[i], t = frames[i].t;
      // ataque (consoante) dentro de uma nota → nova nota
      // o ataque pode cair numa trama sem altura (a consoante): fica pendente até à próxima trama com voz
      while (oi < onsetSet.length && onsetSet[oi] <= t) { if (onsetSet[oi] > t - 0.0101) pendingOnset = true; oi++; }
      const onsetHere = pendingOnset && m != null;
      if (m != null) pendingOnset = false;
      if (m == null) {
        if (cur && ++gapRun > 4) close(i - gapRun);
        continue;
      }
      if (!cur) { open(i); continue; }
      if (onsetHere && t - cur.t0 > 0.08) {
        // só separa se a energia caiu e voltou a subir (consoante real, não vibrato)
        let minPrev = Infinity, maxNow = 0;
        for (let j = Math.max(0, i - 6); j < i; j++) minPrev = Math.min(minPrev, frames[j].rms);
        for (let j = i; j < Math.min(frames.length, i + 3); j++) maxNow = Math.max(maxNow, frames[j].rms);
        let peakSoFar = 0;
        for (let j = Math.max(0, i - 15); j < i; j++) peakSoFar = Math.max(peakSoFar, frames[j].rms);
        if (maxNow > minPrev * 1.4 || minPrev < peakSoFar * 0.5) { close(i - 1); open(i); continue; }
      }
      gapRun = 0;
      const ref = median(cur.vals.slice(-8).map((p) => p.m));
      if (Math.abs(m - ref) > 0.75) {
        if (devRun === 0) devStart = i;
        devRun++;
        if (devRun >= 4) {
          // mudou de nota de forma estável
          close(devStart - 1);
          open(devStart);
          for (let j = devStart + 1; j <= i; j++) if (sm[j] != null) cur.vals.push({ t: frames[j].t, m: sm[j] });
          devRun = 0;
          continue;
        }
      } else {
        devRun = 0;
      }
      cur.vals.push({ t, m });
      cur.peak = Math.max(cur.peak, frames[i].rms);
    }
    if (cur) close(frames.length - 1);
    const maxPeak = notes.reduce((a, n) => Math.max(a, n.peak), 1e-6);
    for (const n of notes) { n.vel = Math.round(55 + 72 * Math.sqrt(n.peak / maxPeak)); delete n.peak; }
    return { notes, curve };
  }

  // ---------- tom (Krumhansl-Schmuckler) ----------
  const PROF_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const PROF_MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  function corr(a, b) {
    const ma = a.reduce((s, v) => s + v, 0) / 12, mb = b.reduce((s, v) => s + v, 0) / 12;
    let n = 0, da = 0, db = 0;
    for (let i = 0; i < 12; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
    return da && db ? n / Math.sqrt(da * db) : 0;
  }
  /** notes: [{pitch, t0, t1}] → { root: 0..11, mode: 'major'|'minor', score } */
  function detectKey(notes) {
    const h = new Array(12).fill(0);
    for (const n of notes) h[((Math.round(n.pitch) % 12) + 12) % 12] += Math.min(1, n.t1 - n.t0);
    if (h.every((v) => v === 0)) return { root: 0, mode: 'minor', score: 0 };
    let best = { score: -2 };
    for (let r = 0; r < 12; r++) {
      const rot = (p) => p.map((_, i) => p[(i - r + 12) % 12]);
      const sMaj = corr(h, rot(PROF_MAJ)), sMin = corr(h, rot(PROF_MIN));
      if (sMaj > best.score) best = { root: r, mode: 'major', score: sMaj };
      if (sMin > best.score) best = { root: r, mode: 'minor', score: sMin };
    }
    return best;
  }

  /** Arredonda uma altura (float) para a nota mais próxima da escala. */
  function snap(p, root, scaleId) {
    const iv = (SCALES[scaleId] || SCALES.chromatic).iv;
    let best = Math.round(p), bd = Infinity;
    for (let m = Math.floor(p) - 2; m <= Math.ceil(p) + 2; m++) {
      if (!iv.includes((((m - root) % 12) + 12) % 12)) continue;
      const dd = Math.abs(m - p);
      if (dd < bd - 1e-9) { bd = dd; best = m; }
    }
    return best;
  }

  BV.pitch = { track, segment, detectKey, snap, hzToMidi, midiToHz, noteName, NOMES, SCALES };
  if (typeof module !== 'undefined') module.exports = BV;
})(typeof window !== 'undefined' ? window : globalThis);
