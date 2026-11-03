// Field fixes. Every change is logged with its before and after and a plain
// reason, so nothing is changed silently and every fix can be undone.

const TITLES = /^(dr|mr|mrs|ms|miss|mx|prof|sir|madam|mme|herr|frau)\.?\s+/i;
const JUNK_NAMES = new Set([
  'test', 'testing', 'asdf', 'qwerty', 'n/a', 'na', 'none', 'null', 'nil', 'unknown', 'name',
  'firstname', 'first name', 'first', 'sample', 'demo', 'user', 'customer', 'lead', 'contact',
  'xxx', 'xx', 'x', '-', '--', '.', '?', 'tbd', 'no name', 'noname', 'sir', 'madam',
]);
const ROLE_LOCALS = new Set([
  'info', 'sales', 'hello', 'hi', 'contact', 'support', 'admin', 'team', 'office', 'enquiries',
  'inquiries', 'enquiry', 'inquiry', 'hr', 'careers', 'jobs', 'marketing', 'billing', 'accounts',
  'noreply', 'no-reply', 'help', 'mail', 'general', 'press', 'media', 'partners', 'founders',
]);
// Legal endings that read badly inside a sentence ("saw Acme Inc., LLC is hiring").
// "Corp" and "Co" are left alone: they're often part of how a company is said.
export const LEGAL_END = /[\s,]+(inc\.?|incorporated|l\.?l\.?c\.?|ltd\.?|limited|pvt\.?\s*ltd\.?|private\s+limited|gmbh|plc|s\.?a\.?|a\.?g\.?|b\.?v\.?|pty\.?\s*ltd\.?|l\.?l\.?p\.?|s\.?r\.?l\.?|oy|ab|as|aps|k\.?k\.?)$/i;
const SMALL_WORDS = new Set(['and', 'of', 'the', 'for', 'a', 'an', 'in', 'on', 'at', 'to', 'by', '&']);
const EMAIL_SHAPE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i;

export const tidySpaces = s => String(s ?? '').replace(/[ \s]+/g, ' ').trim();

const hasLetters = s => /\p{L}/u.test(s);
const isAllUpper = s => hasLetters(s) && s === s.toUpperCase() && s !== s.toLowerCase();
const isAllLower = s => hasLetters(s) && s === s.toLowerCase() && s !== s.toUpperCase();

function capWord(w) {
  if (!w) return w;
  const lower = w.toLowerCase();
  if (/^mc\p{L}{2,}/u.test(lower)) return 'Mc' + lower[2].toUpperCase() + lower.slice(3);
  return lower[0].toUpperCase() + lower.slice(1);
}

// "JOHN" -> "John", "mary-jane o'neil" -> "Mary-Jane O'Neil". Only touches
// names written all in capitals or all in lower case; "DeShawn" stays as is.
export function properName(s) {
  if (!isAllUpper(s) && !isAllLower(s)) return s;
  return s.split(/([\s\-'’])/).map(part => (/^[\s\-'’]$/.test(part) ? part : capWord(part))).join('');
}

export function cleanFirstName(raw) {
  let v = tidySpaces(raw);
  const why = v !== String(raw ?? '') ? ['trimmed spaces'] : [];
  if (TITLES.test(v)) { v = v.replace(TITLES, ''); why.push('dropped the title'); }
  const cased = properName(v);
  if (cased !== v) { v = cased; why.push('fixed capitals'); }
  return { value: v, why };
}

export function nameProblem(first) {
  const v = tidySpaces(first);
  if (!v) return 'No first name';
  if (JUNK_NAMES.has(v.toLowerCase())) return `"${v}" isn't a real name`;
  if (/^\p{L}\.?$/u.test(v)) return `First name is only an initial ("${v}")`;
  if (/^[\d\W_]+$/u.test(v)) return `"${v}" isn't a real name`;
  if (/@/.test(v)) return 'First name looks like an email';
  return null;
}

export function cleanCompany(raw) {
  let v = tidySpaces(raw);
  const why = [];
  let stripped = v;
  for (let k = 0; k < 3; k++) {
    const next = stripped.replace(LEGAL_END, '').replace(/[\s,]+$/, '');
    if (next === stripped || !hasLetters(next)) break;
    stripped = next;
  }
  if (stripped !== v) { v = stripped; why.push('dropped the legal ending'); }
  // Fix shouting, but keep real acronyms like IBM or SAP.
  const letters = v.replace(/[^\p{L}]/gu, '');
  if (isAllUpper(v) && letters.length > 4) {
    v = v.split(' ').map(w => {
      const l = w.replace(/[^\p{L}]/gu, '');
      if (SMALL_WORDS.has(w.toLowerCase())) return w.toLowerCase();
      if (l.length <= 3) return w;
      return w.split('-').map(capWord).join('-');
    }).join(' ');
    v = v[0].toUpperCase() + v.slice(1);
    why.push('fixed capitals');
  }
  return { value: v, why };
}

export function cleanEmail(raw) {
  const v = tidySpaces(raw).replace(/^mailto:/i, '').replace(/^<|>$/g, '').replace(/\s/g, '').toLowerCase();
  return { value: v, why: v !== String(raw ?? '') ? ['lower case, no spaces'] : [] };
}

export function emailProblem(email) {
  if (!email) return 'No email';
  if (!EMAIL_SHAPE.test(email)) return `"${email}" isn't shaped like an email`;
  return null;
}

export function isRoleAddress(email) {
  const local = String(email).split('@')[0];
  return ROLE_LOCALS.has(local);
}

export function cleanTitle(raw) {
  let v = tidySpaces(raw);
  const first = v.split(/\s*[|•·]\s*|\s+[-–—]\s+|\s*;\s*/)[0].trim();
  if (first && first !== v) return { value: first, why: ['kept the main title'] };
  return { value: v, why: [] };
}

// For matching only: "https://www.linkedin.com/in/Priya-Rao/?x=1" -> "linkedin.com/in/priya-rao"
export function linkedinKey(raw) {
  const v = tidySpaces(raw).toLowerCase();
  if (!v) return '';
  const m = v.match(/linkedin\.com\/(in|pub)\/([^/?#\s]+)/);
  return m ? `linkedin.com/${m[1]}/${decodeURIComponentSafe(m[2])}` : '';
}

function decodeURIComponentSafe(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

export function splitFullName(raw) {
  const v = tidySpaces(raw).replace(TITLES, '');
  if (!v) return { first: '', last: '' };
  if (v.includes(',')) {
    // "Rao, Priya"
    const [last, first] = v.split(',').map(tidySpaces);
    return { first: first.split(' ')[0] || '', last };
  }
  const parts = v.split(' ');
  return { first: parts[0], last: parts.slice(1).join(' ') };
}
