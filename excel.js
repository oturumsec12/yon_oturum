/**
 * Ek bağımlılık gerektirmeyen, gerçek .xlsx (Office Open XML) üreticisi.
 * ZIP dosyası DEFLATE yerine STORE biçiminde yazılır.
 * Tüm hücreler Unicode inline string veya sayı olarak saklanır.
 */
const encode = new TextEncoder();
const xml = v => String(v ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
}[c]));
function columnName(index) {
  let result = "";
  for (let x = index + 1; x > 0; x = Math.floor((x - 1) / 26)) {
    result = String.fromCharCode(65 + (x - 1) % 26) + result;
  }
  return result;
}
function sheetXml(rows) {
  const maxColumns = rows.reduce((max, r) => Math.max(max, r.length), 0);
  const end = maxColumns && rows.length ? `${columnName(maxColumns - 1)}${rows.length}` : "A1";
  const body = rows.map((cells, y) => `<row r="${y + 1}">${cells.map((value, x) => {
    const at = `${columnName(x)}${y + 1}`;
    const style = y === 0 ? ' s="1"' : "";
    if (typeof value === "number" && Number.isFinite(value)) return `<c r="${at}"${style}><v>${value}</v></c>`;
    return `<c r="${at}"${style} t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
  }).join("")}</row>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<dimension ref="A1:${end}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="17"/><cols>${Array.from({length:maxColumns},(_,i) => `<col min="${i+1}" max="${i+1}" width="${[20,64,18][i] || 24}" customWidth="1"/>`).join("")}</cols>` +
    `<sheetData>${body}</sheetData><autoFilter ref="A1:${end}"/></worksheet>`;
}
// CRC32 ve ZIP yapısını üçüncü parti servis veya CDN olmadan oluştur.
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function put16(view, offset, value) { view.setUint16(offset, value, true); }
function put32(view, offset, value) { view.setUint32(offset, value >>> 0, true); }
function zip(files) {
  const pieces = []; const entries = []; let pos = 0;
  for (const [name, contents] of files) {
    const n = encode.encode(name), d = encode.encode(contents), crc = crc32(d);
    const header = new Uint8Array(30 + n.length);
    const v = new DataView(header.buffer);
    put32(v, 0, 0x04034b50); put16(v, 4, 20); put16(v, 6, 0x0800);
    put16(v, 8, 0); put16(v, 10, 0); put16(v, 12, 0);
    put32(v, 14, crc); put32(v, 18, d.length); put32(v, 22, d.length);
    put16(v, 26, n.length); put16(v, 28, 0); header.set(n, 30);
    pieces.push(header, d);
    entries.push({ n, crc, len: d.length, offset: pos });
    pos += header.length + d.length;
  }
  const directoryPos = pos;
  for (const entry of entries) {
    const header = new Uint8Array(46 + entry.n.length);
    const v = new DataView(header.buffer);
    put32(v, 0, 0x02014b50); put16(v, 4, 20); put16(v, 6, 20);
    put16(v, 8, 0x0800); put16(v, 10, 0); put16(v, 12, 0); put16(v, 14, 0);
    put32(v, 16, entry.crc); put32(v, 20, entry.len); put32(v, 24, entry.len);
    put16(v, 28, entry.n.length); put16(v, 30, 0); put16(v, 32, 0);
    put16(v, 34, 0); put16(v, 36, 0); put32(v, 38, 0); put32(v, 42, entry.offset);
    header.set(entry.n, 46); pieces.push(header); pos += header.length;
  }
  const end = new Uint8Array(22), view = new DataView(end.buffer);
  put32(view, 0, 0x06054b50); put16(view, 4, 0); put16(view, 6, 0);
  put16(view, 8, entries.length); put16(view, 10, entries.length);
  put32(view, 12, pos - directoryPos); put32(view, 16, directoryPos); put16(view, 20, 0);
  pieces.push(end);
  return new Blob(pieces, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
export function workbook(sheets) {
  if (!sheets.length) throw new Error("Excel için çalışma sayfası bulunamadı.");
  const names = sheets.map(s => s.name.slice(0, 31));
  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
    names.map((name, i) => `<sheet name="${xml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") + `</sheets></workbook>`;
  const bookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
    `<Relationship Id="rId${sheets.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`;
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
    `</Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>` +
    `<font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts>` +
    `<fills count="3"><fill><patternFill patternType="none"/></fill>` +
    `<fill><patternFill patternType="gray125"/></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FFC00000"/><bgColor indexed="64"/></patternFill></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1"/></cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`;
  const files = [
    ["[Content_Types].xml", types], ["_rels/.rels", rootRels],
    ["xl/workbook.xml", workbookXml], ["xl/_rels/workbook.xml.rels", bookRels], ["xl/styles.xml", styles],
    ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s.rows)]),
  ];
  return zip(files);
}
export function downloadWorkbook(sheets, filename) {
  const data = workbook(sheets);
  const url = URL.createObjectURL(data);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
