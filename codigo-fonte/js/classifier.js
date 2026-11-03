/* BeatVox — classificação de cada golpe em peça de bateria.
   Sem treino: regras espetrais (bombo grave / tarola média / hi-hat aguda).
   Com treino: k-vizinhos mais próximos nos exemplos da tua voz. */
(function (g) {
  const BV = (g.BV = g.BV || {});

  const DRUMS = [
    { id: 'kick',    nome: 'Bombo (Kick)',    midi: 36, cor: '#e0a556', dica: '"bum", "b"' },
    { id: 'snare',   nome: 'Tarola (Snare)',  midi: 38, cor: '#d9707f', dica: '"pf", "ka"' },
    { id: 'clap',    nome: 'Palmas (Clap)',   midi: 39, cor: '#f4ede1', dica: '"kl", "pá"' },
    { id: 'hat',     nome: 'Hi-hat fechado',  midi: 42, cor: '#8fc1b5', dica: '"ts", "t"' },
    { id: 'openhat', nome: 'Hi-hat aberto',   midi: 46, cor: '#b9a6d6', dica: '"tssss"' },
  ];

  function ruleClassify(f) {
    // sons graves e escuros → bombo
    if (f.centroid < 700 || (f.low > 0.45 && f.centroid < 1600)) return 'kick';
    // sons muito agudos e ruidosos → hi-hat
    if (f.centroid > 5500 || f.high > 0.6) return 'hat';
    return 'snare';
  }

  function dist(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
    return Math.sqrt(s);
  }

  /** training = { kick: [vec,...], snare: [...], ... } */
  const statsCache = new WeakMap();
  function classify(f, training) {
    const examples = [];
    if (training) {
      // só exemplos no formato atual (treinos antigos tinham menos características)
      for (const id in training) for (const v of training[id]) if (v.length === f.vec.length) examples.push({ id, v });
    }
    const classesTrained = [...new Set(examples.map((e) => e.id))];
    if (classesTrained.length < 2) return ruleClassify(f);
    // normaliza cada característica pela sua variação nos exemplos (nenhuma domina a distância)
    let st = statsCache.get(training);
    if (!st || st.n !== examples.length) {
      const D = f.vec.length, mu = new Array(D).fill(0), sd = new Array(D).fill(0);
      for (const e of examples) e.v.forEach((x, d) => (mu[d] += x / examples.length));
      for (const e of examples) e.v.forEach((x, d) => (sd[d] += (x - mu[d]) ** 2 / examples.length));
      st = { n: examples.length, sd: sd.map((v) => Math.max(Math.sqrt(v), 0.06)) };
      statsCache.set(training, st);
    }
    const nd = (a, b) => { let s2 = 0; for (let d = 0; d < a.length; d++) s2 += ((a[d] - b[d]) / st.sd[d]) ** 2; return Math.sqrt(s2); };
    const k = Math.min(5, examples.length);
    const nn = examples.map((e) => ({ id: e.id, d: nd(e.v, f.vec) })).sort((a, b) => a.d - b.d).slice(0, k);
    const votes = {};
    for (const e of nn) votes[e.id] = (votes[e.id] || 0) + 1 / (e.d + 1e-3);
    return Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
  }

  /**
   * Classifica todos os golpes de uma gravação de uma vez.
   * Sem treino, em vez de limites fixos (que falham em microfones de portátil, que cortam graves e agudos),
   * agrupa os golpes pelas suas características e compara-os entre si:
   *  - brilho do som inteiro e do "corpo" (depois do estalo da consoante),
   *  - energia em 6 bandas (o "ka" tem mais 800–2000 Hz do que o "bum"; o "ts" mais acima de 8 kHz do que o "pf").
   * Descobre quantos tipos de som usaste (1 a 4). O grupo mais grave é o bombo, o mais agudo o hi-hat,
   * os do meio são tarolas ("ka" e "pf" são ambos tarola).
   */
  function classifyAll(feats, training) {
    const L = feats.length ? feats[0].vec.length : 0;
    const trainedClasses = training ? Object.keys(training).filter((k) => (training[k] || []).some((v) => v.length === L)) : [];
    const trained = trainedClasses.length >= 2;
    if (feats.length < 3) return feats.map((f) => classify(f, training));
    const n = feats.length;
    const lc = feats.map((f) => Math.log2(Math.max(60, f.centroid)));
    const sorted = [...lc].sort((a, b) => a - b);

    // vetor de características, normalizado (z-score) dentro da gravação
    const raw = feats.map((f, i) => {
      const b = f.bands || [0, 0, 0, 0, 0, 0];
      return [lc[i] * 1.5, Math.log2(Math.max(60, f.bodyCentroid || f.centroid)), ...b.map((v) => Math.sqrt(v) * 0.9)];
    });
    const D = raw[0].length;
    for (let d = 0; d < D; d++) {
      const m = raw.reduce((s, v) => s + v[d], 0) / n;
      const sd = Math.sqrt(raw.reduce((s, v) => s + (v[d] - m) ** 2, 0) / n) || 1;
      const floor = d === 0 ? 0.6 : 0.25; // não amplificar diferenças minúsculas
      for (const v of raw) v[d] = (v[d] - m) / Math.max(sd, floor);
    }
    const dist2 = (a, b) => { let s = 0; for (let d = 0; d < D; d++) s += (a[d] - b[d]) ** 2; return s; };

    function kmeans(k) {
      // início determinístico: o golpe mais grave, depois sempre o mais distante dos centros já escolhidos
      const order = lc.map((v, i) => i).sort((a, b) => lc[a] - lc[b]);
      const cent = [raw[order[0]].slice()];
      while (cent.length < k) {
        let best = -1, bd = -1;
        for (let i = 0; i < n; i++) { const dm = Math.min(...cent.map((c) => dist2(raw[i], c))); if (dm > bd) { bd = dm; best = i; } }
        cent.push(raw[best].slice());
      }
      let lab = new Array(n).fill(0);
      for (let it = 0; it < 30; it++) {
        lab = raw.map((v) => { let b = 0; for (let c = 1; c < k; c++) if (dist2(v, cent[c]) < dist2(v, cent[b])) b = c; return b; });
        for (let c = 0; c < k; c++) {
          const mem = raw.filter((_, i) => lab[i] === c);
          if (mem.length) for (let d = 0; d < D; d++) cent[c][d] = mem.reduce((s, v) => s + v[d], 0) / mem.length;
        }
      }
      const sse = raw.reduce((s, v, i) => s + dist2(v, cent[lab[i]]), 0);
      return { lab, sse };
    }
    // começa com grupos a mais (até 4) e depois junta os que são o mesmo som:
    // é mais robusto do que tentar adivinhar logo quantos tipos de som usaste
    const KMAX = globalThis.BV_KMAX || 4;
    const best = kmeans(Math.min(KMAX, n >= 10 ? 5 : n >= 8 ? 4 : n >= 5 ? 3 : 2));
    // grupos com brilho quase igual (< 0,45 oitavas) são o mesmo som
    let groups = [...new Set(best.lab)].map((g) => {
      const idx = best.lab.map((l, i) => (l === g ? i : -1)).filter((i) => i >= 0);
      return { idx, c: idx.reduce((s, i) => s + lc[i], 0) / idx.length };
    }).sort((a, b) => a.c - b.c);
    for (let i = 0; i < groups.length - 1; ) {
      if (groups[i + 1].c - groups[i].c < 0.45) {
        const g = groups[i], h = groups[i + 1], idx = g.idx.concat(h.idx);
        groups.splice(i, 2, { idx, c: idx.reduce((s, j) => s + lc[j], 0) / idx.length });
      } else i++;
    }
    // perfil médio de bandas de cada grupo: decide os casos ambíguos
    for (const g of groups) {
      g.b = [0, 0, 0, 0, 0, 0];
      for (const i of g.idx) (feats[i].bands || g.b).forEach((v, d) => (g.b[d] += v / g.idx.length));
    }
    // "ka" vs bombo: o bombo quase não tem 800–2000 Hz em relação a 300–800 Hz
    const kickLike = (c, b) => c < 1500 && (b[0] > 0.3 || b[2] / (b[1] + 1e-9) < 0.3);
    // "pf" vs "ts": o "pf" tem mais 2–4,5 kHz do que acima de 8 kHz
    const hatLike = (c, b) => c > 2600 && b[3] / (b[5] + 0.02) < 1.2;
    const isKick = (g) => kickLike(Math.pow(2, g.c), g.b), isHat = (g) => hatLike(Math.pow(2, g.c), g.b);
    // os grupos dão a ordem (grave → agudo). O grupo mais grave é bombo e o mais agudo é hi-hat
    // se a maioria dos seus golpes o confirmar pelas bandas (resiste a um "ka" perdido no meio dos bombos)
    if (trained) {
      // com treino: cada golpe é reconhecido pelos teus exemplos, e cada grupo segue a maioria
      // (um bombo "contaminado" pelo som anterior fica com os outros bombos)
      const per = feats.map((f) => classify(f, training));
      const out = new Array(n);
      for (const g of groups) {
        const cnt = {};
        g.idx.forEach((i) => (cnt[per[i]] = (cnt[per[i]] || 0) + 1));
        const [top, c] = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
        g.idx.forEach((i) => (out[i] = c / g.idx.length >= 0.6 ? top : per[i]));
      }
      return out;
    }
    const vote = (g, test) => g.idx.filter((i) => test(feats[i].centroid, feats[i].bands || g.b)).length > g.idx.length / 2;
    const out = new Array(n);
    groups.forEach((g, gi) => {
      const first = gi === 0, last = gi === groups.length - 1;
      const nm = first && vote(g, kickLike) ? 'kick' : last && vote(g, hatLike) ? 'hat' : 'snare';
      g.idx.forEach((i) => (out[i] = nm));
    });
    return out;
  }

  BV.DRUMS = DRUMS;
  BV.classifier = { classify, classifyAll, ruleClassify };
  if (typeof module !== 'undefined') module.exports = BV;
})(typeof window !== 'undefined' ? window : globalThis);
