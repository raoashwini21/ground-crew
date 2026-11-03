// Security Check + Boarding Gate. Every step of the sequence is filled in
// for every lead, exactly as the inbox would see it, and the finished text
// is checked. Any Mayday holds the lead; turbulence boards but is listed.

import { compile, fill, nearestHeader } from './template.js';
import { LEGAL_END } from './clean.js';

const SENTENCE_SPLIT = /((?<=[.!?])\s+)/;
const words = s => (String(s).match(/\S+/g) || []).length;
const isShouting = v => /\p{L}/u.test(v) && v === v.toUpperCase() && v !== v.toLowerCase() && v.replace(/[^\p{L}]/gu, '').length > 3;

// Compile a step: subject as one piece, the body sentence by sentence so a
// sentence that grows too long once filled can be pointed at.
export function compileStep(step, headers, map) {
  const subject = compile(step.subject || '', headers, map);
  const body = [];
  for (const piece of String(step.body || '').split(SENTENCE_SPLIT)) {
    if (piece === '') continue;
    if (/^\s+$/.test(piece)) { body.push({ sep: piece }); continue; }
    const c = compile(piece, headers, map);
    // Template length with each tag counted as one word.
    c.templateWords = words(c.parts.map(p => ('text' in p ? p.text : ' T ')).join(''));
    body.push(c);
  }
  const subjectTemplateLen = subject.parts.map(p => ('text' in p ? p.text : '')).join('').length;
  return { subject, body, subjectTemplateLen, hasSubject: !!String(step.subject || '').trim() };
}

function* checkIter(manifest, steps, chunk = 250) {
  const { headers, map, leads } = manifest;
  const compiled = steps.map(s => compileStep(s, headers, map));

  // Template-level problems hit every lead the same way; work them out once.
  const templateIssues = [];
  compiled.forEach((c, i) => {
    const all = [c.subject, ...c.body.filter(b => b.parts)];
    const seenUnknown = new Set();
    for (const part of all) {
      for (const t of part.tags) {
        if (t.col !== -1 || seenUnknown.has(t.name)) continue;
        seenUnknown.add(t.name);
        const near = nearestHeader(t.name, headers);
        templateIssues.push({
          kind: 'unknown_tag', level: 'mayday', step: i + 1,
          key: `unknown_tag:${t.name}`,
          label: `{{${t.name}}} isn't a column in your list`,
          hint: near ? `Did you mean {{${near}}}?` : 'Check the spelling against your column names.',
        });
      }
      for (const b of part.broken) {
        templateIssues.push({
          kind: 'broken_tag', level: 'mayday', step: i + 1,
          key: `broken_tag:${b}`, label: `Broken tag "${b}"`,
          hint: 'Tags need two braces on each side, like {{first_name}}.',
        });
      }
    }
  });

  // "Personal" lines from custom columns that repeat across many leads.
  const copied = new Map(); // col -> Set(values that repeat)
  const customCols = new Set();
  for (const c of compiled) for (const part of [c.subject, ...c.body.filter(b => b.parts)]) {
    for (const t of part.tags) if (t.col !== -1 && !t.field) customCols.add(t.col);
  }
  const repeatAt = Math.max(5, Math.ceil(leads.length * 0.02));
  for (const col of customCols) {
    const counts = new Map();
    for (const l of leads) {
      const v = String(l.cells[col] ?? '').trim();
      if (v) counts.set(v, (counts.get(v) || 0) + 1);
    }
    const hot = new Set([...counts].filter(([, n]) => n >= repeatAt).map(([v]) => v));
    if (hot.size) copied.set(col, { hot, counts });
  }

  const results = [];
  let emails = 0;
  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    const issues = templateIssues.slice();
    const rendered = [];

    compiled.forEach((c, si) => {
      const step = si + 1;
      const subj = fill(c.subject, lead.cells);
      const bodyParts = [];
      const used = [...subj.used.map(u => ({ ...u, where: 'subject', text: subj.text }))];
      for (const b of c.body) {
        if (b.sep !== undefined) { bodyParts.push(b.sep); continue; }
        const f = fill(b, lead.cells);
        bodyParts.push(f.text);
        for (const u of f.used) used.push({ ...u, where: 'body', text: f.text });
        if (f.used.some(u => u.value) && words(f.text) > 25 && b.templateWords <= 25) {
          issues.push({
            kind: 'long_line', level: 'turbulence', step, key: 'long_line',
            label: 'A sentence grows past 25 words once filled in',
            detail: clip(f.text, 90),
          });
        }
      }
      const body = bodyParts.join('');
      rendered.push({ step, subject: c.hasSubject ? subj.text : '', body });
      emails++;

      for (const u of used) {
        const tag = `{{${u.slot.name}}}`;
        if (u.empty) {
          issues.push({
            kind: 'empty_tag', level: 'mayday', step, key: `empty_tag:${u.slot.name}`,
            label: `${tag} is blank, with no fallback`,
            hint: `Fill it in, or add a fallback like {{${u.slot.name}|there}}.`,
            detail: gapSnippet(u.text, u),
          });
        } else if (u.value && !u.fellBack) {
          if (isShouting(u.value) && (u.slot.field === 'first_name' || u.slot.field === 'last_name')) {
            issues.push({ kind: 'shouting', level: 'mayday', step, key: `shouting:${u.slot.name}`, label: `${tag} is in capitals`, detail: `"${u.value}"` });
          } else if (isShouting(u.value) && u.slot.field === 'company') {
            issues.push({ kind: 'shouting', level: 'turbulence', step, key: `shouting:${u.slot.name}`, label: `${tag} is in capitals`, detail: `"${u.value}"` });
          }
          if (u.slot.field === 'company' && LEGAL_END.test(u.value)) {
            issues.push({ kind: 'legal_ending', level: 'turbulence', step, key: 'legal_ending', label: 'Company name still has a legal ending', detail: `"${u.value}"` });
          }
          const cp = copied.get(u.slot.col);
          if (cp && cp.hot.has(u.value)) {
            issues.push({
              kind: 'copied_line', level: 'turbulence', step, key: `copied_line:${u.slot.name}`,
              label: `The same ${tag} is used for many leads`,
              detail: `"${clip(u.value, 60)}" goes to ${cp.counts.get(u.value)} leads`,
            });
          }
        }
      }

      if (c.hasSubject && subj.used.some(u => u.value) && subj.text.length > 60 && c.subjectTemplateLen <= 60) {
        issues.push({ kind: 'long_subject', level: 'turbulence', step, key: 'long_subject', label: 'Subject runs over 60 characters once filled in', detail: `"${clip(subj.text, 80)}"` });
      }
      // A blank tag already explains its own stray comma; don't report it twice.
      const messy = used.some(u => u.empty) ? null : messySpot(subj.text) || messySpot(body);
      if (messy) {
        issues.push({ kind: 'messy', level: 'turbulence', step, key: 'messy', label: 'Messy spacing or punctuation', detail: messy });
      }
    });

    if (lead.role) {
      issues.push({ kind: 'role_address', level: 'turbulence', step: 0, key: 'role_address', label: 'Goes to a shared inbox (info@, sales@ and so on)', detail: lead.cells[map.email] });
    }

    const deduped = dedupeIssues(issues);
    const held = deduped.some(x => x.level === 'mayday');
    results.push({ lead, status: held ? 'held' : 'cleared', issues: deduped, rendered });

    if ((i + 1) % chunk === 0) yield { done: i + 1, total: leads.length, emails };
  }

  return summarise(results, emails, steps.length, manifest);
}

// One entry per problem per step, so a lead isn't told the same thing twice.
function dedupeIssues(list) {
  const seen = new Set();
  return list.filter(x => {
    const k = `${x.key}|${x.step}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function summarise(results, emails, stepCount, manifest) {
  const reasons = new Map();
  for (const r of results) {
    const seen = new Set();
    for (const x of r.issues) {
      if (!reasons.has(x.key)) {
        reasons.set(x.key, { key: x.key, kind: x.kind, level: x.level, label: x.label, hint: x.hint || '', steps: new Set(), leadIds: [], example: x.detail || '' });
      }
      const g = reasons.get(x.key);
      if (x.step) g.steps.add(x.step);
      if (!seen.has(x.key)) { g.leadIds.push(r.lead.id); seen.add(x.key); }
    }
  }
  const list = [...reasons.values()].map(g => ({ ...g, steps: [...g.steps].sort(), count: g.leadIds.length }));
  list.sort((a, b) => (a.level === b.level ? b.count - a.count : a.level === 'mayday' ? -1 : 1));

  const cleared = results.filter(r => r.status === 'cleared').length;
  return {
    results,
    reasons: list,
    counts: {
      leads: results.length,
      steps: stepCount,
      emails,
      cleared,
      held: results.length - cleared,
      heldAtBaggage: manifest.lostFound.length,
      turbulenceLeads: results.filter(r => r.status === 'cleared' && r.issues.length).length,
    },
    status: results.length && cleared === results.length ? 'CLEARED' : cleared === 0 ? 'GROUNDED' : 'DELAYED',
  };
}

function clip(s, n) {
  s = String(s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// The words around where a blank landed, e.g. "Hi , saw that…"
function gapSnippet(text, u) {
  const s = String(text);
  const at = typeof u.at === 'number' ? u.at : 0;
  let from = Math.max(0, at - 30);
  let to = Math.min(s.length, at + 30);
  if (from > 0) from = s.indexOf(' ', from) + 1 || from;
  if (to < s.length) { const sp = s.lastIndexOf(' ', to); if (sp > at) to = sp; }
  return (from > 0 ? '…' : '') + s.slice(from, to).replace(/\s+/g, ' ').trim() + (to < s.length ? '…' : '');
}

function messySpot(text) {
  const m = String(text).match(/\S* {2,}\S*|\S*\s[,.;:!?](?!\S*\.\.)\S*|\S*,,\S*|\S*(?<!\.)\.\.(?!\.)\S*/);
  return m ? `"${m[0].trim()}"` : null;
}

export function checkCampaign(manifest, steps) {
  const it = checkIter(manifest, steps);
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}

// Same work in small chunks, so the page keeps breathing on big lists.
export async function checkCampaignChunked(manifest, steps, onProgress) {
  const it = checkIter(manifest, steps);
  let r = it.next();
  while (!r.done) {
    if (onProgress) onProgress(r.value);
    await new Promise(res => setTimeout(res, 0));
    r = it.next();
  }
  return r.value;
}
