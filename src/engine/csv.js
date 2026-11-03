// CSV in and out. Plain RFC 4180: quoted fields, "" escapes, CRLF or LF,
// an optional BOM. Every cell stays a string; nothing is ever evaluated.

export function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const delim = sniffDelimiter(text);
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      cell += ch; i++; continue;
    }
    if (ch === '"' && cell === '') { quoted = true; i++; continue; }
    if (ch === delim) { row.push(cell); cell = ''; i++; continue; }
    if (ch === '\r' || ch === '\n') {
      row.push(cell); cell = '';
      rows.push(row); row = [];
      if (ch === '\r' && text[i + 1] === '\n') i++;
      i++; continue;
    }
    cell += ch; i++;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }

  // Drop fully blank lines (a trailing newline, spacer rows).
  const kept = rows.filter(r => r.some(c => c.trim() !== ''));
  if (!kept.length) return { headers: [], rows: [] };

  const headers = kept[0].map((h, idx) => h.trim() || `Column ${idx + 1}`);
  const width = headers.length;
  const body = kept.slice(1).map(r => {
    const out = r.slice(0, width);
    while (out.length < width) out.push('');
    return out;
  });
  return { headers, rows: body };
}

// Comma unless the header line clearly uses ; or tab (European Excel exports).
function sniffDelimiter(text) {
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const count = c => firstLine.split(c).length - 1;
  const commas = count(','), semis = count(';'), tabs = count('\t');
  if (tabs > commas && tabs >= semis) return '\t';
  if (semis > commas) return ';';
  return ',';
}

// A cell that starts with one of these can run as a formula when the file is
// opened in Excel or Sheets. Prefixing a single quote makes it plain text.
const FORMULA_START = /^[=+\-@\t\r]/;

export function safeCell(value) {
  const s = value == null ? '' : String(value);
  return FORMULA_START.test(s) ? "'" + s : s;
}

export function toCSV(headers, rows) {
  const line = cells => cells.map(c => quote(safeCell(c))).join(',');
  return [line(headers), ...rows.map(line)].join('\r\n') + '\r\n';
}

function quote(s) {
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
