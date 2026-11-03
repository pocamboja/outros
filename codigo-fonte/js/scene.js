/* BeatVox — cena de fundo em WebGL: pó dourado que muda de forma com o scroll.
   I disco de vinil (com reflexo a correr pelos sulcos) · II anel de compasso ·
   III chão do sequenciador · IV pauta musical com a melodia · V o teu disco.
   Reage ao nível de áudio (microfone a gravar, música a tocar). Sem bibliotecas. */
(function () {
  const BV = (window.BV = window.BV || {});
  const canvas = document.getElementById('bg');
  if (!canvas) return;
  const gl = canvas.getContext('webgl', { antialias: false, alpha: true, premultipliedAlpha: false });
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const scene = { progress: 0, level: 0, ok: !!gl, getLevel: null };
  BV.scene = scene;
  if (!gl) { canvas.classList.add('off'); return; }

  const small = Math.min(innerWidth, innerHeight) < 700;
  const N = small ? 6000 : 11000;
  const TAU = Math.PI * 2;
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  // ---------- formas (N pontos cada, coordenadas x,y,z) ----------
  function vinyl() { // disco no plano xz: sulcos finos, rótulo, furo central
    const a = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const u = rnd();
      let r;
      if (u < 0.86) r = Math.round((0.46 + rnd() * 0.76) * 70) / 70 + (rnd() - 0.5) * 0.003; // sulcos
      else if (u < 0.93) r = 0.44 + (rnd() - 0.5) * 0.006;                                       // fim da gravação
      else if (u < 0.975) r = 0.24 + rnd() * 0.15;                                                 // rótulo
      else r = 1.235 + (rnd() - 0.5) * 0.008;                                                      // aresta
      const th = rnd() * TAU;
      a.set([Math.cos(th) * r, (rnd() - 0.5) * 0.006, Math.sin(th) * r], i * 3);
    }
    return a;
  }
  function ring() { // anel de compasso: 16 subdivisões, 4 tempos marcados
    const a = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const u = rnd();
      let th, r, y = (rnd() - 0.5) * 0.02;
      if (u < 0.12) { const b = Math.floor(rnd() * 4); th = (b / 4) * TAU + (rnd() - 0.5) * 0.02; r = 1.05 + rnd() * 0.42; }      // tempos
      else if (u < 0.22) { const s = Math.floor(rnd() * 16); th = (s / 16) * TAU + (rnd() - 0.5) * 0.012; r = 1.2 + rnd() * 0.16; } // subdivisões
      else { th = rnd() * TAU; r = 1.32 + (rnd() - 0.5) * 0.02; }
      a.set([Math.cos(th) * r, y, Math.sin(th) * r], i * 3);
    }
    return a;
  }
  function floor() { // chão em perspetiva: linhas da grelha + células acesas
    const a = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const u = rnd();
      let x, z, y = -0.85;
      if (u < 0.32) { x = -2.8 + Math.floor(rnd() * 17) * 0.35; z = -1.2 + rnd() * 3.2; }
      else if (u < 0.6) { x = -2.8 + rnd() * 5.6; z = -1.2 + Math.floor(rnd() * 9) * 0.4; }
      else {
        const step = Math.floor(rnd() * 16), row = Math.floor(rnd() * 8);
        if ((step * 7 + row * 3) % 5 !== 0) { x = -2.8 + rnd() * 5.6; z = -1.2 + rnd() * 3.2; }
        else { x = -2.8 + (step + 0.2 + rnd() * 0.6) * 0.35; z = -1.2 + (row + 0.2 + rnd() * 0.6) * 0.4; y += rnd() * 0.08; }
      }
      a.set([x, y, z], i * 3);
    }
    return a;
  }
  function staff() { // pauta: 5 linhas, barras de compasso e uma melodia em notas
    const a = new Float32Array(N * 3);
    const gap = 0.16, top = 0.32;
    const melody = [0, 2, 3, 4, 6, 4, 3, 2, 0, 0, 1, 4, 7, 6, 4, 2]; // posições na pauta (meio-espaços)
    for (let i = 0; i < N; i++) {
      const u = rnd();
      let x, y;
      if (u < 0.5) { x = -2.1 + rnd() * 4.2; y = top - Math.floor(rnd() * 5) * gap; }               // linhas
      else if (u < 0.56) { x = -2.1 + Math.floor(rnd() * 5) * 1.05; y = top - rnd() * gap * 4; }    // barras
      else {
        const k = Math.floor(rnd() * melody.length);
        const cx = -1.95 + k * 0.255, cy = top - gap * 4 + melody[k] * (gap / 2);
        if (rnd() < 0.62) { // cabeça da nota (elipse inclinada)
          const th = rnd() * TAU, rr = Math.sqrt(rnd());
          const ex = Math.cos(th) * 0.055 * rr, ey = Math.sin(th) * 0.04 * rr;
          x = cx + ex * 0.95 - ey * 0.3; y = cy + ey * 0.95 + ex * 0.3;
        } else { x = cx + 0.05; y = cy + rnd() * 0.46; } // haste
      }
      a.set([x, y, (rnd() - 0.5) * 0.02], i * 3);
    }
    return a;
  }
  const shapes = [vinyl(), ring(), floor(), staff(), ring(), vinyl()];
  const tilt = [1.02, 1.0, 0.12, 0.0, 1.3, 1.22];
  const offYK = [0, 0, 0, 0, -0.6, -0.52]; // no fim, o disco assenta por baixo do resumo     // inclinação da câmara por movimento
  const spin = [1, 0.5, 0, 0, 0.3, 0.7];             // o chão e a pauta não rodam
  const sheenK = [1, 0, 0, 0, 0, 1];               // reflexo de luz só no vinil
  const offX = [0.4, 0, 0.12, 0.12, 0, 0];
  const scaleK = [1.08, 1, 1, 0.95, 1.2, 0.72];
  const dimK = [1, 1, 0.45, 0.75, 0.3, 0.5]; // atrás de texto denso, o pó fica mais discreto

  // ---------- shaders ----------
  const vs = `
    attribute vec3 aA; attribute vec3 aB; attribute float aSeed;
    uniform float uMix, uTime, uLevel, uRotA, uRotB, uTiltA, uTiltB, uSwirl, uAspect, uSize, uScale, uOffX, uSheenA, uSheenB, uOffY;
    varying float vSeed; varying float vGlow; varying float vSheen;
    vec3 rotY(vec3 p, float a){ float c=cos(a), s=sin(a); return vec3(c*p.x+s*p.z, p.y, -s*p.x+c*p.z); }
    vec3 rotX(vec3 p, float a){ float c=cos(a), s=sin(a); return vec3(p.x, c*p.y-s*p.z, s*p.y+c*p.z); }
    float sheen(vec3 q){ // reflexo do vinil: dois lóbulos fixos de luz enquanto o disco roda
      float ang = atan(q.z, q.x);
      float r = length(q.xz);
      float lobe = pow(abs(cos(ang - 0.7)), 10.0);
      return lobe * smoothstep(0.4, 0.5, r) * (1.0 - smoothstep(1.2, 1.25, r));
    }
    void main(){
      float m = smoothstep(0.0, 1.0, uMix);
      float d = clamp((m - aSeed * 0.35) / 0.65, 0.0, 1.0);
      d = d * d * (3.0 - 2.0 * d);
      vec3 qa = rotY(aA, uRotA), qb = rotY(aB, uRotB);
      vSheen = mix(sheen(aA) * uSheenA, sheen(aB) * uSheenB, d);
      vec3 p = mix(rotX(qa, uTiltA), rotX(qb, uTiltB), d);
      float wob = sin(d * 3.14159) * 0.4;
      p += wob * vec3(sin(aSeed*40.0+uTime), cos(aSeed*31.0+uTime*0.8), sin(aSeed*23.0-uTime*0.6));
      p += normalize(p + 1e-4) * (0.006 + uLevel * 0.2) * sin(uTime*3.0 + aSeed*20.0);
      p = rotY(p, uSwirl);
      p *= uScale;
      float z = p.z + 3.2;
      gl_Position = vec4(p.x / z * 2.2 / uAspect + uOffX, p.y / z * 2.2 + uOffY, 0.0, 1.0);
      gl_PointSize = uSize * (1.0 + uLevel * 1.2 + vSheen * 0.8) / z;
      vSeed = aSeed; vGlow = uLevel;
    }`;
  const fs = `
    precision highp float;
    varying float vSeed; varying float vGlow; varying float vSheen;
    uniform float uTime, uDim;
    void main(){
      vec2 c = gl_PointCoord - 0.5;
      float r = length(c);
      if (r > 0.5) discard;
      float a = smoothstep(0.5, 0.0, r);
      // pó dourado: champanhe → ouro velho, com algumas faíscas de marfim e um toque rosado raro
      vec3 gold = mix(vec3(0.62, 0.44, 0.22), vec3(0.95, 0.82, 0.58), fract(vSeed * 7.13));
      vec3 col = mix(gold, vec3(1.0, 0.96, 0.9), step(0.94, fract(vSeed * 13.7)));
      col = mix(col, vec3(0.92, 0.5, 0.56), step(0.985, fract(vSeed * 3.1)));
      float twinkle = 0.65 + 0.35 * sin(uTime * (1.5 + vSeed * 3.0) + vSeed * 60.0);
      float lum = twinkle * (1.0 + vGlow) + vSheen * 1.8;
      gl_FragColor = vec4(col * lum, a * uDim * clamp(0.75 + vSheen * 0.5 + vGlow * 0.3, 0.0, 1.0));
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
    console.warn('BeatVox: WebGL indisponível', e);
    scene.ok = false; canvas.classList.add('off'); return;
  }
  gl.useProgram(prog);
  const bufs = shapes.map((s) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, s, gl.STATIC_DRAW); return b; });
  const seeds = new Float32Array(N); for (let i = 0; i < N; i++) seeds[i] = rnd();
  const seedBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, seedBuf); gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);
  const aA = gl.getAttribLocation(prog, 'aA'), aB = gl.getAttribLocation(prog, 'aB'), aSeed = gl.getAttribLocation(prog, 'aSeed');
  const U = {};
  ['uMix', 'uTime', 'uLevel', 'uRotA', 'uRotB', 'uTiltA', 'uTiltB', 'uSwirl', 'uAspect', 'uSize', 'uScale', 'uOffX', 'uSheenA', 'uSheenB', 'uDim', 'uOffY']
    .forEach((n) => (U[n] = gl.getUniformLocation(prog, n)));
  gl.enableVertexAttribArray(aA); gl.enableVertexAttribArray(aB); gl.enableVertexAttribArray(aSeed);
  gl.bindBuffer(gl.ARRAY_BUFFER, seedBuf); gl.vertexAttribPointer(aSeed, 1, gl.FLOAT, false, 0, 0);
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  gl.disable(gl.DEPTH_TEST);

  let W = 0, H = 0, dpr = 1;
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  addEventListener('resize', resize);
  resize();

  let boundI = -1, rot = 0, last = performance.now(), lvl = 0, visible = true;
  document.addEventListener('visibilitychange', () => { visible = !document.hidden; if (visible) { last = performance.now(); requestAnimationFrame(frame); } });
  const lerp = (arr, i, f) => arr[i] + (arr[i + 1] - arr[i]) * (f * f * (3 - 2 * f));

  function frame(now) {
    if (!visible) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const p = Math.max(0, Math.min(shapes.length - 1, scene.progress));
    const i = Math.min(shapes.length - 2, Math.floor(p)), f = p - i;
    if (i !== boundI) {
      gl.bindBuffer(gl.ARRAY_BUFFER, bufs[i]); gl.vertexAttribPointer(aA, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufs[i + 1]); gl.vertexAttribPointer(aB, 3, gl.FLOAT, false, 0, 0);
      boundI = i;
    }
    const target = scene.getLevel ? Math.min(1, scene.getLevel() * 4) : 0;
    lvl += (target - lvl) * (target > lvl ? 0.45 : 0.08);
    rot += dt * (reduce ? 0.02 : 0.11 + lvl * 0.5);  // um disco a girar devagar
    const t = now / 1000;
    const narrow = W < 700;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(U.uMix, f);
    gl.uniform1f(U.uTime, reduce ? 0 : t);
    gl.uniform1f(U.uLevel, lvl);
    gl.uniform1f(U.uRotA, rot * spin[i]);
    gl.uniform1f(U.uRotB, rot * spin[i + 1]);
    gl.uniform1f(U.uTiltA, tilt[i]);
    gl.uniform1f(U.uTiltB, tilt[i + 1]);
    gl.uniform1f(U.uSheenA, sheenK[i]);
    gl.uniform1f(U.uSheenB, sheenK[i + 1]);
    gl.uniform1f(U.uSwirl, reduce ? 0 : Math.sin(f * Math.PI) * 0.9);
    gl.uniform1f(U.uAspect, W / Math.max(1, H));
    gl.uniform1f(U.uSize, (narrow ? 6.5 : 9.5) * dpr);
    gl.uniform1f(U.uScale, (narrow ? 0.62 : 1.0) * lerp(scaleK, i, f));
    gl.uniform1f(U.uOffX, narrow ? 0 : lerp(offX, i, f));
    gl.uniform1f(U.uDim, lerp(dimK, i, f));
    gl.uniform1f(U.uOffY, lerp(offYK, i, f));
    gl.drawArrays(gl.POINTS, 0, N);
    scene.level = lvl;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
