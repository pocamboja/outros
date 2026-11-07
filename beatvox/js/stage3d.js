/* BeatVox — palco 3D da mistura (movimento V).
   Cada camada horizontal é uma dimensão do som (graves em baixo, agudos em cima; 3 ou 6 camadas).
   Cada som é um nó: a altura é o seu centro de frequência real, e em cada camada aparece um disco
   do tamanho da sua presença nessa banda. Esquerda-direita é o pan; para a frente (mais perto) é mais alto.
   As ligações levam o som ao master e aos efeitos (reverb, delay), com partículas ao ritmo do nível.
   Canvas 2D com projeção em perspetiva: câmara orbital (arrastar o fundo), zoom (roda), arrastar um nó mexe na mistura. */
(function () {
  const BV = (window.BV = window.BV || {});
  const canvas = document.getElementById('stage3d');
  if (!canvas) return;
  const c = canvas.getContext('2d');
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const S = {
    vis: 0, nodes: [], fx: [], bands: [], selected: null, auto: true, empty: '', view: null,
    getLevel: null, onSelect: null, onDrag: null, onDragEnd: null,
  };
  BV.stage3d = S;

  // ---------- geometria: frequência → altura, mistura → posição ----------
  const F_LO = Math.log2(30), F_HI = Math.log2(16000), YH = 2.7;
  const yOfF = (f) => 0.15 + ((Math.log2(Math.max(30, Math.min(16000, f))) - F_LO) / (F_HI - F_LO)) * YH;
  const XW = 1.5, ZW = 1.35;
  const zOfVol = (db) => (Math.max(-30, Math.min(6, db)) + 30) / 36 * 2 - 1;      // -30 dB → atrás, +6 dB → à frente
  const volOfZ = (z) => Math.round(((Math.max(-1, Math.min(1, z)) + 1) / 2 * 36 - 30) * 2) / 2;
  S.posOf = (n) => ({ x: n.pan * XW, y: yOfF(n.centroid || 1000), z: zOfVol(n.vol) * ZW });

  // ---------- câmara ----------
  let yaw = -0.55, pitch = 0.36, dist = 6.4, W = 0, H = 0, dpr = 1, F = 600, CX = 0, CY = 0;
  // enquadra o palco na zona livre do ecrã (S.view, em px do canvas) — ou no canvas inteiro
  function fit() {
    const v = S.view && S.view.x1 - S.view.x0 > 120 && S.view.y1 - S.view.y0 > 120 ? S.view : { x0: 0, y0: 0, x1: W, y1: H };
    CX = (v.x0 + v.x1) / 2; CY = (v.y0 + v.y1) / 2 - (v.y1 - v.y0) * 0.03;
    F = Math.min((v.x1 - v.x0) / (v.x1 - v.x0 < 520 ? 6.6 : 5.4), (v.y1 - v.y0) / 4.0) * 6.4;
  }
  S.setView = (v) => { S.view = v; fit(); };
  const target = { x: 0, y: 1.45, z: 0 };
  function rot(v) { // mundo → câmara
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const x1 = cy * v.x + sy * v.z, z1 = -sy * v.x + cy * v.z;
    return { x: x1, y: cp * v.y - sp * z1, z: sp * v.y + cp * z1 };
  }
  function unrot(v) { // câmara → mundo
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const y1 = cp * v.y + sp * v.z, z1 = -sp * v.y + cp * v.z;
    return { x: cy * v.x - sy * z1, y: y1, z: sy * v.x + cy * z1 };
  }
  function proj(p) {
    const v = rot({ x: p.x - target.x, y: p.y - target.y, z: p.z - target.z });
    const zc = dist - v.z;
    const k = F / Math.max(0.3, zc);
    return { x: CX + v.x * k, y: CY - v.y * k, k, d: zc };
  }
  function rayPlaneY(sx, sy, y0) {
    const o = unrot({ x: 0, y: 0, z: dist }), d = unrot({ x: (sx - CX) / F, y: -(sy - CY) / F, z: -1 });
    o.x += target.x; o.y += target.y; o.z += target.z;
    if (Math.abs(d.y) < 1e-4) return null;
    const t = (y0 - o.y) / d.y;
    if (t <= 0) return null;
    return { x: o.x + d.x * t, z: o.z + d.z * t };
  }

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    fit();
  }
  addEventListener('resize', resize);

  // ---------- desenho ----------
  const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
  function polyCircle(cx, cy, cz, r, seg = 28) {
    const pts = [];
    for (let i = 0; i < seg; i++) { const a = (i / seg) * Math.PI * 2; pts.push(proj({ x: cx + Math.cos(a) * r, y: cy, z: cz + Math.sin(a) * r })); }
    return pts;
  }
  function path(pts, close = true) { c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); if (close) c.closePath(); }

  const particles = new Map(); // id → [u...]
  let lastT = performance.now(), idleT = 0, layout = [];
  const lv = new Map();

  function frame(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
    if (S.vis > 0.01 && !document.hidden) {
      if (canvas.clientWidth !== W || canvas.clientHeight !== H) resize();
      if (S.auto && !drag && !reduce) { idleT += dt; if (idleT > 2) yaw += dt * 0.06; }
      draw(dt, now / 1000);
    }
    requestAnimationFrame(frame);
  }

  function draw(dt, t) {
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    c.globalAlpha = Math.min(1, S.vis * 1.3);
    const master = { x: 0, y: -0.25, z: 0 };
    // camadas (dimensões)
    const P = 1.75;
    const planes = S.bands.map((b, i) => ({ ...b, i, y: yOfF(Math.sqrt(b.lo * b.hi)), y0: yOfF(b.lo), y1: yOfF(b.hi) }));
    const tint = (i, a) => { const k = planes.length > 1 ? i / (planes.length - 1) : 0; const r = Math.round(140 + 101 * k), g = Math.round(40 + 160 * k), bl = Math.round(60 + 72 * k); return `rgba(${r},${g},${bl},${a})`; };
    for (const pl of planes) {
      const q = [proj({ x: -P, y: pl.y, z: -P }), proj({ x: P, y: pl.y, z: -P }), proj({ x: P, y: pl.y, z: P }), proj({ x: -P, y: pl.y, z: P })];
      const grd = c.createLinearGradient(q[0].x, q[0].y, q[2].x, q[2].y);
      grd.addColorStop(0, tint(pl.i, 0.02)); grd.addColorStop(1, tint(pl.i, 0.09));
      path(q); c.fillStyle = grd; c.fill();
      c.strokeStyle = tint(pl.i, 0.35); c.lineWidth = 1; c.stroke();
      // grelha fina
      c.strokeStyle = tint(pl.i, 0.08);
      for (let g = -1; g <= 1; g += 0.5) {
        const a = proj({ x: g * P, y: pl.y, z: -P }), b = proj({ x: g * P, y: pl.y, z: P });
        c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
        const a2 = proj({ x: -P, y: pl.y, z: g * P }), b2 = proj({ x: P, y: pl.y, z: g * P });
        c.beginPath(); c.moveTo(a2.x, a2.y); c.lineTo(b2.x, b2.y); c.stroke();
      }
      // nome da dimensão no canto
      const lab = proj({ x: -P, y: pl.y, z: P });
      c.fillStyle = tint(pl.i, 0.95);
      c.font = `italic 400 ${Math.max(12, Math.min(18, lab.k * 0.05))}px "Bodoni Moda", Didot, Georgia, serif`;
      c.textAlign = 'right'; c.textBaseline = 'middle';
      c.fillText(pl.nome, lab.x - 10, lab.y);
      c.font = '500 10.5px Geist, system-ui, sans-serif'; c.fillStyle = tint(pl.i, 0.55);
      c.fillText(fmtHz(pl.lo) + '–' + fmtHz(pl.hi), lab.x - 10, lab.y + 15);
    }
    // eixos de leitura: L/R e frente/trás
    c.font = '500 10.5px Geist, system-ui, sans-serif'; c.fillStyle = 'rgba(216,181,122,0.45)'; c.textAlign = 'center';
    const yb = planes.length ? planes[0].y : 0.3;
    const lL = proj({ x: -P - 0.25, y: yb, z: 0 }), lR = proj({ x: P + 0.25, y: yb, z: 0 }), lF = proj({ x: 0, y: yb, z: P + 0.3 }), lB = proj({ x: 0, y: yb, z: -P - 0.3 });
    c.fillText('E', lL.x, lL.y); c.fillText('D', lR.x, lR.y); c.fillText('mais alto', lF.x, lF.y); c.fillText('mais baixo', lB.x, lB.y);

    // nós
    const nodes = S.nodes.map((n) => {
      const p = S.posOf(n);
      const l0 = lv.get(n.id) || 0, l1 = S.getLevel ? S.getLevel(n.id) : 0;
      const l = l1 > l0 ? l0 + (l1 - l0) * 0.6 : l0 + (l1 - l0) * 0.12;
      lv.set(n.id, l);
      return { n, p, s: proj(p), l: Math.min(1, l * 4) };
    });
    const fxs = S.fx.map((f) => {
      const l0 = lv.get(f.id) || 0, l1 = S.getLevel ? S.getLevel(f.id) : 0;
      const l = l0 + (l1 - l0) * 0.15; lv.set(f.id, l);
      return { n: f, p: f.p, s: proj(f.p), l: Math.min(1, l * 6) };
    });
    const ms = proj(master);

    // presença em cada camada (discos) + haste vertical
    for (const o of nodes) {
      if (!o.n.share) continue;
      const present = [];
      planes.forEach((pl) => {
        const sh = pl.of ? pl.of.reduce((s, i) => s + (o.n.share[i] || 0), 0) : o.n.share[pl.i] || 0;
        if (sh < 0.02) return;
        present.push(pl.y);
        const r = 0.05 + 0.32 * Math.sqrt(sh);
        const pts = polyCircle(o.p.x, pl.y, o.p.z, r * (1 + 0.15 * o.l));
        path(pts);
        c.fillStyle = hexA(o.n.cor, (0.08 + 0.32 * sh) * (o.n.muted ? 0.3 : 1) * (S.selected && S.selected !== o.n.id ? 0.5 : 1));
        c.fill();
        c.strokeStyle = hexA(o.n.cor, 0.5 * (o.n.muted ? 0.3 : 1)); c.lineWidth = 1; c.stroke();
      });
      if (present.length) {
        const a = proj({ x: o.p.x, y: Math.min(...present, o.p.y), z: o.p.z }), b = proj({ x: o.p.x, y: Math.max(...present, o.p.y), z: o.p.z });
        c.strokeStyle = hexA(o.n.cor, 0.35); c.lineWidth = 1; c.setLineDash([2, 4]);
        c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); c.setLineDash([]);
      }
    }

    // ligações (grafo): som → master; som → FX (envio); FX → master
    const edge = (a, b, col, w, alpha, id, level) => {
      const mx = (a.x + b.x) / 2, my = Math.max(a.y, b.y) + 30;
      c.strokeStyle = col; c.globalAlpha = Math.min(1, S.vis * 1.3) * alpha; c.lineWidth = w;
      c.beginPath(); c.moveTo(a.x, a.y); c.quadraticCurveTo(mx, my, b.x, b.y); c.stroke();
      // partículas a correr na ligação, mais e mais rápidas com o nível
      let ps = particles.get(id);
      if (!ps) { ps = []; particles.set(id, ps); }
      const want = Math.round(2 + level * 10);
      while (ps.length < want) ps.push(Math.random());
      while (ps.length > want) ps.pop();
      c.fillStyle = col;
      for (let i = 0; i < ps.length; i++) {
        ps[i] = (ps[i] + dt * (0.15 + level * 0.9)) % 1;
        const u = ps[i], x = (1 - u) * (1 - u) * a.x + 2 * (1 - u) * u * mx + u * u * b.x, y = (1 - u) * (1 - u) * a.y + 2 * (1 - u) * u * my + u * u * b.y;
        c.globalAlpha = Math.min(1, S.vis * 1.3) * alpha * (0.4 + 0.6 * level) * Math.sin(u * Math.PI);
        c.beginPath(); c.arc(x, y, 1.2 + level * 1.6, 0, Math.PI * 2); c.fill();
      }
      c.globalAlpha = Math.min(1, S.vis * 1.3);
    };
    for (const o of nodes) {
      if (o.n.muted) continue;
      edge(o.s, ms, hexA(o.n.cor, 0.5), 1, 0.55, o.n.id + '>m', o.l);
      for (const f of fxs) {
        const amt = o.n.sends ? o.n.sends[f.n.id] || 0 : 0;
        if (amt > 0.01) edge(o.s, f.s, hexA(f.n.cor, 0.7), 0.5 + amt * 2.5, 0.2 + amt * 0.8, o.n.id + '>' + f.n.id, o.l * amt);
      }
    }
    for (const f of fxs) edge(f.s, ms, hexA(f.n.cor, 0.5), 1, 0.4, f.n.id + '>m', f.l);

    // master: núcleo dourado
    const pulse = nodes.reduce((m, o) => Math.max(m, o.l), 0);
    const rm = (10 + pulse * 8) * Math.min(1.6, ms.k / 150);
    const gm = c.createRadialGradient(ms.x, ms.y, 0, ms.x, ms.y, rm * 2.4);
    gm.addColorStop(0, 'rgba(255,240,200,0.95)'); gm.addColorStop(0.35, 'rgba(216,181,122,0.55)'); gm.addColorStop(1, 'rgba(216,181,122,0)');
    c.fillStyle = gm; c.beginPath(); c.arc(ms.x, ms.y, rm * 2.4, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#d8b57a'; c.font = 'italic 400 15px "Bodoni Moda", Didot, Georgia, serif'; c.textAlign = 'center'; c.textBaseline = 'top';
    c.fillText('Master', ms.x, ms.y + rm + 6);

    // FX e sons, de trás para a frente
    const all = nodes.map((o) => ({ ...o, fx: false })).concat(fxs.map((o) => ({ ...o, fx: true })));
    all.sort((a, b) => b.s.d - a.s.d);
    layout = [];
    for (const o of all) {
      const r = (o.fx ? 9 : 8 + 3 * Math.sqrt(Math.max(0, (o.n.vol ?? 0) + 30) / 36)) * Math.min(1.8, o.s.k / 140) * (1 + 0.35 * o.l);
      const sel = S.selected === o.n.id, hov = hover === o.n.id;
      const dim = o.n.muted ? 0.3 : S.selected && !sel ? 0.75 : 1;
      c.globalAlpha = Math.min(1, S.vis * 1.3) * dim;
      // brilho
      const g1 = c.createRadialGradient(o.s.x, o.s.y, 0, o.s.x, o.s.y, r * 3.2);
      g1.addColorStop(0, hexA(o.n.cor, 0.55 + 0.4 * o.l)); g1.addColorStop(1, hexA(o.n.cor, 0));
      c.fillStyle = g1; c.beginPath(); c.arc(o.s.x, o.s.y, r * 3.2, 0, Math.PI * 2); c.fill();
      // esfera
      const g2 = c.createRadialGradient(o.s.x - r * 0.35, o.s.y - r * 0.4, r * 0.1, o.s.x, o.s.y, r);
      g2.addColorStop(0, '#fffaf0'); g2.addColorStop(0.35, o.n.cor); g2.addColorStop(1, hexA(o.n.cor, 0.55));
      c.fillStyle = g2; c.beginPath(); c.arc(o.s.x, o.s.y, r, 0, Math.PI * 2); c.fill();
      if (o.fx) { c.strokeStyle = hexA(o.n.cor, 0.9); c.lineWidth = 1; c.beginPath(); c.arc(o.s.x, o.s.y, r + 4, 0, Math.PI * 2); c.stroke(); }
      if (sel || hov) {
        c.strokeStyle = sel ? '#f1dcae' : 'rgba(241,220,174,0.6)'; c.lineWidth = sel ? 1.5 : 1;
        c.beginPath(); c.arc(o.s.x, o.s.y, r + 7 + (sel ? Math.sin(t * 3) * 1.5 : 0), 0, Math.PI * 2); c.stroke();
      }
      // nome
      c.fillStyle = sel ? '#fffaf0' : 'rgba(244,237,225,0.85)';
      c.font = `${sel ? 600 : 500} 12px Geist, system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'top';
      if (!o.n.muted || sel || hov) c.fillText(o.n.nome + (o.n.muted ? ' (mudo)' : ''), o.s.x, o.s.y + r + 6);
      layout.push({ id: o.n.id, x: o.s.x, y: o.s.y, r: Math.max(12, r + 6), fx: o.fx, n: o.n, p: o.p });
    }
    c.globalAlpha = 1;
    if (S.empty) {
      c.fillStyle = 'rgba(244,237,225,0.7)'; c.font = 'italic 400 20px "Bodoni Moda", Didot, Georgia, serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(S.empty, W / 2, H * 0.42);
    }
  }
  const fmtHz = (f) => (f >= 1000 ? (f / 1000).toFixed(f % 1000 ? 1 : 0).replace('.', ',') + ' kHz' : Math.round(f) + ' Hz');

  // ---------- interação ----------
  let drag = null, hover = null;
  const hit = (x, y) => { let best = null, bd = Infinity; for (const l of layout) { const d = Math.hypot(l.x - x, l.y - y); if (d < l.r && d < bd) { bd = d; best = l; } } return best; };
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  canvas.addEventListener('pointerdown', (e) => {
    const p = pos(e), h = hit(p.x, p.y);
    idleT = 0;
    canvas.setPointerCapture(e.pointerId);
    if (h) {
      S.selected = h.id;
      if (S.onSelect) S.onSelect(h.id);
      drag = h.fx ? { kind: 'none' } : { kind: 'node', id: h.id, y0: h.p.y, moved: false };
    } else drag = { kind: 'orbit', x: p.x, y: p.y, yaw, pitch };
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pos(e);
    if (!drag) {
      const h = hit(p.x, p.y);
      hover = h ? h.id : null;
      canvas.style.cursor = h ? (h.fx ? 'pointer' : 'grab') : 'move';
      return;
    }
    idleT = 0;
    if (drag.kind === 'orbit') {
      yaw = drag.yaw + (p.x - drag.x) * 0.006;
      pitch = Math.max(0.05, Math.min(1.25, drag.pitch + (p.y - drag.y) * 0.004));
    } else if (drag.kind === 'node') {
      const w = rayPlaneY(p.x, p.y, drag.y0);
      if (!w) return;
      drag.moved = true;
      canvas.style.cursor = 'grabbing';
      const pan = Math.round(Math.max(-1, Math.min(1, w.x / XW)) * 100) / 100;
      if (S.onDrag) S.onDrag(drag.id, pan, volOfZ(w.z / ZW));
    }
  });
  const end = () => { if (drag && drag.kind === 'node' && drag.moved && S.onDragEnd) S.onDragEnd(drag.id); drag = null; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  // a roda do rato muda de movimento (scroll da página); o zoom é com pinça no trackpad (ctrl + roda) ou com S.zoom()
  canvas.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault(); idleT = 0;
    dist = Math.max(3.6, Math.min(11, dist * (1 + Math.sign(e.deltaY) * 0.08)));
  }, { passive: false });
  S.hits = () => layout;
  S.zoom = (k) => { idleT = 0; dist = Math.max(3.6, Math.min(11, dist * k)); };
  S.resetView = () => { yaw = -0.55; pitch = 0.36; dist = 6.4; idleT = 0; };

  resize();
  requestAnimationFrame(frame);
})();
