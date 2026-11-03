// Writes Skyline Leads to disk.
//   node tools/skyline.mjs            -> data/skyline-leads.csv (3,000 rows)
//   node tools/skyline.mjs 10000 out.csv

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSkyline, SEQUENCE_PLANTED, SEQUENCE_FIXED } from '../src/engine/skyline.js';

export { makeSkyline, SEQUENCE_PLANTED, SEQUENCE_FIXED };

function csvLine(cells) {
  return cells.map(c => (/[",\r\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c)).join(',');
}

export function skylineCSV(n, seed) {
  const s = makeSkyline(n, seed);
  return { ...s, csv: [csvLine(s.headers), ...s.rows.map(csvLine)].join('\n') + '\n' };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const n = Number(process.argv[2] || 3000);
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const out = process.argv[3] || `${root}/data/skyline-leads.csv`;
  const { csv, planted } = skylineCSV(n);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, csv);
  if (!process.argv[3]) {
    writeFileSync(`${root}/data/skyline-sequence.json`, JSON.stringify({ planted: SEQUENCE_PLANTED, fixed: SEQUENCE_FIXED }, null, 2) + '\n');
  }
  console.log(`${n} rows, ${planted.length} planted problems -> ${out}`);
}
