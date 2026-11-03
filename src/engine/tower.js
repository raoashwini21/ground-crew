// The Control Tower: copy checks on the template itself, before anything is
// filled in. Each rule has a radio line. The score is a writing heuristic,
// not a prediction of replies or deliverability.

import { compile, nearestHeader } from './template.js';

const SPAM = ['free', 'guarantee', 'guaranteed', 'act now', 'risk-free', 'risk free', 'click here', 'limited time', 'no obligation', '100%', 'winner', 'urgent', 'buy now', 'special offer', 'cash'];
const CLICHES = ['hope this finds you well', 'hope you are well', "hope you're well", 'synergy', 'synergies', 'game-changing', 'game changer', 'game-changer', 'circle back', 'touch base', 'quick call', 'pick your brain', 'revolutionary', 'cutting-edge', 'best-in-class', 'world-class', 'leverage'];
const WEAK_FOLLOWUP = ['just following up', 'following up', 'bumping this', 'bump this', 'just checking in', 'checking in', 'circling back', 'any update', 'did you get a chance'];

const wordList = s => String(s).match(/[\p{L}\p{N}'’-]+/gu) || [];
const sentences = s => String(s).split(/(?<=[.!?])\s+|\n+/).map(x => x.trim()).filter(Boolean);
const hasPhrase = (text, p) => new RegExp(`(^|[^\\p{L}])${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}]|$)`, 'iu').test(text);

export const RULES = [
  { id: 'unknown_tag', kind: 'mayday', name: 'A tag that isn\'t a column' },
  { id: 'blank_tag', kind: 'mayday', name: 'A tag with blanks in the list and no fallback' },
  { id: 'broken_tag', kind: 'mayday', name: 'A tag with missing braces' },
  { id: 'long_body', kind: 'turbulence', name: 'Body over about 100 words' },
  { id: 'loud_subject', kind: 'turbulence', name: 'Subject long, in capitals, or with "!"' },
  { id: 'me_heavy', kind: 'turbulence', name: 'Far more "I" and "we" than "you"' },
  { id: 'no_ask', kind: 'turbulence', name: 'No question or clear ask at the end' },
  { id: 'spam', kind: 'turbulence', name: 'Spammy words' },
  { id: 'links', kind: 'turbulence', name: 'More than one link, or any link in email 1' },
  { id: 'cliche', kind: 'turbulence', name: 'Clichés' },
  { id: 'long_sentence', kind: 'turbulence', name: 'A sentence over 25 words' },
  { id: 'exclaim', kind: 'turbulence', name: 'More than one "!"' },
  { id: 'weak_followup', kind: 'turbulence', name: '"Just following up" in a follow-up' },
  { id: 'em_dash', kind: 'turbulence', name: 'Em dash (house style)' },
];

export const PRESETS = {
  operator: RULES.map(r => r.id),
  gentle: ['unknown_tag', 'blank_tag', 'broken_tag', 'long_body'],
};

// manifest is optional: without it, tag checks only look at syntax.
export function towerCheck(step, index, { manifest = null, enabled = PRESETS.operator } = {}) {
  const on = new Set(enabled);
  const calls = [];
  const add = (rule, line, where = '') => { if (on.has(rule)) calls.push({ rule, kind: RULES.find(r => r.id === rule).kind, line, where }); };
  const subject = String(step.subject || '');
  const body = String(step.body || '');
  const isFirst = index === 0;

  if (manifest) {
    const seen = new Set();
    for (const part of [subject, body]) {
      const c = compile(part, manifest.headers, manifest.map);
      for (const t of c.tags) {
        if (seen.has(t.raw)) continue;
        seen.add(t.raw);
        if (t.col === -1) {
          const near = nearestHeader(t.name, manifest.headers);
          add('unknown_tag', `{{${t.name}}} isn't in your list.${near ? ` Did you mean {{${near.toLowerCase().replace(/[^a-z0-9]+/g, '_')}}}?` : ''}`);
        }
        else if (t.fallback === null) {
          const blanks = manifest.leads.filter(l => !String(l.cells[t.col] ?? '').trim()).length;
          if (blanks) add('blank_tag', `${fmtN(blanks)} lead${blanks === 1 ? ' has' : 's have'} no ${t.name}. Add a fallback, like {{${t.name}|your team}}.`);
        }
      }
      for (const b of c.broken) add('broken_tag', `"${b}" is a broken tag. Tags need two braces each side.`);
    }
  }

  // Strip tags so they don't count as words or trip the word checks.
  const plain = body.replace(/\{\{[^{}]*\}\}/g, 'X');
  const plainSubject = subject.replace(/\{\{[^{}]*\}\}/g, 'X');

  const n = wordList(plain).length;
  if (n > 100) add('long_body', `Reduce altitude: ${n} words. Aim under 100 for a phone.`);

  if (subject.trim()) {
    const sw = wordList(plainSubject).length;
    const letters = plainSubject.replace(/[^\p{L}]/gu, '');
    if (sw > 6 || plainSubject.includes('!') || (letters.length > 3 && letters === letters.toUpperCase())) {
      add('loud_subject', 'Subject too loud. Keep it short and quiet.', 'subject');
    }
  }

  const me = (plain.match(/\b(i|i'm|i've|i'd|me|my|we|we're|we've|our|us)\b/gi) || []).length;
  const you = (plain.match(/\b(you|you're|you've|your|yours)\b/gi) || []).length;
  if (me >= 4 && me > you * 2) add('me_heavy', `${me} I's and we's, ${you} you's. Make it about them.`);

  const lines = sentences(plain);
  // Ignore the sign-off ("Best,", "Ash") when looking for the ask.
  const bodyLines = plain.split('\n').map(x => x.trim()).filter(Boolean);
  while (bodyLines.length > 1 && wordList(bodyLines[bodyLines.length - 1]).length <= 3 && !/\?/.test(bodyLines[bodyLines.length - 1])) bodyLines.pop();
  const tail = sentences(bodyLines.join('\n')).slice(-2).join(' ');
  if (plain.trim() && !/\?/.test(tail) && !/\b(let me know|worth a|open to|interested|reply|thoughts)\b/i.test(tail)) {
    add('no_ask', 'No ask on approach. End with one easy question.');
  }

  const spamHit = SPAM.find(w => hasPhrase(plain + ' ' + plainSubject, w));
  if (spamHit) add('spam', `"${cap(spamHit)}" looks spammy to inboxes.`);

  const links = (plain.match(/https?:\/\/\S+|www\.\S+/gi) || []).length;
  if (links > 1 || (isFirst && links >= 1)) {
    add('links', isFirst ? 'Links on the first touch. Keep email 1 link-free.' : `${links} links. Keep it to one.`);
  }

  const cliche = CLICHES.find(w => hasPhrase(plain, w));
  if (cliche) add('cliche', `"${cap(cliche)}" on the radar. Say it plainly.`);

  const long = lines.find(s => wordList(s).length > 25);
  if (long) add('long_sentence', 'Long sentence. Break it in two.');

  if ((plain.match(/!/g) || []).length > 1) add('exclaim', 'Easy on the exclamation marks.');

  if (!isFirst && WEAK_FOLLOWUP.some(w => hasPhrase(plain, w))) add('weak_followup', 'Weak follow-up. Bring something new.');

  if (/—/.test(body + subject)) add('em_dash', 'Em dash spotted. Use a full stop.');

  const maydays = calls.filter(c => c.kind === 'mayday').length;
  const turb = calls.length - maydays;
  const score = Math.max(0, 100 - maydays * 25 - turb * 8);
  return { calls, score, clear: maydays === 0 && score >= 85, words: n };
}

const cap = s => s[0].toUpperCase() + s.slice(1);
const fmtN = n => Number(n).toLocaleString('en-US');
