// Take-off: three files. Every cell goes through safeCell, so a lead whose
// name starts with "=" can't run as a formula when the file is opened.

import { toCSV } from './csv.js';

export function boardedCSV(manifest, gate) {
  const rows = gate.results.filter(r => r.status === 'cleared').map(r => r.lead.cells.slice(0, manifest.headers.length));
  return toCSV(manifest.headers, rows);
}

export function heldCSV(manifest, gate) {
  const headers = [...manifest.headers, 'Held at', 'Reason'];
  const rows = [];
  for (const { lead, reasons } of manifest.lostFound) {
    rows.push([...lead.cells.slice(0, manifest.headers.length), 'Baggage Claim', reasons.join('; ')]);
  }
  for (const r of gate.results) {
    if (r.status !== 'held') continue;
    const why = r.issues.filter(x => x.level === 'mayday').map(x => (x.step ? `Step ${x.step}: ` : '') + x.label);
    rows.push([...r.lead.cells.slice(0, manifest.headers.length), 'Boarding Gate', why.join('; ')]);
  }
  return toCSV(headers, rows);
}

export function changesCSV(manifest) {
  const headers = ['Row', 'Column', 'Before', 'After', 'Why'];
  const rows = manifest.changes.map(c => [c.row, c.column, c.before, c.after, c.why]);
  for (const t of manifest.twins) {
    for (const r of t.mergedRows) rows.push([r, '(whole row)', `row ${r}`, `merged into row ${t.keepRow}`, t.why]);
  }
  rows.sort((a, b) => a[0] - b[0]);
  return toCSV(headers, rows);
}
