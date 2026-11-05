// Email templates: {{tag}} and {{tag|fallback}}. Tags find their column by
// name, ignoring case, spaces and punctuation, so {{First Name}} and
// {{first_name}} both work. A template is compiled once, then filled
// thousands of times.

import { squash, FIELDS } from './columns.js';

const TAG = /\{\{\s*([^{}|]*?)\s*(?:\|\s*([^{}]*?)\s*)?\}\}/g;

// Field names a person might type, mapped to the field they mean.
const FIELD_ALIASES = {
  first_name: ['firstname', 'first', 'fname', 'name'],
  last_name: ['lastname', 'last', 'lname', 'surname'],
  full_name: ['fullname'],
  email: ['email', 'emailaddress'],
  company: ['company', 'companyname', 'organization', 'organisation', 'account'],
  title: ['title', 'jobtitle', 'role', 'position'],
  linkedin: ['linkedin', 'linkedinurl'],
  website: ['website', 'domain', 'companywebsite'],
};

// Variables your sending tool fills in itself: never a column, never a problem.
const SYSTEM = new Set(['signature', 'mysignature', 'accountsignature', 'unsubscribe', 'unsubscribelink', 'unsubscribeurl',
  'optout', 'optoutlink', 'myname', 'myfirstname', 'mylastname', 'mycompany', 'myemail', 'dayofweek', 'timeofday', 'today']);
export function isSystemTag(tag) {
  const k = squash(tag);
  return k.startsWith('sender') || SYSTEM.has(k);
}

export function resolveTag(tag, headers, map) {
  const key = squash(tag);
  if (!key) return -1;
  const direct = headers.findIndex(h => squash(h) === key);
  if (direct !== -1) return direct;
  for (const field of FIELDS) {
    if (field in map && FIELD_ALIASES[field].includes(key)) return map[field];
  }
  return -1;
}

export function fieldOfColumn(col, map) {
  for (const f of FIELDS) if (map[f] === col) return f;
  return null;
}

// Returns { parts, tags, broken } where parts alternate text and tag slots.
export function compile(text, headers, map) {
  const src = String(text ?? '');
  const parts = [];
  const tags = [];
  let last = 0;
  for (const m of src.matchAll(TAG)) {
    if (m.index > last) parts.push({ text: src.slice(last, m.index) });
    const col = resolveTag(m[1], headers, map);
    const slot = {
      raw: m[0],
      name: m[1],
      col,
      field: col === -1 ? null : fieldOfColumn(col, map),
      fallback: m[2] === undefined ? null : m[2],
      system: col === -1 && isSystemTag(m[1]),
    };
    parts.push(slot);
    tags.push(slot);
    last = m.index + m[0].length;
  }
  if (last < src.length) parts.push({ text: src.slice(last) });

  // Tags that didn't open or close properly: "{{first_name}", "{first_name}".
  // Spintax is resolved before this runs, so any brace left is a stray one.
  const broken = [];
  for (const p of parts) {
    if (!('text' in p)) continue;
    for (const m of p.text.matchAll(/[{}]+/g)) {
      const from = Math.max(0, p.text.lastIndexOf(' ', m.index) + 1);
      let to = p.text.indexOf(' ', m.index + m[0].length);
      if (to === -1) to = p.text.length;
      const snippet = p.text.slice(from, to).trim();
      if (snippet && !broken.includes(snippet)) broken.push(snippet);
    }
  }
  return { parts, tags, broken };
}

// Fill one compiled template for one lead. Returns the text and what went in.
export function fill(compiled, cells) {
  let out = '';
  const used = [];
  for (const p of compiled.parts) {
    if ('text' in p) { out += p.text; continue; }
    if (p.col === -1) {
      out += p.raw;
      used.push({ slot: p, value: null, unknown: !p.system, system: p.system });
      continue;
    }
    const value = String(cells[p.col] ?? '').trim();
    if (value) {
      out += value;
      used.push({ slot: p, value });
    } else if (p.fallback !== null) {
      out += p.fallback;
      used.push({ slot: p, value: p.fallback, fellBack: true });
    } else {
      used.push({ slot: p, value: '', empty: true, at: out.length });
    }
  }
  return { text: out, used };
}

export function nearestHeader(tag, headers) {
  const key = squash(tag);
  let best = null, bestD = Infinity;
  for (const h of headers) {
    const d = editDistance(key, squash(h));
    if (d < bestD) { bestD = d; best = h; }
  }
  return bestD <= Math.max(2, Math.floor(key.length / 3)) ? best : null;
}

function editDistance(a, b) {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

// Suggested tag spelling for a column: {{first_name}} style.
export function tagFor(header) {
  return '{{' + String(header).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') + '}}';
}
