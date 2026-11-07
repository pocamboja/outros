/* BeatVox — botões rotativos.
   Transforma <input type="range" data-knob> num botão rotativo acessível.
   O input continua a existir (escondido) e recebe os eventos 'input',
   por isso a lógica da app não precisa de saber que há um botão.
   Arrastar na vertical · roda do rato · setas do teclado (Shift = fino) · duplo clique repõe. */
(function () {
  const BV = (window.BV = window.BV || {});
  const NS = 'http://www.w3.org/2000/svg';
  const A0 = -135, A1 = 135;                 // curso do botão em graus
  const C = 38, R_ARC = 33, R_CAP = 23;
  const COLORS = { gold: '#d8b57a', cyan: '#8fc1b5', violet: '#b9a6d6', pink: '#d9707f' };
  const knobs = [];

  const el = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  const polar = (deg, r) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [C + r * Math.cos(a), C + r * Math.sin(a)];
  };
  const arcPath = (d0, d1, r) => {
    const [x0, y0] = polar(d0, r), [x1, y1] = polar(d1, r);
    const large = Math.abs(d1 - d0) > 180 ? 1 : 0;
    return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };

  function make(input) {
    const color = COLORS[input.dataset.color] || COLORS.gold;
    const min = +input.min, max = +input.max;
    const step = +input.step || 1;
    const def = input.dataset.default != null ? +input.dataset.default : +input.value;
    const id = 'k' + Math.random().toString(36).slice(2, 8);
    const wrap = document.createElement('div');
    wrap.className = 'knob';
    wrap.tabIndex = 0;
    wrap.setAttribute('role', 'slider');
    wrap.setAttribute('aria-label', input.getAttribute('aria-label') || '');
    wrap.setAttribute('aria-valuemin', min);
    wrap.setAttribute('aria-valuemax', max);
    wrap.title = 'Arrasta para cima ou para baixo · duplo clique repõe';

    const svg = el('svg', { viewBox: '0 0 76 76', 'aria-hidden': 'true' }, wrap);
    const defs = el('defs', {}, svg);
    const g1 = el('radialGradient', { id: id + 'cap', cx: '38%', cy: '30%', r: '75%' }, defs);
    el('stop', { offset: '0%', 'stop-color': '#3a2026' }, g1);
    el('stop', { offset: '60%', 'stop-color': '#1d0b10' }, g1);
    el('stop', { offset: '100%', 'stop-color': '#0e0407' }, g1);
    const glow = el('filter', { id: id + 'g', x: '-30%', y: '-30%', width: '160%', height: '160%' }, defs);
    el('feGaussianBlur', { stdDeviation: '1.6', result: 'b' }, glow);
    const m = el('feMerge', {}, glow);
    el('feMergeNode', { in: 'b' }, m);
    el('feMergeNode', { in: 'SourceGraphic' }, m);

    // marcas serigrafadas
    for (let i = 0; i <= 10; i++) {
      const d = A0 + ((A1 - A0) * i) / 10;
      const [x0, y0] = polar(d, 36.5), [x1, y1] = polar(d, i % 5 === 0 ? 39.5 : 38.3);
      el('line', { x1: x0, y1: y0, x2: x1, y2: y1, stroke: i % 5 === 0 ? 'rgba(216,181,122,.6)' : 'rgba(216,181,122,.22)', 'stroke-width': 1.2, 'stroke-linecap': 'round' }, svg);
    }
    // anel de LED (fundo + valor)
    el('path', { d: arcPath(A0, A1, R_ARC), fill: 'none', stroke: 'rgba(216,181,122,.12)', 'stroke-width': 2, 'stroke-linecap': 'round' }, svg);
    const valArc = el('path', { fill: 'none', stroke: color, 'stroke-width': 3, 'stroke-linecap': 'round', filter: `url(#${id}g)` }, svg);
    // sombra + serrilhado + tampa
    const cap = el('g', { class: 'k-cap' }, svg);
    el('circle', { cx: C, cy: C, r: R_CAP, fill: `url(#${id}cap)`, stroke: 'rgba(216,181,122,.35)', 'stroke-width': 1 }, cap);
    el('circle', { cx: C, cy: C - R_CAP + 6, r: 2.6, fill: color, filter: `url(#${id}g)` }, cap);

    input.parentNode.insertBefore(wrap, input);
    const out = input.parentNode.querySelector('output');

    const k = {
      input, wrap,
      render() {
        const v = +input.value;
        const t = (v - min) / (max - min);
        const deg = A0 + t * (A1 - A0);
        cap.setAttribute('transform', `rotate(${deg.toFixed(1)} ${C} ${C})`);
        valArc.setAttribute('d', t > 0.004 ? arcPath(A0, deg, R_ARC) : '');
        wrap.setAttribute('aria-valuenow', v);
        if (out) wrap.setAttribute('aria-valuetext', out.textContent);
      },
    };
    const set = (v) => {
      v = Math.max(min, Math.min(max, Math.round(v / step) * step));
      if (v === +input.value) return;
      input.value = v;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      k.render();
    };

    let drag = null;
    wrap.addEventListener('pointerdown', (e) => {
      wrap.setPointerCapture(e.pointerId);
      drag = { y: e.clientY, v: +input.value };
      wrap.focus();
      e.preventDefault();
    });
    wrap.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const fine = e.shiftKey ? 0.2 : 1;
      set(drag.v + ((drag.y - e.clientY) / 180) * (max - min) * fine);
    });
    const end = () => { drag = null; };
    wrap.addEventListener('pointerup', end);
    wrap.addEventListener('pointercancel', end);
    wrap.addEventListener('wheel', (e) => {
      e.preventDefault();
      set(+input.value + (e.deltaY < 0 ? 1 : -1) * Math.max(step, (max - min) / 50));
    }, { passive: false });
    wrap.addEventListener('dblclick', () => set(def));
    wrap.addEventListener('keydown', (e) => {
      const big = (max - min) / 10, small = e.shiftKey ? step : Math.max(step, (max - min) / 100);
      const map = { ArrowUp: small, ArrowRight: small, ArrowDown: -small, ArrowLeft: -small, PageUp: big, PageDown: -big };
      if (e.key in map) { set(+input.value + map[e.key]); e.preventDefault(); e.stopPropagation(); }
      else if (e.key === 'Home') { set(min); e.preventDefault(); }
      else if (e.key === 'End') { set(max); e.preventDefault(); }
    });
    k.render();
    knobs.push(k);
  }

  BV.knobs = {
    init() { document.querySelectorAll('input[type=range][data-knob]').forEach(make); },
    refresh() { knobs.forEach((k) => k.render()); },
  };
  BV.knobs.init();
})();
