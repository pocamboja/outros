/* BeatVox — zip mínimo (sem compressão), para entregar o .mid onde só .zip é aceite. */
(function () {
  const BV = (window.BV = window.BV || {});
  const T = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; }
  const crc32 = (d) => { let c = 0xffffffff; for (let i = 0; i < d.length; i++) c = T[(c ^ d[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  /** files: [{name, data: Uint8Array}] → Uint8Array */
  function store(files) {
    const enc = new TextEncoder(), parts = [], central = [];
    let off = 0;
    const u16 = (v) => [v & 255, (v >>> 8) & 255], u32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
    for (const f of files) {
      const nm = enc.encode(f.name), crc = crc32(f.data), sz = f.data.length;
      const head = [...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(sz), ...u32(sz), ...u16(nm.length), ...u16(0)];
      parts.push(new Uint8Array(head), nm, f.data);
      central.push([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(sz), ...u32(sz), ...u16(nm.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)], nm);
      off += head.length + nm.length + sz;
    }
    let cdSize = 0;
    const cd = central.map((x) => { const a = x instanceof Uint8Array ? x : new Uint8Array(x); cdSize += a.length; return a; });
    const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(off), ...u16(0)]);
    const all = [...parts, ...cd, end], total = all.reduce((s, a) => s + a.length, 0), out = new Uint8Array(total);
    let o = 0; for (const a of all) { out.set(a, o); o += a.length; }
    return out;
  }
  BV.zip = { store, crc32 };
})();
