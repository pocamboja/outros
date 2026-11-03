/* BeatVox — exportação para ficheiro MIDI.
   Bateria no canal 10 (General MIDI), lead no canal 1.
   Uma só pista → formato 0; bateria + lead → formato 1 (uma pista cada). */
(function (g) {
  const BV = (g.BV = g.BV || {});

  function vlq(n) {
    const bytes = [n & 0x7f];
    while ((n >>= 7)) bytes.unshift((n & 0x7f) | 0x80);
    return bytes;
  }
  const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const u16 = (n) => [(n >>> 8) & 255, n & 255];
  const ascii = (s) => [...s].map((c) => c.charCodeAt(0) & 127);
  const PPQ = 96;

  function trackBytes(name, events, endT, withTempo, bpm) {
    const trk = [];
    trk.push(0, 0xff, 0x03, ...vlq(name.length), ...ascii(name));
    if (withTempo) {
      const us = Math.round(60000000 / bpm);
      trk.push(0, 0xff, 0x51, 0x03, (us >> 16) & 255, (us >> 8) & 255, us & 255);
      trk.push(0, 0xff, 0x58, 0x04, 4, 2, 24, 8); // 4/4
    }
    events.sort((a, b) => a.t - b.t || a.order - b.order);
    let last = 0;
    for (const e of events) { trk.push(...vlq(e.t - last), ...e.data); last = e.t; }
    trk.push(...vlq(Math.max(0, endT - last)), 0xff, 0x2f, 0x00);
    return ascii('MTrk').concat(u32(trk.length), trk);
  }

  function drumEvents(notes, stepTicks) {
    const midiOf = Object.fromEntries(BV.DRUMS.map((d) => [d.id, d.midi]));
    const len = Math.max(1, Math.round(stepTicks / 2));
    const ev = [];
    for (const n of notes) {
      const t = Math.round(n.step * stepTicks), k = midiOf[n.drum];
      const v = Math.max(1, Math.min(127, Math.round(n.vel)));
      ev.push({ t, order: 1, data: [0x99, k, v] }, { t: t + len, order: 0, data: [0x89, k, 0] });
    }
    return ev;
  }

  function leadEvents(notes, stepTicks, ch = 0) {
    const ev = [];
    for (const n of notes) {
      const t = Math.round(n.step * stepTicks), k = Math.max(0, Math.min(127, n.pitch));
      const v = Math.max(1, Math.min(127, Math.round(n.vel)));
      const off = t + Math.max(1, Math.round(n.len * stepTicks) - 1);
      ev.push({ t, order: 1, data: [0x90 | ch, k, v] }, { t: off, order: 0, data: [0x80 | ch, k, 0] });
    }
    return ev;
  }

  // curvas dos efeitos da voz → CC e pitch bend no canal do lead (só quando o valor muda)
  const CC_OF = { vol: 11, garra: 1, vogal: 74, ar: 91 };
  function autoEvents(fx, stepTicks) {
    const ev = [], N = fx.n * fx.res, tk = (k) => Math.round((k * stepTicks) / fx.res);
    for (const key in CC_OF) {
      const arr = fx[key];
      if (!arr) continue;
      let last = -1;
      for (let k = 0; k < N; k++) {
        const v = Math.max(0, Math.min(127, Math.round(arr[k] * 127)));
        if (v !== last) { ev.push({ t: tk(k), order: 0, data: [0xb0, CC_OF[key], v] }); last = v; }
      }
      ev.push({ t: tk(N), order: 0, data: [0xb0, CC_OF[key], key === 'vol' ? 127 : 0] });
    }
    if (fx.bend) {
      // alcance do pitch bend: ±2 semitons (RPN 0)
      ev.push(...[[101, 0], [100, 0], [6, 2], [38, 0]].map(([c, v], i) => ({ t: 0, order: -10 + i, data: [0xb0, c, v] })));
      let last = -1;
      for (let k = 0; k < N; k++) {
        const v = Math.max(0, Math.min(16383, Math.round(8192 + (fx.bend[k] / 2) * 8191)));
        if (Math.abs(v - last) >= 24) { ev.push({ t: tk(k), order: 0, data: [0xe0, v & 127, v >> 7] }); last = v; }
      }
      ev.push({ t: tk(N), order: 0, data: [0xe0, 0, 64] });
    }
    return ev;
  }

  /**
   * @param {{drums?:Array, lead?:Array, leadAuto?:object, bpm:number, stepsPerBeat:number, totalSteps:number}} o
   * @returns {Uint8Array}
   */
  function build(o) {
    const stepTicks = PPQ / o.stepsPerBeat;
    const endT = Math.round(o.totalSteps * stepTicks);
    const parts = [];
    if (o.drums) parts.push(['BeatVox Bateria', drumEvents(o.drums, stepTicks)]);
    if (o.lead) parts.push(['BeatVox Lead', leadEvents(o.lead, stepTicks).concat(o.leadAuto ? autoEvents(o.leadAuto, stepTicks) : [])]);
    if (o.bass) parts.push(['BeatVox 808', leadEvents(o.bass, stepTicks, 1)]);
    let tracks;
    if (parts.length === 1) {
      tracks = [trackBytes(parts[0][0], parts[0][1], endT, true, o.bpm)];
    } else {
      tracks = [trackBytes('BeatVox', [], endT, true, o.bpm), ...parts.map(([n, e]) => trackBytes(n, e, endT, false))];
    }
    const fmt = tracks.length === 1 ? 0 : 1;
    const header = ascii('MThd').concat(u32(6), u16(fmt), u16(tracks.length), u16(PPQ));
    return new Uint8Array(header.concat(...tracks));
  }

  BV.midi = { build };
  if (typeof module !== 'undefined') module.exports = BV;
})(typeof window !== 'undefined' ? window : globalThis);
