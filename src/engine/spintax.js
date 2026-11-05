// Spintax: {Hi|Hey|Hello} picks one option per email, the way sending tools
// like Smartlead, Instantly and SalesRobot do. Options can hold tags and
// nest: {Hi {{first_name}}|Hey}. Tags are protected first, so a fallback
// like {{company|your team}} is never mistaken for spintax.

const OPEN = '\u0001';
const CLOSE = '\u0002';
const GROUP = /\{([^{}]*\|[^{}]*)\}/; // innermost {a|b}, tags already hidden

function protect(text) {
  const tags = [];
  const t = String(text ?? '').replace(/\{\{[^{}]*\}\}/g, m => { tags.push(m); return OPEN + (tags.length - 1) + CLOSE; });
  return { t, tags };
}
const restore = (t, tags) => t.replace(/\u0001(\d+)\u0002/g, (_, i) => tags[+i]);

function resolve(text, pick) {
  const { t: start, tags } = protect(text);
  let t = start;
  let k = 0;
  let m;
  while ((m = t.match(GROUP))) {
    const opts = m[1].split('|');
    t = t.slice(0, m.index) + pick(opts, k++) + t.slice(m.index + m[0].length);
  }
  return restore(t, tags);
}

export function hasSpintax(text) {
  return GROUP.test(protect(text).t);
}

// How many {a|b} groups, and how many different emails they can make.
export function spinInfo(text) {
  let groups = 0;
  let versions = 1;
  resolve(text, opts => { groups++; versions *= opts.length; return opts[0]; });
  return { groups, versions };
}

// One version, picked the same way every time for the same seed (a lead and
// a step), so the preview, the X-ray and the boarding pass always agree.
export function variant(text, seed) {
  return resolve(text, (opts, k) => opts[hash(`${seed}:${k}`) % opts.length]);
}

export function firstVariant(text) {
  return resolve(text, opts => opts[0]);
}

// Every option side by side, so checks see every tag and phrase any
// version could contain.
export function unionText(text) {
  return resolve(text, opts => opts.join(' '));
}

function hash(s) {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); }
  // Mix the bits so picks in the same email don't move together.
  x ^= x >>> 16; x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return x >>> 0;
}
