/* BeatVox — equalizador 3D de blocos LED (movimento III, Bateria).
   16 colunas (uma por passo do compasso) × 14 blocos, cores de medidor VU
   (verde → amarelo → laranja → vermelho), blocos apagados visíveis, pico que cai devagar
   e reflexo no chão. Reage ao espetro do som: a música a tocar e a tua voz a gravar.
   Só é desenhado à volta do movimento III (visibilidade dada pela posição do scroll). */
(function () {
  const BV = (window.BV = window.BV || {});
  const canvas = document.getElementById('eq');
  if (!canvas) return;
  const gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: false });
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const eq = { visible: 0, live: false, getSpectrum: null, getRect: null, ok: !!gl };
  BV.eq = eq;
  if (!gl) { canvas.style.display = 'none'; return; }

  const COLS = 16, SEGS = 14, FOV = 0.75;
  const SPACING = 0.24, BW = 0.19, BD = 0.19, SEG_H = 0.088, SEG_GAP = 0.03;

  // ---------- malha: um cubo por bloco (posição, normal, coluna, bloco) ----------
  const faces = [ // [normal, 4 cantos]
    [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
    [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]],
    [[1, 0, 0], [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]]],
    [[-1, 0, 0], [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]]],
    [[0, 1, 0], [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]]],
    [[0, -1, 0], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]],
  ];
  const data = [];
  for (let c = 0; c < COLS; c++) {
    const cx = (c - (COLS - 1) / 2) * SPACING;
    for (let s = 0; s < SEGS; s++) {
      const cy = s * (SEG_H + SEG_GAP) + SEG_H / 2;
      for (const [nrm, q] of faces) {
        for (const vi of [0, 1, 2, 0, 2, 3]) {
          const [x, y, z] = q[vi];
          // uv: coordenadas na face (-1..1), para escurecer as arestas como num bloco LED
          const uv = nrm[0] ? [z, y] : nrm[1] ? [x, z] : [x, y];
          data.push(cx + (x * BW) / 2, cy + (y * SEG_H) / 2, (z * BD) / 2, nrm[0], nrm[1], nrm[2], c, s, uv[0], uv[1]);
        }
      }
    }
  }
  const verts = new Float32Array(data);
  const VCOUNT = verts.length / 10;

  const vs = `
    attribute vec3 aPos; attribute vec3 aNrm; attribute float aCol; attribute float aSeg; attribute vec2 aUV;
    uniform float uH[${COLS}]; uniform float uPk[${COLS}];
    uniform mat4 uMVP; uniform float uMirror;
    varying vec3 vCol; varying float vLit; varying float vShade; varying float vY; varying vec2 vUV;
    vec3 vu(float s){ // cores de medidor VU por altura do bloco
      if (s < 6.0) return vec3(0.42, 0.80, 0.27);       // verde
      if (s < 9.0) return vec3(0.98, 0.83, 0.22);       // amarelo
      if (s < 12.0) return vec3(0.98, 0.55, 0.16);      // laranja
      return vec3(0.93, 0.16, 0.18);                    // vermelho
    }
    void main(){
      int c = int(aCol + 0.5);
      float h = 0.0, pk = 0.0;
      for (int i = 0; i < ${COLS}; i++) { if (i == c) { h = uH[i]; pk = uPk[i]; } }
      float lit = step(aSeg + 0.5, h * ${SEGS}.0);
      float isPeak = 1.0 - step(0.5, abs(aSeg - floor(pk * ${SEGS}.0 - 0.001)));
      isPeak *= step(0.02, pk) * (1.0 - lit);
      vLit = max(lit, isPeak * 0.9);
      vCol = vu(aSeg);
      // luz: topo e frente mais claros, lados mais escuros
      vShade = aNrm.z > 0.5 ? 1.0 : aNrm.y > 0.5 ? 1.35 : aNrm.y < -0.5 ? 0.35 : 0.55;
      vUV = aUV;
      vec3 p = aPos;
      p.y *= uMirror;
      vY = aPos.y;
      gl_Position = uMVP * vec4(p, 1.0);
    }`;
  const fs = `
    precision highp float;
    varying vec3 vCol; varying float vLit; varying float vShade; varying float vY; varying vec2 vUV;
    uniform float uAlpha; uniform float uMirror;
    void main(){
      float e = max(abs(vUV.x), abs(vUV.y));
      float edge = smoothstep(0.72, 1.0, e);
      // bloco apagado: vidro escuro com a aresta da cor a marcar o contorno
      vec3 off = vCol * (0.035 + 0.16 * edge) * vShade;
      // aceso: cor saturada, centro mais quente (LED por trás do difusor), arestas escuras
      vec3 on = vCol * vShade * (1.05 - 0.5 * edge);
      on = mix(on, vec3(1.0, 0.98, 0.9), 0.22 * (1.0 - e * e) * step(0.9, vShade));
      vec3 col = mix(off, on, vLit);
      float a = uAlpha * mix(0.7, 1.0, vLit);
      if (uMirror < 0.0) a *= 0.3 * (1.0 - smoothstep(0.0, 0.8, vY)); // reflexo a desvanecer
      gl_FragColor = vec4(col, a);
    }`;
  function sh(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  let prog;
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  } catch (e) {
    console.warn('BeatVox: equalizador 3D indisponível', e);
    eq.ok = false; canvas.style.display = 'none'; return;
  }
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  const att = (name, size, off) => { const l = gl.getAttribLocation(prog, name); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, 40, off * 4); };
  att('aPos', 3, 0); att('aNrm', 3, 3); att('aCol', 1, 6); att('aSeg', 1, 7); att('aUV', 2, 8);
  const U = {};
  ['uH', 'uPk', 'uMVP', 'uMirror', 'uAlpha'].forEach((n) => (U[n] = gl.getUniformLocation(prog, n)));
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  // ---------- matrizes ----------
  const mul = (a, b) => { const o = new Float32Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; };
  const persp = (fov, asp, n, f) => { const t = 1 / Math.tan(fov / 2); return new Float32Array([t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, (2 * f * n) / (n - f), 0]); };
  const rotX = (a) => { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); };
  const rotY = (a) => { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); };
  const scaleY = (k) => new Float32Array([1, 0, 0, 0, 0, k, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const trans = (x, y, z) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);

  let W = 0, H = 0, dpr = 1;
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  addEventListener('resize', resize);
  resize();

  const h = new Float32Array(COLS), pk = new Float32Array(COLS), pkHold = new Float32Array(COLS);
  let last = performance.now(), mx = 0, my = 0;
  addEventListener('pointermove', (e) => { mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5; }, { passive: true });

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const v = eq.live ? 1 : eq.visible;
    canvas.style.opacity = v.toFixed(3);
    if (canvas.clientWidth !== W || canvas.clientHeight !== H) resize();
    if (v > 0.001 && !document.hidden) {
      const t = now / 1000;
      const spec = eq.getSpectrum ? eq.getSpectrum(COLS) : null;
      for (let c = 0; c < COLS; c++) {
        // sem som: respira devagar, em onda; com som: segue o espetro
        const idle = reduce ? 0.18 : 0.14 + 0.1 * Math.sin(t * 1.6 + c * 0.55) + 0.05 * Math.sin(t * 3.1 - c * 0.9);
        const target = Math.max(idle, spec ? spec[c] : 0);
        h[c] += (target - h[c]) * (target > h[c] ? 0.55 : Math.min(1, dt * 5));
        if (h[c] >= pk[c]) { pk[c] = h[c]; pkHold[c] = 0.35; }
        else if ((pkHold[c] -= dt) < 0) pk[c] = Math.max(h[c], pk[c] - dt * 0.45);
      }
      const asp = W / Math.max(1, H);
      const narrow = W < 700;
      // câmara: ligeiramente de cima, a balançar devagar; segue um pouco o rato
      const yaw = ((reduce ? 0 : Math.sin(t * 0.25) * 0.22) + mx * 0.25) * (eq.live ? 1 : 0.6);
      const pitch = 0.32 + my * 0.08;
      const rise = 1 - v; // ao entrar, as barras sobem do chão
      // ao gravar: centrado e mais baixo, por baixo da contagem.
      // em repouso: encaixado atrás do estúdio (getRect), para não espreitar entre os painéis
      let cx = narrow ? 0 : 0.35, cy = -0.75 - rise * 0.6, cz = narrow ? -5.6 : -4.4, sy = 1;
      const tf = Math.tan(FOV / 2);
      const r = !eq.live && eq.getRect ? eq.getRect() : null;
      if (eq.live) { cx = 0; cy = -1.55; cz = narrow ? -5.6 : -4.6; }
      else if (r && r.width > 200) {
        const nl = (r.left / W) * 2 - 1, nr = (r.right / W) * 2 - 1, nb = 1 - (r.bottom / H) * 2;
        const span = (nr - nl) * 0.84;                     // margem para o balanço da câmara
        const d = Math.max(3, (COLS * SPACING) / (span * tf * asp));
        cz = -d;
        cx = ((nl + nr) / 2) * d * tf * asp;
        // estica as barras na vertical para ocuparem ~85% da altura do estúdio
        sy = Math.max(1, Math.min(2.6, (0.85 * (r.height / H) * 2 * d * tf) / (SEGS * (SEG_H + SEG_GAP))));
        cy = (nb + 0.24) * d * tf - rise * 0.6;
      }
      // em repouso, o equalizador só existe dentro do estúdio (a transição abre-o ao ecrã inteiro)
      if (r && r.width > 200 && !eq.live) {
        const k = Math.max(0, Math.min(1, (v - 0.6) / 0.4)), e = k * k * (3 - 2 * k);
        const ins = [r.top, W - r.right, H - r.bottom, r.left].map((x) => Math.max(0, x * e).toFixed(1) + 'px');
        canvas.style.clipPath = `inset(${ins.join(' ')} round 4px)`;
      } else if (canvas.style.clipPath) canvas.style.clipPath = '';
      const view = mul(trans(cx, cy, cz), mul(rotX(pitch), mul(rotY(yaw), scaleY(sy))));
      const mvp = mul(persp(FOV, asp, 0.1, 50), view);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniformMatrix4fv(U.uMVP, false, mvp);
      gl.uniform1fv(U.uH, h.map((x) => x * Math.min(1, v * 1.4)));
      gl.uniform1fv(U.uPk, pk.map((x) => x * Math.min(1, v * 1.4)));
      gl.uniform1f(U.uAlpha, eq.live ? 1 : 0.55 + 0.45 * (1 - v)); // atrás do vidro do estúdio, mais discreto
      // reflexo primeiro (sem escrever profundidade), depois as barras
      gl.depthMask(false);
      gl.uniform1f(U.uMirror, -1);
      gl.drawArrays(gl.TRIANGLES, 0, VCOUNT);
      gl.depthMask(true);
      gl.uniform1f(U.uMirror, 1);
      gl.drawArrays(gl.TRIANGLES, 0, VCOUNT);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
