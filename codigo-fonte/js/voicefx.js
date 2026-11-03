/* BeatVox — efeitos controlados pela voz.
   A partir da gravação da melodia, mede a cada 10 ms como estás a cantar:
     volume, glide (deslizes de altura), vibrato, ar (voz sussurrada), garra (voz rasgada) e vogal ("uuu" ↔ "iii").
   Cada medida vira uma curva no tempo da grelha que controla um efeito do som (e uma curva CC no MIDI).
   A calibração grava a tua voz normal, rasgada, com ar, "uuu" e "iii", e as medidas passam a ser relativas a ti. */
(function (g) {
  const BV = (g.BV = g.BV || {});

  const FX = [
    { id: 'vol',   nome: 'Volume',  cor: '#f4ede1', dica: 'Cantar mais forte abre o filtro e sobe o volume.', midi: 'CC11' },
    { id: 'glide', nome: 'Glide',   cor: '#f1dcae', dica: 'Os teus deslizes entre notas viram pitch bend.', midi: 'pitch bend' },
    { id: 'vib',   nome: 'Vibrato', cor: '#d8b57a', dica: 'O teu vibrato passa para o som.', midi: 'pitch bend' },
    { id: 'ar',    nome: 'Ar',      cor: '#8fc1b5', dica: 'Voz com ar ou sussurrada → reverb.', midi: 'CC91' },
    { id: 'garra', nome: 'Garra',   cor: '#d9707f', dica: 'Voz rasgada ou gritada → distorção.', midi: 'CC1' },
    { id: 'vogal', nome: 'Vogais',  cor: '#e0a556', dica: '"uuu" fecha e "iii" abre um filtro wah.', midi: 'CC74' },
  ];
  // takes da calibração (o que cantar em cada uma)
  const CAL = [
    { id: 'normal', nome: 'Normal',  dica: 'Um "aaa" confortável, numa nota só.' },
    { id: 'garra',  nome: 'Rasgado', dica: 'O mesmo "aaa", mas rasgado ou gritado.' },
    { id: 'ar',     nome: 'Com ar',  dica: 'Um "aaa" sussurrado, com muito ar.' },
    { id: 'u',      nome: '"uuu"',   dica: 'Um "uuu" fechado.' },
    { id: 'i',      nome: '"iii"',   dica: 'Um "iii" aberto.' },
  ];
  // Duas famílias de características, para a vogal não "contaminar" a garra e o ar:
  //  q (qualidade): periodicidade (YIN), ruído entre harmónicos (log), energia acima de 5 kHz (log)
  //  s (forma da boca): brilho (log2 do centroide), 800–2500 Hz vs graves, 2500–5000 Hz vs graves
  const QS = [0.1, 0.35, 0.4], SS = [0.35, 0.3, 0.35];
  // perfil por omissão (sem calibração): vozes de teste sintéticas; a calibração substitui-o pela tua voz
  const DEFAULT_CAL = {
    normal: { q: [0.98, -3.2, -3.0], s: [9.8, -0.3, -1.6] },
    garra:  { q: [0.9, -1.8, -2.6], s: [9.8, -0.3, -1.5] },
    ar:     { q: [0.4, -0.5, -0.9], s: [10.9, 0.0, -0.4] },
    u:      { q: [0.98, -3.4, -3.6], s: [8.6, -0.8, -2.9] },
    i:      { q: [0.98, -3.0, -2.5], s: [9.6, -0.8, -1.2] },
  };

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  /** Características por trama (10 ms), alinhadas com as tramas de P.track. */
  function analyze(x, sr, frames) {
    const n = 4096, win = Math.min(2048, Math.round(sr * 0.042));
    const binHz = sr / n;
    const band = (mag, lo, hi) => { let s = 0; for (let k = Math.max(1, Math.round(lo / binHz)); k <= Math.min(mag.length - 1, Math.round(hi / binHz)); k++) s += mag[k] * mag[k]; return s; };
    const pk = (mag, f) => { const k = Math.round(f / binHz); let m = 0; for (let j = k - 1; j <= k + 1; j++) if (j > 0 && j < mag.length) m = Math.max(m, mag[j]); return m * m; };
    const out = [];
    let peak = 1e-9;
    for (const f of frames) peak = Math.max(peak, f.rms);
    let lastF0 = 0;
    for (const f of frames) {
      const lvl = 20 * Math.log10((f.rms + 1e-9) / peak);
      if (lvl < -45) { out.push({ t: f.t, lvl, midi: null, conf: 0, q: null, s: null }); continue; }
      const mag = BV.dsp.magSpectrum(x, Math.round(f.t * sr - win / 2), win, n);
      let sw = 0, tot = 0;
      for (let k = Math.round(100 / binHz); k <= Math.round(8000 / binHz) && k < mag.length; k++) { const p = mag[k] * mag[k]; tot += p; sw += p * k * binHz; }
      // ruído entre harmónicos: energia a meio caminho entre harmónicos / energia nos harmónicos (até 4 kHz)
      const f0 = f.conf > 0.3 ? 440 * Math.pow(2, (f.midi - 69) / 12) : lastF0;
      if (f.conf > 0.3) lastF0 = f0;
      let inter = 1e-12, harm = 1e-12;
      if (f0 > 60) for (let h = 1; h * f0 < 4000; h++) { harm += pk(mag, h * f0); inter += pk(mag, (h + 0.5) * f0); }
      else inter = harm = 1;
      const b1 = band(mag, 100, 800) + 1e-12, b2 = band(mag, 800, 2500) + 1e-12, b3 = band(mag, 2500, 5000) + 1e-12, b4 = band(mag, 5000, 9000) + 1e-12;
      out.push({
        t: f.t, lvl, midi: f.conf > 0.6 ? f.midi : null, conf: f.conf,
        q: [f.conf, Math.log10(inter / harm), Math.log10(b4 / (tot + 1e-12))],
        s: [Math.log2(Math.max(100, sw / (tot + 1e-12))), Math.log10(b2 / b1), Math.log10(b3 / b1)],
      });
    }
    return out;
  }

  /** Média das características na parte forte de uma take (para a calibração). */
  function profile(feat) {
    const loud = feat.filter((f) => f.q && f.lvl > -14);
    if (loud.length < 10) return null;
    const q = [0, 0, 0], s = [0, 0, 0];
    for (const f of loud) { f.q.forEach((x, d) => (q[d] += x / loud.length)); f.s.forEach((x, d) => (s[d] += x / loud.length)); }
    return { q, s };
  }

  // quanto x está de A para B (0 em A, 1 em B), no espaço escalado
  function along(x, A, B, S) {
    let num = 0, den = 0;
    for (let d = 0; d < S.length; d++) { const ab = (B[d] - A[d]) / S[d], ax = (x[d] - A[d]) / S[d]; num += ab * ax; den += ab * ab; }
    return den > 1e-9 ? num / den : 0;
  }
  // decompõe x − N em a·(G − N) + b·(A − N) (mínimos quadrados): separa garra de ar
  function split(x, N, G, A, S) {
    const u = [], v = [], w = [];
    for (let d = 0; d < S.length; d++) { u.push((G[d] - N[d]) / S[d]); v.push((A[d] - N[d]) / S[d]); w.push((x[d] - N[d]) / S[d]); }
    const dot = (p, q) => p.reduce((s, _, i) => s + p[i] * q[i], 0);
    const uu = dot(u, u), vv = dot(v, v), uv = dot(u, v), uw = dot(u, w), vw = dot(v, w);
    const det = uu * vv - uv * uv;
    if (Math.abs(det) < 1e-9) return [uu > 0 ? uw / uu : 0, vv > 0 ? vw / vv : 0];
    return [(uw * vv - vw * uv) / det, (vw * uu - uw * uv) / det];
  }

  /**
   * Curvas no tempo da grelha.
   * o = { off: s do tempo 1 na gravação, sd: duração do passo (s), n: passos, cal }
   * Devolve { res, n, vol, ar, garra, vogal, sung } (Float32Array de n*res pontos; sung = altura cantada, NaN sem voz)
   */
  function curves(feat, o) {
    const cal = { ...DEFAULT_CAL, ...(o.cal || {}) };
    const res = Math.max(4, Math.min(16, Math.ceil(o.sd / 0.015)));
    const N = o.n * res, dtp = o.sd / res;
    const vol = new Float32Array(N), ar = new Float32Array(N), garra = new Float32Array(N), vogal = new Float32Array(N), sung = new Float32Array(N).fill(NaN);
    if (!feat.length) return { res, n: o.n, sd: o.sd, vol, ar, garra, vogal, sung };
    const t0 = feat[0].t, hop = feat.length > 1 ? feat[1].t - feat[0].t : 0.01;
    // valores crus por trama
    // cada vogal tem o seu "normal" (um "iii" limpo tem mais agudos do que um "aaa" limpo):
    // a referência da qualidade é a mistura dos 3 perfis limpos (u, a, i) mais parecidos com a forma da boca atual
    const clean = [cal.u, cal.normal, cal.i];
    const base = (sx) => {
      const w = clean.map((c) => { let d = 0; for (let k = 0; k < SS.length; k++) d += ((sx[k] - c.s[k]) / SS[k]) ** 2; return 1 / (d + 0.05); });
      const W = w[0] + w[1] + w[2];
      return cal.normal.q.map((_, d) => (w[0] * clean[0].q[d] + w[1] * clean[1].q[d] + w[2] * clean[2].q[d]) / W);
    };
    const raw = feat.map((f) => {
      const vol = clamp01((f.lvl + 36) / 36);
      if (!f.q || f.lvl < -30) return { vol, ar: 0, garra: 0, vogal: null };
      const b0 = f.conf > 0.5 ? base(f.s) : cal.normal.q;
      const qx = f.q.map((x, d) => x - b0[d] + cal.normal.q[d]);
      const [a, b] = split(qx, cal.normal.q, cal.garra.q, cal.ar.q, QS);
      return {
        vol,
        garra: clamp01((a - 0.15) * 1.3),
        ar: clamp01((b - 0.15) * 1.3),
        vogal: f.conf > 0.5 ? clamp01(along(f.s, cal.u.s, cal.i.s, SS)) : null,
      };
    });
    // suavização (ataque rápido, largada mais lenta), por trama
    const smooth = (key, att, rel, hold) => {
      const y = new Float32Array(raw.length);
      let s = 0;
      for (let i = 0; i < raw.length; i++) {
        let v = raw[i][key];
        if (v == null) v = hold ? s : 0;
        s += (v - s) * (v > s ? att : rel);
        y[i] = s;
      }
      return y;
    };
    const sv = smooth('vol', 0.6, 0.15), sa = smooth('ar', 0.25, 0.12), sg = smooth('garra', 0.35, 0.15), so = smooth('vogal', 0.3, 0.3, true);
    for (let k = 0; k < N; k++) {
      const tt = o.off + k * dtp, i = Math.round((tt - t0) / hop);
      if (i < 0 || i >= feat.length) continue;
      vol[k] = sv[i]; ar[k] = sa[i]; garra[k] = sg[i]; vogal[k] = so[i];
      // altura: mediana de 3 tramas, só com voz clara
      const ms = [feat[i - 1], feat[i], feat[i + 1]].filter((f) => f && f.midi != null && f.lvl > -30).map((f) => f.midi).sort((a, b) => a - b);
      if (ms.length >= 2) sung[k] = ms[Math.floor(ms.length / 2)];
    }
    return { res, n: o.n, sd: o.sd, vol, ar, garra, vogal, sung };
  }

  /**
   * Desvio de altura em relação às notas da grelha (em semitons), separado em glide (lento) e vibrato (rápido).
   * Recalculado sempre que as notas mudam (podes editar as notas e o glide continua certo).
   */
  function bends(fx, notes, octave = 0) {
    const { res, n, sung } = fx, N = n * res;
    const dev = new Float32Array(N);
    const ok = new Uint8Array(N);
    const at = new Array(n).fill(null);
    for (const x of notes) for (let s = x.step; s < Math.min(n, x.step + x.len); s++) at[s] = x;
    for (let k = 0; k < N; k++) {
      const nt = at[Math.floor(k / res)];
      if (!nt || isNaN(sung[k])) continue;
      const d = sung[k] + 12 * octave - nt.pitch;
      if (Math.abs(d) > 2.5) continue; // nota editada para longe do que cantaste: sem bend
      dev[k] = d; ok[k] = 1;
    }
    // componente lenta: média móvel de ~120 ms; o resto é vibrato
    const w = Math.max(2, Math.round(0.06 / ((fx.sd || 0.12) / res)));
    const glide = new Float32Array(N), vib = new Float32Array(N);
    for (let k = 0; k < N; k++) {
      if (!ok[k]) continue;
      let s = 0, c = 0;
      for (let j = Math.max(0, k - w); j <= Math.min(N - 1, k + w); j++) if (ok[j]) { s += dev[j]; c++; }
      glide[k] = s / c;
      vib[k] = Math.max(-1, Math.min(1, dev[k] - glide[k]));
    }
    // o glide volta a zero suavemente fora da voz (sem saltos no som)
    for (let pass = 0; pass < 2; pass++) for (let k = 1; k < N; k++) if (!ok[k]) glide[k] = glide[k - 1] * 0.8;
    return { glide, vib };
  }

  /** Junta tudo o que está ligado num objeto pronto para o motor de áudio / MIDI. */
  function build(fx, notes, octave, on) {
    if (!fx) return null;
    const { glide, vib } = bends(fx, notes, octave);
    const N = fx.n * fx.res, bend = new Float32Array(N);
    for (let k = 0; k < N; k++) bend[k] = (on.glide ? glide[k] : 0) + (on.vib ? vib[k] : 0);
    return {
      res: fx.res, n: fx.n,
      vol: on.vol ? fx.vol : null,
      ar: on.ar ? fx.ar : null,
      garra: on.garra ? fx.garra : null,
      vogal: on.vogal ? fx.vogal : null,
      bend: on.glide || on.vib ? bend : null,
    };
  }

  BV.voicefx = { FX, CAL, DEFAULT_CAL, analyze, profile, curves, bends, build, along, split };
  if (typeof module !== 'undefined') module.exports = BV;
})(typeof window !== 'undefined' ? window : globalThis);
