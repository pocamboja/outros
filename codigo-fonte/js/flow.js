/* BeatVox — fluxo em passos guiado pelo scroll.
   O documento tem uma "pista" invisível com uma altura de ecrã por passo e
   encaixe (scroll-snap) em cada um. Os passos são camadas fixas: a posição do
   scroll (p = 0..N-1) controla em contínuo a transição entre elas, e a cena 3D
   muda de forma ao mesmo ritmo. */
(function () {
  const BV = (window.BV = window.BV || {});
  const steps = [...document.querySelectorAll('.step')];
  const N = steps.length;
  const track = document.getElementById('track');
  const railFill = document.getElementById('railFill');
  const railBtns = [...document.querySelectorAll('.rail [data-go]')];
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const depthEls = steps.map((s) => [...s.querySelectorAll('[data-depth]')].map((el) => ({ el, d: +el.dataset.depth })));

  const flow = { p: 0, active: -1, onStep: null, locked: false };
  BV.flow = flow;

  let vh = innerHeight;
  function size() {
    vh = innerHeight;
    track.innerHTML = '';
    for (let i = 0; i < N; i++) {
      const a = document.createElement('div');
      a.className = 'snap';
      a.style.height = vh + 'px';
      track.appendChild(a);
    }
    render();
  }

  const ease = (x) => x * x * (3 - 2 * x);

  function render() {
    const p = Math.max(0, Math.min(N - 1, scrollY / vh));
    flow.p = p;
    if (BV.scene) BV.scene.progress = p;
    if (BV.eq) BV.eq.visible = Math.max(0, 1 - Math.abs(p - 2) * 1.6);
    if (BV.stage3d) BV.stage3d.vis = Math.max(0, 1 - Math.abs(p - 4) * 1.4);
    steps.forEach((s, i) => {
      const t = p - i;            // 0 = no ecrã, >0 a sair (para cima/para nós), <0 a entrar (da profundidade)
      const a = Math.abs(t);
      if (a >= 1) {
        if (!s.hidden) { s.hidden = true; s.setAttribute('aria-hidden', 'true'); }
        return;
      }
      if (s.hidden) { s.hidden = false; }
      s.toggleAttribute('inert', a > 0.5);
      s.setAttribute('aria-hidden', a > 0.5 ? 'true' : 'false');
      const k = ease(Math.min(1, a * 1.25));
      const op = 1 - k;
      if (reduce) {
        s.style.opacity = op;
        s.style.transform = 'none';
        s.style.filter = 'none';
      } else {
        // a sair: aproxima-se da câmara e sobe; a entrar: vem de trás, mais pequeno, desfocado
        const scale = t > 0 ? 1 + 0.22 * k : 1 - 0.14 * k;
        const ty = -t * 9;        // vh
        const rx = t * 7;         // graus
        s.style.opacity = op.toFixed(3);
        s.style.transform = `translate3d(0, ${ty.toFixed(2)}vh, 0) rotateX(${rx.toFixed(2)}deg) scale(${scale.toFixed(4)})`;
        s.style.filter = a > 0.02 ? `blur(${(k * 14).toFixed(1)}px)` : 'none';
        // parallax: cada camada interior desloca-se a uma velocidade diferente
        for (const { el, d } of depthEls[i]) el.style.transform = a > 0.001 ? `translate3d(0, ${(-t * d * 16).toFixed(2)}vh, 0)` : '';
      }
    });
    railFill.style.transform = `scaleY(${(p / (N - 1)).toFixed(4)})`;
    const act = Math.round(p);
    if (act !== flow.active) {
      flow.active = act;
      document.body.dataset.step = act;
      railBtns.forEach((b) => b.setAttribute('aria-current', +b.dataset.go === act ? 'step' : 'false'));
      if (flow.onStep) flow.onStep(act);
    }
  }

  let ticking = false;
  addEventListener('scroll', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(() => { ticking = false; render(); }); }
  }, { passive: true });
  addEventListener('resize', () => {
    const at = flow.p;
    size();
    scrollTo(0, Math.round(at) * vh);
  });

  flow.go = (i) => {
    i = Math.max(0, Math.min(N - 1, i));
    scrollTo({ top: i * vh, behavior: reduce ? 'auto' : 'smooth' });
  };
  flow.lock = (on) => {
    flow.locked = on;
    document.documentElement.classList.toggle('locked', on);
  };
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-go]');
    if (!b) return;
    e.preventDefault();
    flow.go(+b.dataset.go);
  });

  size();
})();
