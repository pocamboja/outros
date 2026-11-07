/* BeatVox — passos guiados pelo scroll.
   O documento tem uma "pista" invisível com uma altura de ecrã por passo e
   encaixe (scroll-snap) em cada um. Os passos são camadas fixas que se movem
   exatamente com o scroll, como uma página: ao descer, o passo atual sobe e o
   seguinte entra por baixo. Sem zoom, rotação nem desfocagem. */
(function () {
  const BV = (window.BV = window.BV || {});
  const steps = [...document.querySelectorAll('.step')];
  const N = steps.length;
  const track = document.getElementById('track');
  const NOMES = steps.map((s) => s.getAttribute('aria-label') || '');
  const pgLabel = document.getElementById('pgLabel'), pgPrev = document.getElementById('pgPrev'), pgNext = document.getElementById('pgNext');
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

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

  function render() {
    const p = Math.max(0, Math.min(N - 1, scrollY / vh));
    flow.p = p;
    if (BV.eq) BV.eq.visible = 0; // o equalizador só aparece a gravar (mostra o que o micro ouve)
    if (BV.stage3d) BV.stage3d.vis = Math.max(0, 1 - Math.abs(p - 4) * 1.4);
    steps.forEach((s, i) => {
      const t = p - i;            // 0 = no ecrã; >0 já passou (está acima); <0 ainda vem (está abaixo)
      const a = Math.abs(t);
      if (a >= 1) {
        if (!s.hidden) { s.hidden = true; s.setAttribute('aria-hidden', 'true'); }
        return;
      }
      if (s.hidden) s.hidden = false;
      s.toggleAttribute('inert', a > 0.5);
      s.setAttribute('aria-hidden', a > 0.5 ? 'true' : 'false');
      // segue o scroll: o passo desloca-se o mesmo que o dedo; o que sai perde um pouco de destaque
      // parado (a ≈ 0) não leva estilos: opacidade < 1 impediria o vidro fosco de desfocar o fundo
      s.style.transform = a < 1e-3 ? '' : `translate3d(0, ${(-t * 100).toFixed(3)}vh, 0)`;
      s.style.opacity = a < 1e-3 ? '' : reduce ? (a < 0.5 ? 1 : 0) : (1 - 0.45 * a).toFixed(3);
    });
    const act = Math.round(p);
    if (act !== flow.active) {
      flow.active = act;
      document.body.dataset.step = act;
      if (pgLabel) pgLabel.innerHTML = `<b>${act + 1}</b> / ${N} · ${NOMES[act]}`;
      if (pgPrev) pgPrev.disabled = act === 0;
      if (pgNext) pgNext.disabled = act === N - 1;
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
    if (flow.locked) return;
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
  if (pgPrev) pgPrev.addEventListener('click', () => flow.go(flow.active - 1));
  if (pgNext) pgNext.addEventListener('click', () => flow.go(flow.active + 1));

  size();
})();
