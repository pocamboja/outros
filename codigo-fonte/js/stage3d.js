/* BeatVox — palco 3D da mistura (movimento V).
   Cada camada horizontal é uma dimensão do som (graves em baixo, agudos em cima; 3 ou 6 camadas).
   Cada som é um nó: a altura é o seu centro de frequência real, e em cada camada aparece um disco
   do tamanho da sua presença nessa banda. Esquerda-direita é o pan; para a frente (mais perto) é mais alto.
   É também um grafo de sinal: cada som liga ao Master (saída direta) e aos efeitos (envios); cada efeito
   liga ao Master ou a outro efeito. As ligações levam partículas ao ritmo do nível.
   Interação: arrastar o fundo roda a câmara; arrastar um som muda pan e volume; arrastar o "+" de um nó
   até um efeito (ou ao Master) cria uma ligação; clicar numa ligação seleciona-a; duplo clique num nó
   silencia o som ou desliga o efeito; os efeitos arrastam-se para onde quiseres.
   Canvas 2D com projeção em perspetiva. */
(function () {
  const BV = (window.BV = window.BV || {});
  const canvas = document.getElementById('stage3d');
  if (!canvas) return;
  const c = canvas.getContext('2d');
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const S = {
    vis: 0, nodes: [], fx: [], bands: [], conflicts: [], selected: null, selEdge: null, auto: true, empty: '', view: null, preset: 'free',
    getLevel: null, onSelect: null, onSelectEdge: null, onDrag: null, onDragEnd: null, onMoveFx: null, onConnect: null, onToggle: null,
    onPreset: null, describe: null, describeEdge: null,
  };
  BV.stage3d = S;

  // ---------- geometria: frequência → altura, mistura → posição ----------
  const F_LO = Math.log2(30), F_HI = Math.log2(16000), YH = 2.7;
  const yOfF = (f) => 0.15 + ((Math.log2(Math.max(30, Math.min(16000, f))) - F_LO) / (F_HI - F_LO)) * YH;
  const XW = 1.5, ZW = 1.35, FXLIM = 2.6;
  const zOfVol = (db) => (Math.max(-30, Math.min(6, db)) + 30) / 36 * 2 - 1;      // -30 dB → atrás, +6 dB → à frente
  const volOfZ = (z) => Math.round(((Math.max(-1, Math.min(1, z)) + 1) / 2 * 36 - 30) * 2) / 2;
  S.posOf = (n) => ({ x: n.pan * XW, y: yOfF(n.centroid || 1000), z: zOfVol(n.vol) * ZW });
  // o Master fica por baixo do centro; visto de cima passa para a frente das camadas, para não tapar os sons
  const masterPos = () => { const k = Math.max(0, Math.min(1, (pitch - 0.9) / 0.5)); return { x: 0, y: -0.25, z: 2.5 * k * k * (3 - 2 * k) }; };

  // ---------- câmara ----------
  let yaw = -0.55, pitch = 0.36, dist = 6.4, W = 0, H = 0, dpr = 1, F = 600, CX = 0, CY = 0;
  let aim = null; // vista para onde a câmara está a ir (Frente / Cima / Livre)
  const fitT = { CX: 0, CY: 0, F: 600 };
  // enquadra o palco na zona livre do ecrã (S.view, em px do canvas) — ou no canvas inteiro
  function fit(snap) {
    const v = S.view && S.view.x1 - S.view.x0 > 120 && S.view.y1 - S.view.y0 > 120 ? S.view : { x0: 0, y0: 0, x1: W, y1: H };
    fitT.CX = (v.x0 + v.x1) / 2; fitT.CY = (v.y0 + v.y1) / 2 - (v.y1 - v.y0) * 0.03;
    fitT.F = Math.min((v.x1 - v.x0) / (v.x1 - v.x0 < 520 ? 6.6 : 5.4), (v.y1 - v.y0) / 4.0) * 6.4;
    if (snap || reduce) { CX = fitT.CX; CY = fitT.CY; F = fitT.F; }
  }
  S.setView = (v) => { const first = !S.view; S.view = v; fit(first); };
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
    fit(true);
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
  const fmtHz = (f) => (f >= 1000 ? (f / 1000).toFixed(f % 1000 ? 1 : 0).replace('.', ',') + ' kHz' : Math.round(f) + ' Hz');
  const SANS = 'Geist, system-ui, sans-serif', SERIF = '"Bodoni Moda", Didot, Georgia, serif';

  const particles = new Map(); // id da ligação → [u...]
  let lastT = performance.now(), idleT = 0;
  let layout = [], edgeLayout = [], ports = [];
  const lv = new Map();
  let mouse = null; // última posição do rato no canvas

  function frame(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
    if (S.vis > 0.01 && !document.hidden) {
      if (canvas.clientWidth !== W || canvas.clientHeight !== H) resize();
      const ease = reduce ? 1 : 1 - Math.pow(0.0015, dt);
      CX += (fitT.CX - CX) * ease; CY += (fitT.CY - CY) * ease; F += (fitT.F - F) * ease;
      if (aim) {
        let dy = aim.yaw - yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        yaw += dy * ease; pitch += (aim.pitch - pitch) * ease; dist += (aim.dist - dist) * ease;
        if (Math.abs(dy) < 0.002 && Math.abs(aim.pitch - pitch) < 0.002 && Math.abs(aim.dist - dist) < 0.01) { yaw = aim.yaw; pitch = aim.pitch; dist = aim.dist; aim = null; }
      } else if (S.auto && S.preset === 'free' && !drag && !reduce) { idleT += dt; if (idleT > 2) yaw += dt * 0.06; }
      draw(dt, now / 1000);
    }
    requestAnimationFrame(frame);
  }

  /** ponto de controlo da curva de uma ligação (desce para o Master, sobe entre efeitos) */
  const ctrl = (a, b, toMaster) => ({ x: (a.x + b.x) / 2, y: toMaster ? Math.max(a.y, b.y) + 30 : Math.min(a.y, b.y) - 36 });
  const bez = (a, m, b, u) => ({ x: (1 - u) * (1 - u) * a.x + 2 * (1 - u) * u * m.x + u * u * b.x, y: (1 - u) * (1 - u) * a.y + 2 * (1 - u) * u * m.y + u * u * b.y });

  function draw(dt, t) {
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    const A = Math.min(1, S.vis * 1.3);
    c.globalAlpha = A;
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
      c.strokeStyle = tint(pl.i, 0.08);
      for (let g = -1; g <= 1; g += 0.5) {
        const a = proj({ x: g * P, y: pl.y, z: -P }), b = proj({ x: g * P, y: pl.y, z: P });
        c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
        const a2 = proj({ x: -P, y: pl.y, z: g * P }), b2 = proj({ x: P, y: pl.y, z: g * P });
        c.beginPath(); c.moveTo(a2.x, a2.y); c.lineTo(b2.x, b2.y); c.stroke();
      }
      if (pitch > 1.1) continue; // de cima, as camadas sobrepõem-se: os nomes não se leriam
      const lab = proj({ x: -P, y: pl.y, z: P });
      c.fillStyle = tint(pl.i, 0.95);
      c.font = `italic 400 ${Math.max(12, Math.min(18, lab.k * 0.05))}px ${SERIF}`;
      c.textAlign = 'right'; c.textBaseline = 'middle';
      c.fillText(pl.nome, lab.x - 10, lab.y);
      c.font = `500 10.5px ${SANS}`; c.fillStyle = tint(pl.i, 0.55);
      c.fillText(fmtHz(pl.lo) + '–' + fmtHz(pl.hi), lab.x - 10, lab.y + 15);
    }
    // eixos de leitura: E/D e frente/trás
    c.font = `500 10.5px ${SANS}`; c.fillStyle = 'rgba(216,181,122,0.45)'; c.textAlign = 'center';
    const yb = planes.length ? planes[0].y : 0.3;
    const lL = proj({ x: -P - 0.25, y: yb, z: 0 }), lR = proj({ x: P + 0.25, y: yb, z: 0 }), lF = proj({ x: 0, y: yb, z: P + 0.3 }), lB = proj({ x: 0, y: yb, z: -P - 0.3 });
    c.fillText('E', lL.x, lL.y); c.fillText('D', lR.x, lR.y);
    if (pitch > 0.2) { c.fillText('mais alto', lF.x, lF.y); c.fillText('mais baixo', lB.x, lB.y); } // de frente, a profundidade não se vê

    // nós (sons) e efeitos, já projetados
    const nodes = S.nodes.map((n) => {
      const p = S.posOf(n);
      const l0 = lv.get(n.id) || 0, l1 = S.getLevel ? S.getLevel(n.id) : 0;
      const l = l1 > l0 ? l0 + (l1 - l0) * 0.6 : l0 + (l1 - l0) * 0.12;
      lv.set(n.id, l);
      return { n, p, s: proj(p), l: Math.min(1, l * 4), fx: false };
    });
    const radius = (o) => (o.fx ? 9 : 8 + 3 * Math.sqrt(Math.max(0, (o.n.vol ?? 0) + 30) / 36)) * Math.min(1.8, o.s.k / 140) * (1 + 0.35 * o.l);
    for (const o of nodes) o.r = radius(o);
    // sons no mesmo sítio do ecrã afastam-se um pouco (só no desenho), para se verem os dois
    for (let pass = 0; pass < 3; pass++) for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i].s, b = nodes[j].s, dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), min = nodes[i].r + nodes[j].r + 10;
      if (d < min) { const ux = d > 0.5 ? dx / d : 1, uy = d > 0.5 ? dy / d : 0, push = (min - d) / 2; a.x -= ux * push; a.y -= uy * push; b.x += ux * push; b.y += uy * push; }
    }
    const fxs = S.fx.map((f) => {
      const l0 = lv.get(f.id) || 0, l1 = S.getLevel ? S.getLevel(f.id) : 0;
      const l = l0 + (l1 - l0) * 0.15; lv.set(f.id, l);
      const o = { n: f, p: f.p, s: proj(f.p), l: Math.min(1, l * 6), fx: true };
      o.r = radius(o);
      return o;
    });
    const byId = new Map(nodes.concat(fxs).map((o) => [o.n.id, o]));
    const ms = proj(masterPos());

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
    // conflitos: dois sons com muita energia na mesma camada, perto um do outro, a tocar ao mesmo tempo
    for (const k of S.conflicts || []) {
      const a = byId.get(k.a), b = byId.get(k.b), pl = planes[k.band];
      if (!a || !b || !pl) continue;
      const pa = proj({ x: a.p.x, y: pl.y, z: a.p.z }), pb = proj({ x: b.p.x, y: pl.y, z: b.p.z });
      const pulse = 0.55 + 0.35 * Math.sin(t * 4);
      c.strokeStyle = `rgba(255,120,110,${0.55 * pulse + 0.2 * k.sev})`; c.lineWidth = 1.5; c.setLineDash([4, 4]);
      c.beginPath(); c.moveTo(pa.x, pa.y); c.lineTo(pb.x, pb.y); c.stroke(); c.setLineDash([]);
      const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
      c.fillStyle = `rgba(255,120,110,${0.85 * pulse})`; c.beginPath(); c.arc(mx, my, 7, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#1b0b06'; c.font = `700 10px ${SANS}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('!', mx, my + 0.5);
    }

    // ligações (grafo)
    const edges = [];
    for (const o of nodes) {
      if (o.n.dry !== false) edges.push({ key: o.n.id + '>master', a: o, b: null, col: o.n.cor, amt: 1, dim: o.n.muted, level: o.l });
      for (const f of fxs) {
        const amt = o.n.sends ? o.n.sends[f.n.id] || 0 : 0;
        if (amt > 0.005) edges.push({ key: o.n.id + '>' + f.n.id, a: o, b: f, col: f.n.cor, amt, dim: o.n.muted || f.n.on === false, level: o.l * amt });
      }
    }
    for (const f of fxs) {
      const to = f.n.out && f.n.out !== 'master' ? byId.get(f.n.out) : null;
      edges.push({ key: f.n.id + '>' + (to ? to.n.id : 'master'), a: f, b: to, col: f.n.cor, amt: 1, dim: f.n.on === false, level: f.l });
    }
    edgeLayout = [];
    const hovEdge = hover && hover.edge;
    for (const e of edges) {
      const a = e.a.s, b = e.b ? e.b.s : ms, toMaster = !e.b, m = ctrl(a, b, toMaster);
      const sel = S.selEdge === e.key, hov = hovEdge === e.key;
      const base = e.b && !e.a.fx ? 0.2 + e.amt * 0.8 : 0.55;
      const alpha = (e.dim ? 0.18 : base) * (sel || hov ? 1.6 : 1) * (S.selEdge && !sel ? 0.55 : 1);
      const w = (e.b && !e.a.fx ? 0.5 + e.amt * 2.5 : 1) + (sel ? 1.5 : hov ? 0.8 : 0);
      if (sel) { c.save(); c.shadowColor = e.col; c.shadowBlur = 12; }
      c.strokeStyle = hexA(e.col, 0.5 + (sel ? 0.4 : 0)); c.globalAlpha = A * Math.min(1, alpha); c.lineWidth = w;
      c.beginPath(); c.moveTo(a.x, a.y); c.quadraticCurveTo(m.x, m.y, b.x, b.y); c.stroke();
      if (sel) c.restore();
      // partículas a correr na ligação, mais e mais rápidas com o nível
      let ps = particles.get(e.key);
      if (!ps) { ps = []; particles.set(e.key, ps); }
      const want = e.dim ? 0 : Math.round(2 + e.level * 10);
      while (ps.length < want) ps.push(Math.random());
      while (ps.length > want) ps.pop();
      c.fillStyle = hexA(e.col, 0.9);
      for (let i = 0; i < ps.length; i++) {
        ps[i] = (ps[i] + dt * (0.15 + e.level * 0.9)) % 1;
        const u = ps[i], q = bez(a, m, b, u);
        c.globalAlpha = A * Math.min(1, alpha) * (0.4 + 0.6 * e.level) * Math.sin(u * Math.PI);
        c.beginPath(); c.arc(q.x, q.y, 1.2 + e.level * 1.6, 0, Math.PI * 2); c.fill();
      }
      c.globalAlpha = A;
      const pts = [];
      for (let i = 0; i <= 16; i++) pts.push(bez(a, m, b, i / 16));
      edgeLayout.push({ key: e.key, pts, mid: bez(a, m, b, 0.5), amt: e.amt, send: !!e.b && !e.a.fx, col: e.col });
      if (sel && e.b && !e.a.fx) {
        const q = bez(a, m, b, 0.5), txt = Math.round(e.amt * 100) + '%';
        c.font = `600 11px ${SANS}`; const tw = c.measureText(txt).width + 12;
        c.fillStyle = 'rgba(20,8,10,0.85)'; c.strokeStyle = hexA(e.col, 0.8); c.lineWidth = 1;
        c.beginPath(); c.roundRect ? c.roundRect(q.x - tw / 2, q.y - 10, tw, 20, 10) : c.rect(q.x - tw / 2, q.y - 10, tw, 20); c.fill(); c.stroke();
        c.fillStyle = '#fffaf0'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(txt, q.x, q.y + 0.5);
      }
    }
    // cabo a ser puxado
    if (drag && drag.kind === 'link') {
      const from = byId.get(drag.from);
      if (from) {
        const tgt = drag.target;
        const b = tgt ? (tgt === 'master' ? ms : byId.get(tgt).s) : { x: drag.x, y: drag.y };
        c.strokeStyle = tgt ? '#f1dcae' : 'rgba(241,220,174,0.7)'; c.lineWidth = tgt ? 2 : 1.5; c.setLineDash(tgt ? [] : [5, 5]);
        c.beginPath(); c.moveTo(from.s.x, from.s.y); c.lineTo(b.x, b.y); c.stroke(); c.setLineDash([]);
      }
    }

    // master: núcleo dourado
    const pulse = nodes.reduce((m, o) => Math.max(m, o.n.muted ? 0 : o.l), 0);
    const rm = (10 + pulse * 8) * Math.min(1.6, ms.k / 150);
    const linkHot = drag && drag.kind === 'link';
    const gm = c.createRadialGradient(ms.x, ms.y, 0, ms.x, ms.y, rm * 2.4);
    gm.addColorStop(0, 'rgba(255,240,200,0.95)'); gm.addColorStop(0.35, 'rgba(216,181,122,0.55)'); gm.addColorStop(1, 'rgba(216,181,122,0)');
    c.fillStyle = gm; c.beginPath(); c.arc(ms.x, ms.y, rm * 2.4, 0, Math.PI * 2); c.fill();
    if (linkHot) { c.strokeStyle = drag.target === 'master' ? '#fffaf0' : 'rgba(241,220,174,0.5)'; c.lineWidth = 1.5; c.setLineDash([3, 4]); c.beginPath(); c.arc(ms.x, ms.y, rm + 10, 0, Math.PI * 2); c.stroke(); c.setLineDash([]); }
    c.fillStyle = '#d8b57a'; c.font = `italic 400 15px ${SERIF}`; c.textAlign = 'center'; c.textBaseline = 'top';
    c.fillText('Master', ms.x, ms.y + rm + 6);

    // esferas, de trás para a frente
    const all = nodes.concat(fxs);
    all.sort((a, b) => b.s.d - a.s.d);
    layout = [{ id: 'master', x: ms.x, y: ms.y, r: Math.max(16, rm + 6), master: true }];
    ports = [];
    for (const o of all) {
      const r = o.r;
      const sel = S.selected === o.n.id, hov = hover && hover.id === o.n.id;
      const off = o.n.muted || o.n.on === false || o.n.silent;
      const dim = off ? 0.3 : S.selected && !sel ? 0.75 : 1;
      c.globalAlpha = A * dim;
      const g1 = c.createRadialGradient(o.s.x, o.s.y, 0, o.s.x, o.s.y, r * 3.2);
      g1.addColorStop(0, hexA(o.n.cor, 0.55 + 0.4 * o.l)); g1.addColorStop(1, hexA(o.n.cor, 0));
      c.fillStyle = g1; c.beginPath(); c.arc(o.s.x, o.s.y, r * 3.2, 0, Math.PI * 2); c.fill();
      const g2 = c.createRadialGradient(o.s.x - r * 0.35, o.s.y - r * 0.4, r * 0.1, o.s.x, o.s.y, r);
      g2.addColorStop(0, '#fffaf0'); g2.addColorStop(0.35, o.n.cor); g2.addColorStop(1, hexA(o.n.cor, 0.55));
      c.fillStyle = g2; c.beginPath(); c.arc(o.s.x, o.s.y, r, 0, Math.PI * 2); c.fill();
      if (o.fx) { // efeitos: anel e, ao puxar um cabo, alvo
        c.strokeStyle = hexA(o.n.cor, 0.9); c.lineWidth = 1; c.beginPath(); c.arc(o.s.x, o.s.y, r + 4, 0, Math.PI * 2); c.stroke();
        if (linkHot && drag.from !== o.n.id) {
          c.globalAlpha = A; c.strokeStyle = drag.target === o.n.id ? '#fffaf0' : hexA(o.n.cor, 0.6); c.lineWidth = 1.5; c.setLineDash([3, 4]);
          c.beginPath(); c.arc(o.s.x, o.s.y, r + 11, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
        }
      }
      if (o.n.silent && !o.fx) { c.strokeStyle = hexA(o.n.cor, 0.9); c.setLineDash([2, 3]); c.lineWidth = 1; c.beginPath(); c.arc(o.s.x, o.s.y, r + 4, 0, Math.PI * 2); c.stroke(); c.setLineDash([]); }
      c.globalAlpha = A * dim;
      if (sel || hov) {
        c.strokeStyle = sel ? '#f1dcae' : 'rgba(241,220,174,0.6)'; c.lineWidth = sel ? 1.5 : 1;
        c.beginPath(); c.arc(o.s.x, o.s.y, r + 7 + (sel ? Math.sin(t * 3) * 1.5 : 0), 0, Math.PI * 2); c.stroke();
      }
      layout.push({ id: o.n.id, x: o.s.x, y: o.s.y, r: Math.max(12, r + 6), fx: o.fx, n: o.n, p: o.p, d: o.s.d });
      // "+" para puxar uma ligação (mais visível no nó selecionado ou debaixo do rato)
      const pr = r + 12, px = o.s.x + pr * 0.72, py = o.s.y - pr * 0.72, show = sel || hov || (hover && hover.port === o.n.id);
      ports.push({ id: o.n.id, x: px, y: py, r: 10 });
      if (!linkHot) {
        c.globalAlpha = A * (show ? 1 : 0.28) * (off ? 0.6 : 1);
        c.fillStyle = 'rgba(20,8,10,0.75)'; c.strokeStyle = show ? '#f1dcae' : hexA(o.n.cor, 0.9); c.lineWidth = 1;
        c.beginPath(); c.arc(px, py, 6.5, 0, Math.PI * 2); c.fill(); c.stroke();
        c.beginPath(); c.moveTo(px - 3, py); c.lineTo(px + 3, py); c.moveTo(px, py - 3); c.lineTo(px, py + 3); c.stroke();
      }
    }
    // nomes, da frente para trás (os da frente ficam no sítio; os outros desviam-se)
    // as esferas também são obstáculos: um nome nunca tapa outro nó
    const placed = layout.map((L) => ({ x: L.x - L.r + 5, y: L.y - L.r + 5, w: 2 * L.r - 10, h: 2 * L.r - 10, id: L.id }));
    const fits = (r, id) => !placed.some((q) => q.id !== id && r.x < q.x + q.w && q.x < r.x + r.w && r.y < q.y + q.h && q.y < r.y + r.h);
    for (const L of layout.slice(1).sort((a, b) => a.d - b.d)) {
      const sel = S.selected === L.id, hov = hover && hover.id === L.id, n = L.n;
      const off = n.muted || n.on === false || n.silent;
      const txt = n.nome + (n.muted ? ' (mudo)' : n.on === false ? ' (desligado)' : n.silent ? ' (sem saída)' : '');
      c.font = `${sel ? 600 : 500} 12px ${SANS}`;
      const w = c.measureText(txt).width + 6, h = 15;
      let rect = null;
      const spots = [[0, L.r - 2], [0, -L.r - h - 2], [L.r + w / 2 + 4, -h / 2], [-L.r - w / 2 - 4, -h / 2], [0, L.r + 14], [0, -L.r - h - 16]];
      for (const [dx, dy] of spots) {
        const r = { x: L.x + dx - w / 2, y: L.y + dy, w, h };
        if (fits(r, L.id)) { rect = r; break; }
      }
      if (!rect) { if (!sel && !hov) continue; rect = { x: L.x - w / 2, y: L.y + L.r - 2, w, h }; }
      placed.push({ ...rect, id: L.id });
      c.globalAlpha = A * (off && !sel && !hov ? 0.55 : 1);
      c.fillStyle = sel ? '#fffaf0' : 'rgba(244,237,225,0.85)'; c.textAlign = 'center'; c.textBaseline = 'top';
      c.fillText(txt, rect.x + w / 2, rect.y + 1);
    }
    c.globalAlpha = 1;
    // dica ao passar o rato
    if (hover && mouse && !drag) {
      const lines = hover.edge ? (S.describeEdge ? S.describeEdge(hover.edge) : null) : hover.port ? ['Arrasta até um efeito ou ao Master para ligar'] : hover.id && S.describe ? S.describe(hover.id) : null;
      if (lines && lines.length) tip(lines, mouse.x, mouse.y);
    }
    if (S.empty) {
      c.fillStyle = 'rgba(244,237,225,0.7)'; c.font = `italic 400 20px ${SERIF}`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(S.empty, W / 2, H * 0.42);
    }
  }
  function tip(lines, x, y) {
    c.font = `500 11.5px ${SANS}`;
    const w = Math.max(...lines.map((l) => c.measureText(l).width)) + 18, h = lines.length * 16 + 10;
    let tx = x + 16, ty = y + 14;
    if (tx + w > W - 6) tx = x - w - 10;
    if (ty + h > H - 6) ty = y - h - 10;
    c.fillStyle = 'rgba(18,6,9,0.9)'; c.strokeStyle = 'rgba(216,181,122,0.35)'; c.lineWidth = 1;
    c.beginPath(); c.roundRect ? c.roundRect(tx, ty, w, h, 4) : c.rect(tx, ty, w, h); c.fill(); c.stroke();
    c.textAlign = 'left'; c.textBaseline = 'top';
    lines.forEach((l, i) => { c.fillStyle = i ? 'rgba(200,186,166,0.95)' : '#f4ede1'; c.font = `${i ? 400 : 600} 11.5px ${SANS}`; c.fillText(l, tx + 9, ty + 6 + i * 16); });
  }

  // ---------- interação ----------
  let drag = null, hover = null;
  const hitNode = (x, y, withMaster = true) => {
    let best = null, bd = Infinity;
    for (const l of layout) { if (!withMaster && l.master) continue; const d = Math.hypot(l.x - x, l.y - y); if (d < l.r && d < bd) { bd = d; best = l; } }
    return best;
  };
  // o "+" só ganha ao nó se o clique não for bem em cima de uma esfera (um + de trás não rouba o nó da frente)
  const hitPort = (x, y) => {
    const p = ports.find((q) => Math.hypot(q.x - x, q.y - y) < q.r);
    if (!p) return null;
    const h = hitNode(x, y);
    return h && h.id !== p.id && Math.hypot(h.x - x, h.y - y) < h.r * 0.75 ? null : p;
  };
  function hitEdge(x, y) {
    let best = null, bd = 7;
    for (const e of edgeLayout) for (let i = 1; i < e.pts.length; i++) {
      const a = e.pts[i - 1], b = e.pts[i], dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1;
      const u = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / L2));
      const d = Math.hypot(a.x + u * dx - x, a.y + u * dy - y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  function linkTarget(x, y, from) {
    const h = hitNode(x, y);
    if (!h || h.id === from) return null;
    if (h.master) return 'master';
    return h.fx ? h.id : null;
  }
  canvas.addEventListener('pointerdown', (e) => {
    const p = pos(e);
    idleT = 0;
    canvas.setPointerCapture(e.pointerId);
    const port = hitPort(p.x, p.y);
    if (port) { drag = { kind: 'link', from: port.id, x: p.x, y: p.y, target: null }; return; }
    const h = hitNode(p.x, p.y);
    if (h && !h.master) {
      S.selected = h.id; S.selEdge = null;
      if (S.onSelect) S.onSelect(h.id);
      drag = h.fx ? { kind: 'fx', id: h.id, y0: h.p.y, moved: false } : { kind: 'node', id: h.id, y0: h.p.y, moved: false };
      return;
    }
    const ed = hitEdge(p.x, p.y);
    if (ed) {
      S.selEdge = ed.key; S.selected = null;
      if (S.onSelectEdge) S.onSelectEdge(ed.key);
      drag = { kind: 'none' };
      return;
    }
    drag = { kind: 'orbit', x: p.x, y: p.y, yaw, pitch, moved: false };
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pos(e);
    mouse = p;
    if (!drag) {
      const port = hitPort(p.x, p.y), h = port ? null : hitNode(p.x, p.y), ed = port || h ? null : hitEdge(p.x, p.y);
      hover = port ? { port: port.id, id: null } : h && !h.master ? { id: h.id } : ed ? { edge: ed.key } : null;
      canvas.style.cursor = port ? 'crosshair' : h && !h.master ? (h.fx ? 'pointer' : 'grab') : ed ? 'pointer' : 'move';
      return;
    }
    idleT = 0;
    if (drag.kind === 'orbit') {
      if (Math.abs(p.x - drag.x) + Math.abs(p.y - drag.y) > 3) drag.moved = true;
      if (!drag.moved) return;
      aim = null;
      if (S.preset !== 'free') { S.preset = 'free'; if (S.onPreset) S.onPreset('free'); }
      yaw = drag.yaw + (p.x - drag.x) * 0.006;
      pitch = Math.max(0.02, Math.min(1.5, drag.pitch + (p.y - drag.y) * 0.004));
    } else if (drag.kind === 'node') {
      const w = rayPlaneY(p.x, p.y, drag.y0);
      if (!w) return;
      drag.moved = true;
      canvas.style.cursor = 'grabbing';
      const pan = Math.round(Math.max(-1, Math.min(1, w.x / XW)) * 100) / 100;
      if (S.onDrag) S.onDrag(drag.id, pan, volOfZ(w.z / ZW));
    } else if (drag.kind === 'fx') {
      const w = rayPlaneY(p.x, p.y, drag.y0);
      if (!w) return;
      drag.moved = true;
      canvas.style.cursor = 'grabbing';
      if (S.onMoveFx) S.onMoveFx(drag.id, Math.max(-FXLIM, Math.min(FXLIM, w.x)), Math.max(-FXLIM, Math.min(FXLIM, w.z)));
    } else if (drag.kind === 'link') {
      drag.x = p.x; drag.y = p.y;
      drag.target = linkTarget(p.x, p.y, drag.from);
      canvas.style.cursor = drag.target ? 'copy' : 'crosshair';
    }
  });
  const end = () => {
    if (drag) {
      if ((drag.kind === 'node' || drag.kind === 'fx') && drag.moved && S.onDragEnd) S.onDragEnd(drag.id);
      if (drag.kind === 'link' && drag.target && S.onConnect) S.onConnect(drag.from, drag.target);
      if (drag.kind === 'orbit' && !drag.moved && (S.selected || S.selEdge)) { S.selected = null; S.selEdge = null; if (S.onSelect) S.onSelect(null); }
    }
    drag = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', () => { if (!drag) { hover = null; mouse = null; } });
  canvas.addEventListener('dblclick', (e) => {
    const p = pos(e), h = hitNode(p.x, p.y, false);
    if (h && S.onToggle) S.onToggle(h.id);
  });
  // a roda do rato muda de movimento (scroll da página); o zoom é com pinça no trackpad (ctrl + roda) ou com S.zoom()
  canvas.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault(); idleT = 0;
    dist = Math.max(3.6, Math.min(12, dist * (1 + Math.sign(e.deltaY) * 0.08)));
  }, { passive: false });
  S.hits = () => layout;
  S.edges = () => edgeLayout;
  S.ports = () => ports;
  S.zoom = (k) => { idleT = 0; dist = Math.max(3.6, Math.min(12, dist * k)); if (aim) aim.dist = Math.max(3.6, Math.min(12, aim.dist * k)); };
  const PRESETS = { free: { yaw: -0.55, pitch: 0.36, dist: 6.4 }, front: { yaw: 0, pitch: 0.03, dist: 6.8 }, top: { yaw: 0, pitch: 1.5, dist: 9.2 } };
  /** vistas: livre (a rodar), de frente (pan × frequência) e de cima (pan × volume) */
  S.setPreset = (name) => {
    if (!PRESETS[name]) return;
    S.preset = name; idleT = 0;
    aim = { ...PRESETS[name] };
  };
  S.resetView = () => { S.setPreset('free'); idleT = 0; if (S.onPreset) S.onPreset('free'); };

  resize();
  requestAnimationFrame(frame);
})();
