// Lecture et écriture minimales de classeurs Excel (.xlsx) sans dépendance externe.
// Un .xlsx est une archive ZIP contenant des fichiers XML (format Office Open XML).
import { inflateRawSync, deflateRawSync, crc32 } from 'node:zlib';

const MAX_UNCOMPRESSED = 100 * 1024 * 1024;

export class XlsxError extends Error {}

// --- ZIP ----------------------------------------------------------------------

function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new XlsxError("Le fichier n'est pas un classeur Excel (.xlsx) valide");

  const count = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (ptr + 46 > buf.length || buf.readUInt32LE(ptr) !== 0x02014b50) throw new XlsxError('Archive corrompue');
    const method = buf.readUInt16LE(ptr + 10);
    const compressed = buf.readUInt32LE(ptr + 20);
    const size = buf.readUInt32LE(ptr + 24);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const offset = buf.readUInt32LE(ptr + 42);
    const name = buf.toString('utf8', ptr + 46, ptr + 46 + nameLen);
    entries.set(name, { method, compressed, size, offset });
    total += size;
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  if (total > MAX_UNCOMPRESSED) throw new XlsxError('Classeur trop volumineux');

  return (name) => {
    const e = entries.get(name);
    if (!e) return null;
    if (buf.readUInt32LE(e.offset) !== 0x04034b50) throw new XlsxError('Archive corrompue');
    const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28);
    const data = buf.subarray(start, start + e.compressed);
    if (e.method === 0) return data.toString('utf8');
    if (e.method === 8) return inflateRawSync(data, { maxOutputLength: MAX_UNCOMPRESSED }).toString('utf8');
    throw new XlsxError('Méthode de compression non prise en charge');
  };
}

function writeZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of files) {
    const raw = Buffer.from(content, 'utf8');
    const data = deflateRawSync(raw);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);           // version
    local.writeUInt16LE(0x0800, 6);       // noms en UTF-8
    local.writeUInt16LE(8, 8);            // deflate
    local.writeUInt16LE(0, 10);           // heure
    local.writeUInt16LE(0x21, 12);        // date (1980-01-01)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);

    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const centralDir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDir, end]);
}

// --- XML ------------------------------------------------------------------------

function decodeXml(s) {
  return s
    .replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e) => {
      switch (e.toLowerCase()) {
        case 'lt': return '<';
        case 'gt': return '>';
        case 'amp': return '&';
        case 'quot': return '"';
        case 'apos': return "'";
        default: return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      }
    })
    .replace(/_x([0-9A-Fa-f]{4})_/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
}

function encodeXml(s) {
  return String(s)
    // Caractères de contrôle interdits en XML
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w:]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) out[m[1]] = decodeXml(m[3] ?? m[4]);
  return out;
}

/** Texte d'un nœud <si> ou <is> : concatène les <t>, en ignorant les annotations phonétiques. */
function richText(xml) {
  const cleaned = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let text = '';
  for (const m of cleaned.matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)) text += decodeXml(m[1] ?? '');
  return text;
}

function colIndex(ref) {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase();
  if (!letters) return -1;
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function colName(index) {
  let s = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

// --- Lecture ------------------------------------------------------------------

/**
 * Lit un classeur. Renvoie `{ sheets: [{ name, rows }], date1904 }` où `rows` est un
 * tableau de lignes (tableaux de cellules : chaîne, nombre, booléen ou null).
 */
export function readXlsx(buffer) {
  const read = readZip(buffer);
  const workbook = read('xl/workbook.xml');
  if (!workbook) throw new XlsxError("Le fichier n'est pas un classeur Excel (.xlsx) valide");

  const rels = new Map();
  for (const m of (read('xl/_rels/workbook.xml.rels') ?? '').matchAll(/<Relationship\b[^>]*>/g)) {
    const a = attrs(m[0]);
    rels.set(a.Id, a.Target);
  }

  const shared = [];
  for (const m of (read('xl/sharedStrings.xml') ?? '').matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)) {
    shared.push(richText(m[1] ?? ''));
  }

  const date1904 = /<workbookPr\b[^>]*date1904\s*=\s*["'](1|true)["']/.test(workbook);
  const sheets = [];
  for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const a = attrs(m[0]);
    const target = rels.get(a['r:id']);
    if (!target) continue;
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    const xml = read(path);
    if (xml === null) continue;
    sheets.push({ name: a.name, rows: parseSheet(xml, shared) });
  }
  return { sheets, date1904 };
}

function parseSheet(xml, shared) {
  const rows = [];
  let nextRow = 0;
  for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const r = attrs(rm[1]).r;
    const rowIndex = r ? Number(r) - 1 : nextRow;
    nextRow = rowIndex + 1;
    const row = [];
    let nextCol = 0;
    for (const cm of (rm[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = attrs(cm[1]);
      const col = a.r ? colIndex(a.r) : nextCol;
      nextCol = col + 1;
      const inner = cm[2] ?? '';
      const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let value = null;
      switch (a.t) {
        case 's': value = v === undefined ? null : shared[Number(v)] ?? null; break;
        case 'inlineStr': value = richText(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(inner)?.[1] ?? ''); break;
        case 'str': value = v === undefined ? null : decodeXml(v); break;
        case 'b': value = v === undefined ? null : v.trim() === '1'; break;
        case 'e': value = null; break;
        case 'd': value = v === undefined ? null : decodeXml(v).slice(0, 10); break;
        default: value = v === undefined || v.trim() === '' ? null : Number(v);
      }
      if (col >= 0) row[col] = value;
    }
    rows[rowIndex] = Array.from(row, (x) => x ?? null);
  }
  return Array.from(rows, (x) => x ?? []);
}

/** Convertit un numéro de série Excel en date AAAA-MM-JJ. */
export function excelSerialToIso(serial, date1904 = false) {
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  return new Date(epoch + Math.floor(serial) * 86400000).toISOString().slice(0, 10);
}

function isoToExcelSerial(iso) {
  return (Date.parse(`${iso}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86400000;
}

// --- Écriture -----------------------------------------------------------------

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF3B5BDB"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const STYLE = { date: 1, header: 2, money: 3, wrap: 4 };

function cellXml(ref, value, type) {
  if (value === null || value === undefined || value === '') return '';
  if (type === 'date' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `<c r="${ref}" s="${STYLE.date}"><v>${isoToExcelSerial(value)}</v></c>`;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}"${type === 'money' ? ` s="${STYLE.money}"` : ''}><v>${value}</v></c>`;
  }
  if (typeof value === 'boolean') return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
  const style = type === 'wrap' ? ` s="${STYLE.wrap}"` : '';
  return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${encodeXml(value)}</t></is></c>`;
}

function filterRef({ columns, rows, autoFilter = true }) {
  if (!autoFilter || !rows.length) return null;
  return `A1:${colName(Math.max(columns.length - 1, 0))}${rows.length + 1}`;
}

const absRef = (ref) => ref.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2');

function sheetXml({ columns, rows, autoFilter }) {
  const header = `<row r="1">${columns.map((c, i) =>
    `<c r="${colName(i)}1" t="inlineStr" s="${STYLE.header}"><is><t>${encodeXml(c.header)}</t></is></c>`).join('')}</row>`;
  const body = rows.map((row, r) => `<row r="${r + 2}">${columns.map((c, i) =>
    cellXml(`${colName(i)}${r + 2}`, row[i], c.type)).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? 16}" customWidth="1"/>`).join('')}</cols>
<sheetData>${header}${body}</sheetData>
${filterRef({ columns, rows, autoFilter }) ? `<autoFilter ref="${filterRef({ columns, rows, autoFilter })}"/>` : ''}
</worksheet>`;
}

function definedNames(sheets) {
  const names = sheets.map((s, i) => {
    const ref = filterRef(s);
    if (!ref) return '';
    const quoted = `'${s.name.replace(/'/g, "''")}'`;
    return `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${encodeXml(`${quoted}!${absRef(ref)}`)}</definedName>`;
  }).join('');
  return names ? `<definedNames>${names}</definedNames>` : '';
}

/**
 * Crée un classeur. `sheets` : [{ name, columns: [{ header, type?, width? }], rows: [[...]], autoFilter? }].
 * Types de colonne : 'date' (chaîne AAAA-MM-JJ), 'money', 'wrap' ou texte/nombre par défaut.
 */
export function writeXlsx(sheets) {
  const files = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n')}
</Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheets.map((s, i) => `<sheet name="${encodeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
${definedNames(sheets)}
</workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('\n')}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`],
    ['xl/styles.xml', STYLES],
    ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)]),
  ];
  return writeZip(files);
}
