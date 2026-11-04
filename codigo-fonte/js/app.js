/* BeatVox — aplicação: estado, análise, vistas (Bateria / Lead) e interação. */
(function () {
  const BV = window.BV;
  const engine = new BV.Engine();
  const $ = (id) => document.getElementById(id);
  const P = BV.pitch;
  const V = BV.voicefx;
  const esc = (t) => String(t).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  const RULER = 28, MIN_CELL = 16;
  let ROW = 46, LANE = 96;
  const DRUMS = BV.DRUMS;
  const LEAD_COLOR = '#f1dcae';
  // tema do ecrã (vidro escuro com fósforo verde-água)
  const T = {
    bg: 'rgba(0,0,0,0)', beatShade: 'rgba(216,181,122,0.028)', rowLine: 'rgba(216,181,122,0.07)',
    step: 'rgba(244,237,225,0.03)', beat: 'rgba(244,237,225,0.07)', bar: 'rgba(216,181,122,0.4)',
    ruler: 'rgba(216,181,122,0.03)', rulerLine: 'rgba(216,181,122,0.16)', rulerBar: '#f1dcae', rulerBeat: '#8c7b6b',
    hover: 'rgba(216,181,122,0.1)', hit: 'rgba(244,237,225,0.8)',
    white: 'rgba(244,237,225,0.018)', black: 'rgba(0,0,0,0.22)', whiteIn: 'rgba(216,181,122,0.06)', blackIn: 'rgba(216,181,122,0.03)', root: 'rgba(241,220,174,0.08)',
    cLine: 'rgba(216,181,122,0.3)', keyLine: 'rgba(244,237,225,0.04)',
    lane: 'rgba(0,0,0,0.25)', laneLine: 'rgba(216,181,122,0.16)', wave: 'rgba(216,181,122,0.55)', laneText: '#8c7b6b',
    play: '#f1dcae', noteText: '#1b0b06',
  };
  const MODE_PT = { major: 'maior', minor: 'menor' };

  // ---------- estado ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  const saved = store.get('bv.settings', {});
  // treinos de versões antigas usavam menos características: são descartados (é preciso voltar a treinar)
  let oldTrainingDropped = false;
  function loadTraining() {
    const t = store.get('bv.training', {}), out = {};
    for (const k in t) {
      const ok = (t[k] || []).filter((v) => Array.isArray(v) && v.length === 9);
      if (ok.length) out[k] = ok; else if ((t[k] || []).length) oldTrainingDropped = true;
    }
    return out;
  }
  const state = {
    view: saved.view || 'drums',
    bpm: saved.bpm || 90,
    bars: saved.bars || 2,
    grid: saved.grid || 16,
    metronome: saved.metronome ?? true,
    headphones: saved.headphones ?? true,
    sensitivity: saved.sensitivity ?? 0.5,
    name: saved.name || '',
    fxOn: { vol: true, glide: true, vib: true, ar: true, garra: true, vogal: true, ...(saved.fxOn || {}) },
    voiceCal: store.get('bv.voicecal', {}),
    mix: BV.mix.merge(saved.mix),
    kit: BV.sounds.KITS.some((k) => k.id === saved.kit) ? saved.kit : 'beatvox',
    slots: saved.slots && typeof saved.slots === 'object' ? { ...saved.slots } : {}, // lugar → id do sample na biblioteca
    loops: saved.loops || 1,
    latencyMs: saved.latencyMs ?? null,
    withVoice: false,
    training: loadTraining(),
    busy: false,
    hover: null,
    drums: { rec: null, hits: [], notes: [] },
    lead: {
      rec: null, segs: [], curve: [], notes: [],
      detected: { root: 9, mode: 'minor', score: 0 },
      keySetting: saved.leadKey ?? 'auto',     // 'auto' ou 0..11
      scale: saved.leadScale || 'auto',        // 'auto' ou id da escala
      octave: saved.leadOctave || 0,
      preset: BV.sounds.LEADS.some((x) => x.id === saved.leadPreset) ? saved.leadPreset : 'synth',
      overBeat: saved.leadOverBeat ?? true,
      lo: 48, hi: 72,
      lastLen: 2,
    },
  };
  let rendering = false; // a exportar (WAV / zip)
  const persist = () => store.set('bv.settings', {
    view: state.view, bpm: state.bpm, bars: state.bars, grid: state.grid, metronome: state.metronome,
    headphones: state.headphones, sensitivity: state.sensitivity, latencyMs: state.latencyMs,
    leadKey: state.lead.keySetting, leadScale: state.lead.scale, leadOctave: state.lead.octave,
    leadPreset: state.lead.preset, leadOverBeat: state.lead.overBeat, name: state.name, loops: state.loops, fxOn: state.fxOn, mix: state.mix,
    kit: state.kit, slots: state.slots,
  });

  // ---------- sons: kit, instrumento da melodia e os teus samples ----------
  const SND = BV.sounds, LIB = SND.library;
  /** o que o motor toca agora: kit de bateria e samples escolhidos (AudioBuffers da biblioteca) */
  function soundsNow() {
    const s = { kit: state.kit, drums: {}, bass: null, lead: null };
    for (const d of DRUMS) { const it = LIB.get(state.slots[d.id]); if (it) s.drums[d.id] = it.buf; }
    const b = LIB.get(state.slots.bass), l = LIB.get(state.slots.lead);
    if (b) s.bass = { buf: b.buf, root: b.root ?? 36 };
    if (l) s.lead = { buf: l.buf, root: l.root ?? 60 };
    return s;
  }
  /** nome do som de um lugar ("Kit 808", "kick_01.wav", "Pad"…) */
  function soundName(slot) {
    const it = LIB.get(state.slots[slot]);
    if (it) return it.name;
    if (slot === 'lead') return (SND.LEADS.find((x) => x.id === state.lead.preset) || SND.LEADS[0]).nome;
    if (slot === 'bass') return '808 sintetizado';
    return 'Kit ' + (SND.KITS.find((k) => k.id === state.kit) || SND.KITS[0]).nome;
  }

  const stepsPerBeat = () => state.grid / 4;
  const totalSteps = () => state.bars * state.grid;
  const stepDur = () => 60 / state.bpm / stepsPerBeat();
  const latencySec = () => (state.latencyMs == null ? engine.defaultLatency() : state.latencyMs / 1000);
  const isLead = () => state.view === 'lead';
  const cur = () => (isLead() ? state.lead : state.drums);

  function setStatus(msg, kind) {
    const el = $('status');
    el.textContent = msg;
    el.parentNode.className = 'hud-status' + (kind ? ' ' + kind : '');
  }

  const matches = (r) => !!r && r.bpm === state.bpm && r.bars === state.bars;
  // gravações do microfone compensam a latência; ficheiros de áudio importados não têm latência
  const bar1Of = (r) => r.bar1Sample + (r.imported ? 0 : Math.round(latencySec() * r.sr));

  // ================= BATERIA: análise =================
  function analyzeDrums() {
    const D = state.drums;
    if (!matches(D.rec)) return;
    const r = D.rec;
    const bar1 = bar1Of(r);
    const on = BV.dsp.detectOnsets(r.samples, r.sr, { sensitivity: state.sensitivity });
    const sd = stepDur(), loop = sd * totalSteps();
    const maxPeak = on.reduce((m, o) => Math.max(m, o.peak), 1e-6);
    const training = trainedCount() >= 2 ? state.training : null;
    const hits = [], feats = [];
    on.forEach((o, i) => {
      const t = (o.sample - bar1) / r.sr;
      if (t < -sd / 2 || t >= loop - sd / 2) return;
      const gap = on[i + 1] ? on[i + 1].sample - o.sample : 2048;
      feats.push(BV.dsp.features(r.samples, r.sr, o.sample, gap));
      const vel = Math.round(45 + 82 * Math.sqrt(o.peak / maxPeak));
      hits.push({ t, vel });
    });
    // os golpes são classificados em conjunto: compara os teus sons entre si (bom para microfones de portátil)
    const kinds = BV.classifier.classifyAll(feats, training);
    hits.forEach((h, i) => (h.drum = kinds[i]));
    D.hits = hits;
    quantizeDrums();
  }

  function quantizeDrums() {
    const D = state.drums, sd = stepDur(), n = totalSteps();
    const map = new Map();
    for (const h of D.hits) {
      const step = Math.round(h.t / sd) + 0;
      if (step < 0 || step >= n) continue;
      const k = step + ':' + h.drum;
      const prev = map.get(k);
      if (!prev || h.vel > prev.vel) map.set(k, { step, drum: h.drum, vel: h.vel });
    }
    D.notes = [...map.values()].sort((a, b) => a.step - b.step);
  }

  // ================= LEAD: análise =================
  function analyzeLead() {
    const L = state.lead;
    if (!matches(L.rec)) return;
    const r = L.rec;
    // a curva de altura é cara: calcula-se uma vez por gravação
    if (!r._track) r._track = P.track(r.samples, r.sr);
    const key = 's' + state.sensitivity;
    r._on = r._on || {};
    if (!r._on[key]) r._on[key] = BV.dsp.detectOnsets(r.samples, r.sr, { sensitivity: state.sensitivity }).map((o) => o.time);
    const seg = P.segment(r._track.frames, r._on[key], { sensitivity: state.sensitivity });
    const off = bar1Of(r) / r.sr;
    const loop = stepDur() * totalSteps();
    L.segs = seg.notes
      .map((n) => ({ ...n, t0: n.t0 - off, t1: n.t1 - off }))
      .filter((n) => n.t1 > 0 && n.t0 < loop);
    L.curve = seg.curve.map((p) => ({ t: p.t - off, midi: p.midi })).filter((p) => p.t > -0.2 && p.t < loop + 0.2);
    L.detected = P.detectKey(L.segs);
    quantizeLead();
    // efeitos da voz: como cantaste, a cada 10 ms, no tempo da grelha
    if (!r._vfeat) r._vfeat = V.analyze(r.samples, r.sr, r._track.frames);
    L.fx = V.curves(r._vfeat, { off, sd: stepDur(), n: totalSteps(), cal: state.voiceCal });
  }
  /** curvas dos efeitos ligados, prontas para o som e para o MIDI (null se não houver) */
  function leadFxNow() {
    const L = state.lead;
    if (!L.fx || L.fx.n !== totalSteps() || !L.notes.length) return null;
    const on = state.fxOn;
    if (!Object.values(on).some(Boolean)) return null;
    return V.build(L.fx, L.notes, L.octave, on);
  }
  /** repete as curvas N vezes (para o MIDI com repetições) */
  function loopFx(fx, loops) {
    if (!fx || loops === 1) return fx;
    const out = { res: fx.res, n: fx.n * loops };
    for (const k of ['vol', 'ar', 'garra', 'vogal', 'bend']) {
      if (!fx[k]) { out[k] = null; continue; }
      const a = new Float32Array(fx[k].length * loops);
      for (let i = 0; i < loops; i++) a.set(fx[k], i * fx[k].length);
      out[k] = a;
    }
    return out;
  }

  const leadRoot = () => (state.lead.keySetting === 'auto' ? state.lead.detected.root : +state.lead.keySetting);
  const leadScale = () => (state.lead.scale === 'auto' ? state.lead.detected.mode : state.lead.scale);

  function quantizeLead() {
    const L = state.lead, sd = stepDur(), n = totalSteps();
    const root = leadRoot(), scale = leadScale();
    let notes = [];
    for (const s of L.segs) {
      const step = Math.max(0, Math.round(s.t0 / sd) + 0);
      if (step >= n) continue;
      // a duração vem do que foi cantado (não de onde o fim cai na grelha)
      const len = Math.max(1, Math.min(n - step, Math.round((s.t1 - s.t0) / sd)));
      notes.push({ step, len, pitch: P.snap(s.pitch, root, scale) + 12 * L.octave, vel: s.vel });
    }
    // monofónico: no mesmo passo fica a mais longa; a anterior é cortada quando começa a seguinte
    notes.sort((a, b) => a.step - b.step || b.len - a.len);
    notes = notes.filter((x, i) => i === 0 || x.step !== notes[i - 1].step);
    for (let i = 0; i < notes.length - 1; i++) notes[i].len = Math.max(1, Math.min(notes[i].len, notes[i + 1].step - notes[i].step));
    L.notes = notes;
    fitRange();
  }

  function fitRange() {
    const L = state.lead;
    const ps = L.notes.map((x) => x.pitch);
    for (const c of L.curve) if (c.midi != null) ps.push(c.midi + 12 * L.octave);
    let lo, hi;
    if (ps.length) { lo = Math.floor(Math.min(...ps)) - 2; hi = Math.ceil(Math.max(...ps)) + 2; }
    else { lo = 48 + 12 * L.octave; hi = 72 + 12 * L.octave; }
    while (hi - lo < 23) { hi++; if (hi - lo < 23) lo--; }
    L.lo = Math.max(12, lo); L.hi = Math.min(115, Math.max(L.lo + 23, hi));
  }

  function analyzeAll() { analyzeDrums(); analyzeLead(); }

  // ================= estatísticas =================
  function renderStats() {
    const card = $('statsCard');
    let rows = [], tip = '';
    const ref = 60 / state.bpm / 4;
    const timing = (ts) => {
      const devs = ts.map((t) => (t - Math.round(t / ref) * ref) * 1000);
      return { mean: devs.reduce((a, b) => a + b, 0) / devs.length, abs: devs.reduce((a, b) => a + Math.abs(b), 0) / devs.length };
    };
    const timingTip = (tm) => {
      let s = tm.abs < 12 ? 'Timing muito preciso.' : tm.abs < 25 ? 'Bom timing — pequenas variações dão groove.' : 'Muita variação no timing. Experimenta um BPM mais lento.';
      if (Math.abs(tm.mean) > 12) s += tm.mean < 0 ? ' Tendes a adiantar-te.' : ' Tendes a atrasar-te (ou calibra a latência).';
      return s;
    };
    if (!isLead()) {
      const D = state.drums;
      if (!D.hits.length) { card.hidden = true; return; }
      const tm = timing(D.hits.map((h) => h.t));
      const counts = {};
      for (const n of D.notes) counts[n.drum] = (counts[n.drum] || 0) + 1;
      rows = [
        ['Golpes detetados', D.hits.length],
        ...DRUMS.filter((d) => counts[d.id]).map((d) => [d.nome, counts[d.id]]),
        ['Desvio médio', tm.abs.toFixed(0) + ' ms'],
        ['Tendência', (tm.mean >= 0 ? '+' : '') + tm.mean.toFixed(0) + ' ms'],
      ];
      tip = timingTip(tm);
      $('statsTitle').textContent = 'O teu timing';
    } else {
      const L = state.lead;
      if (!L.segs.length) { card.hidden = true; return; }
      const tm = timing(L.segs.map((s) => s.t0));
      // afinação: distância (cents) de cada nota cantada ao meio-tom mais próximo
      const cents = L.segs.map((s) => (s.pitch - Math.round(s.pitch)) * 100);
      const absC = cents.reduce((a, b) => a + Math.abs(b), 0) / cents.length;
      const meanC = cents.reduce((a, b) => a + b, 0) / cents.length;
      const root = leadRoot(), scale = leadScale();
      const out = L.segs.filter((s) => P.snap(s.pitch, root, scale) !== Math.round(s.pitch)).length;
      rows = [
        ['Notas detetadas', L.segs.length],
        ['Tom', P.NOMES[L.detected.root] + ' ' + MODE_PT[L.detected.mode]],
        ['Afinação média', '±' + absC.toFixed(0) + ' cents'],
        ['Tendência', (meanC >= 0 ? '+' : '') + meanC.toFixed(0) + ' cents'],
        ['Fora da escala', out ? out + ' (ajustadas)' : '0'],
        ['Desvio de tempo', tm.abs.toFixed(0) + ' ms'],
      ];
      tip = absC < 15 ? 'Afinação muito boa.' : absC < 30 ? 'Afinação razoável — o ajuste à escala trata do resto.' : 'Afinação instável. Canta mais devagar e sustenta as notas.';
      if (Math.abs(meanC) > 15) tip += meanC > 0 ? ' Tendes a cantar um pouco alto (sustenido).' : ' Tendes a cantar um pouco baixo (bemol).';
      tip += ' ' + timingTip(tm);
      $('statsTitle').textContent = 'A tua afinação';
    }
    card.hidden = false;
    $('stats').innerHTML = rows.map(([k, v]) => `<span class="stat">${k} <b>${v}</b></span>`).join('') + `<span class="tip">${tip}</span>`;
  }

  // ================= cabeçalhos =================
  const isBlack = (p) => [1, 3, 6, 8, 10].includes(((p % 12) + 12) % 12);
  const inScale = (p) => {
    const iv = P.SCALES[leadScale()] ? P.SCALES[leadScale()].iv : P.SCALES.chromatic.iv;
    return iv.includes((((p - leadRoot()) % 12) + 12) % 12);
  };
  const keyLabel = (p) => P.noteName(p) + ' · ' + P.noteName(p, true);

  function renderHeads() {
    const h = $('heads');
    if (!isLead()) {
      h.innerHTML =
        `<div class="head ruler" style="height:${RULER}px">Bateria</div>` +
        DRUMS.map((d) => `<div class="head" style="height:${ROW}px"><span class="sw" style="background:${d.cor};color:${d.cor}"></span><div><div class="nm">${d.nome}</div><div class="ht">${d.dica}</div></div></div>`).join('') +
        `<div class="head lane" style="height:${LANE}px">A tua voz</div>`;
      return;
    }
    const L = state.lead;
    let html = `<div class="head ruler" style="height:${RULER}px">Lead</div>`;
    for (let p = L.hi; p >= L.lo; p--) {
      const showName = ROW >= 14 || p % 12 === 0;
      html += `<div class="key${isBlack(p) ? ' black' : ''}${p % 12 === 0 ? ' c' : ''}${inScale(p) ? '' : ' out'}" data-pitch="${p}" style="height:${ROW}px;font-size:${Math.min(11, ROW - 3)}px">${showName ? keyLabel(p) : ''}</div>`;
    }
    html += `<div class="head lane" style="height:${LANE}px">A tua voz</div>`;
    h.innerHTML = html;
  }
  $('heads').addEventListener('pointerdown', (e) => {
    const k = e.target.closest('.key');
    if (!k) return;
    engine.ensureCtx();
    engine.playLead(+k.dataset.pitch, engine.ctx.currentTime + 0.01, 0.35, 100, state.lead.preset);
  });

  // ================= desenho =================
  const canvas = $('canvas');
  const ctx2 = canvas.getContext('2d');
  let geo = { W: 0, H: 0, cell: 0 };
  let lastHeadsKey = '';

  function layout() {
    const sc = $('scroller');
    const avail = Math.max(300, sc.clientHeight - 16);
    if (!isLead()) {
      ROW = Math.max(42, Math.min(84, Math.floor((avail - RULER - 110) / DRUMS.length)));
      LANE = Math.max(96, Math.min(180, avail - RULER - ROW * DRUMS.length));
    } else {
      const rows = state.lead.hi - state.lead.lo + 1;
      ROW = Math.max(10, Math.min(26, Math.floor((avail - RULER - 90) / rows)));
      LANE = Math.max(80, Math.min(150, avail - RULER - ROW * rows));
    }
    const headsKey = [state.view, ROW, LANE, state.lead.lo, state.lead.hi, leadRoot(), leadScale()].join('|');
    if (headsKey !== lastHeadsKey) { lastHeadsKey = headsKey; renderHeads(); }
    const n = totalSteps();
    const W = Math.max(sc.clientWidth, n * MIN_CELL);
    const rowsN = isLead() ? state.lead.hi - state.lead.lo + 1 : DRUMS.length;
    const H = RULER + rowsN * ROW + LANE;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    geo = { W, H, cell: W / n, rowsN };
    draw();
  }

  function rr(c, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function drawGridLines(c, W, H) {
    const n = totalSteps(), spb = stepsPerBeat(), spBar = state.grid, cell = geo.cell;
    for (let s = 0; s <= n; s++) {
      const x = Math.round(s * cell) + 0.5;
      let col = T.step;
      if (s % spBar === 0) col = T.bar;
      else if (s % spb === 0) col = T.beat;
      c.strokeStyle = col;
      c.lineWidth = s % spBar === 0 ? 1.5 : 1;
      c.beginPath(); c.moveTo(x, RULER); c.lineTo(x, H); c.stroke();
    }
  }

  function drawRuler(c, W) {
    const n = totalSteps(), spb = stepsPerBeat(), spBar = state.grid, cell = geo.cell;
    c.fillStyle = T.ruler;
    c.fillRect(0, 0, W, RULER);
    c.fillStyle = T.rulerLine;
    c.fillRect(0, RULER - 1, W, 1);
    c.textBaseline = 'middle';
    for (let s = 0; s < n; s += spb) {
      const bar = Math.floor(s / spBar) + 1, beat = Math.floor((s % spBar) / spb) + 1;
      c.fillStyle = beat === 1 ? T.rulerBar : T.rulerBeat;
      c.font = (beat === 1 ? '700 14px' : '600 12px') + ' "Geist", system-ui, sans-serif';
      c.fillText(beat === 1 ? String(bar) : bar + '.' + beat, s * cell + 5, RULER / 2);
    }
  }

  function draw(playPos) {
    const c = ctx2, { W, H } = geo;
    c.clearRect(0, 0, W, H);
    c.fillStyle = T.bg;
    c.fillRect(0, 0, W, H);
    if (isLead()) drawLead(c, W, H); else drawDrums(c, W, H);
    drawRuler(c, W);
    drawLane(c, W);
    if (playPos != null) {
      const x = playPos * geo.cell;
      c.save();
      c.shadowColor = T.play; c.shadowBlur = 10;
      c.fillStyle = T.play;
      c.fillRect(x - 1, 0, 2, H);
      c.restore();
      c.fillStyle = T.play;
      c.beginPath(); c.moveTo(x - 6, 0); c.lineTo(x + 6, 0); c.lineTo(x, 8); c.closePath(); c.fill();
    }
  }

  function drawDrums(c, W, H) {
    const cell = geo.cell, n = totalSteps(), spb = stepsPerBeat();
    for (let b = 0; b < n / spb; b++) if (b % 2 === 1) {
      c.fillStyle = T.beatShade;
      c.fillRect(b * spb * cell, RULER, spb * cell, DRUMS.length * ROW);
    }
    c.fillStyle = T.rowLine;
    for (let r = 0; r <= DRUMS.length; r++) c.fillRect(0, RULER + r * ROW, W, 1);
    if (state.hover && !engine.playing) {
      c.fillStyle = T.hover;
      c.fillRect(state.hover.step * cell, RULER + state.hover.row * ROW, cell, ROW);
    }
    drawGridLines(c, W, H);
    const rowOf = Object.fromEntries(DRUMS.map((d, i) => [d.id, i]));
    for (const note of state.drums.notes) {
      const d = DRUMS[rowOf[note.drum]];
      const x = note.step * cell, y = RULER + rowOf[note.drum] * ROW;
      const v = note.vel / 127, pad = Math.min(3, cell * 0.12);
      // nota = coluna de blocos LED (como um medidor): blocos acesos = força do golpe
      const SEG = 6, gap = 2, top = y + 6, hgt = ROW - 12;
      const sh = (hgt - gap * (SEG - 1)) / SEG, lit = Math.max(1, Math.round(v * SEG));
      const w = cell - pad * 2, rad = Math.min(2, cell / 8);
      const now = engine.playing && Math.floor(engine.position ? engine.position() : -1) === note.step;
      for (let k = 0; k < SEG; k++) {
        const on = k < lit, yy = top + hgt - (k + 1) * sh - k * gap;
        c.save();
        if (on) {
          c.globalAlpha = 0.55 + 0.45 * (k / SEG) + (now ? 0.2 : 0);
          c.shadowColor = d.cor; c.shadowBlur = now ? 18 : 8;
          c.fillStyle = d.cor;
        } else { c.globalAlpha = 0.1; c.fillStyle = d.cor; }
        rr(c, x + pad, yy, w, sh, rad);
        c.fill();
        c.restore();
        if (on) { c.fillStyle = 'rgba(255,255,255,0.28)'; c.fillRect(x + pad + 1, yy + 1, w - 2, 1); }
      }
    }
    const sd = stepDur();
    c.fillStyle = T.hit;
    for (const h of state.drums.hits) c.fillRect((h.t / sd) * cell - 0.5, RULER + rowOf[h.drum] * ROW + 2, 1.5, 6);
  }

  function drawLead(c, W, H) {
    const L = state.lead, cell = geo.cell, sd = stepDur();
    const chromatic = leadScale() === 'chromatic';
    // linhas de notas (teclas pretas mais escuras, notas fora da escala esbatidas)
    for (let p = L.hi; p >= L.lo; p--) {
      const y = RULER + (L.hi - p) * ROW;
      let col = isBlack(p) ? T.black : T.white;
      if (!chromatic && inScale(p)) col = isBlack(p) ? T.blackIn : T.whiteIn;
      c.fillStyle = col;
      c.fillRect(0, y, W, ROW);
      if (!chromatic && (((p - leadRoot()) % 12) + 12) % 12 === 0) { c.fillStyle = T.root; c.fillRect(0, y, W, ROW); }
      c.fillStyle = p % 12 === 0 ? T.cLine : T.keyLine;
      c.fillRect(0, y + ROW - 1, W, 1);
    }
    if (state.hover && !engine.playing) {
      c.fillStyle = T.hover;
      c.fillRect(state.hover.step * cell, RULER + state.hover.row * ROW, cell, ROW);
    }
    drawGridLines(c, W, H);
    // notas
    c.textBaseline = 'middle';
    for (const nt of L.notes) {
      if (nt.pitch < L.lo || nt.pitch > L.hi) continue;
      const x = nt.step * cell, y = RULER + (L.hi - nt.pitch) * ROW, w = nt.len * cell;
      c.save();
      c.globalAlpha = 0.5 + 0.5 * (nt.vel / 127);
      c.shadowColor = LEAD_COLOR; c.shadowBlur = 9;
      c.fillStyle = LEAD_COLOR;
      rr(c, x + 1, y + 1, w - 2, ROW - 2, Math.min(2.5, ROW / 4));
      c.fill();
      c.restore();
      c.fillStyle = 'rgba(255,255,255,0.35)';
      c.fillRect(x + w - 4, y + 3, 2, ROW - 6); // pega para redimensionar
      if (w > 34 && ROW >= 12) {
        c.fillStyle = T.noteText;
        c.font = `700 ${Math.min(13, ROW - 2)}px "Geist", system-ui, sans-serif`;
        c.fillText(P.noteName(nt.pitch, true), x + 5, y + ROW / 2 + 0.5);
      }
    }
    // curva da voz (por cima das notas: mostra como cantaste de facto)
    const yOf = (m) => RULER + (L.hi - m + 0.5) * ROW;
    c.strokeStyle = 'rgba(235,227,207,0.85)';
    c.lineWidth = 1.25;
    c.shadowColor = 'rgba(0,0,0,0.6)';
    c.shadowBlur = 2;
    c.lineJoin = 'round';
    c.beginPath();
    let pen = false;
    for (const p of L.curve) {
      if (p.midi == null) { pen = false; continue; }
      const x = (p.t / sd) * cell, y = yOf(p.midi + 12 * L.octave);
      if (pen) c.lineTo(x, y); else c.moveTo(x, y);
      pen = true;
    }
    c.stroke();
    c.shadowBlur = 0;
  }

  function drawLane(c, W) {
    const y0 = RULER + geo.rowsN * ROW, mid = y0 + LANE / 2, cell = geo.cell;
    c.fillStyle = T.lane;
    c.fillRect(0, y0, W, LANE);
    c.fillStyle = T.laneLine;
    c.fillRect(0, y0, W, 1);
    const r = cur().rec;
    if (!matches(r)) {
      c.fillStyle = T.laneText;
      c.font = '600 14px "Geist", system-ui, sans-serif';
      c.textBaseline = 'middle';
      c.fillText(r ? 'Gravação feita noutro BPM/compassos — grava de novo para ver a tua voz aqui.' : 'A forma de onda da tua gravação aparece aqui.', 12, mid);
      return;
    }
    const bar1 = bar1Of(r), sd = stepDur();
    const spp = (sd / cell) * r.sr;
    let max = 1e-4;
    for (let i = Math.max(0, bar1); i < Math.min(r.samples.length, bar1 + spp * W); i++) max = Math.max(max, Math.abs(r.samples[i]));
    const amp = (LANE / 2 - 8) / max;
    c.fillStyle = T.wave;
    for (let px = 0; px < W; px++) {
      const a = Math.floor(bar1 + px * spp), b = Math.floor(bar1 + (px + 1) * spp);
      let lo = 0, hi = 0;
      for (let i = Math.max(0, a); i < Math.min(r.samples.length, b); i += 2) {
        const v = r.samples[i];
        if (v < lo) lo = v; else if (v > hi) hi = v;
      }
      c.fillRect(px, mid - hi * amp, 1, Math.max(1, (hi - lo) * amp));
    }
    const marks = isLead()
      ? state.lead.segs.map((s) => ({ t: s.t0, cor: LEAD_COLOR }))
      : state.drums.hits.map((h) => ({ t: h.t, cor: DRUMS.find((d) => d.id === h.drum).cor }));
    for (const m of marks) {
      const x = (m.t / sd) * cell;
      c.fillStyle = m.cor;
      c.fillRect(x - 1, y0 + 4, 2, LANE - 8);
      c.beginPath(); c.moveTo(x - 5, y0 + 4); c.lineTo(x + 5, y0 + 4); c.lineTo(x, y0 + 11); c.closePath(); c.fill();
    }
    // efeitos da voz: uma linha por efeito ligado (o que a app ouviu na tua voz)
    const fx = isLead() ? leadFxNow() : null;
    if (fx) {
      const step = cell / fx.res, top = y0 + 8, h = LANE - 16;
      c.save();
      c.lineWidth = 1.5; c.lineJoin = 'round';
      for (const d of V.FX) {
        const arr = d.id === 'glide' || d.id === 'vib' ? null : fx[d.id];
        if (!arr) continue;
        c.strokeStyle = d.cor; c.globalAlpha = d.id === 'vol' ? 0.35 : 0.9;
        c.beginPath();
        for (let k = 0; k < arr.length; k++) { const x = k * step, y = top + h - arr[k] * h; k ? c.lineTo(x, y) : c.moveTo(x, y); }
        c.stroke();
      }
      if (fx.bend) {
        c.strokeStyle = '#f1dcae'; c.globalAlpha = 0.9; c.setLineDash([3, 3]);
        c.beginPath();
        for (let k = 0; k < fx.bend.length; k++) { const x = k * step, y = mid - Math.max(-2, Math.min(2, fx.bend[k])) * (h / 4); k ? c.lineTo(x, y) : c.moveTo(x, y); }
        c.stroke();
      }
      c.restore();
    }
  }

  // ================= edição com rato / toque =================
  let drag = null;
  function cellAt(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const row = Math.floor((y - RULER) / ROW);
    if (y < RULER || row < 0 || row >= geo.rowsN) return null;
    const step = Math.floor(x / geo.cell);
    if (step < 0 || step >= totalSteps()) return null;
    return { row, step, x, y };
  }
  const previewLead = (pitch, vel = 100) => {
    engine.ensureCtx();
    engine.playLead(pitch, engine.ctx.currentTime + 0.01, Math.min(0.4, stepDur() * 2), vel, state.lead.preset);
  };

  canvas.addEventListener('pointerdown', (e) => {
    const cell = cellAt(e);
    if (!cell) return;
    canvas.setPointerCapture(e.pointerId);
    if (!isLead()) {
      const drum = DRUMS[cell.row].id;
      const note = state.drums.notes.find((n) => n.step === cell.step && n.drum === drum);
      if (note) drag = { kind: 'drum', note, y: e.clientY, vel: note.vel, moved: false };
      else {
        const n = { step: cell.step, drum, vel: 100 };
        state.drums.notes.push(n);
        state.drums.notes.sort((a, b) => a.step - b.step);
        drag = { kind: 'drum', note: n, y: e.clientY, vel: 100, moved: true, isNew: true };
        engine.ensureCtx();
        engine.playDrum(drum, engine.ctx.currentTime + 0.01, 100);
      }
    } else {
      const L = state.lead, pitch = L.hi - cell.row;
      const note = L.notes.find((n) => n.pitch === pitch && cell.step >= n.step && cell.step < n.step + n.len);
      if (note) {
        const rightEdge = (note.step + note.len) * geo.cell;
        const nearEdge = rightEdge - cell.x < Math.max(7, geo.cell * 0.35);
        drag = { kind: nearEdge ? 'resize' : 'move', note, x: e.clientX, y: e.clientY, step: note.step, pitch: note.pitch, moved: false };
      } else {
        const len = Math.min(L.lastLen, totalSteps() - cell.step);
        const n = { step: cell.step, len, pitch, vel: 100 };
        L.notes.push(n);
        drag = { kind: 'resize', note: n, x: e.clientX, y: e.clientY, moved: true, isNew: true };
        previewLead(pitch);
      }
    }
    updateButtons();
    draw(engine.position());
  });

  canvas.addEventListener('pointermove', (e) => {
    if (drag) {
      const dx = e.clientX - drag.x, dy = drag.y - e.clientY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
      if (!drag.moved) return;
      if (drag.kind === 'drum') {
        if (drag.isNew) return;
        drag.note.vel = Math.max(10, Math.min(127, Math.round(drag.vel + dy)));
        setStatus('Velocidade: ' + drag.note.vel);
      } else if (drag.kind === 'resize') {
        const rect = canvas.getBoundingClientRect();
        const endStep = Math.ceil((e.clientX - rect.left) / geo.cell - 0.15);
        drag.note.len = Math.max(1, Math.min(totalSteps() - drag.note.step, endStep - drag.note.step));
        state.lead.lastLen = drag.note.len;
      } else if (drag.kind === 'move') {
        const L = state.lead;
        const ns = Math.max(0, Math.min(totalSteps() - drag.note.len, drag.step + Math.round(dx / geo.cell)));
        const np = Math.max(L.lo, Math.min(L.hi, drag.pitch + Math.round(dy / ROW)));
        if (np !== drag.note.pitch) previewLead(np);
        drag.note.step = ns;
        drag.note.pitch = np;
      }
      draw(engine.position());
      return;
    }
    const cell = cellAt(e);
    const h = cell ? { row: cell.row, step: cell.step } : null;
    if (JSON.stringify(h) !== JSON.stringify(state.hover)) { state.hover = h; draw(engine.position()); }
    if (isLead() && cell) {
      const L = state.lead, pitch = L.hi - cell.row;
      const note = L.notes.find((n) => n.pitch === pitch && cell.step >= n.step && cell.step < n.step + n.len);
      const edge = note && (note.step + note.len) * geo.cell - cell.x < Math.max(7, geo.cell * 0.35);
      canvas.style.cursor = edge ? 'ew-resize' : note ? 'grab' : 'crosshair';
    } else canvas.style.cursor = cell ? 'pointer' : 'default';
  });

  canvas.addEventListener('pointerup', () => {
    if (drag && !drag.moved && !drag.isNew) {
      const arr = drag.kind === 'drum' ? state.drums.notes : state.lead.notes;
      const i = arr.indexOf(drag.note);
      if (i >= 0) arr.splice(i, 1);
    } else if (drag && drag.kind !== 'drum') {
      state.lead.notes.sort((a, b) => a.step - b.step);
    }
    drag = null;
    updateButtons();
    draw(engine.position());
  });
  canvas.addEventListener('pointerleave', () => { if (!drag) { state.hover = null; draw(engine.position()); } });

  // ================= controlos =================
  const hasDrums = () => state.drums.notes.length > 0;
  const hasLead = () => state.lead.notes.length > 0;

  function updateButtons() {
    const C = cur();
    const hasCur = C.notes.length > 0;
    $('btnMidiDrums').disabled = !hasDrums();
    $('btnMidiLead').disabled = !hasLead();
    $('btnMidiAll').disabled = !(hasDrums() || hasLead());
    const any = hasDrums() || hasLead();
    for (const id of ['btnWav', 'btnSaveProj', 'btnAll']) $(id).disabled = !any || rendering;
    const nStems = stemParts().length;
    $('btnStems').disabled = nStems < 2 || rendering;
    $('btnStems').title = nStems >= 2 ? stemParts().map(([n]) => n).join(', ') : 'Precisa de pelo menos duas partes (bateria, melodia, 808 ou voz)';
    $('btnCoverPlay').disabled = $('btnPlay').disabled;
    $('btnPng').disabled = !hasCur && !C.rec;
    $('btnPlay').disabled = (!hasDrums() && !hasLead() && !matches(C.rec) && !state.metronome) || state.busy;
    $('btnRec').disabled = state.busy;
    $('btnRecLead').disabled = state.busy;
    $('btnOpen').disabled = state.busy;
    $('btnOpenLead').disabled = state.busy;
    $('btnCal').disabled = state.busy;
    $('btnTrain').disabled = state.busy;
    $('empty').hidden = hasCur || !!C.rec;
    $('emptyDrums').hidden = isLead();
    $('emptyLead').hidden = !isLead();
    $('overBeat').disabled = !hasDrums();
    $('overBeatHint').hidden = hasDrums();
  }

  function syncControls() {
    $('bpm').value = state.bpm;
    document.querySelectorAll('#view button').forEach((b) => b.classList.toggle('on', b.dataset.v === state.view));
    document.querySelectorAll('#bars button').forEach((b) => b.classList.toggle('on', +b.dataset.v === state.bars));
    document.querySelectorAll('#grid button').forEach((b) => b.classList.toggle('on', +b.dataset.v === state.grid));
    $('presetSel').innerHTML = presetOptions();
    $('kitSel').value = state.kit;
    const own = DRUMS.filter((d) => LIB.get(state.slots[d.id])).length + ['bass', 'lead'].filter((k) => LIB.get(state.slots[k])).length;
    $('kitHint').textContent = own ? ` · ${own} ${own === 1 ? 'sample' : 'samples'}` : '';
    $('kitSel').title = kitHint();
    $('metronome').checked = state.metronome;
    $('btnClick').classList.toggle('on', state.metronome);
    $('btnClick').setAttribute('aria-pressed', state.metronome ? 'true' : 'false');
    $('btnMetro').textContent = engine.playing ? 'Parar' : 'Ouvir o clique';
    $('headphones').checked = state.headphones;
    $('sens').value = Math.round(state.sensitivity * 100);
    $('sensOut').textContent = Math.round(state.sensitivity * 100) + '%';
    const lat = Math.round(latencySec() * 1000);
    $('lat').value = lat;
    $('latOut').textContent = lat + ' ms' + (state.latencyMs == null ? ' (auto)' : '');
    $('latOut').title = state.latencyMs == null ? 'Latência automática (estimada pelo browser)' : 'Latência definida à mão';
    $('trainCard').hidden = isLead();
    $('leadCard').hidden = !isLead();
    const L = state.lead;
    const det = P.NOMES[L.detected.root] + ' ' + MODE_PT[L.detected.mode];
    $('keySel').options[0].textContent = L.segs.length ? `Auto (${P.NOMES[L.detected.root]})` : 'Auto';
    $('keySel').value = String(L.keySetting);
    $('scaleSel').options[0].textContent = L.segs.length ? `Auto (${MODE_PT[L.detected.mode]})` : 'Auto';
    $('scaleSel').value = L.scale;
    $('octOut').textContent = (L.octave > 0 ? '+' : '') + L.octave;
    $('overBeat').checked = L.overBeat;
    $('keyInfo').textContent = L.segs.length ? 'Tom detetado: ' + det : 'O tom é detetado depois de gravares.';
    renderTrainState();
    renderFx();
    // HUD e resumo da exportação
    $('hudBpm').textContent = state.bpm;
    const keyTxt = L.segs.length ? det : '';
    $('hudKeyWrap').hidden = !keyTxt;
    $('hudKey').textContent = keyTxt;
    $('sumDrums').textContent = state.drums.notes.length;
    $('sumLead').textContent = state.lead.notes.length;
    $('sumBpm').textContent = state.bpm;
    $('sumKey').textContent = keyTxt || '—';
    $('sumKeyWrap').hidden = !keyTxt;
    if (document.activeElement !== $('projName')) $('projName').value = state.name;
    $('loopsSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.v === state.loops));
    renderCover(engine.playing ? engine.position() : null);
    if (BV.knobs) BV.knobs.refresh();
  }

  function refresh() { syncControls(); renderStats(); updateButtons(); layout(); }

  function setView(v) {
    if (v === state.view) return;
    state.view = v;
    state.hover = null;
    persist();
    refresh();
    setStatus(v === 'lead' ? 'Lead: canta uma melodia ("na-na", "du-du" ou "lá") e as notas aparecem no piano roll.' : 'Bateria: faz beatbox e o padrão aparece na grelha.');
  }

  function setBpm(v) {
    v = Math.max(50, Math.min(200, Math.round(+v || 90)));
    if (v === state.bpm) { $('bpm').value = v; return; }
    const wasPlaying = engine.playing;
    stopPlay();
    state.bpm = v;
    engine.setMix(state.mix, state.bpm);
    if (!matches(state.drums.rec)) state.drums.hits = [];
    if (!matches(state.lead.rec)) { state.lead.segs = []; state.lead.curve = []; }
    analyzeAll();
    persist(); refresh();
    if (wasPlaying) startPlay();
  }

  function setBars(v) {
    stopPlay();
    const old = totalSteps();
    state.bars = v;
    const n = totalSteps();
    const repeat = (arr) => {
      const base = arr.filter((x) => x.step < old), out = [];
      for (let o = 0; o < n; o += old) for (const x of base) if (x.step + o < n) out.push({ ...x, step: x.step + o, ...(x.len ? { len: Math.min(x.len, n - x.step - o) } : {}) });
      return out;
    };
    if (matches(state.drums.rec)) analyzeDrums(); else { state.drums.hits = []; state.drums.notes = repeat(state.drums.notes); }
    if (matches(state.lead.rec)) analyzeLead(); else { state.lead.segs = []; state.lead.curve = []; state.lead.notes = repeat(state.lead.notes); }
    persist(); refresh();
  }

  function setGrid(v) {
    stopPlay();
    const ratio = v / state.grid;
    state.grid = v;
    if (matches(state.drums.rec)) analyzeDrums();
    else {
      const map = new Map();
      for (const x of state.drums.notes) { const step = Math.round(x.step * ratio); map.set(step + ':' + x.drum, { ...x, step }); }
      state.drums.notes = [...map.values()];
    }
    if (matches(state.lead.rec)) analyzeLead();
    else state.lead.notes = state.lead.notes.map((x) => ({ ...x, step: Math.round(x.step * ratio), len: Math.max(1, Math.round(x.len * ratio)) }));
    state.lead.lastLen = Math.max(1, Math.round(state.lead.lastLen * ratio));
    persist(); refresh();
  }

  // ================= gravação =================
  async function doRecord(kind = 'pattern', drumId) {
    if (state.busy) return;
    stopPlay();
    state.busy = true;
    updateButtons();
    const ov = $('overlay'), big = $('ovBig'), sub = $('ovSub'), bar = $('ovBar');
    const recBtn = isLead() ? $('btnRecLead') : $('btnRec');
    if (BV.flow) BV.flow.lock(true);
    const lead = kind === 'pattern' && isLead();
    if (kind === 'pattern') recBtn.classList.add('active');
    stopMicTest();
    // medidor do microfone durante a gravação
    const ovMeter = $('ovMeter');
    let meterRaf = 0;
    const meterLoop = () => { ovMeter.style.transform = `scaleX(${Math.min(1, engine.micLevel() * 1.6).toFixed(3)})`; meterRaf = state.busy ? requestAnimationFrame(meterLoop) : 0; };
    meterLoop();
    // na bateria, a tua voz aparece no equalizador LED por trás da contagem
    const eqLive = !lead && kind !== 'calibrate' && BV.eq && BV.eq.ok;
    const eqCanvas = $('eq'), eqHome = eqCanvas && eqCanvas.nextElementSibling;
    if (eqLive) { ov.prepend(eqCanvas); ov.classList.add('with-eq'); BV.eq.live = true; }
    ov.hidden = false;
    big.textContent = '…'; big.classList.remove('is-rec');
    sub.textContent = 'A abrir o microfone…';
    bar.style.width = '0';
    const onBeat = (b, inCount, total) => {
      if (inCount) {
        big.textContent = String((b % 4) + 1);
        big.classList.remove('is-rec');
        sub.textContent = 'Contagem — prepara-te';
      } else {
        const b2 = b - 4;
        big.textContent = String((b2 % 4) + 1);
        big.classList.add('is-rec');
        sub.textContent = kind === 'calibrate' ? 'Bate palmas em cada clique' :
          kind === 'train' ? 'Faz o som de ' + DRUMS.find((d) => d.id === drumId).nome + ' em cada clique' :
          kind === 'voicecal' ? V.CAL.find((x) => x.id === drumId).dica.replace(/\.$/, '') + ', sem parar' :
          (lead ? 'Canta a melodia' : 'A gravar') + ' — compasso ' + (Math.floor(b2 / 4) + 1) + ' de ' + state.bars;
        bar.style.width = ((b2 + 1) / (total - 4)) * 100 + '%';
      }
    };
    try {
      if (kind === 'calibrate') {
        const r = await engine.calibrate({ headphones: state.headphones, onBeat });
        state.latencyMs = Math.round(r.latency * 1000);
        persist();
        analyzeAll();
        setStatus(`Calibrado com ${r.hits} palmas: latência ${state.latencyMs} ms.`, 'ok');
      } else if (kind === 'voicecal') {
        const rec = await engine.record({ bpm: 90, bars: 1, countInBars: 1, metronome: false, headphones: state.headphones, latency: 0, onBeat });
        const feat = V.analyze(rec.samples, rec.sr, P.track(rec.samples, rec.sr).frames);
        const prof = V.profile(feat);
        if (!prof) throw new Error('Não te ouvi bem. Canta mais alto e sem parar durante o compasso.');
        state.voiceCal[drumId] = prof;
        store.set('bv.voicecal', state.voiceCal);
        renderCalRows();
        analyzeLead();
        setStatus(`Calibrado: ${V.CAL.find((x) => x.id === drumId).nome}.`, 'ok');
      } else if (kind === 'train') {
        const rec = await engine.record({ bpm: 90, bars: 2, countInBars: 1, metronome: true, headphones: state.headphones, latency: 0, onBeat });
        const bar1 = bar1Of(rec);
        const on = BV.dsp.detectOnsets(rec.samples, rec.sr, { sensitivity: 0.5 });
        const beat = 60 / 90;
        const vecs = [];
        on.forEach((o, i) => {
          const t = (o.sample - bar1) / rec.sr;
          if (t < -beat / 2 || t > 8 * beat) return;
          const gap = on[i + 1] ? on[i + 1].sample - o.sample : 2048;
          vecs.push(BV.dsp.features(rec.samples, rec.sr, o.sample, gap).vec);
        });
        if (vecs.length < 3) throw new Error('Só apanhei ' + vecs.length + ' sons. Tenta mais alto e bem marcado.');
        state.training[drumId] = vecs;
        store.set('bv.training', state.training);
        renderTrainRows();
        analyzeDrums();
        setStatus(`Treinado: ${vecs.length} exemplos de ${DRUMS.find((d) => d.id === drumId).nome}.`, 'ok');
      } else {
        const backing = lead && state.lead.overBeat && hasDrums()
          ? { drums: state.drums.notes, stepsPerBeat: stepsPerBeat(), totalSteps: totalSteps() }
          : null;
        const rec = await engine.record({
          bpm: state.bpm, bars: state.bars, countInBars: 1, metronome: state.metronome,
          headphones: state.headphones, latency: 0, onBeat, backing,
        });
        const C = cur();
        C.rec = { ...rec, bpm: state.bpm, bars: state.bars };
        const lowMic = rec.rawPeak < 0.03;
        if (lead) {
          sub.textContent = 'A analisar a melodia…';
          big.textContent = '...';
          await new Promise((r) => setTimeout(r, 30));
          analyzeLead();
          if (!state.lead.segs.length) setStatus('Não detetei notas. Canta mais perto do micro, com vogais longas ("lá", "nã").', 'err');
          else setStatus(`Detetei ${state.lead.segs.length} notas · tom ${P.NOMES[state.lead.detected.root]} ${MODE_PT[state.lead.detected.mode]}.`, 'ok');
          if (lowMic) setStatus('O microfone gravou muito baixo. Aproxima-te dele ou escolhe outro microfone no Andamento. Já reforcei o volume.', 'err');
        } else {
          analyzeDrums();
          if (!state.drums.hits.length) setStatus('Não detetei golpes. Fala mais perto do micro ou sobe a sensibilidade.', 'err');
          else setStatus(`Detetei ${state.drums.hits.length} golpes → ${state.drums.notes.length} notas na grelha.`, 'ok');
          if (lowMic) setStatus('O microfone gravou muito baixo. Aproxima-te dele ou escolhe outro microfone no Andamento. Já reforcei o volume.', 'err');
        }
      }
    } catch (err) {
      console.error(err);
      const msg = err && err.name === 'NotAllowedError'
        ? (EMBEDDED
          ? 'O microfone não está disponível nesta página. Usa Abrir áudio, ou a versão do zip para gravar.'
          : 'Sem acesso ao microfone. Autoriza o microfone no browser (ícone do cadeado na barra de endereço).')
        : err && err.name === 'NotFoundError' ? 'Não encontrei nenhum microfone.'
        : (err && err.message) || 'Algo correu mal na gravação.';
      setStatus(msg, 'err');
    } finally {
      state.busy = false;
      ov.hidden = true;
      if (eqLive) { BV.eq.live = false; ov.classList.remove('with-eq'); if (eqHome) eqHome.before(eqCanvas); else document.body.prepend(eqCanvas); }
      fillMics();
      recBtn.classList.remove('active');
      if (BV.flow) BV.flow.lock(false);
      refresh();
    }
  }

  // ================= reprodução =================
  let raf = null;
  function startPlay() {
    const C = cur();
    if (!hasDrums() && !hasLead() && !matches(C.rec) && !state.metronome) return;
    engine.setMix(state.mix, state.bpm);
    // gravações da voz: a do passo atual com "Ouvir a voz", e as que estiverem ligadas na mistura
    const voices = [];
    for (const [R, kind] of [[state.drums, 'vdrums'], [state.lead, 'vlead']]) {
      if (!matches(R.rec)) continue;
      const inMix = !state.mix.els[kind].mute, here = state.withVoice && R === C;
      if (inMix || here) voices.push({ rec: R.rec, offset: bar1Of(R.rec) / R.rec.sr, kind: inMix ? kind : null });
    }
    engine.play({
      bpm: state.bpm,
      stepsPerBeat: stepsPerBeat(),
      totalSteps: totalSteps(),
      drums: () => state.drums.notes,
      lead: () => state.lead.notes,
      leadPreset: state.lead.preset,
      voices,
      click: () => state.metronome,
      leadFx: () => leadFxNow(),
      bass: () => bassNotes(),
    });
    let lastBeat = -1;
    const pulseEls = [$('btnClick'), $('bpm')];
    $('btnPlay').innerHTML = '<svg><use href="#i-stop"/></svg><span>Parar</span>';
    $('btnPlay').classList.add('on');
    $('btnMetro').textContent = 'Parar';
    $('btnCoverPlay').classList.add('on'); $('btnCoverPlay').innerHTML = '<svg><use href="#i-stop"/></svg>';
    const posOut = $('posOut');
    const loop = () => {
      const pos = engine.position();
      draw(pos);
      if (BV.flow && BV.flow.active === 5) renderCover(pos);
      if (pos != null) {
        const beatSteps = stepsPerBeat(), barSteps = state.grid;
        posOut.textContent = (Math.floor(pos / barSteps) + 1) + '.' + (Math.floor((pos % barSteps) / beatSteps) + 1);
        // pulso visual a cada tempo (mais forte no primeiro tempo do compasso)
        const beat = Math.floor(pos / beatSteps);
        if (beat !== lastBeat) {
          lastBeat = beat;
          if (state.metronome) for (const el of pulseEls) {
            el.classList.remove('tick', 'tick-bar');
            void el.offsetWidth;
            el.classList.add(Math.floor(pos) % barSteps < beatSteps ? 'tick-bar' : 'tick');
          }
        }
      }
      raf = engine.playing ? requestAnimationFrame(loop) : null;
    };
    loop();
  }
  function stopPlay() {
    if (!engine.playing) return;
    engine.stop();
    cancelAnimationFrame(raf);
    $('btnPlay').innerHTML = '<svg><use href="#i-play"/></svg><span>Tocar</span>';
    $('btnPlay').classList.remove('on');
    $('btnMetro').textContent = 'Ouvir o clique';
    $('btnCoverPlay').classList.remove('on'); $('btnCoverPlay').innerHTML = '<svg><use href="#i-play"/></svg>';
    renderCover();
    $('posOut').textContent = '1.1';
    draw();
  }
  const togglePlay = () => (engine.playing ? stopPlay() : startPlay());
  const restartIfPlaying = () => { if (engine.playing) { stopPlay(); startPlay(); } };

  // ================= exportar =================
  // Dentro de um artifact do claude.ai as descargas passam pela capacidade "downloads",
  // que não aceita .mid: nesse caso o MIDI vai dentro de um .zip.
  const EMBEDDED = !!(window.claude && typeof window.claude.use === 'function');
  async function download(blob, name) {
    if (EMBEDDED) {
      const dl = await window.claude.use('downloads');
      if (!dl) { setStatus('Descargas indisponíveis nesta página. Usa a versão do zip.', 'err'); return; }
      let data = blob, fname = name;
      if (/\.(mid|wav)$/.test(name)) {
        data = new Blob([BV.zip.store([{ name, data: new Uint8Array(await blob.arrayBuffer()) }])]);
        fname = name.replace(/\.(mid|wav)$/, '.zip');
      }
      try {
        await dl.save({ filename: fname, data });
        setStatus(fname !== name ? 'Guardado ' + fname + '. Descompacta-o para teres o ' + name.split('.').pop().toUpperCase() + '.' : 'Guardado ' + fname + '.', 'ok');
      } catch (e) {
        if (e && e.code === 'declined') setStatus('Descarga cancelada.');
        else if (e && e.code === 'rate_limited') setStatus('Já há uma descarga à espera de confirmação.');
        else setStatus('Não foi possível guardar o ficheiro nesta página.', 'err');
      }
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  const midiOpts = () => ({ bpm: state.bpm, stepsPerBeat: stepsPerBeat(), totalSteps: totalSteps() });
  // ---------- V: nome, repetições, MIDI, WAV, capa e projeto ----------
  const slug = () => (state.name.trim() || 'beatvox').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'beatvox';
  const fileBase = () => `${slug()}-${state.bpm}bpm`;
  /** repete as notas do loop N vezes (para MIDI e WAV) */
  const looped = (notes) => {
    const n = totalSteps(), out = [];
    for (let k = 0; k < state.loops; k++) for (const x of notes) out.push({ ...x, step: x.step + k * n });
    return out;
  };
  function midiBytes(kind) {
    const o = { ...midiOpts(), totalSteps: totalSteps() * state.loops };
    if ((kind === 'all' || kind === 'drums') && hasDrums()) o.drums = looped(state.drums.notes);
    if ((kind === 'all' || kind === 'bass') && bassNotes().length) o.bass = looped(bassNotes());
    if ((kind === 'all' || kind === 'lead') && hasLead()) {
      o.lead = looped(state.lead.notes);
      const L = SND.LEADS.find((x) => x.id === state.lead.preset);
      if (L && L.gm != null) o.leadProgram = L.gm;
      const fx = leadFxNow();
      if (fx) o.leadAuto = loopFx(fx, state.loops);
    }
    return BV.midi.build(o);
  }
  function exportMidi(kind) {
    const name = { all: 'completo', drums: 'bateria', lead: 'melodia' }[kind];
    download(new Blob([midiBytes(kind)], { type: 'audio/midi' }), `${fileBase()}-${name}.mid`);
    if (!EMBEDDED) setStatus(kind === 'all' ? 'MIDI completo descarregado.' : 'MIDI descarregado — arrasta-o para o teu DAW.', 'ok');
  }
  // as gravações da voz que estão ligadas na mistura (tiraste o "M")
  const mixVoices = () => [[state.drums, 'vdrums'], [state.lead, 'vlead']]
    .filter(([R, k]) => matches(R.rec) && !state.mix.els[k].mute).map(([R, k]) => ({ rec: R.rec, offset: bar1Of(R.rec) / R.rec.sr, kind: k }));
  /** opções do render para as partes pedidas ({ drums, lead, bass, voices }) */
  function renderOpts(parts, extra = {}) {
    return {
      mix: state.mix, bpm: state.bpm, stepsPerBeat: stepsPerBeat(), totalSteps: totalSteps(), loops: state.loops, leadPreset: state.lead.preset,
      drums: parts.drums ? state.drums.notes : [], lead: parts.lead ? state.lead.notes : [], leadFx: parts.lead ? leadFxNow() : null,
      bass: parts.bass ? bassNotes() : [], voices: parts.voices ? mixVoices() : [], sounds: soundsNow(), ...extra,
    };
  }
  async function wavMix() {
    const r = await engine.render(renderOpts({ drums: 1, lead: 1, bass: 1, voices: 1 }));
    return BV.encodeWav({ ...r, name: state.name.trim() || 'BeatVox' });
  }
  /** stems: as partes que existem, cada uma com os seus envios para os efeitos */
  function stemParts() {
    const out = [];
    if (hasDrums()) out.push(['bateria', { drums: 1 }]);
    if (hasLead()) out.push(['melodia', { lead: 1 }]);
    if (bassNotes().length) out.push(['808', { bass: 1 }]);
    if (mixVoices().length) out.push(['voz', { voices: 1 }]);
    return out;
  }
  /** Os stems têm a mesma duração e o mesmo ponto de partida que a mistura, e o mesmo ganho entre si:
      postos lado a lado num DAW somam a mistura (antes do compressor do master). */
  async function stemFiles(dir = '') {
    const rs = [];
    for (const [nome, parts] of stemParts()) rs.push([nome, await engine.render(renderOpts(parts, { master: false, raw: true }))]);
    let pk = 0;
    for (const [, r] of rs) for (const ch of r.channels) for (let i = 0; i < ch.length; i++) { const a = Math.abs(ch[i]); if (a > pk) pk = a; }
    const g = pk > 0.89 ? 0.89 / pk : 1;
    return rs.map(([nome, r]) => {
      if (g !== 1) for (const ch of r.channels) for (let i = 0; i < ch.length; i++) ch[i] *= g;
      return { name: `${dir}${fileBase()}-${nome}.wav`, data: BV.encodeWav({ ...r, name: `${state.name.trim() || 'BeatVox'} (${nome})` }) };
    });
  }
  async function busyExport(label, fn) {
    if (rendering) return;
    rendering = true; updateButtons();
    setStatus(label);
    try { await fn(); } catch (e) { console.error(e); setStatus('Não consegui criar o ficheiro: ' + ((e && e.message) || e), 'err'); }
    finally { rendering = false; updateButtons(); }
  }
  const loopTxt = () => `${state.bars * state.loops} ${state.bars * state.loops === 1 ? 'compasso' : 'compassos'} a ${state.bpm} BPM`;
  const exportWav = () => busyExport('A renderizar o áudio…', async () => {
    await download(new Blob([await wavMix()], { type: 'audio/wav' }), `${fileBase()}.wav`);
    if (!EMBEDDED) setStatus(`WAV descarregado: ${loopTxt()}, a começar no tempo 1 e pronto a dar a volta em loop.`, 'ok');
  });
  const exportStems = () => busyExport('A renderizar os stems…', async () => {
    const files = await stemFiles();
    await download(new Blob([BV.zip.store(files)], { type: 'application/zip' }), `${fileBase()}-stems.zip`);
    if (!EMBEDDED) setStatus(`Stems descarregados (${files.length} WAV, ${loopTxt()}, todos alinhados).`, 'ok');
  });

  // projeto: notas e definições em JSON (sem as gravações da voz)
  function projectJson() {
    const L = state.lead;
    return JSON.stringify({
      app: 'BeatVox', version: 1, name: state.name, bpm: state.bpm, bars: state.bars, grid: state.grid, loops: state.loops,
      drums: state.drums.notes.map(({ step, drum, vel }) => ({ step, drum, vel })),
      lead: L.notes.map(({ step, len, pitch, vel }) => ({ step, len, pitch, vel })),
      leadSettings: { key: L.keySetting, scale: L.scale, octave: L.octave, preset: L.preset, detected: L.detected },
      fxOn: state.fxOn,
      mix: state.mix,
      kit: state.kit,
      sounds: Object.fromEntries(SND.SLOTS.map((k) => [k, LIB.get(state.slots[k])]).filter(([, it]) => it).map(([k, it]) => [k, it.name])),
      fx: L.fx ? Object.fromEntries(Object.entries(L.fx).map(([k, v]) => [k, v instanceof Float32Array ? Array.from(v, (x) => (isNaN(x) ? null : Math.round(x * 1000) / 1000)) : v])) : null,
    });
  }
  function saveProject() {
    download(new Blob([projectJson()], { type: 'application/json' }), `${slug()}.beatvox.json`);
    if (!EMBEDDED) setStatus('Projeto guardado. Usa Abrir para continuar mais tarde.', 'ok');
  }
  async function openProject(file) {
    try {
      const p = JSON.parse(await file.text());
      if (!p || p.app !== 'BeatVox' || !Array.isArray(p.drums)) throw new Error('não é um projeto BeatVox');
      stopPlay();
      state.bpm = Math.max(50, Math.min(200, +p.bpm || 90));
      state.bars = [1, 2, 4].includes(+p.bars) ? +p.bars : 2;
      state.grid = [8, 16, 32].includes(+p.grid) ? +p.grid : 16;
      state.loops = [1, 2, 4, 8].includes(+p.loops) ? +p.loops : 1;
      state.name = String(p.name || '').slice(0, 40);
      const n = totalSteps(), ids = new Set(DRUMS.map((d) => d.id));
      state.drums = { rec: null, hits: [], notes: p.drums.filter((x) => ids.has(x.drum) && x.step >= 0 && x.step < n).map((x) => ({ step: x.step | 0, drum: x.drum, vel: Math.max(1, Math.min(127, x.vel | 0 || 100)) })) };
      const L = state.lead, ls = p.leadSettings || {};
      Object.assign(L, { rec: null, segs: [], curve: [], notes: (p.lead || []).filter((x) => x.step >= 0 && x.step < n).map((x) => ({ step: x.step | 0, len: Math.max(1, x.len | 0), pitch: x.pitch | 0, vel: Math.max(1, Math.min(127, x.vel | 0 || 100)) })) });
      if (ls.key != null) L.keySetting = ls.key;
      if (ls.scale) L.scale = ls.scale;
      if (ls.octave != null) L.octave = ls.octave | 0;
      if (ls.preset) L.preset = ls.preset;
      if (ls.detected) L.detected = ls.detected;
      if (p.fxOn) state.fxOn = { ...state.fxOn, ...p.fxOn };
      if (p.mix) { state.mix = BV.mix.merge(p.mix); engine.setMix(state.mix, state.bpm); }
      if (SND.KITS.some((k) => k.id === p.kit)) state.kit = p.kit;
      // samples: voltam se estiverem na tua biblioteca (procurados pelo nome do ficheiro)
      const missing = [];
      if (p.sounds && typeof p.sounds === 'object') {
        state.slots = {};
        for (const k of SND.SLOTS) if (p.sounds[k]) { const it = LIB.byName(p.sounds[k]); if (it) state.slots[k] = it.id; else missing.push(p.sounds[k]); }
      }
      if (L.preset === 'sample' && !state.slots.lead) L.preset = 'synth';
      if (!SND.LEADS.some((x) => x.id === L.preset)) L.preset = 'synth';
      engine.setSounds(soundsNow());
      L.fx = null;
      if (p.fx && p.fx.n === n && p.fx.res) {
        L.fx = { res: p.fx.res, n: p.fx.n, sd: p.fx.sd };
        for (const k of ['vol', 'ar', 'garra', 'vogal', 'sung']) L.fx[k] = Float32Array.from(p.fx[k] || [], (x) => (x == null ? NaN : x));
      }
      $('bpm').value = state.bpm;
      persist(); refresh();
      setStatus(`Projeto aberto: ${state.name || 'sem título'} (${state.drums.notes.length} + ${L.notes.length} notas).` + (missing.length ? ` Não encontrei na biblioteca: ${missing.join(', ')} (uso o kit).` : ''), missing.length ? 'err' : 'ok');
    } catch (e) {
      setStatus('Não consegui abrir esse ficheiro: ' + e.message + '.', 'err');
    }
  }

  // capa: o beat desenhado como colunas LED (como o equalizador do movimento III) + a melodia em ouro
  function drawCover(cv, pos = null) {
    const S = cv.width, c = cv.getContext('2d'), u = S / 560;
    const bg = c.createRadialGradient(S * 0.5, S * 0.32, 0, S * 0.5, S * 0.5, S * 0.8);
    bg.addColorStop(0, '#3a1019'); bg.addColorStop(0.55, '#1a070c'); bg.addColorStop(1, '#0b0305');
    c.fillStyle = bg; c.fillRect(0, 0, S, S);
    // grão subtil
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    c.fillStyle = 'rgba(241,220,174,0.035)';
    for (let i = 0; i < 900; i++) c.fillRect(rnd() * S, rnd() * S, u, u);
    // moldura dourada
    const m = 22 * u;
    c.strokeStyle = 'rgba(216,181,122,0.45)'; c.lineWidth = u;
    c.strokeRect(m, m, S - 2 * m, S - 2 * m);
    c.fillStyle = '#d8b57a'; c.textBaseline = 'alphabetic';
    c.font = `600 ${10.5 * u}px Geist, system-ui, sans-serif`;
    if ('letterSpacing' in c) c.letterSpacing = `${2.5 * u}px`;
    c.textAlign = 'left'; c.fillText('BEATVOX', m + 16 * u, m + 26 * u);
    c.textAlign = 'right'; c.fillText(`${state.bpm} BPM`, S - m - 16 * u, m + 26 * u);
    if ('letterSpacing' in c) c.letterSpacing = '0px';
    // colunas LED
    const n = Math.min(64, totalSteps()), SEG = 12;
    const x0 = m + 30 * u, x1 = S - m - 30 * u, yb = S * 0.64, hgt = S * 0.34;
    const cw = (x1 - x0) / n, gap = Math.max(1, cw * 0.18), sh = hgt / SEG;
    const lift = { kick: 1, snare: 0.82, clap: 0.74, openhat: 0.62, hat: 0.5 };
    const byStep = new Map();
    for (const x of state.drums.notes) {
      if (x.step >= n) continue;
      const h = (lift[x.drum] || 0.6) * (0.55 + 0.45 * x.vel / 127);
      const prev = byStep.get(x.step);
      if (!prev || h > prev.h) byStep.set(x.step, { h, cor: (DRUMS.find((d) => d.id === x.drum) || DRUMS[0]).cor });
    }
    const cur = pos == null ? -1 : Math.floor(pos) % n;
    for (let i = 0; i < n; i++) {
      const col = byStep.get(i), lit = col ? Math.max(1, Math.round(col.h * SEG)) : 0, hot = i === cur;
      for (let k = 0; k < SEG; k++) {
        const x = x0 + i * cw + gap / 2, y = yb - (k + 1) * sh + sh * 0.12, w = cw - gap, h = sh * 0.76;
        if (k < lit) {
          c.save();
          c.shadowColor = col.cor; c.shadowBlur = (hot ? 22 : 10) * u;
          c.fillStyle = col.cor; c.globalAlpha = hot ? 1 : 0.6 + 0.4 * (k / SEG);
          c.fillRect(x, y, w, h);
          c.restore();
          c.fillStyle = 'rgba(255,255,255,0.25)'; c.fillRect(x, y, w, Math.max(1, u));
        } else {
          c.fillStyle = hot ? 'rgba(241,220,174,0.16)' : 'rgba(216,181,122,0.06)';
          c.fillRect(x, y, w, h);
        }
      }
    }
    // reflexo
    const rg = c.createLinearGradient(0, yb, 0, yb + 40 * u);
    rg.addColorStop(0, 'rgba(216,181,122,0.22)'); rg.addColorStop(1, 'rgba(216,181,122,0)');
    c.fillStyle = rg; c.fillRect(x0, yb + 2 * u, x1 - x0, 40 * u);
    // melodia: linha dourada por cima das colunas
    const ln = state.lead.notes.filter((x) => x.step < n);
    if (ln.length) {
      const lo = Math.min(...ln.map((x) => x.pitch)), hi = Math.max(...ln.map((x) => x.pitch)), span = Math.max(6, hi - lo);
      const yOf = (p) => yb - hgt - 18 * u - ((p - lo) / span) * 46 * u;
      c.save();
      c.strokeStyle = '#f1dcae'; c.lineWidth = 2 * u; c.shadowColor = '#d8b57a'; c.shadowBlur = 12 * u; c.lineCap = 'round';
      for (const x of ln) { const y = yOf(x.pitch); c.beginPath(); c.moveTo(x0 + x.step * cw + 2 * u, y); c.lineTo(x0 + (x.step + x.len) * cw - 2 * u, y); c.stroke(); }
      c.restore();
    }
    // título
    c.textAlign = 'center';
    c.fillStyle = '#f4ede1';
    const title = state.name.trim() || 'Sem título';
    let fs = 54 * u;
    c.font = `italic 400 ${fs}px "Bodoni Moda", Didot, Georgia, serif`;
    while (c.measureText(title).width > S - 2 * m - 40 * u && fs > 22 * u) { fs -= 2 * u; c.font = `italic 400 ${fs}px "Bodoni Moda", Didot, Georgia, serif`; }
    c.fillText(title, S / 2, S * 0.8);
    const L = state.lead, keyTxt = L.notes.length ? `${P.NOMES[leadRoot()]} ${MODE_PT[L.detected.mode] || ''}`.trim() : '';
    c.font = `500 ${12 * u}px Geist, system-ui, sans-serif`;
    c.fillStyle = '#b8a48a';
    c.fillText([`${state.bars} ${state.bars === 1 ? 'compasso' : 'compassos'}`, keyTxt, state.loops > 1 ? `${state.loops}× loop` : ''].filter(Boolean).join('  ·  '), S / 2, S * 0.8 + 30 * u);
  }
  function renderCover(pos = null) { const cv = $('cover'); if (cv) drawCover(cv, pos); }
  function exportCover() {
    const out = document.createElement('canvas');
    out.width = out.height = 1600;
    drawCover(out);
    out.toBlob((b) => download(b, `${slug()}-capa.png`));
  }
  const exportAll = () => busyExport('A preparar o pacote completo…', async () => {
    const files = [];
    const add = (name, data) => files.push({ name, data });
    const enc = new TextEncoder();
    if (hasDrums() || hasLead()) add(`${fileBase()}-completo.mid`, midiBytes('all'));
    if (hasDrums()) add(`midi/${fileBase()}-bateria.mid`, midiBytes('drums'));
    if (hasLead()) add(`midi/${fileBase()}-melodia.mid`, midiBytes('lead'));
    if (bassNotes().length) add(`midi/${fileBase()}-808.mid`, midiBytes('bass'));
    add(`${fileBase()}.wav`, await wavMix());
    if (stemParts().length >= 2) for (const f of await stemFiles('stems/')) files.push(f);
    const cv = document.createElement('canvas'); cv.width = cv.height = 1600; drawCover(cv);
    const png = await new Promise((r) => cv.toBlob(r));
    add(`${slug()}-capa.png`, new Uint8Array(await png.arrayBuffer()));
    add(`${slug()}.beatvox.json`, enc.encode(projectJson()));
    await download(new Blob([BV.zip.store(files)], { type: 'application/zip' }), `${fileBase()}.zip`);
    if (!EMBEDDED) setStatus(`Pacote descarregado: ${files.length} ficheiros.`, 'ok');
  });

  function exportPng() {
    const dpr = window.devicePixelRatio || 1;
    const headW = 150;
    const out = document.createElement('canvas');
    out.width = Math.round((geo.W + headW) * dpr);
    out.height = Math.round(geo.H * dpr);
    const c = out.getContext('2d');
    c.scale(dpr, dpr);
    c.fillStyle = '#0d0f0f';
    c.fillRect(0, 0, headW, geo.H);
    c.textBaseline = 'middle';
    c.fillStyle = T.rulerBeat;
    c.font = '600 12px "Geist", system-ui, sans-serif';
    c.fillText(`BEATVOX · ${isLead() ? 'LEAD' : 'BATERIA'} · ${state.bpm} BPM`, 12, RULER / 2);
    if (!isLead()) {
      DRUMS.forEach((d, i) => {
        const y = RULER + i * ROW;
        c.fillStyle = d.cor; c.fillRect(12, y + 12, 8, ROW - 24);
        c.fillStyle = '#e2d9c5'; c.font = '600 15px "Geist", system-ui, sans-serif';
        c.fillText(d.nome, 28, y + ROW / 2);
        c.fillStyle = '#161b1a'; c.fillRect(0, y, headW, 1);
      });
    } else {
      const L = state.lead;
      for (let p = L.hi; p >= L.lo; p--) {
        const y = RULER + (L.hi - p) * ROW;
        c.fillStyle = isBlack(p) ? '#1f1d21' : '#e6ddc8';
        c.fillRect(0, y, headW, ROW);
        c.fillStyle = '#16171a'; c.fillRect(0, y + ROW - 1, headW, 1);
        if (ROW >= 14 || p % 12 === 0) {
          c.fillStyle = isBlack(p) ? '#8b8578' : '#3b352c';
          c.font = `600 ${Math.min(12, ROW - 3)}px "Geist", system-ui, sans-serif`;
          c.fillText(keyLabel(p), headW - 82, y + ROW / 2);
        }
      }
    }
    c.fillStyle = T.rulerBeat; c.font = '600 12px "Geist", system-ui, sans-serif';
    c.fillText('A TUA VOZ', 12, RULER + geo.rowsN * ROW + LANE / 2);
    c.drawImage(canvas, headW, 0, geo.W, geo.H);
    out.toBlob((b) => download(b, `beatvox-${isLead() ? 'lead' : 'bateria'}-${state.bpm}bpm.png`));
  }

  // ================= V: mistura (palco 3D) =================
  const MX = BV.mix, ST = BV.stage3d;
  const MIXEL = MX.elements();
  const elInfo = (id) => MIXEL.find((e) => e.id === id) || { id, nome: id, cor: '#d8b57a' };
  const fxOf = (id) => state.mix.fx.find((f) => f.id === id);
  /** nome de um efeito: "Reverb", ou "Reverb 2" se houver mais do que um do mesmo tipo */
  function fxName(f) {
    const same = state.mix.fx.filter((x) => x.type === f.type);
    return MX.FX_TYPES[f.type].nome + (same.length > 1 ? ' ' + (same.indexOf(f) + 1) : '');
  }
  const nameOf = (id) => (id === 'master' ? 'Master' : fxOf(id) ? fxName(fxOf(id)) : elInfo(id).nome);
  const colorOf = (id) => (id === 'master' ? '#d8b57a' : fxOf(id) ? MX.FX_TYPES[fxOf(id).type].cor : elInfo(id).cor);

  /** 808: uma nota em cada bombo, no tom da melodia (segue a nota da melodia que estiver a tocar) */
  function bassNotes() {
    if (!state.mix.bassOn) return [];
    const n = totalSteps();
    const kicks = state.drums.notes.filter((x) => x.drum === 'kick' && x.step < n).sort((a, b) => a.step - b.step);
    if (!kicks.length) return [];
    const lead = [...state.lead.notes].sort((a, b) => a.step - b.step);
    const root = state.lead.segs.length || lead.length ? leadRoot() : 9;
    const pcAt = (s) => {
      let cur = null;
      for (const x of lead) { if (x.step <= s) cur = x; else break; }
      if (!cur && lead.length) cur = lead[0];
      return cur ? ((cur.pitch % 12) + 12) % 12 : root;
    };
    return kicks.map((k, i) => {
      const nx = i + 1 < kicks.length ? kicks[i + 1].step : n + kicks[0].step;
      let p = 24 + pcAt(k.step);
      if (p < 28) p += 12; // entre Mi1 e Ré#2: grave mas ainda audível em colunas pequenas
      return { step: k.step, len: Math.max(1, Math.min(nx - k.step, stepsPerBeat() * 2)), pitch: p, vel: k.vel };
    });
  }

  // ---- perfis de espetro: cada som renderizado sozinho → energia por banda e centro de frequência ----
  const profiles = new Map(); // id → { key, share, centroid }
  let profTimer = 0, profBusy = false;
  function elNotes(id) {
    if (id === 'lead') return { lead: state.lead.notes, leadFx: leadFxNow() };
    if (id === 'bass') return { bass: bassNotes() };
    if (id === 'vdrums' || id === 'vlead') {
      const R = id === 'vdrums' ? state.drums : state.lead;
      return matches(R.rec) ? { voices: [{ rec: R.rec, offset: bar1Of(R.rec) / R.rec.sr, kind: id }] } : null;
    }
    return { drums: state.drums.notes.filter((x) => x.drum === id) };
  }
  function visibleEls() {
    return MIXEL.filter((e) => {
      const o = elNotes(e.id);
      if (!o) return false;
      return (o.drums && o.drums.length) || (o.lead && o.lead.length) || (o.bass && o.bass.length) || (o.voices && o.voices.length);
    }).map((e) => e.id);
  }
  function profKey(id) {
    const e = state.mix.els[id], o = elNotes(id);
    const src = id === 'lead' ? state.lead.preset + ':' + (state.slots.lead || '') : id === 'bass' ? state.slots.bass || '' : DRUMS.some((d) => d.id === id) ? state.slots[id] || state.kit : 0;
    return JSON.stringify([e.eq, e.p, state.bpm, state.grid, state.bars, src, o && (o.drums || o.lead || o.bass || []).map((x) => x.step + ':' + (x.pitch || 0))]);
  }
  function scheduleProfiles() {
    clearTimeout(profTimer);
    profTimer = setTimeout(updateProfiles, 220);
  }
  async function updateProfiles() {
    if (profBusy) { scheduleProfiles(); return; }
    profBusy = true;
    try {
      for (const id of visibleEls()) {
        const key = profKey(id), old = profiles.get(id);
        if (old && old.key === key) continue;
        // só este som, no centro, sem efeitos: interessa a forma do espetro
        const mix = JSON.parse(JSON.stringify(state.mix));
        for (const k in mix.els) Object.assign(mix.els[k], { mute: k !== id, solo: false, vol: 0, pan: 0, dry: true, sends: {} });
        const r = await engine.render({ bpm: state.bpm, stepsPerBeat: stepsPerBeat(), totalSteps: totalSteps(), loops: 1, leadPreset: state.lead.preset, mix, raw: true, master: false, preroll: false, sounds: soundsNow(), ...elNotes(id) });
        const pr = MX.spectrumProfile(r.channels, r.sr);
        if (pr) profiles.set(id, { key, ...pr });
        mixNodes();
      }
    } catch (e) { console.warn('BeatVox: perfil de espetro', e); }
    profBusy = false;
    refreshPresence();
  }
  /** atualiza só o espetro no painel (sem redesenhar os controlos, que podem estar a ser arrastados) */
  function refreshPresence() {
    const box = $('mixInsp');
    if (!mixSel || mixSel.includes('>') || fxOf(mixSel) || box.hidden) return;
    const pr = profiles.get(mixSel), old = box.querySelector('.presence, .mx-pres-wait'), hint = box.querySelector('.mx-centro');
    if (old) old.outerHTML = presenceHtml(mixSel);
    if (hint && pr) hint.textContent = centroTxt(pr);
  }

  // ---- conflitos de frequência ----
  const zOfVol = (db) => (Math.max(-30, Math.min(6, db)) + 30) / 36 * 2 - 1;
  /** em que passos cada som está a soar (para saber se dois sons tocam ao mesmo tempo) */
  function activity(id) {
    const n = totalSteps(), a = new Uint8Array(n), o = elNotes(id);
    if (!o) return a;
    if (o.voices) { a.fill(1); return a; }
    const ring = Math.max(1, stepsPerBeat() / 2), len = { kick: 2, snare: 2, clap: 2, hat: 1, openhat: 3 };
    for (const x of o.drums || []) for (let k = 0; k < Math.round((len[x.drum] || 1) * ring); k++) a[(x.step + k) % n] = 1;
    for (const x of (o.lead || []).concat(o.bass || [])) for (let k = 0; k < x.len; k++) a[(x.step + k) % n] = 1;
    return a;
  }
  const bandShare = (pr, b, i) => (b.of ? b.of.reduce((t, j) => t + pr.share[j], 0) : pr.share[i]);
  /** dois sons com muita energia na mesma camada, perto um do outro no palco e a tocar ao mesmo tempo */
  function findConflicts(ids) {
    const bands = state.mix.dims === 6 ? MX.BANDS6 : MX.BANDS3, out = [];
    const anySolo = ids.some((id) => state.mix.els[id].solo);
    const live = ids.filter((id) => {
      const e = state.mix.els[id];
      return profiles.get(id) && !e.mute && (!anySolo || e.solo) && (e.dry !== false || Object.values(e.sends).some((v) => v > 0.005));
    });
    const act = new Map(live.map((id) => [id, activity(id)]));
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const A = live[i], B = live[j], ea = state.mix.els[A], eb = state.mix.els[B];
      const d = Math.hypot((ea.pan - eb.pan) * 1.5, (zOfVol(ea.vol) - zOfVol(eb.vol)) * 1.35);
      if (d > 0.6) continue;
      const xa = act.get(A), xb = act.get(B);
      let both = 0, na = 0, nb = 0;
      for (let k = 0; k < xa.length; k++) { na += xa[k]; nb += xb[k]; both += xa[k] & xb[k]; }
      const co = both / Math.max(1, Math.min(na, nb));
      if (co < 0.5) continue;
      bands.forEach((b, bi) => {
        const sa = bandShare(profiles.get(A), b, bi), sb = bandShare(profiles.get(B), b, bi);
        if (sa < 0.35 || sb < 0.35) return;
        out.push({ a: A, b: B, band: bi, nome: b.nome, sev: Math.min(1, Math.min(sa, sb) * co * (1 - d / 0.6) * 2.5) });
      });
    }
    return out;
  }
  let mixConflicts = [];

  // ---- nós e ligações do palco ----
  /** posição dos efeitos: atrás e por cima das camadas, ou onde os arrastaste */
  function fxPos(f, i, n) {
    let h = 0; for (const ch of f.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const y = 2.4 + (h % 3) * 0.16;
    if (f.pos) return { x: f.pos.x, y, z: f.pos.z };
    return { x: n === 1 ? -2.05 : -2.05 + 4.1 * (i / (n - 1)), y, z: -1.5 - (i % 2) * 0.3 };
  }
  const hasOut = (e) => e.dry !== false || Object.values(e.sends).some((v) => v > 0.005);
  function mixNodes() {
    if (!ST) return;
    const ids = visibleEls();
    const anySolo = ids.some((id) => state.mix.els[id].solo);
    ST.bands = state.mix.dims === 6 ? MX.BANDS6 : MX.BANDS3;
    ST.nodes = ids.map((id) => {
      const e = state.mix.els[id], info = elInfo(id), pr = profiles.get(id);
      return {
        id, nome: info.nome, cor: info.cor, vol: e.vol, pan: e.pan,
        muted: e.mute || (anySolo && !e.solo), dry: e.dry !== false, silent: !hasOut(e),
        share: pr ? pr.share : null, centroid: pr ? pr.centroid : { kick: 70, bass: 70, snare: 1500, clap: 1600, hat: 9000, openhat: 8500, lead: 900 }[id] || 1000,
        sends: { ...e.sends },
      };
    });
    const n = state.mix.fx.length;
    ST.fx = state.mix.fx.map((f, i) => ({ id: f.id, nome: fxName(f), cor: MX.FX_TYPES[f.type].cor, p: fxPos(f, i, n), on: f.on, out: f.out }));
    mixConflicts = findConflicts(ids);
    ST.conflicts = mixConflicts;
    ST.empty = ids.length ? '' : 'Grava a bateria ou a melodia para as veres aqui.';
  }
  const pctTxt = (v) => Math.round(v * 100) + '%';
  const dbTxt = (v) => (v > 0 ? '+' : '') + (Math.round(v * 10) / 10).toString().replace('.', ',') + ' dB';
  const panTxt = (v) => (Math.abs(v) < 0.02 ? 'centro' : (v < 0 ? 'E ' : 'D ') + Math.round(Math.abs(v) * 100));
  /** ligações: "som>master" (saída direta), "som>efeito" (envio), "efeito>destino" */
  function edgeValid(key) {
    const [a, b] = key.split('>');
    const f = fxOf(a);
    if (f) return f.out === b || (b === 'master' && !fxOf(f.out));
    const e = state.mix.els[a];
    if (!e || !visibleEls().includes(a)) return false;
    return b === 'master' ? e.dry !== false : (e.sends[b] || 0) > 0.005 && !!fxOf(b);
  }
  function unlink(key) {
    const [a, b] = key.split('>');
    const f = fxOf(a);
    if (f) { f.out = 'master'; return; }
    const e = state.mix.els[a];
    if (!e) return;
    if (b === 'master') e.dry = false; else delete e.sends[b];
  }
  if (ST) {
    ST.getLevel = (id) => (engine.mixer && engine.playing ? engine.mixer.level(id) : 0);
    ST.onSelect = (id) => { selectMix(id); };
    ST.onSelectEdge = (key) => { selectMix(key); };
    ST.onDrag = (id, pan, vol) => {
      const e = state.mix.els[id];
      if (!e) return;
      e.pan = pan; e.vol = vol;
      mixChanged(false);
      if (mixSel === id) syncInspValues();
    };
    ST.onDragEnd = () => persist();
    ST.onMoveFx = (id, x, z) => {
      const f = fxOf(id);
      if (!f) return;
      f.pos = { x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100 };
      mixNodes(); clearTimeout(persistT); persistT = setTimeout(persist, 400);
    };
    ST.onConnect = (from, to) => {
      const f = fxOf(from);
      if (f) {
        if (!MX.canRoute(state.mix, from, to)) { setStatus('Essa ligação fazia um ciclo: o som voltava ao mesmo efeito.', 'err'); return; }
        f.out = to;
        setStatus(`${fxName(f)} → ${nameOf(to)}.`, 'ok');
      } else {
        const e = state.mix.els[from];
        if (!e) return;
        if (to === 'master') e.dry = true;
        else if (!((e.sends[to] || 0) > 0.005)) e.sends[to] = 0.5;
        setStatus(`${nameOf(from)} → ${nameOf(to)}${to === 'master' ? ' (saída direta)' : ': envio a ' + pctTxt(e.sends[to])}.`, 'ok');
      }
      mixChanged(false);
      selectMix(from + '>' + to);
    };
    ST.onToggle = (id) => {
      const f = fxOf(id);
      if (f) { f.on = !f.on; setStatus(`${fxName(f)} ${f.on ? 'ligado' : 'desligado'}.`); }
      else if (state.mix.els[id]) { const e = state.mix.els[id]; e.mute = !e.mute; restartIfPlaying(); setStatus(`${nameOf(id)} ${e.mute ? 'em mudo' : 'de volta à mistura'}.`); }
      mixChanged(false); renderInsp();
    };
    ST.onPreset = (name) => syncViewSeg(name);
    ST.describe = (id) => {
      const f = fxOf(id);
      if (f) {
        const ins = visibleEls().filter((k) => (state.mix.els[k].sends[id] || 0) > 0.005).map(nameOf);
        return [fxName(f) + (f.on ? '' : ' (desligado)'), ins.length ? 'Recebe: ' + ins.join(', ') : 'Ainda ninguém lhe envia som', 'Saída: ' + nameOf(f.out), 'Duplo clique: ' + (f.on ? 'desligar' : 'ligar')];
      }
      const e = state.mix.els[id];
      if (!e) return null;
      const sends = Object.entries(e.sends).filter(([k, v]) => v > 0.005 && fxOf(k)).map(([k, v]) => `${nameOf(k)} ${pctTxt(v)}`);
      const cf = mixConflicts.filter((k) => k.a === id || k.b === id).map((k) => `Disputa os ${k.nome.toLowerCase()} com ${nameOf(k.a === id ? k.b : k.a)}`);
      return [nameOf(id) + (e.mute ? ' (mudo)' : ''), `${dbTxt(e.vol)} · ${panTxt(e.pan)}`, (e.dry === false ? 'Sem saída direta' : 'Saída direta') + (sends.length ? ' · ' + sends.join(' · ') : ''), ...cf, 'Duplo clique: ' + (e.mute ? 'tirar do mudo' : 'silenciar')];
    };
    ST.describeEdge = (key) => {
      const [a, b] = key.split('>'), e = state.mix.els[a];
      const what = fxOf(a) ? 'Saída do efeito' : b === 'master' ? 'Saída direta' : 'Envio ' + pctTxt(e ? e.sends[b] || 0 : 0);
      return [`${nameOf(a)} → ${nameOf(b)}`, what, 'Clica para ajustar ou desligar'];
    };
  }
  let mixSel = null, persistT = 0;
  function selectMix(id) {
    mixSel = id;
    closeFxMenu();
    renderInsp();
  }
  function mixChanged(reprofile) {
    engine.setMix(state.mix, state.bpm);
    clearTimeout(persistT); persistT = setTimeout(persist, 400);
    mixNodes();
    if (reprofile) scheduleProfiles();
  }

  // ---- painel de ajustes (só aparece com um som, um efeito ou uma ligação escolhidos) ----
  function sliderRow(k, nome, min, max, step, val, txt) {
    return `<label class="mx-row"><span class="mx-l">${nome}</span><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${val}" aria-label="${nome.replace(/<[^>]*>/g, '')}" /><output data-o="${k}">${txt}</output></label>`;
  }
  const dot = (id) => `<i style="--c:${colorOf(id)}"></i>`;
  const closeBtn = '<button class="mx-close icon-btn" data-close title="Fechar (Esc)" aria-label="Fechar"><svg><use href="#i-x"/></svg></button>';
  function presenceHtml(id) {
    const pr = profiles.get(id), bands = state.mix.dims === 6 ? MX.BANDS6 : MX.BANDS3;
    if (!pr) return '<p class="hint mx-pres-wait">A medir o espetro…</p>';
    const shares = bands.map((b, i) => bandShare(pr, b, i));
    const max = Math.max(...shares, 1e-9);
    return `<div class="presence" style="--n:${bands.length}">${bands.map((b, i) => {
      const lit = Math.round((shares[i] / max) * 8);
      return `<div class="pcol" title="${b.nome}: ${Math.round(shares[i] * 100)}%"><div class="pleds">${Array.from({ length: 8 }, (_, k) => `<i class="${k < lit ? 'on' : ''}"></i>`).join('')}</div><span>${b.nome.replace('Médios-graves', 'M-graves')}</span></div>`;
    }).join('')}</div>`;
  }
  function paramRow(prefix, q, v) {
    if (q.kind === 'seg') return `<div class="mx-row"><span class="mx-l">${q.nome}</span><div class="seg" data-seg="${prefix}${q.id}">${q.opts.map(([ov, n]) => `<button data-v="${ov}" class="${String(v) === String(ov) ? 'on' : ''}">${n}</button>`).join('')}</div></div>`;
    if (q.kind === 'toggle') return `<div class="mx-row"><span class="mx-l">${q.nome}</span><label class="switch mx-sw"><input type="checkbox" data-k="${prefix}${q.id}" ${v ? 'checked' : ''} aria-label="${q.nome}" /><i></i></label></div>`;
    return sliderRow(prefix + q.id, q.nome, q.min, q.max, q.step, v, q.fmt(v));
  }
  function renderInsp() {
    const box = $('mixInsp');
    if (!box) return;
    if (mixSel && (mixSel.includes('>') ? !edgeValid(mixSel) : !fxOf(mixSel) && !visibleEls().includes(mixSel))) mixSel = null;
    const was = !box.hidden;
    box.hidden = !mixSel;
    if (ST) { ST.selected = mixSel && !mixSel.includes('>') ? mixSel : null; ST.selEdge = mixSel && mixSel.includes('>') ? mixSel : null; }
    if (was !== !box.hidden) setTimeout(mixView, 0);
    if (!mixSel) { box.innerHTML = ''; return; }
    if (mixSel.includes('>')) renderEdgeInsp(box);
    else if (fxOf(mixSel)) renderFxInsp(box);
    else renderElInsp(box);
  }
  const centroTxt = (pr) => `Centro em ${pr.centroid >= 1000 ? (pr.centroid / 1000).toFixed(1).replace('.', ',') + ' kHz' : Math.round(pr.centroid) + ' Hz'}. Presença em cada dimensão:`;
  function renderElInsp(box) {
    const id = mixSel, e = state.mix.els[id], info = elInfo(id), pr = profiles.get(id);
    const params = MX.PARAMS[id] || [];
    const voiceNote = id === 'vdrums' || id === 'vlead' ? '<p class="hint">A tua gravação. Começa fora da mistura: tira o "M" (ou faz duplo clique no nó) para a juntares ao beat.</p>' : '';
    const cf = mixConflicts.filter((k) => k.a === id || k.b === id);
    const cfHtml = cf.map((k) => {
      const other = k.a === id ? k.b : k.a;
      return `<div class="mx-warn"><p><b>Disputa os ${k.nome.toLowerCase()} com ${nameOf(other)}.</b> Tocam ao mesmo tempo e estão no mesmo sítio do palco.</p>
        <div class="mx-warn-btns"><button class="btn small ghost" data-fix="eq" data-band="${k.band}">Cortar ${k.nome.toLowerCase()} −4 dB</button><button class="btn small ghost" data-fix="pan" data-other="${other}">Afastar no pan</button></div></div>`;
    }).join('');
    const fxRows = state.mix.fx.map((f) => sliderRow('send.' + f.id, `${dot(f.id)}${fxName(f)}`, 0, 1, 0.01, e.sends[f.id] || 0, pctTxt(e.sends[f.id] || 0))).join('');
    box.innerHTML = `<div class="mx-title">${dot(id)}<b>${info.nome}</b>
        <span class="mx-ms"><button class="ms ${e.mute ? 'on' : ''}" data-mute="${id}" title="Silenciar (M)">M</button><button class="ms ${e.solo ? 'on solo' : ''}" data-solo="${id}" title="Solo (S)">S</button></span>${closeBtn}</div>
      ${cfHtml}
      <p class="hint mx-centro">${pr ? centroTxt(pr) : ''}</p>
      ${presenceHtml(id)}${voiceNote}
      <div class="mx-sec">${sliderRow('vol', 'Volume', -30, 6, 0.5, e.vol, dbTxt(e.vol))}${sliderRow('pan', 'Pan', -1, 1, 0.01, e.pan, panTxt(e.pan))}</div>
      <div class="mx-sec"><span class="g-label">EQ</span>${['Graves', 'Médios', 'Agudos'].map((n, i) => sliderRow('eq' + i, n, -12, 12, 0.5, e.eq[i], dbTxt(e.eq[i]))).join('')}</div>
      ${params.length || id === 'lead' ? `<div class="mx-sec"><span class="g-label">Som</span>${id === 'lead'
        ? `<div class="mx-row"><span class="mx-l">Timbre</span><div class="select mx-sel"><select id="mxPreset" aria-label="Timbre da melodia">${presetOptions()}</select></div></div>`
        : params.map((q) => sliderRow('p.' + q.id, q.nome, q.min, q.max, q.step, e.p[q.id], q.fmt(e.p[q.id]))).join('')}
        ${SND.SLOTS.includes(id) ? `<div class="mx-src"><span>${LIB.get(state.slots[id]) ? 'Sample' : 'Origem'}: <b>${esc(soundName(id))}</b></span><button class="btn small ghost" data-lib title="Escolher outro kit ou um sample teu">Biblioteca</button></div>` : ''}</div>` : ''}
      <div class="mx-sec"><span class="g-label">Saídas</span>
        <div class="mx-row"><span class="mx-l">${dot('master')}Master</span><label class="switch mx-sw" title="Saída direta para o master. Desliga-a para o som só se ouvir através dos efeitos."><input type="checkbox" data-k="dry" ${e.dry !== false ? 'checked' : ''} aria-label="Saída direta para o master" /><i></i></label></div>
        ${fxRows}
        <button class="btn small ghost mx-add" data-addfor="${id}">+ Efeito para este som</button>
        ${!hasOut(e) ? '<p class="hint mx-err">Sem saída: este som não se ouve. Liga a saída direta ou envia-o para um efeito.</p>' : ''}
      </div>`;
  }
  function renderFxInsp(box) {
    const f = fxOf(mixSel), T = MX.FX_TYPES[f.type];
    const targets = ['master', ...state.mix.fx.filter((x) => x.id !== f.id && MX.canRoute(state.mix, f.id, x.id)).map((x) => x.id)];
    const ins = visibleEls();
    box.innerHTML = `<div class="mx-title">${dot(f.id)}<b>${fxName(f)}</b>${closeBtn}</div>
      <p class="hint">${T.dica}</p>
      <div class="mx-row"><span class="mx-l">Ligado</span><label class="switch mx-sw" title="Ligar ou desligar (duplo clique no nó)"><input type="checkbox" data-k="fxon" ${f.on ? 'checked' : ''} aria-label="Ligado" /><i></i></label></div>
      <div class="mx-sec">${T.params.map((q) => paramRow('fxp.', q, f.p[q.id])).join('')}</div>
      <div class="mx-sec"><span class="g-label">Entradas</span>
        ${ins.map((id) => sliderRow('in.' + id, `${dot(id)}${nameOf(id)}`, 0, 1, 0.01, state.mix.els[id].sends[f.id] || 0, pctTxt(state.mix.els[id].sends[f.id] || 0))).join('') || '<p class="hint">Ainda não há sons.</p>'}
        <p class="hint">Ou arrasta o <b>+</b> de um som até este efeito.</p>
      </div>
      <div class="mx-sec"><span class="g-label">Saída</span>
        <div class="seg mx-outs" data-out>${targets.map((t) => `<button data-v="${t}" class="${f.out === t ? 'on' : ''}">${nameOf(t)}</button>`).join('')}</div>
      </div>
      <button class="btn small ghost mx-remove" data-rmfx="${f.id}">Remover efeito</button>`;
  }
  function renderEdgeInsp(box) {
    const [a, b] = mixSel.split('>'), f = fxOf(a), e = state.mix.els[a];
    let body;
    if (f) body = `<p class="hint">A saída de ${fxName(f)} vai para ${nameOf(b)}. Arrasta o <b>+</b> do efeito para outro efeito para os encadear.</p>`;
    else if (b === 'master') body = `<p class="hint">Saída direta do som para o master. Desliga-a para o som só se ouvir através dos efeitos (como num insert).</p>`;
    else body = `<div class="mx-sec">${sliderRow('edge', 'Envio', 0, 1, 0.01, e.sends[b] || 0, pctTxt(e.sends[b] || 0))}</div><p class="hint">Quanto deste som vai para ${nameOf(b)} (depois do volume e do pan).</p>`;
    const canUnlink = !(f && b === 'master');
    box.innerHTML = `<div class="mx-title mx-edge">${dot(a)}<b>${nameOf(a)}</b><span class="arrow">→</span>${dot(b)}<b>${nameOf(b)}</b>${closeBtn}</div>
      ${body}
      <div class="mx-btns">
        ${canUnlink ? `<button class="btn small" data-unlink>Desligar</button>` : ''}
        <button class="btn small ghost" data-sel="${a}">Abrir ${nameOf(a)}</button>
        ${b !== 'master' ? `<button class="btn small ghost" data-sel="${b}">Abrir ${nameOf(b)}</button>` : ''}
      </div>`;
  }
  function syncInspValues() {
    const box = $('mixInsp');
    if (!box || !mixSel || !state.mix.els[mixSel]) return;
    const e = state.mix.els[mixSel];
    const set = (k, v, txt) => { const i = box.querySelector(`[data-k="${k}"]`), o = box.querySelector(`[data-o="${k}"]`); if (i) i.value = v; if (o) o.textContent = txt; };
    set('vol', e.vol, dbTxt(e.vol)); set('pan', e.pan, panTxt(e.pan));
  }
  $('mixInsp').addEventListener('input', (e) => {
    const k = e.target.dataset.k;
    if (!k || e.target.type === 'checkbox') return;
    const v = +e.target.value, out = $('mixInsp').querySelector(`[data-o="${k}"]`);
    let reprofile = false, txt = pctTxt(v);
    const el = state.mix.els[mixSel], f = fxOf(mixSel);
    if (k.startsWith('fxp.') && f) {
      const q = MX.FX_TYPES[f.type].params.find((x) => 'fxp.' + x.id === k);
      f.p[q.id] = v; txt = q.fmt(v);
    } else if (k.startsWith('in.') && f) {
      const src = state.mix.els[k.slice(3)];
      if (src) { if (v > 0) src.sends[f.id] = v; else delete src.sends[f.id]; }
    } else if (k === 'edge') {
      const [a, b] = mixSel.split('>');
      if (state.mix.els[a]) state.mix.els[a].sends[b] = v;
    } else if (el) {
      if (k === 'vol') { el.vol = v; txt = dbTxt(v); }
      else if (k === 'pan') { el.pan = v; txt = panTxt(v); }
      else if (k.startsWith('eq')) { el.eq[+k[2]] = v; txt = dbTxt(v); reprofile = true; }
      else if (k.startsWith('send.')) { const id = k.slice(5); if (v > 0) el.sends[id] = v; else delete el.sends[id]; }
      else if (k.startsWith('p.')) { const q = (MX.PARAMS[mixSel] || []).find((x) => 'p.' + x.id === k); el.p[q.id] = v; txt = q.fmt(v); reprofile = true; }
    }
    if (out) out.textContent = txt;
    mixChanged(reprofile);
  });
  $('mixInsp').addEventListener('change', (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    if (e.target.type === 'checkbox') {
      const on = e.target.checked, f = fxOf(mixSel);
      if (k === 'dry' && state.mix.els[mixSel]) state.mix.els[mixSel].dry = on;
      else if (k === 'fxon' && f) f.on = on;
      else if (k.startsWith('fxp.') && f) f.p[k.slice(4)] = on ? 1 : 0;
      mixChanged(false);
    }
    renderInsp();
  });
  $('mixInsp').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const f = fxOf(mixSel);
    if (b.dataset.close != null) { selectMix(null); return; }
    if (b.dataset.sel) { selectMix(b.dataset.sel); return; }
    if (b.dataset.mute) { const el = state.mix.els[b.dataset.mute]; el.mute = !el.mute; mixChanged(false); restartIfPlaying(); renderInsp(); return; }
    if (b.dataset.solo) { const el = state.mix.els[b.dataset.solo]; el.solo = !el.solo; mixChanged(false); renderInsp(); return; }
    if (b.dataset.addfor) { openFxMenu(b.dataset.addfor, b); return; }
    if (b.dataset.rmfx) { const name = fxName(fxOf(b.dataset.rmfx)); MX.removeFx(state.mix, b.dataset.rmfx); mixChanged(false); selectMix(null); setStatus(`${name} removido.`); return; }
    if (b.dataset.unlink != null) { unlink(mixSel); const [a] = mixSel.split('>'); mixChanged(false); selectMix(a); setStatus('Ligação desligada.'); return; }
    if (b.dataset.fix) {
      const el = state.mix.els[mixSel];
      if (b.dataset.fix === 'eq') {
        const bi = +b.dataset.band, idx = state.mix.dims === 6 ? [0, 0, 1, 1, 2, 2][bi] : bi;
        el.eq[idx] = Math.max(-12, el.eq[idx] - 4);
        mixChanged(true);
      } else {
        const o = state.mix.els[b.dataset.other], side = el.pan <= o.pan ? -1 : 1;
        el.pan = Math.max(-1, Math.min(1, (Math.abs(el.pan) < 0.3 ? 0.35 : Math.abs(el.pan)) * side));
        if (Math.abs(o.pan) < 0.3) o.pan = -0.35 * side;
        mixChanged(false);
      }
      renderInsp(); return;
    }
    const seg = b.closest('[data-seg]');
    if (seg && f) {
      const pid = seg.dataset.seg.replace(/^fxp\./, ''), q = MX.FX_TYPES[f.type].params.find((x) => x.id === pid);
      const o = q && q.opts.find((x) => String(x[0]) === b.dataset.v);
      if (o) { f.p[pid] = o[0]; mixChanged(false); renderInsp(); }
      return;
    }
    if (b.closest('[data-out]') && f) {
      const to = b.dataset.v;
      if (MX.canRoute(state.mix, f.id, to)) { f.out = to; mixChanged(false); renderInsp(); }
      return;
    }
    if (b.dataset.lib != null) { openLib(mixSel); return; }
  });

  // ---- acrescentar efeitos ----
  const fxMenu = $('fxMenu'), btnAddFx = $('btnAddFx');
  let addFor = null;
  fxMenu.innerHTML = MX.FX_ORDER.map((t) => { const T = MX.FX_TYPES[t]; return `<button role="menuitem" data-add="${t}"><i style="--c:${T.cor}"></i><b>${T.nome}</b><span>${T.dica}</span></button>`; }).join('');
  function openFxMenu(forId = null, anchor = btnAddFx) {
    addFor = forId;
    fxMenu.hidden = false;
    btnAddFx.setAttribute('aria-expanded', 'true');
    fxMenu.classList.toggle('from-insp', anchor !== btnAddFx);
    fxMenu.style.left = ''; fxMenu.style.bottom = '';
    if (anchor !== btnAddFx) { // aberto a partir do painel: aparece por cima do botão que o abriu
      const r = anchor.getBoundingClientRect(), host = fxMenu.offsetParent.getBoundingClientRect(), mw = fxMenu.offsetWidth;
      const vx = Math.max(16, Math.min(r.right - mw, innerWidth - mw - 16));
      fxMenu.style.left = (vx - host.left) + 'px';
      fxMenu.style.bottom = (host.bottom - r.top + 6) + 'px';
    }
    const full = state.mix.fx.length >= MX.MAX_FX;
    fxMenu.querySelectorAll('button').forEach((b) => (b.disabled = full));
    if (!full) fxMenu.querySelector('button').focus();
  }
  function closeFxMenu() {
    if (fxMenu.hidden) return;
    fxMenu.hidden = true;
    btnAddFx.setAttribute('aria-expanded', 'false');
  }
  btnAddFx.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!fxMenu.hidden) { closeFxMenu(); return; }
    const sel = mixSel && state.mix.els[mixSel] ? mixSel : null;
    openFxMenu(sel);
  });
  fxMenu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-add]');
    if (!b) return;
    e.stopPropagation();
    const f = MX.addFx(state.mix, b.dataset.add);
    closeFxMenu();
    if (!f) { setStatus(`Já tens ${MX.MAX_FX} efeitos. Remove um para acrescentar outro.`, 'err'); return; }
    if (addFor && state.mix.els[addFor]) state.mix.els[addFor].sends[f.id] = 0.5;
    mixChanged(false);
    selectMix(f.id);
    setStatus(addFor ? `${fxName(f)} acrescentado e ligado a ${nameOf(addFor)}.` : `${fxName(f)} acrescentado. Arrasta o + de um som até ele para o ligar.`, 'ok');
  });
  document.addEventListener('click', (e) => { if (!fxMenu.hidden && !fxMenu.contains(e.target)) closeFxMenu(); });

  // ---- vistas ----
  function syncViewSeg(name) { $('viewSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === name)); }
  $('viewSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || !ST) return;
    ST.setPreset(b.dataset.v); syncViewSeg(b.dataset.v);
  });

  // ---- teclado no palco: setas escolhem o nó seguinte, Esc fecha, Delete apaga, M/S mudo e solo ----
  function mixKey(e) {
    if (!BV.flow || BV.flow.active !== 4) return false;
    if (e.target.closest && e.target.closest('input, select, textarea, [contenteditable]')) return false;
    if (e.key === 'Escape') { if (!fxMenu.hidden) closeFxMenu(); else selectMix(null); return true; }
    if (!mixSel) return false;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (mixSel.includes('>')) { unlink(mixSel); const [a] = mixSel.split('>'); mixChanged(false); selectMix(a); return true; }
      if (fxOf(mixSel)) { const name = fxName(fxOf(mixSel)); MX.removeFx(state.mix, mixSel); mixChanged(false); selectMix(null); setStatus(`${name} removido.`); return true; }
      return false;
    }
    const el = state.mix.els[mixSel];
    if (el && (e.key === 'm' || e.key === 'M')) { el.mute = !el.mute; mixChanged(false); restartIfPlaying(); renderInsp(); return true; }
    if (el && (e.key === 's' || e.key === 'S')) { el.solo = !el.solo; mixChanged(false); renderInsp(); return true; }
    return false;
  }
  $('stage3d').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const ids = visibleEls().concat(state.mix.fx.map((f) => f.id));
      if (!ids.length) return;
      const i = ids.indexOf(mixSel), d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
      selectMix(ids[i < 0 ? (d > 0 ? 0 : ids.length - 1) : (i + d + ids.length) % ids.length]);
      setStatus(nameOf(mixSel) + ' selecionado.');
    }
  });

  // zona livre para o palco: entre o título, a barra de baixo e o painel da direita (se estiver aberto)
  function mixView() {
    if (!ST) return;
    const cv = $('stage3d'), r = cv.getBoundingClientRect();
    if (!r.width) return;
    const head = document.querySelector('.mix-head').getBoundingClientRect(), bar = document.querySelector('.mix-bar').getBoundingClientRect(), insp = $('mixInsp');
    const narrow = innerWidth <= 860;
    const ir = insp.hidden ? null : insp.getBoundingClientRect();
    const right = ir && ir.width ? ir.left - r.left - 10 : document.querySelector('.mix-next').getBoundingClientRect().right - r.left - 20;
    ST.setView(narrow ? { x0: 0, y0: head.bottom - r.top, x1: r.width, y1: bar.top - r.top }
      : { x0: head.left - r.left - 40, y0: head.bottom - r.top - 10, x1: right, y1: bar.top - r.top - 6 });
  }
  addEventListener('resize', () => setTimeout(mixView, 50));
  function mixRefresh() {
    setTimeout(mixView, 0);
    mixNodes();
    renderInsp();
    $('bassOn').checked = state.mix.bassOn;
    $('dimsSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.v === state.mix.dims));
    syncViewSeg(ST ? ST.preset : 'free');
    scheduleProfiles();
  }
  $('dimsSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    state.mix.dims = +b.dataset.v; persist(); mixRefresh();
  });
  $('bassOn').addEventListener('change', (e) => { state.mix.bassOn = e.target.checked; persist(); mixRefresh(); restartIfPlaying(); refresh(); });
  $('autoRot').addEventListener('change', (e) => { if (ST) ST.auto = e.target.checked; });
  $('zoomIn').addEventListener('click', () => ST && ST.zoom(0.88));
  $('zoomOut').addEventListener('click', () => ST && ST.zoom(1.14));
  $('btnMixReset').addEventListener('click', () => {
    const keep = { bassOn: state.mix.bassOn, dims: state.mix.dims };
    state.mix = Object.assign(MX.defaultState(), keep);
    mixSel = null;
    mixChanged(true); renderInsp();
    if (ST) ST.resetView();
    setStatus('Mistura reposta: volumes, pan, EQ, sons e efeitos voltaram ao início.', 'ok');
  });
  engine.setMix(state.mix, state.bpm);

  // ================= efeitos da voz (UI) =================
  function renderFx() {
    const L = state.lead, on = state.fxOn;
    $('fxGrid').innerHTML = V.FX.map((d) => `<button type="button" class="fx-chip${on[d.id] ? ' on' : ''}" data-fx="${d.id}" aria-pressed="${!!on[d.id]}" title="${d.dica} MIDI: ${d.midi}." style="--c:${d.cor}"><i></i>${d.nome}</button>`).join('');
    $('fxAll').checked = Object.values(on).some(Boolean);
    const nCal = V.CAL.filter((x) => state.voiceCal[x.id]).length;
    $('fxHint').textContent = !L.rec && !L.fx
      ? 'Grava a melodia: os efeitos seguem a forma como cantas (rasgado, com ar, vogais, vibrato…).'
      : nCal === 0 ? 'Sem calibração: uso valores médios. Calibra a tua voz para os efeitos te seguirem melhor.'
      : nCal < V.CAL.length ? `Calibração parcial (${nCal} de ${V.CAL.length}). As restantes usam valores médios.`
      : 'Calibrado com a tua voz. As linhas por baixo do piano roll mostram cada efeito.';
    $('btnVoiceCal').textContent = nCal ? 'Recalibrar a voz' : 'Calibrar a voz';
  }
  function renderCalRows() {
    $('calRows').innerHTML = V.CAL.map((x) => {
      const ok = !!state.voiceCal[x.id];
      return `<div class="trow"><span class="sw" style="background:var(--gold);color:var(--gold)"></span>
        <div><div class="n">${x.nome}</div><div class="h">${x.dica}</div></div>
        <span class="c ${ok ? 'ok' : ''}">${ok ? 'calibrado' : 'por gravar'}</span>
        <span><button type="button" class="cap" data-cal="${x.id}">${ok ? 'Regravar' : 'Gravar'}</button></span></div>`;
    }).join('');
  }
  $('fxGrid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-fx]');
    if (!b) return;
    state.fxOn[b.dataset.fx] = !state.fxOn[b.dataset.fx];
    persist(); renderFx(); draw(engine.playing ? engine.position() : undefined); restartIfPlaying();
  });
  $('fxAll').addEventListener('change', (e) => {
    for (const d of V.FX) state.fxOn[d.id] = e.target.checked;
    persist(); renderFx(); draw(engine.playing ? engine.position() : undefined); restartIfPlaying();
  });
  $('calRows').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-cal]');
    if (!b) return;
    const dlg = $('calDlg');
    dlg.close();
    await doRecord('voicecal', b.dataset.cal);
    renderCalRows();
    dlg.showModal();
  });
  $('btnCalReset').addEventListener('click', () => {
    state.voiceCal = {};
    store.set('bv.voicecal', state.voiceCal);
    renderCalRows(); analyzeLead(); refresh();
  });
  $('btnVoiceCal').addEventListener('click', () => { renderCalRows(); $('calDlg').showModal(); });

  // ================= treino (bateria) =================
  const trainedCount = () => Object.values(state.training).filter((v) => v && v.length).length;
  function renderTrainState() {
    const el = $('trainState');
    const t = DRUMS.filter((d) => state.training[d.id] && state.training[d.id].length);
    if (t.length >= 2) el.textContent = 'Treinado com a tua voz: ' + t.map((d) => `${d.nome.split(' ')[0]} (${state.training[d.id].length})`).join(', ') + '.';
    else if (t.length === 1) el.textContent = 'Só 1 peça treinada — treina pelo menos mais uma. Até lá uso regras automáticas.';
    else el.textContent = 'A comparar os teus sons entre si: o mais grave é o bombo, o mais agudo o hi-hat.';
  }
  function renderTrainRows() {
    $('trainRows').innerHTML = DRUMS.map((d) => {
      const n = (state.training[d.id] || []).length;
      return `<div class="trow"><span class="sw" style="background:${d.cor};color:${d.cor}"></span>
        <div><div class="n">${d.nome}</div><div class="h">${d.dica}</div></div>
        <span class="c ${n ? 'ok' : ''}">${n ? n + ' exemplos' : 'sem treino'}</span>
        <span><button type="button" class="cap" data-train="${d.id}">${n ? 'Regravar' : 'Gravar exemplos'}</button>
        ${n ? `<button type="button" class="cap ghost mini" data-untrain="${d.id}" aria-label="Apagar exemplos de ${d.nome}"><svg><use href="#i-x"/></svg></button>` : ''}</span></div>`;
    }).join('');
  }
  $('trainRows').addEventListener('click', async (e) => {
    const t = e.target.closest('[data-train]'), u = e.target.closest('[data-untrain]');
    if (t) {
      const dlg = $('trainDlg');
      dlg.close();
      await doRecord('train', t.dataset.train);
      dlg.showModal();
    } else if (u) {
      delete state.training[u.dataset.untrain];
      store.set('bv.training', state.training);
      renderTrainRows(); analyzeDrums(); refresh();
    }
  });
  $('btnTrainReset').addEventListener('click', () => {
    state.training = {};
    store.set('bv.training', state.training);
    renderTrainRows(); analyzeDrums(); refresh();
  });
  $('btnTrain').addEventListener('click', () => { renderTrainRows(); $('trainDlg').showModal(); });

  // ================= sons: kits, instrumentos e biblioteca =================
  function presetOptions() {
    const smp = LIB.get(state.slots.lead);
    return SND.LEADS.map((x) => `<option value="${x.id}"${x.id === state.lead.preset ? ' selected' : ''}>${x.id === 'sample' ? (smp ? 'O teu sample: ' + esc(smp.name) : 'O teu sample…') : x.nome}</option>`).join('');
  }
  function kitHint() {
    const k = SND.KITS.find((x) => x.id === state.kit) || SND.KITS[0];
    const own = DRUMS.filter((d) => LIB.get(state.slots[d.id])).length;
    return k.dica + (own ? ` ${own === DRUMS.length ? 'Todas as peças' : own === 1 ? '1 peça' : own + ' peças'} com samples teus.` : '');
  }
  $('kitSel').innerHTML = SND.KITS.map((k) => `<option value="${k.id}">${k.nome}</option>`).join('');
  /** um compasso curto para ouvires o kit */
  function demoKit() {
    if (engine.playing) return; // a tocar já se ouve o kit novo
    const c = engine.ensureCtx(), t0 = c.currentTime + 0.06, sd = 60 / 96 / 4;
    [['kick', 0], ['hat', 2], ['snare', 4], ['hat', 6], ['kick', 8], ['kick', 10], ['hat', 10], ['snare', 12], ['openhat', 14]]
      .forEach(([d, k]) => engine.playDrum(d, t0 + k * sd, d === 'kick' || d === 'snare' ? 115 : 85));
  }
  $('kitSel').addEventListener('change', (e) => {
    state.kit = e.target.value;
    applySounds();
    demoKit();
    setStatus(`Kit ${(SND.KITS.find((k) => k.id === state.kit) || {}).nome}: ${kitHint()}`, 'ok');
  });
  /** o motor passa a tocar os sons escolhidos (kit + samples); o palco volta a medir o espetro */
  function applySounds() {
    for (const k of Object.keys(state.slots)) if (!LIB.get(state.slots[k])) delete state.slots[k];
    if (state.lead.preset === 'sample' && !state.slots.lead) state.lead.preset = 'synth';
    engine.setSounds(soundsNow());
    persist(); syncControls(); scheduleProfiles();
    if (mixSel && !mixSel.includes('>')) renderInsp();
  }

  const SLOT_INFO = () => DRUMS.map((d) => ({ id: d.id, nome: d.nome.replace(/ \(.*\)/, ''), cor: d.cor }))
    .concat([{ id: 'bass', nome: '808 (baixo)', cor: '#c9895b' }, { id: 'lead', nome: 'Melodia', cor: LEAD_COLOR }]);
  const CATS = [['kick', 'Bombo'], ['snare', 'Tarola'], ['clap', 'Palmas'], ['hat', 'Hi-hat fechado'], ['openhat', 'Hi-hat aberto'], ['bass', '808 / baixo'], ['lead', 'Melodia'], ['other', 'Outro']];
  const slotName = (id) => (SLOT_INFO().find((x) => x.id === id) || { nome: id }).nome;
  function openLib(focus = null) {
    renderLib();
    if (!$('libDlg').open) $('libDlg').showModal();
    if (focus) { const sel = $('libRows').querySelector(`[data-slot="${focus}"]`); if (sel) sel.focus(); }
    LIB.init().then(() => { if ($('libDlg').open) renderLib(); });
  }
  function renderLib() {
    const items = LIB.items, kit = (SND.KITS.find((k) => k.id === state.kit) || SND.KITS[0]).nome;
    $('libState').textContent = !LIB.stored ? 'Este browser não deixa guardar samples: ficam só até fechares a página.'
      : items.length ? `${items.length} ${items.length === 1 ? 'sample guardado' : 'samples guardados'} neste browser. Escolhe abaixo o som de cada lugar.`
      : 'Ainda não tens samples. Até lá, cada lugar usa os sons sintetizados.';
    $('libRows').innerHTML = SLOT_INFO().map((sl) => {
      const cur = state.slots[sl.id] || '', melodic = sl.id === 'bass' || sl.id === 'lead';
      const mine = items.filter((it) => it.cat === sl.id), rest = items.filter((it) => it.cat !== sl.id);
      const opt = (it) => `<option value="${it.id}"${it.id === cur ? ' selected' : ''}>${esc(it.name)}${melodic && it.root != null ? ' · ' + P.noteName(it.root, true) : ''}</option>`;
      const synth = sl.id === 'lead' ? 'Instrumento sintetizado' : sl.id === 'bass' ? '808 sintetizado' : 'Kit ' + kit;
      return `<div class="trow lrow"><span class="sw" style="background:${sl.cor};color:${sl.cor}"></span>
        <div class="n">${sl.nome}</div>
        <div class="select"><select data-slot="${sl.id}" aria-label="Som para ${sl.nome}"><option value="">${synth}</option>${mine.length ? `<optgroup label="${sl.nome}">${mine.map(opt).join('')}</optgroup>` : ''}${rest.length ? `<optgroup label="Outros samples">${rest.map(opt).join('')}</optgroup>` : ''}</select></div>
        <button type="button" class="cap mini" data-hear="${sl.id}" aria-label="Ouvir ${sl.nome}" title="Ouvir"><svg><use href="#i-play"/></svg></button></div>`;
    }).join('');
    $('libCount').textContent = items.length;
    $('libAll').hidden = !items.length;
    $('libItems').innerHTML = items.map((it) => `<div class="litem"><span class="ln" title="${esc(it.path || it.name)}">${esc(it.name)}</span>
      <div class="select"><select data-cat="${it.id}" aria-label="Tipo de ${esc(it.name)}">${CATS.map(([v, n]) => `<option value="${v}"${it.cat === v ? ' selected' : ''}>${n}</option>`).join('')}</select></div>
      <button type="button" class="cap mini" data-hearitem="${it.id}" aria-label="Ouvir ${esc(it.name)}" title="Ouvir"><svg><use href="#i-play"/></svg></button>
      <button type="button" class="cap mini ghost" data-rm="${it.id}" aria-label="Apagar ${esc(it.name)}" title="Apagar"><svg><use href="#i-x"/></svg></button></div>`).join('');
    $('btnLibClear').disabled = !items.length;
  }
  function hearSlot(id) {
    const c = engine.ensureCtx(), t = c.currentTime + 0.03;
    if (id === 'lead') previewLead(60 + 12 * state.lead.octave);
    else if (id === 'bass') engine.playBass(36, t, 0.7, 110);
    else engine.playDrum(id, t, 110);
  }
  async function importFiles(entries) {
    if (!entries.length) return;
    $('libState').textContent = `A importar ${entries.length} ${entries.length === 1 ? 'ficheiro' : 'ficheiros'}…`;
    let res;
    try { res = await LIB.add(entries, (i, n) => { $('libState').textContent = `A importar… ${i + 1} de ${n}`; }); }
    catch (err) { console.error(err); $('libState').textContent = 'Não consegui importar esses ficheiros.'; return; }
    const { added, skipped } = res;
    // um pacote novo entra logo: cada lugar recebe o primeiro sample do pacote que lhe corresponde
    const placed = [];
    for (const sl of SND.SLOTS) {
      const it = added.filter((x) => x.cat === sl).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))[0];
      if (it) { state.slots[sl] = it.id; placed.push(`${slotName(sl)}: ${it.name}`); }
    }
    applySounds();
    renderLib();
    const msg = added.length
      ? `${added.length} ${added.length === 1 ? 'sample importado' : 'samples importados'}` + (placed.length ? ` (${placed.join(' · ')})` : '') + (skipped.length ? `. ${skipped.length} ignorados (não são áudio ou não se leem).` : '.')
        + (state.slots.lead && state.lead.preset !== 'sample' && placed.some((x) => x.startsWith('Melodia')) ? ' Para a melodia, escolhe "O teu sample" no Som.' : '')
      : `Nenhum sample importado${skipped.length ? `: ${skipped.length} ficheiros não são áudio ou não se leem` : ''}.`;
    $('libState').textContent = msg;
    setStatus(msg, added.length ? 'ok' : 'err');
  }
  $('btnLib').addEventListener('click', () => openLib());
  $('btnLibFiles').addEventListener('click', () => $('libIn').click());
  $('btnLibFolder').addEventListener('click', () => $('libDirIn').click());
  for (const id of ['libIn', 'libDirIn']) $(id).addEventListener('change', (e) => {
    const fs = [...(e.target.files || [])].map((f) => ({ file: f, path: f.webkitRelativePath || f.name }));
    e.target.value = '';
    importFiles(fs);
  });
  const drop = $('libDrop');
  $('libDlg').addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  $('libDlg').addEventListener('dragleave', (e) => { if (!$('libDlg').contains(e.relatedTarget)) drop.classList.remove('over'); });
  $('libDlg').addEventListener('drop', async (e) => {
    e.preventDefault(); drop.classList.remove('over');
    importFiles(await SND.fromDrop(e.dataTransfer));
  });
  $('libRows').addEventListener('change', (e) => {
    const slot = e.target.dataset.slot;
    if (!slot) return;
    if (e.target.value) state.slots[slot] = e.target.value; else delete state.slots[slot];
    if (slot === 'lead') state.lead.preset = e.target.value ? 'sample' : state.lead.preset === 'sample' ? 'synth' : state.lead.preset;
    applySounds();
    restartIfPlaying();
    hearSlot(slot);
  });
  $('libRows').addEventListener('click', (e) => { const b = e.target.closest('[data-hear]'); if (b) hearSlot(b.dataset.hear); });
  $('libItems').addEventListener('change', async (e) => {
    const id = e.target.dataset.cat;
    if (!id) return;
    await LIB.update(id, { cat: e.target.value });
    renderLib();
  });
  $('libItems').addEventListener('click', async (e) => {
    const h = e.target.closest('[data-hearitem]'), r = e.target.closest('[data-rm]');
    if (h) { const it = LIB.get(h.dataset.hearitem), c = engine.ensureCtx(); if (it) SND.playSample(c, it.buf, c.currentTime + 0.02, engine.master, { gain: 0.8 }); }
    if (r) { await LIB.remove(r.dataset.rm); applySounds(); renderLib(); }
  });
  $('btnLibClear').addEventListener('click', async () => {
    if (!confirm('Apagar todos os samples da biblioteca deste browser?')) return;
    await LIB.clear(); state.slots = {}; applySounds(); renderLib();
    setStatus('Biblioteca apagada. Voltaste aos sons sintetizados.');
  });
  $('libDlg').addEventListener('close', () => refresh());
  // os samples guardados carregam em segundo plano; quando chegarem, entram no som
  engine.setSounds(soundsNow());
  LIB.init().then(() => { engine.setSounds(soundsNow()); syncControls(); scheduleProfiles(); });

  // ================= ligações =================
  document.querySelectorAll('#view button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.v)));
  document.querySelectorAll('[data-bpm]').forEach((b) => b.addEventListener('click', () => setBpm(state.bpm + +b.dataset.bpm)));
  $('bpm').addEventListener('change', (e) => setBpm(e.target.value));
  document.querySelectorAll('#bars button').forEach((b) => b.addEventListener('click', () => setBars(+b.dataset.v)));
  document.querySelectorAll('#grid button').forEach((b) => b.addEventListener('click', () => setGrid(+b.dataset.v)));
  function setMetronome(on) {
    state.metronome = on;
    persist(); syncControls(); updateButtons();
    if (!on && engine.playing && !hasDrums() && !hasLead()) stopPlay();
    setStatus(on ? 'Metrónomo ligado: ouves o clique a tocar e a gravar.' : 'Metrónomo desligado (a contagem antes de gravar continua).');
  }
  $('metronome').addEventListener('change', (e) => setMetronome(e.target.checked));
  $('btnClick').addEventListener('click', () => setMetronome(!state.metronome));
  $('btnMetro').addEventListener('click', () => {
    if (engine.playing) { stopPlay(); return; }
    if (!state.metronome) setMetronome(true);
    startPlay();
  });
  $('headphones').addEventListener('change', (e) => {
    state.headphones = e.target.checked; persist();
    if (!state.headphones) setStatus('Sem auscultadores: ligo o cancelamento de eco, mas a deteção fica menos precisa.');
  });
  $('withVoice').addEventListener('change', (e) => { state.withVoice = e.target.checked; restartIfPlaying(); });
  let sensT;
  $('sens').addEventListener('input', (e) => {
    state.sensitivity = +e.target.value / 100;
    $('sensOut').textContent = e.target.value + '%';
    clearTimeout(sensT);
    sensT = setTimeout(() => { persist(); analyzeAll(); refresh(); }, 150);
  });
  let latT;
  $('lat').addEventListener('input', (e) => {
    state.latencyMs = +e.target.value;
    $('latOut').textContent = e.target.value + ' ms';
    clearTimeout(latT);
    latT = setTimeout(() => { persist(); analyzeAll(); refresh(); }, 100);
  });
  $('btnLatAuto').addEventListener('click', () => { state.latencyMs = null; persist(); analyzeAll(); refresh(); });
  $('btnCal').addEventListener('click', () => doRecord('calibrate'));
  $('btnRec').addEventListener('click', () => doRecord('pattern'));
  $('btnOpen').addEventListener('click', () => $('fileIn').click());
  $('btnOpenLead').addEventListener('click', () => $('fileIn').click());
  $('btnRecLead').addEventListener('click', () => doRecord('pattern'));
  $('fileIn').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f || state.busy) return;
    stopPlay();
    state.busy = true; updateButtons();
    setStatus('A ler ' + f.name + '…');
    try {
      const ctx = engine.ensureCtx();
      const buf = await ctx.decodeAudioData(await f.arrayBuffer());
      // 150 ms de silêncio à frente: um som logo no início do ficheiro também conta como ataque
      const pad = Math.round(buf.sampleRate * 0.15);
      const n = buf.length, samples = new Float32Array(n + pad);
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < n; i++) samples[pad + i] += d[i] / buf.numberOfChannels;
      }
      // o primeiro tempo do compasso é o primeiro som do ficheiro
      BV.normalizeAudio(samples);
      const on = BV.dsp.detectOnsets(samples, buf.sampleRate, { sensitivity: 0.5 });
      const bar1Sample = on.length ? Math.max(0, on[0].sample - Math.round(buf.sampleRate * 0.005)) : 0;
      cur().rec = { samples, sr: buf.sampleRate, bar1Sample, bpm: state.bpm, bars: state.bars, imported: true };
      if (isLead()) {
        analyzeLead();
        setStatus(state.lead.segs.length ? `${f.name}: ${state.lead.segs.length} notas, tom ${P.NOMES[state.lead.detected.root]} ${MODE_PT[state.lead.detected.mode]}.` : `Não encontrei notas em ${f.name}.`, state.lead.segs.length ? 'ok' : 'err');
      } else {
        analyzeDrums();
        setStatus(state.drums.hits.length ? `${f.name}: ${state.drums.hits.length} golpes, ${state.drums.notes.length} notas na grelha.` : `Não encontrei golpes em ${f.name}.`, state.drums.hits.length ? 'ok' : 'err');
      }
    } catch (err) {
      console.error(err);
      setStatus('Não consegui ler esse ficheiro. Usa WAV, MP3, M4A ou OGG.', 'err');
    } finally {
      state.busy = false;
      refresh();
    }
  });
  $('btnPlay').addEventListener('click', togglePlay);
  $('btnMidiDrums').addEventListener('click', () => exportMidi('drums'));
  $('btnMidiLead').addEventListener('click', () => exportMidi('lead'));
  $('btnMidiAll').addEventListener('click', () => exportMidi('all'));
  $('btnPng').addEventListener('click', exportPng);
  $('btnWav').addEventListener('click', exportWav);
  $('btnStems').addEventListener('click', exportStems);
  $('btnCover').addEventListener('click', exportCover);
  $('btnAll').addEventListener('click', exportAll);
  $('btnSaveProj').addEventListener('click', saveProject);
  $('btnOpenProj').addEventListener('click', () => $('projIn').click());
  $('projIn').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) openProject(f); });
  $('btnCoverPlay').addEventListener('click', togglePlay);
  $('projName').addEventListener('input', (e) => { state.name = e.target.value; persist(); renderCover(engine.playing ? engine.position() : null); });
  $('loopsSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    state.loops = +b.dataset.v; persist(); refresh();
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => renderCover());
  $('btnClear').addEventListener('click', () => {
    stopPlay();
    if (isLead()) Object.assign(state.lead, { notes: [], segs: [], curve: [], rec: null, fx: null });
    else Object.assign(state.drums, { notes: [], hits: [], rec: null });
    fitRange();
    refresh();
    setStatus(isLead() ? 'Lead limpo.' : 'Bateria limpa.');
  });

  // lead
  $('keySel').addEventListener('change', (e) => {
    state.lead.keySetting = e.target.value === 'auto' ? 'auto' : +e.target.value;
    persist(); if (state.lead.segs.length) quantizeLead(); refresh(); restartIfPlaying();
  });
  $('scaleSel').addEventListener('change', (e) => {
    state.lead.scale = e.target.value;
    persist(); if (state.lead.segs.length) quantizeLead(); refresh(); restartIfPlaying();
  });
  document.querySelectorAll('[data-oct]').forEach((b) => b.addEventListener('click', () => {
    const L = state.lead, d = +b.dataset.oct;
    if (L.octave + d < -3 || L.octave + d > 3) return;
    L.octave += d;
    for (const n of L.notes) n.pitch += 12 * d;
    fitRange();
    persist(); refresh(); restartIfPlaying();
  }));
  function setPreset(v) {
    if (v === 'sample' && !LIB.get(state.slots.lead)) { syncControls(); openLib('lead'); return; }
    state.lead.preset = v;
    persist(); syncControls(); restartIfPlaying(); scheduleProfiles();
    if (mixSel === 'lead') renderInsp();
    previewLead(60 + 12 * state.lead.octave);
  }
  $('presetSel').addEventListener('change', (e) => setPreset(e.target.value));
  $('mixInsp').addEventListener('change', (e) => { if (e.target.id === 'mxPreset') setPreset(e.target.value); });
  $('btnLibLead').addEventListener('click', () => openLib('lead'));
  $('overBeat').addEventListener('change', (e) => { state.lead.overBeat = e.target.checked; persist(); });

  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input[type=number], input[type=text], select, textarea') || $('trainDlg').open || $('calDlg').open) return;
    if (mixKey(e)) { e.preventDefault(); return; }
    if (e.code === 'Space') { e.preventDefault(); if (!$('btnPlay').disabled || engine.playing) togglePlay(); }
    else if (e.key === 'r' || e.key === 'R') doRecord('pattern');
    else if (e.key === '1') BV.flow ? BV.flow.go(2) : setView('drums');
    else if (e.key === '2') BV.flow ? BV.flow.go(3) : setView('lead');
  });
  window.addEventListener('resize', layout);

  // arranque
  const keySel = $('keySel');
  keySel.innerHTML = '<option value="auto">Auto</option>' + P.NOMES.map((n, i) => `<option value="${i}">${n} (${['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][i]})</option>`).join('');
  $('scaleSel').innerHTML = '<option value="auto">Auto</option>' + Object.entries(P.SCALES).map(([id, s]) => `<option value="${id}">${s.nome}</option>`).join('');
  fitRange();
  refresh();
  // o canvas desenha texto com as fontes do painel: redesenha quando estiverem carregadas
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => layout());
  // duplo clique no botão da latência volta ao automático
  const latKnob = document.querySelector('#lat') && document.querySelector('#lat').previousElementSibling;
  if (latKnob && latKnob.classList.contains('knob')) latKnob.addEventListener('dblclick', (e) => { e.stopImmediatePropagation(); $('btnLatAuto').click(); }, true);
  if (oldTrainingDropped) setStatus('O reconhecimento da bateria foi melhorado: volta a treinar a tua voz no movimento III.', 'err');
  else if (EMBEDDED) {
    setStatus('Nesta página usa Abrir áudio. Para gravar com o microfone, abre a versão do zip.');
  } else if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus('Este browser não dá acesso ao microfone aqui. Abre com o iniciar (servidor local) em Chrome/Edge/Firefox.', 'err');
  }

  // ---------- microfone: escolher e testar ----------
  let micRaf = 0, micPeakHold = 0, micTesting = false;
  async function fillMics() {
    try {
      const mics = await engine.listMics();
      const sel = $('micSel'), cur = engine.deviceId || '';
      if (!mics.length) return;
      sel.innerHTML = '<option value="">Microfone predefinido</option>' + mics.filter((m) => m.deviceId && m.deviceId !== 'default')
        .map((m, i) => `<option value="${m.deviceId}">${(m.label || 'Microfone ' + (i + 1)).replace(/</g, '&lt;')}</option>`).join('');
      sel.value = cur;
    } catch (e) {}
  }
  function stopMicTest() {
    if (!micTesting) return;
    micTesting = false;
    cancelAnimationFrame(micRaf);
    engine.stopMonitor();
    $('btnMicTest').querySelector('span').textContent = 'Testar';
    $('micMeter').style.transform = 'scaleX(0)';
  }
  async function startMicTest() {
    try {
      await engine.startMonitor(state.headphones);
    } catch (err) {
      setStatus(err && err.name === 'NotAllowedError'
        ? (EMBEDDED ? 'O microfone não está disponível nesta página. Usa a versão do zip.' : 'Sem acesso ao microfone. Autoriza-o no browser (ícone do cadeado).')
        : 'Não consegui abrir o microfone.', 'err');
      return;
    }
    micTesting = true;
    $('btnMicTest').querySelector('span').textContent = 'Parar';
    fillMics();
    let t0 = performance.now(), maxSeen = 0;
    const loop = () => {
      if (!micTesting) return;
      const l = engine.micLevel();
      micPeakHold = Math.max(l, micPeakHold * 0.93);
      maxSeen = Math.max(maxSeen, l);
      $('micMeter').style.transform = `scaleX(${Math.min(1, micPeakHold * 1.6).toFixed(3)})`;
      if (performance.now() - t0 > 1500) {
        $('micHint').textContent = maxSeen < 0.03 ? 'Muito baixo: aproxima-te do microfone ou escolhe outro.'
          : maxSeen > 0.95 ? 'A saturar: afasta-te um pouco do microfone.'
          : 'Bom nível. Já podes gravar.';
      }
      micRaf = requestAnimationFrame(loop);
    };
    loop();
  }
  $('btnMicTest').addEventListener('click', () => (micTesting ? stopMicTest() : startMicTest()));
  $('micSel').addEventListener('change', async (e) => {
    engine.deviceId = e.target.value || '';
    try { localStorage.setItem('bv.mic', engine.deviceId); } catch (er) {}
    if (micTesting) { stopMicTest(); startMicTest(); }
  });
  try { engine.deviceId = localStorage.getItem('bv.mic') || ''; } catch (e) {}
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) navigator.mediaDevices.addEventListener('devicechange', fillMics);
  fillMics();

  // ---------- marcar o tempo (tap tempo) ----------
  let taps = [];
  $('btnTap').addEventListener('click', () => {
    const now = performance.now();
    taps = taps.filter((t) => now - t < 2500);
    taps.push(now);
    const b = $('btnTap');
    b.classList.add('flash'); setTimeout(() => b.classList.remove('flash'), 120);
    engine.ensureCtx(); engine.click(engine.ctx.currentTime + 0.005, false, 0.7);
    if (taps.length >= 3) {
      const iv = [];
      for (let i = 1; i < taps.length; i++) iv.push(taps[i] - taps[i - 1]);
      iv.sort((x, y) => x - y);
      const med = iv[Math.floor(iv.length / 2)];
      setBpm(60000 / med);
      setStatus(`Andamento medido: ${state.bpm} BPM (${taps.length} toques).`, 'ok');
    } else setStatus('Continua a tocar ao ritmo…');
  });

  // ---------- ligação ao fluxo de passos ----------
  if (BV.eq) {
    BV.eq.getSpectrum = (n) => (engine.ctx ? engine.spectrum(n) : null);
    BV.eq.getRect = () => { const sl = document.querySelector('.studio-slot[data-slot="2"]'); return sl && sl.firstElementChild ? sl.getBoundingClientRect() : null; };
  }
  if (BV.scene) BV.scene.getLevel = () => (engine.ctx ? engine.level() : 0);
  if (BV.scene && BV.scene.ok) document.body.classList.add('webgl');
  const studio = $('studio');
  function placeStudio(step) {
    const slot = document.querySelector(`.studio-slot[data-slot="${step}"]`);
    if (slot && studio.parentNode !== slot) slot.appendChild(studio);
  }
  if (BV.flow) {
    BV.flow.onStep = (i) => {
      if (i !== 1) stopMicTest();
      if (i === 2 || i === 3) {
        placeStudio(i);
        const v = i === 3 ? 'lead' : 'drums';
        if (state.view !== v) setView(v); else layout();
      } else if (i === 4) { refresh(); mixRefresh(); setTimeout(mixView, 800); }
      else if (i === 5) refresh();
    };
    // posição inicial do estúdio
    placeStudio(state.view === 'lead' ? 3 : 2);
    BV.flow.onStep(BV.flow.active);
  } else placeStudio(2);
  layout();

  // ganchos para testes
  window.BV.app = { state, engine, analyzeAll, draw, layout, refresh, setView };
})();
