// Baggage Claim: the lead list comes in messy and leaves clean.
// Order matters: fix fields, then merge twins (a twin can fill a blank),
// then hold back anything that still can't safely be emailed.

import { FIELD_LABELS } from './columns.js';
import {
  tidySpaces, properName, cleanFirstName, cleanCompany, cleanEmail, cleanTitle,
  nameProblem, emailProblem, isRoleAddress, linkedinKey, splitFullName,
} from './clean.js';

export function buildManifest(parsed, map) {
  const headers = parsed.headers.slice();
  const columnMap = { ...map };
  const changes = [];

  // No first-name column but a full name: add First/Last columns so tags work.
  let splitFrom = -1;
  if (!('first_name' in columnMap) && 'full_name' in columnMap) {
    splitFrom = columnMap.full_name;
    columnMap.first_name = headers.push('First Name') - 1;
    if (!('last_name' in columnMap)) columnMap.last_name = headers.push('Last Name') - 1;
  }

  const leads = parsed.rows.map((r, i) => {
    const cells = r.slice();
    while (cells.length < headers.length) cells.push('');
    return { id: i, row: i + 2, original: r, cells, twinRows: [] };
  });

  const log = (lead, col, before, after, why) => {
    if (before === after) return;
    lead.cells[col] = after;
    changes.push({ id: changes.length, leadId: lead.id, row: lead.row, column: headers[col], col, before, after, why });
  };

  for (const lead of leads) {
    const c = lead.cells;
    if (splitFrom !== -1) {
      const { first, last } = splitFullName(c[splitFrom]);
      log(lead, columnMap.first_name, '', first, 'split from the full name');
      if (headers[columnMap.last_name] === 'Last Name' && !c[columnMap.last_name]) {
        log(lead, columnMap.last_name, '', last, 'split from the full name');
      }
    }
    fix(lead, 'first_name', cleanFirstName);
    fix(lead, 'last_name', v => {
      const t = tidySpaces(v); const p = properName(t);
      return { value: p, why: [t !== v ? 'trimmed spaces' : '', p !== t ? 'fixed capitals' : ''].filter(Boolean) };
    });
    fix(lead, 'company', v => {
      const r = cleanCompany(v);
      if (tidySpaces(v) !== v) r.why.unshift('trimmed spaces');
      return r;
    });
    fix(lead, 'email', cleanEmail);
    fix(lead, 'title', cleanTitle);
  }

  function fix(lead, field, fn) {
    if (!(field in columnMap)) return;
    const col = columnMap[field];
    const before = lead.cells[col] ?? '';
    const { value, why } = fn(before);
    if (value !== before) log(lead, col, before, value, why.join(', ') || 'tidied');
  }

  // ---- Twins (certain only: same email or same LinkedIn profile) ----
  const parent = leads.map((_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const reason = new Map();
  const join = (a, b, why) => {
    const ra = find(a), rb = find(b);
    if (ra === rb) return;
    const [keep, drop] = ra < rb ? [ra, rb] : [rb, ra];
    parent[drop] = keep;
    reason.set(drop, why);
  };
  const seen = { email: new Map(), linkedin: new Map() };
  for (const lead of leads) {
    const email = 'email' in columnMap ? lead.cells[columnMap.email] : '';
    if (email && !emailProblem(email)) {
      if (seen.email.has(email)) join(seen.email.get(email), lead.id, 'same email');
      else seen.email.set(email, lead.id);
    }
    const li = 'linkedin' in columnMap ? linkedinKey(lead.cells[columnMap.linkedin]) : '';
    if (li) {
      if (seen.linkedin.has(li)) join(seen.linkedin.get(li), lead.id, 'same LinkedIn profile');
      else seen.linkedin.set(li, lead.id);
    }
  }

  const groups = new Map();
  for (const lead of leads) {
    const root = find(lead.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(lead);
  }

  const twins = [];
  const kept = [];
  for (const [root, members] of groups) {
    const keep = leads[root];
    kept.push(keep);
    if (members.length < 2) continue;
    const others = members.filter(m => m !== keep);
    // Fill the kept row's blanks from its twins, first non-blank wins.
    for (let col = 0; col < headers.length; col++) {
      if (tidySpaces(keep.cells[col])) continue;
      const donor = others.find(o => tidySpaces(o.cells[col]));
      if (donor) log(keep, col, keep.cells[col] ?? '', donor.cells[col], `filled from its twin on row ${donor.row}`);
    }
    keep.twinRows = others.map(o => o.row);
    twins.push({
      keepId: keep.id,
      keepRow: keep.row,
      mergedRows: others.map(o => o.row),
      mergedIds: others.map(o => o.id),
      why: others.map(o => reason.get(o.id) || 'same email').filter((v, i, a) => a.indexOf(v) === i).join(' and '),
    });
  }
  kept.sort((a, b) => a.id - b.id);

  // ---- Lost & Found: rows that can't safely be emailed ----
  const boarding = [];
  const lostFound = [];
  for (const lead of kept) {
    const reasons = [];
    const first = 'first_name' in columnMap ? lead.cells[columnMap.first_name] : '';
    const email = 'email' in columnMap ? lead.cells[columnMap.email] : '';
    const np = nameProblem(first);
    if (np) reasons.push(np);
    const ep = emailProblem(email);
    if (ep) reasons.push(ep);
    if (reasons.length) lostFound.push({ lead, reasons });
    else {
      lead.role = isRoleAddress(email);
      boarding.push(lead);
    }
  }

  return {
    headers,
    map: columnMap,
    leads: boarding,
    lostFound,
    twins,
    changes,
    stats: {
      rows: parsed.rows.length,
      boarding: boarding.length,
      lostFound: lostFound.length,
      twinsMerged: twins.reduce((n, t) => n + t.mergedRows.length, 0),
      fixes: changes.filter(c => !c.why.startsWith('filled from')).length,
      roleAddresses: boarding.filter(l => l.role).length,
    },
    labels: FIELD_LABELS,
  };
}
