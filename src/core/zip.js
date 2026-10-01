// Lecture / écriture d'archives ZIP en JavaScript pur (navigateur et Node).
// La décompression DEFLATE suit l'algorithme de « tinf » (Joergen Ibsen) / tiny-inflate (licence MIT).

export class ZipError extends Error {}

// --- DEFLATE : décompression (RFC 1951) -----------------------------------------

class Tree {
  constructor() {
    this.table = new Uint16Array(16);
    this.trans = new Uint16Array(288);
  }
}

const lengthBits = new Uint8Array(30);
const lengthBase = new Uint16Array(30);
const distBits = new Uint8Array(30);
const distBase = new Uint16Array(30);
const CLC_INDEX = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

function buildBitsBase(bits, base, delta, first) {
  for (let i = 0; i < delta; i++) bits[i] = 0;
  for (let i = 0; i < 30 - delta; i++) bits[i + delta] = (i / delta) | 0;
  for (let s = first, i = 0; i < 30; i++) {
    base[i] = s;
    s += 1 << bits[i];
  }
}
buildBitsBase(lengthBits, lengthBase, 4, 3);
buildBitsBase(distBits, distBase, 2, 1);
lengthBits[28] = 0;
lengthBase[28] = 258;

const fixedLit = new Tree();
const fixedDist = new Tree();
(() => {
  fixedLit.table.set([0, 0, 0, 0, 0, 0, 0, 24, 152, 112]);
  for (let i = 0; i < 24; i++) fixedLit.trans[i] = 256 + i;
  for (let i = 0; i < 144; i++) fixedLit.trans[24 + i] = i;
  for (let i = 0; i < 8; i++) fixedLit.trans[168 + i] = 280 + i;
  for (let i = 0; i < 112; i++) fixedLit.trans[176 + i] = 144 + i;
  fixedDist.table[5] = 32;
  for (let i = 0; i < 32; i++) fixedDist.trans[i] = i;
})();

const offs = new Uint16Array(16);
function buildTree(t, lengths, off, num) {
  t.table.fill(0);
  for (let i = 0; i < num; i++) t.table[lengths[off + i]]++;
  t.table[0] = 0;
  for (let s = 0, i = 0; i < 16; i++) {
    offs[i] = s;
    s += t.table[i];
  }
  for (let i = 0; i < num; i++) if (lengths[off + i]) t.trans[offs[lengths[off + i]]++] = i;
}

/** Décompresse un flux DEFLATE brut dont la taille décompressée est connue. */
export function inflateRaw(source, size) {
  const d = { source, index: 0, tag: 0, bitcount: 0, dest: new Uint8Array(size), length: 0 };
  const limit = source.length + 4;
  const refill = () => {
    while (d.bitcount < 24) {
      d.tag |= (d.source[d.index++] ?? 0) << d.bitcount;
      d.bitcount += 8;
    }
    if (d.index > limit + 4) throw new ZipError('Données compressées corrompues');
  };
  const getBit = () => {
    if (!d.bitcount--) {
      d.tag = d.source[d.index++] ?? 0;
      d.bitcount = 7;
    }
    const bit = d.tag & 1;
    d.tag >>>= 1;
    return bit;
  };
  const readBits = (num, base) => {
    if (!num) return base;
    refill();
    const val = d.tag & (0xffff >>> (16 - num));
    d.tag >>>= num;
    d.bitcount -= num;
    return val + base;
  };
  const decodeSymbol = (t) => {
    refill();
    let s = 0;
    let cur = 0;
    let len = 0;
    let tag = d.tag;
    do {
      cur = 2 * cur + (tag & 1);
      tag >>>= 1;
      if (++len > 15) throw new ZipError('Données compressées corrompues');
      s += t.table[len];
      cur -= t.table[len];
    } while (cur >= 0);
    d.tag = tag;
    d.bitcount -= len;
    return t.trans[s + cur];
  };
  const put = (byte) => {
    if (d.length >= size) throw new ZipError('Données compressées corrompues');
    d.dest[d.length++] = byte;
  };

  const lt = new Tree();
  const dt = new Tree();
  const codeTree = new Tree();
  const lengths = new Uint8Array(288 + 32);

  const decodeTrees = () => {
    const hlit = readBits(5, 257);
    const hdist = readBits(5, 1);
    const hclen = readBits(4, 4);
    lengths.fill(0, 0, 19);
    for (let i = 0; i < hclen; i++) lengths[CLC_INDEX[i]] = readBits(3, 0);
    buildTree(codeTree, lengths, 0, 19);
    for (let num = 0; num < hlit + hdist;) {
      const sym = decodeSymbol(codeTree);
      let repeat;
      let value = 0;
      if (sym === 16) {
        value = lengths[num - 1];
        repeat = readBits(2, 3);
      } else if (sym === 17) {
        repeat = readBits(3, 3);
      } else if (sym === 18) {
        repeat = readBits(7, 11);
      } else {
        lengths[num++] = sym;
        continue;
      }
      if (num + repeat > hlit + hdist) throw new ZipError('Données compressées corrompues');
      while (repeat--) lengths[num++] = value;
    }
    buildTree(lt, lengths, 0, hlit);
    buildTree(dt, lengths, hlit, hdist);
  };

  const inflateBlock = (lit, dist) => {
    for (;;) {
      const sym = decodeSymbol(lit);
      if (sym === 256) return;
      if (sym < 256) {
        put(sym);
        continue;
      }
      const s = sym - 257;
      if (s >= 29) throw new ZipError('Données compressées corrompues');
      const length = readBits(lengthBits[s], lengthBase[s]);
      const ds = decodeSymbol(dist);
      const from = d.length - readBits(distBits[ds], distBase[ds]);
      if (from < 0) throw new ZipError('Données compressées corrompues');
      for (let i = from; i < from + length; i++) put(d.dest[i]);
    }
  };

  let final;
  do {
    final = getBit();
    const type = readBits(2, 0);
    if (type === 0) {
      // Bloc non compressé : on revient à la frontière d'octet.
      while (d.bitcount > 8) {
        d.index--;
        d.bitcount -= 8;
      }
      const len = d.source[d.index] | (d.source[d.index + 1] << 8);
      d.index += 4;
      if (d.index + len > source.length) throw new ZipError('Données compressées corrompues');
      for (let i = 0; i < len; i++) put(d.source[d.index++]);
      d.tag = 0;
      d.bitcount = 0;
    } else if (type === 1) {
      inflateBlock(fixedLit, fixedDist);
    } else if (type === 2) {
      decodeTrees();
      inflateBlock(lt, dt);
    } else {
      throw new ZipError('Données compressées corrompues');
    }
  } while (!final);

  return d.length === size ? d.dest : d.dest.subarray(0, d.length);
}

// --- CRC-32 -----------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// --- Archive ZIP --------------------------------------------------------------------

const MAX_UNCOMPRESSED = 100 * 1024 * 1024;
const utf8 = new TextDecoder();
const encoder = new TextEncoder();

/** Ouvre une archive ; renvoie une fonction `read(nom)` qui donne le contenu texte d'un fichier (ou null). */
export function readZip(input) {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const u16 = (o) => view.getUint16(o, true);
  const u32 = (o) => view.getUint32(o, true);
  if (buf.length < 22) throw new ZipError('Fichier vide ou trop court');

  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (u32(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError("Le fichier n'est pas une archive ZIP");

  const entries = new Map();
  let ptr = u32(eocd + 16);
  let total = 0;
  for (let n = u16(eocd + 10); n > 0; n--) {
    if (ptr + 46 > buf.length || u32(ptr) !== 0x02014b50) throw new ZipError('Archive corrompue');
    const nameLen = u16(ptr + 28);
    const entry = {
      method: u16(ptr + 10),
      compressed: u32(ptr + 20),
      size: u32(ptr + 24),
      offset: u32(ptr + 42),
    };
    entries.set(utf8.decode(buf.subarray(ptr + 46, ptr + 46 + nameLen)), entry);
    total += entry.size;
    ptr += 46 + nameLen + u16(ptr + 30) + u16(ptr + 32);
  }
  if (total > MAX_UNCOMPRESSED) throw new ZipError('Archive trop volumineuse');

  return (name) => {
    const e = entries.get(name);
    if (!e) return null;
    if (e.offset + 30 > buf.length || u32(e.offset) !== 0x04034b50) throw new ZipError('Archive corrompue');
    const start = e.offset + 30 + u16(e.offset + 26) + u16(e.offset + 28);
    const data = buf.subarray(start, start + e.compressed);
    if (e.method === 0) return utf8.decode(data);
    if (e.method === 8) return utf8.decode(inflateRaw(data, e.size));
    throw new ZipError('Méthode de compression non prise en charge');
  };
}

/** Crée une archive (fichiers stockés sans compression, format accepté par Excel). */
export function writeZip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of files) {
    const data = typeof content === 'string' ? encoder.encode(content) : content;
    const nameBytes = encoder.encode(name);
    const crc = crc32(data);
    const header = (size) => {
      const h = new DataView(new ArrayBuffer(size));
      return h;
    };

    const local = header(30);
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // noms en UTF-8
    local.setUint16(8, 0, true); // stocké
    local.setUint16(12, 0x21, true); // date : 1980-01-01
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);

    const dir = header(46);
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, 0, true);
    dir.setUint16(14, 0x21, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, data.length, true);
    dir.setUint32(24, data.length, true);
    dir.setUint16(28, nameBytes.length, true);
    dir.setUint32(42, offset, true);

    parts.push(new Uint8Array(local.buffer), nameBytes, data);
    central.push(new Uint8Array(dir.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const centralSize = central.reduce((a, p) => a + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((a, p) => a + p.length, 0));
  let pos = 0;
  for (const p of all) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}
