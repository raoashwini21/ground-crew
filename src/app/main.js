// Ground Crew, the page. Lead data only ever goes in as text, never HTML,
// so a cell can't run as code. Nothing here touches the network.

import {
  parseCSV, guessColumns, FIELDS, FIELD_LABELS, buildManifest, checkCampaignChunked,
  towerCheck, PRESETS, boardedCSV, heldCSV, changesCSV, tagFor, compile,
} from '../engine/index.js';
import { makeSkyline, SEQUENCE_PLANTED } from '../engine/skyline.js';
import { resolveTag, nearestHeader } from '../engine/template.js';
import { properName } from '../engine/clean.js';
import { h, icon, flaps, clatter, gauge } from './ui.js';
import * as sfx from './sound.js';

const fmt = n => Number(n).toLocaleString('en-US');
const plural = (n, one, many = one + 's') => `${fmt(n)} ${n === 1 ? one : many}`;
const ART = name => (window.__ASSETS__ || {})[`art/${name}.webp`] || '';
const CASES = ['teal', 'coral', 'mustard', 'lilac', 'navy', 'green'];
const caseFor = seed => {
  let x = 0;
  for (const c of String(seed)) x = (x * 31 + c.charCodeAt(0)) >>> 0;
  return `case-${CASES[x % CASES.length]}`;
};

// ---------- state ----------
const STATIONS = [
  ['checkin', 'Check-in', 'checkin'],
  ['baggage', 'Baggage Claim', 'baggage'],
  ['tower', 'Control Tower', 'tower'],
  ['gate', 'Boarding Gate', 'gate'],
  ['takeoff', 'Take-off', 'takeoff'],
];
const blankSteps = () => [{ subject: '', body: 'Hi {{first_name}},\n\n\n\nWorth a quick chat?\n' }];
const state = {
  view: 'checkin', fileName: '', parsed: null, map: null, manifest: null,
  steps: blankSteps(), preset: 'operator', gate: null, gateStale: true,
  baggageTab: 'boarding', query: '', shown: 100, reason: null, passenger: null,
  sample: [], bigWarning: false, justRan: false, fixNote: '',
  edits: new Map(), // lead index -> { column index: value you typed }
  starter: true,    // still the placeholder email, not the person's own
  calm: readPref('calm') === '1',
  sound: readPref('sound') !== '0',
};
function readPref(k) { try { return localStorage.getItem('gc.' + k); } catch { return null; } }
function writePref(k, v) { try { localStorage.setItem('gc.' + k, v); } catch {} }

sfx.setSound(state.sound);
const app = document.getElementById('app');
let radioEl;

// ---------- Radio silence: the page's own security policy is the proof ----------
const radio = { locked: false, transmissions: 0, blocked: 0 };
function initRadio() {
  const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
  radio.locked = !!meta && /connect-src 'none'/.test(meta.content) && /default-src 'none'/.test(meta.content);
  const count = () => {
    radio.transmissions = performance.getEntriesByType('resource').filter(e => !/^(data|blob):/.test(e.name)).length;
  };
  count();
  try { new PerformanceObserver(() => { count(); paintRadio(); }).observe({ type: 'resource', buffered: true }); } catch {}
  document.addEventListener('securitypolicyviolation', () => { radio.blocked++; paintRadio(); });
}
function paintRadio() {
  if (!radioEl) return;
  radioEl.className = 'radio' + (radio.transmissions ? ' bad' : radio.locked ? '' : ' warn');
  radioEl.replaceChildren(
    h('span', { class: 'lamp' }),
    radio.transmissions ? `${plural(radio.transmissions, 'TRANSMISSION')}`
      : radio.locked ? 'RADIO SILENCE · 0 TX' : 'RADIO CHECK · DEV BUILD',
    radio.blocked ? ` · ${fmt(radio.blocked)} BLOCKED` : '');
  radioEl.title = radio.locked
    ? "This page's security policy blocks every network request. Nothing you load here can leave this computer."
    : 'This copy was opened without its security policy.';
}

// ---------- layout ----------
function canVisit(id) {
  if (id === 'checkin') return true;
  if (id === 'baggage' || id === 'tower' || id === 'gate') return !!state.manifest;
  if (id === 'takeoff') return !!state.gate && !state.gateStale && state.gate.counts.cleared > 0;
  return false;
}
function go(id) {
  if (!canVisit(id)) return;
  if (id !== state.view) {
    sfx.chime();
    if (id === 'baggage') { sfx.hum(3.2); setTimeout(sfx.thunk, 500); setTimeout(sfx.thunk, 1300); }
  }
  state.view = id;
  render();
  window.scrollTo({ top: 0 });
}

function render() {
  document.body.classList.toggle('calm', state.calm);
  radioEl = h('div', { class: 'radio' });
  const nav = h('nav', { class: 'stations' }, STATIONS.map(([id, label], i) =>
    h('button', { class: state.view === id ? 'on' : '', disabled: !canVisit(id), onclick: () => go(id) },
      h('span', { class: 'n' }, String(i).padStart(2, '0')), label)));
  const calm = h('button', {
    class: 'toggle' + (state.calm ? ' on' : ''), title: 'Calm mode: no animation',
    onclick: () => { state.calm = !state.calm; writePref('calm', state.calm ? '1' : '0'); render(); },
  }, state.calm ? '◼ Calm' : '◻ Calm');
  const snd = h('button', {
    class: 'toggle' + (state.sound ? ' on' : ''), title: 'Sound on or off',
    onclick: () => { state.sound = !state.sound; sfx.setSound(state.sound); writePref('sound', state.sound ? '1' : '0'); if (state.sound) sfx.tick(); render(); },
  }, state.sound ? '🔊 Sound' : '🔇 Sound');
  const views = { checkin: viewCheckin, baggage: viewBaggage, tower: viewTower, gate: viewGate, takeoff: viewTakeoff };
  const brand = h('div', { class: 'brand' }, h('span', { class: 'plane' }, icon('plane')), flaps('GROUND CREW', 'white'));
  app.replaceChildren(
    h('header', { class: 'top' }, h('div', { class: 'wrap' }, brand, nav, h('div', { class: 'hdr-tools' }, snd, calm, radioEl))),
    h('main', null, h('div', { class: 'wrap' }, views[state.view]())),
    h('footer', null, h('div', { class: 'wrap row' },
      h('span', null, 'Ground Crew · the pre-flight check for outbound. No signal needed.'),
      h('span', { class: 'spacer' }),
      state.manifest ? h('button', { class: 'btn small ghost', onclick: sweep }, '🧹 Sweep the hangar') : null)));
  paintRadio();
  if (state.view === 'checkin' && !state.parsed) clatter(brand, state.calm);
}

// ---------- the stage: a real scene with crew in front and data moving in it ----------
function stationSign(i, labelOverride) {
  const [, base, ic] = STATIONS[i];
  const label = labelOverride || base;
  return h('div', { class: 'station-sign' },
    h('span', { class: 'num' }, String(i).padStart(2, '0')),
    h('span', { class: 'name' }, icon(ic), label));
}
function crew(name, cls) {
  return h('img', { class: `crew ${cls}`, src: ART(name), alt: '' });
}
function say(who, content, pos) {
  return h('div', { class: 'say', style: pos }, h('span', { class: 'who' }, who), ...[content].flat());
}
function stage(scene, station, { focus = 0.5, tall = false, inFrame = [], over = [], label = '', sky = null } = {}) {
  const frame = h('div', { class: `frame scene-${scene}` }, inFrame);
  frame.style.setProperty('--focus', focus);
  // With sky: the scene sits under an open sky the camera can tilt up into.
  const body = sky ? h('div', { class: 'world' }, frame, sky) : frame;
  return h('div', { class: 'stage' + (tall ? ' tall' : ''), role: 'img', 'aria-label': `${STATIONS[station][1]} scene` },
    body, stationSign(station, label), over);
}

// ---------- 00 Check-in ----------
function viewCheckin() {
  const input = h('input', { type: 'file', accept: '.csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values', hidden: true, onchange: e => e.target.files[0] && loadFile(e.target.files[0]) });
  const ticket = h('div', {
    class: 'ticket', role: 'button', tabindex: '0',
    onclick: () => input.click(),
    onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } },
    ondragover: e => { e.preventDefault(); ticket.classList.add('over'); },
    ondragleave: () => ticket.classList.remove('over'),
    ondrop: e => { e.preventDefault(); ticket.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) loadFile(f); },
  },
  h('div', { class: 'main' },
    h('div', { class: 'airline' }, 'GROUND CREW · CHECK-IN DESK'),
    h('strong', null, 'Drop your lead list here'),
    h('div', { class: 'sub' }, 'A CSV from Apollo, Clay, Sales Navigator or any spreadsheet. It stays on this computer.'),
    h('div', { class: 'fields' },
      h('span', null, 'FROM', h('b', null, 'YOUR LIST')),
      h('span', null, 'TO', h('b', null, 'INBOX')),
      h('span', null, 'SIGNAL', h('b', null, 'NONE NEEDED')))),
  h('div', { class: 'stub' }, h('span', { class: 'airline' }, 'GATE'), h('span', { class: 'big' }, 'GC'), h('div', { class: 'barcode' })),
  input);

  const glass = h('div', { class: 'glass' },
    h('h1', null, 'You built it. Now get it out there.'),
    h('p', null, 'Ground Crew checks every email, for every lead, across every step, before your campaign takes off. On your laptop, with the Wi-Fi off. Nothing is uploaded, nothing is sent.'));

  const parts = [
    stage('checkin', 0, {
      focus: 0.6, tall: true,
      over: [glass, crew('marshal-hero', 'right full'),
        say('MARSHAL', ['Welcome aboard! ', h('b', null, 'Nothing takes off until it’s checked.')], { right: '27cqw', bottom: '58%' })],
    }),
    h('div', { class: 'mobile-intro' },
      h('h1', null, 'You built it. Now get it out there.'),
      h('p', null, 'Ground Crew checks every email, for every lead, before your campaign takes off. On your laptop, with the Wi-Fi off.')),
    ticket,
    h('div', { class: 'row demo-row' }, h('span', { class: 'muted small' }, 'No list handy?'),
      h('button', { class: 'btn small', onclick: loadDemo }, '✈ Try it with Skyline Leads (3,000 made-up leads)')),
  ];

  if (state.bigWarning) {
    parts.push(h('div', { class: 'card next' }, `This list has ${fmt(state.parsed.rows.length)} rows. Ground Crew can handle it, but the checks may take a little while on this computer.`));
  }
  if (state.parsed && state.map) {
    const opts = ['', ...state.parsed.headers];
    const grid = h('div', { class: 'mapgrid' });
    for (const f of FIELDS) {
      if (f === 'full_name' && 'first_name' in state.map) continue;
      const sel = h('select', {
        onchange: e => {
          const v = e.target.value;
          if (v === '') delete state.map[f]; else state.map[f] = state.parsed.headers.indexOf(v);
        },
      }, opts.map(o => h('option', { value: o }, o || '— not in this list —')));
      sel.value = f in state.map ? state.parsed.headers[state.map[f]] : '';
      grid.append(h('span', { class: 'lbl' }, FIELD_LABELS[f]), sel);
    }
    parts.push(h('div', { class: 'card next' },
      h('h3', null, `Luggage tags · ${state.fileName}`),
      h('p', { class: 'muted small' }, `${plural(state.parsed.rows.length, 'row')} · ${plural(state.parsed.headers.length, 'column')}. Here’s which column Ground Crew thinks is which. Change anything that’s wrong. Every other column is kept and can be used as a tag.`),
      grid,
      h('div', { class: 'row next' }, h('span', { class: 'spacer' }),
        h('button', { class: 'btn primary', onclick: boardList }, 'Bags to Baggage Claim →'))));
  }
  return parts;
}

async function loadFile(file) { setParsed(parseCSV(await file.text()), file.name); }
function loadDemo() {
  const s = makeSkyline(3000);
  state.steps = SEQUENCE_PLANTED.map(x => ({ ...x }));
  state.starter = false;
  setParsed({ headers: s.headers, rows: s.rows }, 'skyline-leads.csv');
}
function setParsed(parsed, name) {
  if (!parsed.headers.length) { alert('That file looks empty.'); return; }
  Object.assign(state, {
    parsed, fileName: name, map: guessColumns(parsed.headers), manifest: null,
    gate: null, gateStale: true, bigWarning: parsed.rows.length > 50000, edits: new Map(),
  });
  render();
  setTimeout(() => document.querySelector('.mapgrid')?.scrollIntoView({ behavior: state.calm ? 'auto' : 'smooth', block: 'center' }), 50);
}
function boardList() {
  if (!('email' in state.map)) { alert('Ground Crew needs to know which column holds the email.'); return; }
  if (!('first_name' in state.map) && !('full_name' in state.map)) { alert('Pick a first name (or full name) column so greetings can be checked.'); return; }
  rebuildManifest();
  Object.assign(state, { gateStale: true, baggageTab: 'boarding', query: '', shown: 100 });
  go('baggage');
}

// ---------- Your fixes ----------
// What you type never touches the original rows: edits sit on top, the
// manifest is rebuilt from both, and each edit is logged in changes.csv.
function workingParsed() {
  const p = state.parsed;
  if (!state.edits.size) return p;
  return {
    headers: p.headers,
    rows: p.rows.map((r, i) => {
      const e = state.edits.get(i);
      if (!e) return r;
      const c = r.slice();
      for (const [k, v] of Object.entries(e)) c[k] = v;
      return c;
    }),
  };
}
function rebuildManifest() {
  const m = buildManifest(workingParsed(), state.map);
  const manual = [];
  for (const [i, e] of state.edits) {
    for (const [k, v] of Object.entries(e)) {
      manual.push({ id: -1, leadId: i, row: i + 2, column: m.headers[k], col: +k, before: state.parsed.rows[i][k] ?? '', after: v, why: 'edited by you' });
    }
  }
  m.changes = [...manual, ...m.changes];
  state.manifest = m;
  state.gateStale = true;
}
function addEdits(list) {
  for (const { id, col, value } of list) {
    const cur = state.edits.get(id) || {};
    cur[col] = value;
    state.edits.set(id, cur);
  }
  rebuildManifest();
}
const editable = col => col != null && col < state.parsed.headers.length;
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function rescan(note) {
  const before = state.gate ? state.gate.counts.cleared : 0;
  const t0 = performance.now();
  const res = await checkCampaignChunked(state.manifest, state.steps);
  res.ms = performance.now() - t0;
  Object.assign(state, {
    gate: res, gateStale: false, justRan: true, ...firstMayday(res),
    fixNote: `${note} Boarded ${fmt(before)} → ${fmt(res.counts.cleared)}.`,
  });
  sfx.stamp();
  render();
  window.scrollTo({ top: 0 });
}

function firstMayday(res) {
  const r = res.reasons.find(x => x.level === 'mayday');
  return r ? { reason: r.key, passenger: r.leadIds[0] } : { reason: null, passenger: null };
}

function noteBanner() {
  if (!state.fixNote) return null;
  const el = h('div', { class: 'fixed-note' }, '✅ ', state.fixNote);
  state.fixNote = '';
  return el;
}

// ---------- 01 Baggage Claim ----------
function viewBaggage() {
  const m = state.manifest;
  const changesByLead = new Map();
  for (const c of m.changes) {
    if (!changesByLead.has(c.leadId)) changesByLead.set(c.leadId, new Map());
    changesByLead.get(c.leadId).set(c.col, c);
  }
  const fixedLeads = m.leads.filter(l => changesByLead.has(l.id));
  const tabs = [
    ['boarding', `Manifest ${fmt(m.leads.length)}`],
    ['fixed', `Fixed ${fmt(m.changes.length)}`],
    ['twins', `Twins ${fmt(m.twins.length)}`],
    ['lost', `Lost & Found ${fmt(m.lostFound.length)}`],
  ];
  const search = h('input', {
    type: 'search', placeholder: 'Search passengers', value: state.query,
    oninput: e => { state.query = e.target.value; state.shown = 100; holder.replaceChildren(baggageTable(m, changesByLead, fixedLeads)); },
  });
  const holder = h('div', null, baggageTable(m, changesByLead, fixedLeads));
  const lost = state.baggageTab === 'lost';

  return [
    stage('baggage', 1, {
      focus: 0.9,
      inFrame: [beltLane(m)],
      over: [crew(lost ? 'handler-alert' : 'handler-ok', 'right full pop'),
        say('BAGGAGE HANDLER', lost
          ? [h('b', null, `${plural(m.stats.lostFound, 'bag')} with no name tag. `), 'They stay in Lost & Found, each with its reason.']
          : ['Bags are off the plane! ', h('b', null, `${plural(m.stats.twinsMerged, 'twin')} merged, ${plural(m.stats.fixes, 'tag')} fixed.`)],
        { right: '24cqw', bottom: '60%' })],
    }),
    noteBanner(),
    h('p', { class: 'lede' }, 'The list comes in messy and leaves clean. Every fix shows what it was before. Your original file is never touched.'),
    h('div', { class: 'tags' },
      ltag(m.stats.rows, 'checked in'),
      ltag(m.stats.boarding, 'ready to board', 'green'),
      ltag(m.stats.twinsMerged, 'twins merged', 'orange'),
      ltag(m.stats.fixes, 'tags fixed', 'blue'),
      ltag(m.stats.lostFound, 'lost & found', 'red')),
    h('div', { class: 'row' },
      h('div', { class: 'tabs' }, tabs.map(([id, label]) =>
        h('button', { class: state.baggageTab === id ? 'on' : '', onclick: () => { state.baggageTab = id; state.shown = 100; render(); } }, label))),
      h('span', { class: 'spacer' }), search),
    h('div', { class: 'manifest-head' }, icon('board'), `PASSENGER MANIFEST · FLIGHT ${flightName()}`),
    holder,
    h('p', { class: 'note' }, 'Green cells were fixed. Hover one to see what it said before, and why it changed.'),
    h('div', { class: 'row next' }, h('span', { class: 'spacer' }),
      h('button', { class: 'btn primary', onclick: () => go('tower') }, 'Over to the Control Tower →')),
  ];
}

function ltag(n, label, cls = '') {
  return h('div', { class: `ltag ${cls}` }, h('b', null, fmt(n)), h('span', null, label));
}

// Real luggage from this list rides the belt in the photo: twins as a pair,
// Lost & Found bags with a red tag.
function beltLane(m) {
  const twinIds = new Set(m.twins.map(t => t.keepId));
  const items = [];
  const rest = m.leads.filter(l => !twinIds.has(l.id));
  for (let i = 0; i < 5 && i < rest.length; i++) items.push({ lead: rest[Math.floor(i * rest.length / 5)], kind: '' });
  m.leads.filter(l => twinIds.has(l.id)).slice(0, 1).forEach(l => items.splice(1, 0, { lead: l, kind: 'twin' }));
  m.lostFound.slice(0, 1).forEach(x => items.splice(4, 0, { lead: x.lead, kind: 'lost' }));
  const dur = 30;
  return h('div', { class: 'belt-lane', 'aria-hidden': 'true' }, items.map((it, i) => {
    const first = it.lead.cells[m.map.first_name] || '';
    const co = 'company' in m.map ? it.lead.cells[m.map.company] : '';
    const img = caseFor(first + co);
    const style = { '--dur': `${dur}s`, '--delay': `${-(i / items.length) * dur}s` };
    const el = h('div', { class: `rider ${it.kind}` },
      h('img', { src: ART(img), alt: '' }),
      it.kind === 'twin' ? h('img', { src: ART(img), alt: '' }) : null,
      h('span', { class: 'tag' },
        it.kind === 'lost' ? 'NO NAME TAG' : it.kind === 'twin' ? `${first} ×2` : first,
        h('small', null, it.kind === 'lost' ? 'Lost & Found' : it.kind === 'twin' ? 'twin · merged' : co || '—')));
    for (const [k, v] of Object.entries(style)) el.style.setProperty(k, v);
    return el;
  }));
}

function matches(cells) {
  const q = state.query.trim().toLowerCase();
  return !q || cells.some(c => String(c).toLowerCase().includes(q));
}

function baggageTable(m, changesByLead, fixedLeads) {
  const tab = state.baggageTab;
  const leadById = new Map([...m.leads, ...m.lostFound.map(x => x.lead)].map(l => [l.id, l]));
  if (tab === 'fixed') {
    // Each change on its own line, before and after, so it reads at a glance.
    const list = m.changes.filter(c => matches([c.before, c.after, c.column, nameOf(m, leadById.get(c.leadId) || { cells: [] })]));
    if (!list.length) return h('div', { class: 'empty' }, 'Nothing needed fixing.');
    return h('div', null, h('div', { class: 'tablewrap' }, h('table', null,
      h('thead', null, h('tr', null, h('th', null, 'Row'), h('th', null, 'Passenger'), h('th', null, 'Field'), h('th', null, 'Before'), h('th', null, ''), h('th', null, 'After'), h('th', null, 'Why'))),
      h('tbody', null, list.slice(0, state.shown).map(c => h('tr', null,
        h('td', { class: 'rownum' }, c.row),
        h('td', null, nameOf(m, leadById.get(c.leadId) || { cells: [] })),
        h('td', { class: 'muted' }, c.column),
        h('td', { class: 'before', title: c.before }, c.before === '' ? '(blank)' : c.before),
        h('td', { class: 'muted' }, '→'),
        h('td', { class: 'after', title: c.after }, c.after === '' ? '(blank)' : c.after),
        h('td', { class: 'muted' }, c.why)))))), more(list.length));
  }
  if (tab === 'twins') {
    const rows = m.twins.filter(t => matches(leadById.get(t.keepId)?.cells || []));
    if (!rows.length) return h('div', { class: 'empty' }, 'No twins in this list.');
    return h('div', null, h('div', { class: 'tablewrap' }, h('table', null,
      h('thead', null, h('tr', null, h('th', null, 'Kept row'), h('th', null, 'Passenger'), h('th', null, 'Email'), h('th', null, 'Merged rows'), h('th', null, 'Why'))),
      h('tbody', null, rows.slice(0, state.shown).map(t => {
        const l = leadById.get(t.keepId);
        return h('tr', null,
          h('td', { class: 'rownum' }, t.keepRow),
          h('td', null, nameOf(m, l)),
          h('td', null, l.cells[m.map.email] || ''),
          h('td', { class: 'mono' }, t.mergedRows.join(', ')),
          h('td', null, t.why));
      })))), more(rows.length));
  }
  if (tab === 'lost') {
    const rows = m.lostFound.filter(x => matches(x.lead.cells));
    if (!rows.length) return h('div', { class: 'empty' }, 'Nothing in Lost & Found. Every bag has its tag.');
    // Type a missing name or email straight into the row, then re-check.
    const cols = new Set([m.map.first_name, m.map.email, m.map.full_name].filter(editable));
    const pending = new Map();
    const save = h('button', {
      class: 'btn primary', disabled: true, onclick: () => {
        const list = [];
        for (const [key, value] of pending) { const [id, col] = key.split(':').map(Number); list.push({ id, col, value }); }
        const before = state.manifest.lostFound.length;
        addEdits(list);
        const found = before - state.manifest.lostFound.length;
        state.fixNote = found
          ? `${plural(found, 'bag')} found ${found === 1 ? 'its' : 'their'} tag and joined the manifest.`
          : 'Saved. Those bags still need a real first name and a valid email to board.';
        sfx.thunk();
        render();
      },
    }, 'Save & re-check');
    return h('div', null,
      h('div', { class: 'fixbar' }, h('span', null, '✏️ Fill in a missing first name or email right in the table, then save. Your original file isn’t changed.'), h('span', { class: 'spacer' }), save),
      h('div', { class: 'tablewrap' }, h('table', null,
        h('thead', null, h('tr', null, h('th', null, 'Row'), h('th', null, 'Why it’s held'), m.headers.map(x => h('th', null, x)))),
        h('tbody', null, rows.slice(0, state.shown).map(x => h('tr', null,
          h('td', { class: 'rownum' }, x.lead.row),
          h('td', null, h('span', { class: 'pill lost' }, x.reasons.join(' · '))),
          x.lead.cells.slice(0, m.headers.length).map((c, col) => cols.has(col)
            ? h('td', null, h('input', {
              type: 'text', class: 'cell', value: c, placeholder: m.headers[col], 'aria-label': `${m.headers[col]}, row ${x.lead.row}`,
              oninput: e => { pending.set(`${x.lead.id}:${col}`, e.target.value.trim()); save.disabled = false; },
            }))
            : h('td', { title: c }, c))))))), more(rows.length));
  }
  const list = (tab === 'fixed' ? fixedLeads : m.leads).filter(l => matches(l.cells));
  if (!list.length) return h('div', { class: 'empty' }, 'No passengers match.');
  return h('div', null, h('div', { class: 'tablewrap' }, h('table', null,
    h('thead', null, h('tr', null, h('th', null, 'Row'), m.headers.map(x => h('th', null, x)))),
    h('tbody', null, list.slice(0, state.shown).map(l => {
      const ch = changesByLead.get(l.id);
      return h('tr', null,
        h('td', { class: 'rownum' }, l.row),
        l.cells.slice(0, m.headers.length).map((c, i) => {
          const fix = ch && ch.get(i);
          return h('td', { class: fix ? 'fixed' : null, title: fix ? `Was “${fix.before}” · ${fix.why}` : c }, c);
        }));
    })))), more(list.length));
}

function more(total) {
  if (total <= state.shown) return null;
  return h('div', { class: 'row next' }, h('span', { class: 'muted small' }, `Showing ${fmt(state.shown)} of ${fmt(total)}`),
    h('button', { class: 'btn small', onclick: () => { state.shown += 200; render(); } }, 'Show more'));
}
function nameOf(m, l) {
  const f = 'first_name' in m.map ? l.cells[m.map.first_name] : '';
  const s = 'last_name' in m.map ? l.cells[m.map.last_name] : '';
  return `${f} ${s}`.trim() || '(no name)';
}
function flightName() {
  return state.fileName.replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/gi, ' ').trim().toUpperCase().slice(0, 20) || 'OUTBOUND';
}

// ---------- 02 Control Tower ----------
const towerTimers = new Map();
let lastField = null;
let towerCrew = null;

function viewTower() {
  const m = state.manifest;
  const chips = m.headers.map(x => h('button', {
    class: 'chip', title: `Insert ${tagFor(x)}`,
    onmousedown: e => e.preventDefault(),
    onclick: () => insertTag(tagFor(x)),
  }, tagFor(x)));
  const preset = h('select', { onchange: e => { state.preset = e.target.value; render(); } },
    h('option', { value: 'operator' }, 'Outbound operator'), h('option', { value: 'gentle' }, 'Gentle (Maydays and length only)'));
  preset.value = state.preset;

  const img = crew('controller-ok', 'right');
  const bubble = say('TOWER', '', { right: '30cqw', bottom: '52%' });
  towerCrew = { img, bubble };
  const legs = state.steps.map((step, i) => towerLeg(step, i));
  updateTowerCrew();

  return [
    stage('tower', 2, { focus: 0.55, over: [img, bubble] }),
    state.starter ? h('div', { class: 'starter' }, h('b', null, '✏️ Paste your own emails below. '), 'Right now there’s only a starter email in leg 1. Replace it with your real subject and body, and add your follow-ups. Use tags like {{first_name}} and {{company}} where the lead’s details go.') : null,
    h('p', { class: 'lede' }, 'Each step of your sequence is a flight strip. The tower radios in as you type. The altimeter is a writing guide, not a promise of replies.'),
    h('div', { class: 'card' },
      h('div', { class: 'row' },
        h('span', { class: 'small muted' }, 'Tags from your list · click to drop one in where you’re typing'),
        h('span', { class: 'spacer' }), h('span', { class: 'small muted' }, 'Rules'), preset),
      h('div', { class: 'chips' }, chips),
      h('p', { class: 'note' }, 'Blanks in a column? Add a fallback like {{company|your team}}.')),
    h('div', { class: 'bay next' }, legs),
    h('div', { class: 'row next' },
      state.steps.length < 6 ? h('button', { class: 'btn', onclick: () => { state.steps.push({ subject: '', body: 'Hi {{first_name}},\n\n\n' }); state.gateStale = true; render(); } }, '+ Add a follow-up') : null,
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn primary', onclick: () => go('gate') }, 'Head to Security →')),
  ];
}

// The controller reacts to the whole flight plan: the first Mayday, else
// the first piece of turbulence, else clear skies.
function updateTowerCrew() {
  if (!towerCrew) return;
  const all = state.steps.flatMap((s, i) => towerCheck(s, i, { manifest: state.manifest, enabled: PRESETS[state.preset] }).calls.map(c => ({ ...c, leg: i + 1 })));
  const may = all.find(c => c.kind === 'mayday');
  const turb = all.find(c => c.kind === 'turbulence');
  const pick = may || turb;
  const name = may ? 'controller-alert' : 'controller-ok';
  const line = pick ? pick.line : '';
  if (towerCrew.lastLine !== undefined && line !== towerCrew.lastLine) {
    if (may && !towerCrew.wasMayday) sfx.mayday(); else sfx.radio();
  }
  towerCrew.lastLine = line;
  towerCrew.wasMayday = !!may;
  if (!towerCrew.img.src.endsWith(ART(name).slice(-40))) {
    towerCrew.img.src = ART(name);
    towerCrew.img.classList.remove('pop'); void towerCrew.img.offsetWidth; towerCrew.img.classList.add('pop');
  }
  towerCrew.bubble.replaceChildren(...[
    h('span', { class: 'who' }, may ? `MAYDAY · LEG ${may.leg}` : turb ? `TOWER · LEG ${turb.leg}` : 'TOWER'),
    pick ? pick.line : h('b', null, 'Clear skies on every leg. Roger that.'),
    all.length > 1 ? h('span', { class: 'muted' }, ` (+${all.length - 1} more below)`) : null,
  ].filter(Boolean));
}

function towerLeg(step, i) {
  const log = h('div', { class: 'radiolog' });
  const band = h('div', { class: 'band' });
  const paint = () => {
    const t = towerCheck(step, i, { manifest: state.manifest, enabled: PRESETS[state.preset] });
    const kind = t.calls.some(c => c.kind === 'mayday') ? 'mayday' : t.clear ? 'clear' : 'turbulence';
    band.className = 'band ' + kind;
    log.replaceChildren(
      h('div', { class: 'gauge' }, gauge(t.score, kind),
        h('div', null, h('div', { class: 'lbl' }, 'ALTIMETER'), h('div', { class: 'val' }, t.score), h('div', { class: 'lbl' }, `${plural(t.words, 'WORD')}`))),
      h('div', { class: 'rhead' }, icon('radio'), `TOWER · LEG ${i + 1}`),
      h('ul', null, t.calls.length
        ? t.calls.map(c => h('li', { class: c.kind }, h('span', { class: 'who' }, c.kind === 'mayday' ? 'MAYDAY ▸' : 'TWR ▸'), h('span', null, c.line)))
        : h('li', { class: 'clear' }, h('span', { class: 'who' }, 'TWR ▸'), h('span', null, 'Clear skies. Roger that.'))));
  };
  const schedule = () => {
    state.gateStale = true;
    clearTimeout(towerTimers.get(i));
    towerTimers.set(i, setTimeout(() => { paint(); updateTowerCrew(); }, 140));
  };
  const subject = h('input', {
    type: 'text', value: step.subject, placeholder: i === 0 ? 'Subject line' : 'Empty = reply in the same thread',
    oninput: e => { step.subject = e.target.value; state.starter = false; schedule(); }, onfocus: e => { lastField = e.target; },
  });
  const body = h('textarea', {
    rows: 9, value: step.body,
    oninput: e => { step.body = e.target.value; state.starter = false; schedule(); }, onfocus: e => { lastField = e.target; },
  });
  paint();
  const day = [0, 3, 7, 12, 18, 25][i];
  return h('div', { class: 'leg' },
    h('div', { class: 'strip' },
      h('div', { class: 'side' },
        h('span', { class: 'day' }, 'LEG'), h('span', { class: 'callsign' }, String(i + 1)),
        band, h('span', { class: 'day' }, `DAY ${day}`),
        state.steps.length > 1 ? h('button', { class: 'x', title: 'Remove this step', onclick: () => { state.steps.splice(i, 1); state.gateStale = true; render(); } }, '✕') : null),
      h('div', { class: 'body' },
        h('label', null, i === 0 ? 'Subject · first email' : 'Subject · follow-up'), subject,
        h('label', null, 'Body'), body)),
    log);
}

function insertTag(tag) {
  if (!lastField || !document.body.contains(lastField)) return;
  const el = lastField;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  el.value = el.value.slice(0, start) + tag + el.value.slice(end);
  el.selectionStart = el.selectionEnd = start + tag.length;
  el.focus();
  el.dispatchEvent(new Event('input'));
}

// ---------- 03 Security Check, then the Boarding Gate ----------
let running = false;

function viewGate() {
  return !state.gate || state.gateStale ? viewSecurity() : viewBoarding();
}

function viewSecurity() {
  const m = state.manifest;
  if (!m.leads.length) {
    return [
      stage('security', 3, { focus: 0.5, label: 'Security Check', over: [crew('security-alert', 'left'),
        say('SECURITY', [h('b', null, 'No passengers to scan. '), 'Nobody made it past Baggage Claim.'], { left: '25cqw', bottom: '62%' })] }),
      h('div', { class: 'starter' }, h('b', null, 'There’s no one to check yet. '),
        m.stats.rows ? 'Every row is in Lost & Found. Fill in their names or emails there, or load a different list.' : 'This file has headers but no rows. Load a list with leads in it.',
        ' ', h('button', { class: 'btn small', onclick: () => go(m.stats.rows ? 'baggage' : 'checkin') }, m.stats.rows ? 'Open Lost & Found' : 'Back to Check-in')),
    ];
  }
  const total = m.leads.length * state.steps.length;
  const officer = crew('security-ok', 'left');
  const bubble = say('SECURITY', ['Line up, please. ', h('b', null, `${plural(m.leads.length, 'passenger')} × ${plural(state.steps.length, 'leg')} = ${plural(total, 'email')} to scan.`)], { left: '25cqw', bottom: '62%' });
  const belt = securityBelt(m);
  const glow = h('div', { class: 'machine-glow' });
  const xr = xrayMonitor(m, total);
  const btn = h('button', {
    class: 'btn primary', disabled: running,
    onclick: async () => {
      running = true; btn.disabled = true;
      const t0 = performance.now();
      const res = await checkCampaignChunked(m, state.steps);
      res.ms = performance.now() - t0;
      if (!state.calm) await replay(res, { xr, belt, glow, officer, bubble });
      Object.assign(state, { gate: res, gateStale: false, justRan: true, ...firstMayday(res) });
      running = false;
      render();
      window.scrollTo({ top: 0 });
    },
  }, 'Start the Security Check');

  return [
    stage('security', 3, {
      focus: 0.5, label: 'Security Check',
      inFrame: [belt.el, h('div', { class: 'tunnel-mask' }), glow],
      over: [officer, bubble],
    }),
    state.starter ? h('div', { class: 'starter' }, h('b', null, 'Heads up: you’re checking the starter email, not your own. '), 'Paste your sequence in the Control Tower first, then scan.', ' ', h('button', { class: 'btn small', onclick: () => go('tower') }, 'Open the Control Tower')) : null,
    h('p', { class: 'lede' }, 'Security fills in every step for every lead, exactly as the inbox would see it, and scans the finished email. A blank tag shows up like a forbidden item in a bag.'),
    h('div', { class: 'row' }, btn, h('span', { class: 'muted small' }, 'Takes about a second. Nothing leaves this computer.')),
    h('div', { class: 'next' }, xr.el),
  ];
}

// Bags from real passengers on the X-ray belt. They wait until the scan starts.
function securityBelt(m) {
  const pick = m.leads.slice(0, 10);
  const riders = pick.map((l, i) => {
    const el = h('div', { class: 'rider' }, h('img', { src: ART(caseFor((l.cells[m.map.first_name] || '') + (l.cells[m.map.company] || ''))), alt: '' }));
    el.style.setProperty('--dur', '3.4s');
    el.style.setProperty('--delay', `${-(i / pick.length) * 3.4}s`);
    return el;
  });
  const el = h('div', { class: 'xbelt paused', 'aria-hidden': 'true' }, riders);
  return { el, riders };
}

// The X-ray monitor: one real email at a time, with filled-in values glowing
// and blank tags flashing red. Counts come straight from the engine.
function xrayMonitor(m, total) {
  const count = h('b', null, `0 / ${fmt(total)}`);
  const to = h('div', { class: 'to' }, 'X-RAY READY · press Start to scan every email');
  const mail = h('div', { class: 'mail' });
  const verdict = h('div', { class: 'verdict ok' }, 'STANDBY');
  const laneList = h('ul');
  const bar = h('i');
  const sample = m.leads[0];
  if (sample) mail.replaceChildren(...renderMail(0, sample, true));
  const el = h('div', { class: 'xray', 'aria-live': 'polite' },
    h('div', { class: 'xhead' }, icon('radio'), 'X-RAY · LANE 1', h('span', { class: 'spacer' }), 'EMAILS SCANNED', count),
    h('div', { class: 'screen' }, h('div', { class: 'sweep' }), verdict, to, mail),
    h('div', { class: 'lane' }, h('h4', null, 'INSPECTION LANE'), laneList),
    h('div', { class: 'meter' }, bar));
  return { el, count, to, mail, verdict, laneList, bar, total };
}

function renderMail(stepIndex, lead, xray) {
  const s = state.steps[stepIndex];
  return [
    s.subject && s.subject.trim() ? h('div', { class: 'subj' }, marked(s.subject, lead, xray)) : null,
    marked(s.body, lead, xray),
  ].filter(Boolean);
}

// Play the real results through the X-ray in order. Every number shown is
// the engine's own count up to that passenger.
function replay(res, { xr, belt, glow, officer, bubble }) {
  const m = state.manifest;
  const results = res.results;
  const n = results.length;
  if (!n) return Promise.resolve();
  const steps = state.steps.length;
  const duration = Math.min(3600, 1200 + n * 1.2);
  belt.el.classList.remove('paused');
  glow.classList.add('on');
  sfx.hum(duration / 1000 + 0.6);
  let heldSoFar = 0;
  const lane = [];
  let last = -1;
  const heldPrefix = new Array(n);
  for (let i = 0; i < n; i++) { if (results[i].status === 'held') heldSoFar++; heldPrefix[i] = heldSoFar; }
  return new Promise(done => {
    let t0 = null;
    let shownAt = 0;
    const tick = now => {
      if (t0 === null) t0 = now;
      const p = Math.max(0, Math.min(1, (now - t0) / duration));
      const i = Math.max(0, Math.min(n - 1, Math.floor(p * n)));
      xr.count.textContent = `${fmt((i + 1) * steps)} / ${fmt(xr.total)}`;
      xr.bar.style.width = (p * 100).toFixed(1) + '%';
      for (let k = last + 1; k <= i; k++) if (results[k].status === 'held') { lane.push(results[k]); if (lane.length > 7) lane.shift(); }
      // Show a new email about 8 times a second, preferring a held one if one just passed.
      if (now - shownAt > 120 || p === 1) {
        shownAt = now;
        let r = results[i];
        for (let k = i; k > last && k > i - 40; k--) if (results[k].status === 'held') { r = results[k]; break; }
        const held = r.status === 'held';
        const stepIdx = held ? Math.max(0, (r.issues.find(x => x.level === 'mayday')?.step || 1) - 1) : (i % steps);
        xr.to.textContent = `PASSENGER ${nameOf(m, r.lead).toUpperCase()} · ${r.lead.cells[m.map.email] || ''} · LEG ${stepIdx + 1}`;
        xr.mail.replaceChildren(...renderMail(stepIdx, r.lead, true));
        xr.verdict.className = 'verdict ' + (held ? 'bad' : 'ok');
        xr.verdict.textContent = held ? 'MAYDAY · HOLD' : 'CLEAR';
        glow.classList.toggle('alarm', held);
        if (held) sfx.buzz(); else sfx.beep();
        const want = held ? 'security-alert' : 'security-ok';
        if (officer.dataset.pose !== want) { officer.dataset.pose = want; officer.src = ART(want); }
        if (held) {
          const rider = belt.riders[Math.floor(Math.random() * belt.riders.length)];
          rider.classList.add('flag');
          setTimeout(() => rider.classList.remove('flag'), 900);
        }
        bubble.replaceChildren(h('span', { class: 'who' }, 'SECURITY'),
          ...(held ? [h('b', null, 'Stop that bag! '), `${plural(heldPrefix[i], 'passenger')} held so far.`]
            : ['Scanning… ', h('b', null, `${fmt((i + 1) * steps)} emails checked.`)]));
      }
      xr.laneList.replaceChildren(...lane.slice().reverse().map(r => h('li', null, h('span', null, nameOf(m, r.lead)), h('span', null, shortReason(r)))));
      last = i;
      if (p < 1) requestAnimationFrame(tick);
      else setTimeout(done, 700);
    };
    requestAnimationFrame(tick);
  });
}

function shortReason(r) {
  const x = r.issues.find(i => i.level === 'mayday');
  if (!x) return '';
  if (x.kind === 'empty_tag') return `blank ${x.key.split(':')[1]}`;
  if (x.kind === 'unknown_tag') return 'unknown tag';
  if (x.kind === 'broken_tag') return 'broken tag';
  if (x.kind === 'shouting') return 'in capitals';
  return x.kind;
}

function viewBoarding() {
  const g = state.gate;
  const m = state.manifest;
  const c = g.counts;
  const board = h('div', { class: 'wallboard' },
    h('div', { class: 'bhead' }, icon('board'), 'Departures · Gate GC'),
    h('div', { class: 'rows' },
      h('span', { class: 'k' }, 'Flight'), flaps(flightName().slice(0, 14)),
      h('span', { class: 'k' }, 'Scanned'), flaps(fmt(c.emails), 'white'),
      h('span', { class: 'k' }, 'Boarded'), flaps(fmt(c.cleared), 'green'),
      h('span', { class: 'k' }, 'Held'), flaps(fmt(c.held), c.held ? 'red' : 'green'),
      h('span', { class: 'k' }, 'Lost bags'), flaps(fmt(c.heldAtBaggage)),
      h('span', { class: 'k' }, 'Status'), flaps(g.status, g.status === 'CLEARED' ? 'green' : 'red')));
  if (state.justRan) { state.justRan = false; setTimeout(() => clatter(board, state.calm, sfx.flap), 120); }

  const parts = [
    stage('gate', 3, {
      focus: 0.5,
      inFrame: [board, walkers(g)],
      over: [crew(c.held ? 'agent-alert' : 'agent-ok', 'right pop'),
        say('GATE AGENT', g.status === 'CLEARED'
          ? [h('b', null, 'Everyone’s boarding pass checks out. '), 'Cleared for take-off!']
          : [h('b', null, `${plural(c.held, 'passenger')} can’t board. `), 'Their email would go out broken. Have a look below.'],
        { right: '27cqw', bottom: '64%' })],
    }),
    noteBanner(),
    state.starter ? h('div', { class: 'starter' }, h('b', null, 'Heads up: you’re checking the starter email, not your own. '), 'Paste your sequence in the Control Tower first, then scan.', ' ', h('button', { class: 'btn small', onclick: () => go('tower') }, 'Open the Control Tower')) : null,
    c.held ? h('div', { class: 'fixcta' },
      h('span', null, h('b', null, `🔧 ${plural(c.held, 'passenger')} held at the gate.`), ' Each problem below has a one-click fix.'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn primary', onclick: () => document.querySelector('.fix')?.scrollIntoView({ behavior: state.calm ? 'auto' : 'smooth', block: 'start' }) }, 'Fix them ↓'))
      : h('div', { class: 'fixed-note' }, '✅ Every passenger boards. Nothing to fix. Head to Take-off for your files.'),
    h('p', { class: 'note' }, `Scanned ${plural(c.emails, 'email')} in ${g.ms < 10 ? 'under 0.01' : (g.ms / 1000).toFixed(2)} s on this computer. No internet used.`),
  ];

  if (g.reasons.length) {
    parts.push(h('h3', { class: 'next' }, 'What security found · click one to see who'));
    parts.push(h('div', { class: 'tablewrap round' }, h('table', null,
      h('thead', null, h('tr', null, h('th', null, ''), h('th', null, 'Problem'), h('th', null, 'Leads'), h('th', null, 'Leg'), h('th', null, 'Example'), h('th', null, 'Fix'))),
      h('tbody', null, g.reasons.map(r => h('tr', {
        class: 'click' + (state.reason === r.key ? ' sel' : ''), onclick: () => { state.reason = r.key; state.passenger = r.leadIds[0]; sfx.stamp(); render(); },
      },
        h('td', null, h('span', { class: `pill ${r.level}` }, r.level === 'mayday' ? 'MAYDAY' : 'TURBULENCE')),
        h('td', null, r.label),
        h('td', { class: 'mono' }, fmt(r.count)),
        h('td', { class: 'mono' }, r.steps.length ? r.steps.join(', ') : '—'),
        h('td', { title: r.example }, r.example),
        h('td', { class: 'muted', title: r.hint }, r.hint)))))));
  }

  const resultsById = new Map(g.results.map(r => [r.lead.id, r]));
  const chosen = g.reasons.find(r => r.key === state.reason);
  const sampleBtn = h('button', {
    class: 'btn small', onclick: () => {
      const pool = g.results;
      const pick = new Set();
      while (pick.size < Math.min(5, pool.length)) pick.add(pool[Math.floor(Math.random() * pool.length)].lead.id);
      Object.assign(state, { reason: '__sample', sample: [...pick] });
      state.passenger = state.sample[0];
      render();
    },
  }, '🎲 Show me 5 random passengers');
  const ids = chosen ? chosen.leadIds : state.reason === '__sample' ? state.sample : [];
  if (chosen) parts.push(fixPanel(chosen));
  parts.push(h('div', { class: 'row next' }, h('h3', null, chosen ? `Passengers · ${chosen.label}` : state.reason === '__sample' ? 'Random spot-check' : 'Boarding passes'), h('span', { class: 'spacer' }), sampleBtn));
  const list = ids.slice(0, 200).map(id => resultsById.get(id)).filter(Boolean);
  const left = list.length ? h('div', { class: 'tablewrap round' }, h('table', null,
    h('thead', null, h('tr', null, h('th', null, 'Seat'), h('th', null, 'Passenger'), h('th', null, 'Company'), h('th', null, 'Status'))),
    h('tbody', null, list.map(r => h('tr', { class: 'click' + (state.passenger === r.lead.id ? ' sel' : ''), onclick: () => { state.passenger = r.lead.id; sfx.stamp(); render(); } },
      h('td', { class: 'rownum' }, r.lead.row),
      h('td', null, nameOf(m, r.lead)),
      h('td', null, 'company' in m.map ? r.lead.cells[m.map.company] : ''),
      h('td', null, h('span', { class: 'pill ' + (r.status === 'held' ? 'mayday' : 'clear') }, r.status === 'held' ? 'HELD' : 'BOARDED'))))))) : h('div', { class: 'empty' }, 'Pick a problem above, or spot-check 5 random passengers.');
  const pr = resultsById.get(state.passenger);
  parts.push(h('div', { class: 'grid2' }, left, pr ? boardingPass(pr) : h('div', { class: 'empty' }, 'Click a passenger to open their boarding pass: the exact emails they’d get.')));

  parts.push(h('div', { class: 'row next' },
    h('button', { class: 'btn', onclick: () => go('tower') }, '← Back to the tower'),
    h('button', { class: 'btn', onclick: () => { state.gateStale = true; render(); } }, '↻ Scan again'),
    h('span', { class: 'spacer' }),
    c.cleared
      ? h('button', { class: 'btn primary', onclick: () => go('takeoff') }, `Board ${fmt(c.cleared)} and taxi →`)
      : h('button', { class: 'btn primary', disabled: true, title: 'Fix the Maydays first' }, 'Nobody can board yet')));
  return parts;
}

// One fix per kind of problem, right where it's found. Every fix re-scans.
function fixPanel(r) {
  const m = state.manifest;
  const name = r.key.split(':').slice(1).join(':');
  const box = h('div', { class: 'card fix next' }, h('h3', null, r.level === 'mayday' ? '🔧 Fix it' : 'ℹ️ Your call'));
  const towerBtn = () => h('button', { class: 'btn', onclick: () => go('tower') }, 'Open the Control Tower');
  const replaceTag = (from, to) => {
    const re = new RegExp(`\\{\\{\\s*${esc(from)}\\s*(\\|[^{}]*)?\\}\\}`, 'gi');
    for (const s of state.steps) { s.subject = s.subject.replace(re, (_, fb = '') => `{{${to}${fb}}}`); s.body = s.body.replace(re, (_, fb = '') => `{{${to}${fb}}}`); }
  };

  if (r.kind === 'empty_tag') {
    const col = resolveTag(name, m.headers, m.map);
    const guess = col === m.map.first_name ? 'there' : col === m.map.company ? 'your team' : '';
    const fb = h('input', { type: 'text', value: guess, placeholder: 'e.g. your team', class: 'fbinput' });
    box.append(h('div', { class: 'fixopt' },
      h('b', null, '1 · Add a fallback'),
      h('p', { class: 'muted small' }, `Leads with no ${name} get these words instead, in every leg. Your tag becomes {{${name}|…}}.`),
      h('div', { class: 'row' }, fb, h('button', {
        class: 'btn primary', onclick: () => {
          const v = fb.value.trim();
          if (!v) { fb.focus(); return; }
          const re = new RegExp(`\\{\\{\\s*${esc(name)}\\s*\\}\\}`, 'gi');
          for (const s of state.steps) { s.subject = s.subject.replace(re, `{{${name}|${v}}}`); s.body = s.body.replace(re, `{{${name}|${v}}}`); }
          rescan(`Fallback added: {{${name}|${v}}} in every leg.`);
        },
      }, 'Apply & re-scan'))));
    if (editable(col)) {
      const leads = r.leadIds.slice(0, 40).map(id => m.leads.find(l => l.id === id)).filter(Boolean);
      const inputs = leads.map(l => ({ l, el: h('input', { type: 'text', class: 'cell', placeholder: name, 'aria-label': `${name} for ${nameOf(m, l)}` }) }));
      box.append(h('div', { class: 'fixopt' },
        h('b', null, `2 · Or fill in the ${name} yourself`),
        h('p', { class: 'muted small' }, r.count > 40 ? `Showing the first 40 of ${fmt(r.count)}. Leave any blank to keep it held.` : 'Leave any blank to keep it held.'),
        h('div', { class: 'tablewrap round short' }, h('table', null,
          h('thead', null, h('tr', null, h('th', null, 'Row'), h('th', null, 'Passenger'), h('th', null, 'Email'), h('th', null, name))),
          h('tbody', null, inputs.map(({ l, el }) => h('tr', null,
            h('td', { class: 'rownum' }, l.row), h('td', null, nameOf(m, l)), h('td', null, l.cells[m.map.email] || ''), h('td', null, el)))))),
        h('div', { class: 'row next' }, h('span', { class: 'spacer' }), h('button', {
          class: 'btn', onclick: () => {
            const list = inputs.filter(x => x.el.value.trim()).map(x => ({ id: x.l.id, col, value: x.el.value.trim() }));
            if (!list.length) return;
            addEdits(list);
            rescan(`You filled in ${plural(list.length, name)}.`);
          },
        }, 'Save & re-scan'))));
    }
  } else if (r.kind === 'unknown_tag') {
    const near = nearestHeader(name, m.headers);
    if (near) {
      const to = tagFor(near).slice(2, -2);
      box.append(h('div', { class: 'fixopt' },
        h('p', null, `{{${name}}} isn’t a column in your list. It looks like a typo for ${tagFor(near)}.`),
        h('button', { class: 'btn primary', onclick: () => { replaceTag(name, to); rescan(`{{${name}}} changed to {{${to}}} in every leg.`); } }, `Change to {{${to}}} everywhere & re-scan`)));
    } else {
      box.append(h('div', { class: 'fixopt' }, h('p', null, `{{${name}}} isn’t a column in your list. Change it to one of your columns, or remove it.`), towerBtn()));
    }
  } else if (r.kind === 'broken_tag') {
    box.append(h('div', { class: 'fixopt' }, h('p', null, `“${name}” is missing a brace. Tags need two on each side, like {{first_name}}.`), towerBtn()));
  } else if (r.kind === 'shouting' && r.level === 'mayday') {
    const col = resolveTag(name, m.headers, m.map);
    if (editable(col)) {
      box.append(h('div', { class: 'fixopt' },
        h('p', null, `${plural(r.count, 'lead')} would be greeted in capitals, like “Hi JOHN”.`),
        h('button', {
          class: 'btn primary', onclick: () => {
            const list = r.leadIds.map(id => m.leads.find(l => l.id === id)).filter(Boolean).map(l => ({ id: l.id, col, value: properName(l.cells[col]) }));
            addEdits(list);
            rescan(`Capitals fixed for ${plural(list.length, 'lead')}.`);
          },
        }, 'Fix the capitals & re-scan')));
    }
  } else {
    const tips = {
      copied_line: 'These board. The same “personal” line goes to many people, which reads like a template. Consider writing real first lines for them, or dropping the tag.',
      long_line: 'These board. A long company name stretches the sentence. You could shorten the sentence around the tag.',
      long_subject: 'These board. The subject runs long once the company is filled in. A shorter subject keeps it readable on a phone.',
      role_address: 'These board, but they go to a shared inbox like info@. Those rarely reply. You can remove them from boarded.csv if you prefer.',
      legal_ending: 'These board, but the company still has a legal ending like “Inc.” in the sentence.',
      messy: 'These board, with a double space or stray punctuation. Usually a blank in the middle of a sentence.',
      shouting: 'These board, but the company is in capitals.',
    };
    box.append(h('p', { class: 'muted' }, tips[r.kind] || 'These board. It’s listed so you can decide.'));
  }
  if (r.level === 'mayday') box.append(h('p', { class: 'note' }, 'Or take off without them. They’re saved in held.csv with the reason.'));
  return box;
}

// Real cleared passengers walk to the gate, tagged with their company.
function walkers(g) {
  const m = state.manifest;
  const cleared = g.results.filter(r => r.status === 'cleared');
  const dur = 12;
  const people = [1, 2, 3, 4].map((n, i) => {
    const r = cleared[Math.floor(i * cleared.length / 4)];
    const el = h('div', { class: 'walker' },
      h('img', { src: ART(`passenger-${n}`), alt: '' }),
      // Company, not first name: the figures are fixed art, and a name could
      // put a woman's name on a man's figure or the other way round.
      // The name rides on the passenger's bag as a luggage tag, so it fits any passenger.
      r ? h('span', { class: 'tag', title: 'Boarded' }, r.lead.cells[m.map.first_name] || `Seat ${r.lead.row}`) : null);
    el.style.setProperty('--dur', `${dur}s`);
    el.style.setProperty('--delay', `${-(i / 4) * dur}s`);
    return el;
  });
  return h('div', { class: 'walkers', 'aria-hidden': 'true' }, cleared.length ? people : []);
}

function boardingPass(r) {
  const m = state.manifest;
  const l = r.lead;
  const held = r.status === 'held';
  const co = 'company' in m.map ? l.cells[m.map.company] : '';
  return h('div', { class: 'pass' },
    h('div', { class: 'top' },
      h('div', { class: 'main' },
        h('div', { class: 'airline' }, h('span', null, 'GROUND CREW · BOARDING PASS'), h('span', null, `SEAT ${l.row}`)),
        h('div', { class: 'route' },
          h('div', null, h('div', { class: 'code' }, 'LIST'), h('small', null, flightName())),
          icon('plane'),
          h('div', null, h('div', { class: 'code' }, 'INBOX'), h('small', null, l.cells[m.map.email] || ''))),
        h('div', { class: 'fields' },
          h('span', null, 'PASSENGER', h('b', null, nameOf(m, l))),
          h('span', null, 'COMPANY', h('b', null, co || '(none)')),
          h('span', null, 'LEGS', h('b', null, String(r.rendered.length))),
          h('span', null, 'ROW', h('b', null, String(l.row))))),
      h('div', { class: 'stub' }, h('span', { class: 'airline' }, 'GATE GC'), h('div', { class: 'barcode v' }))),
    h('div', { class: `stamp ${held ? 'held' : 'boarded'}` }, held ? 'HELD' : 'BOARDED'),
    h('div', { class: 'emails' },
      state.steps.map((s, i) => {
        const iss = r.issues.filter(x => x.step === i + 1);
        return [
          h('h4', null, `LEG ${i + 1}`),
          h('pre', null, ...renderMail(i, l, false)),
          iss.length ? h('div', { class: 'iss' }, iss.map(x => h('div', null, h('span', { class: `pill ${x.level}` }, x.level === 'mayday' ? 'MAYDAY' : 'TURBULENCE'), ' ', x.label, x.hint ? h('span', { class: 'muted' }, ` · ${x.hint}`) : null))) : null,
        ];
      }),
      r.issues.filter(x => !x.step).map(x => h('div', { class: 'iss' }, h('div', null, h('span', { class: `pill ${x.level}` }, 'TURBULENCE'), ' ', x.label)))));
}

// Fill a template for one lead as DOM: values glow on the X-ray, blanks
// show as a red gap right where they'd land.
function marked(text, lead, xray) {
  const m = state.manifest;
  const c = compile(text, m.headers, m.map);
  const out = document.createDocumentFragment();
  for (const p of c.parts) {
    if ('text' in p) { out.append(p.text); continue; }
    if (p.col === -1) { out.append(h('span', { class: 'gap', title: 'Not a column in your list' }, p.raw)); continue; }
    const v = String(lead.cells[p.col] ?? '').trim();
    if (v) out.append(xray ? h('span', { class: 'val' }, v) : v);
    else if (p.fallback !== null) out.append(xray ? h('span', { class: 'val' }, p.fallback) : p.fallback);
    else out.append(h('span', { class: 'gap', title: `${p.name} is blank for this lead` }, `${p.name}?`));
  }
  return out;
}

// ---------- 04 Take-off ----------
function viewTakeoff() {
  const m = state.manifest, g = state.gate;
  const base = state.fileName.replace(/\.[^.]+$/, '') || 'campaign';
  const dl = (name, text) => {
    sfx.stamp();
    const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
    const a = h('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const plane = h('div', { class: 'plane-rig' }, h('div', { class: 'trail' }), h('img', { src: ART('plane'), alt: '' }));
  const clouds = [[8, 10, 26], [52, 4, 20], [70, 26, 30], [22, 38, 18], [84, 48, 22], [40, 54, 26], [4, 62, 18], [60, 70, 16]]
    .map(([x, y, w]) => { const c = h('div', { class: 'cloud' }); c.style.left = `${x}%`; c.style.top = `${y}%`; c.style.setProperty('--w', `${w}cqw`); return c; });
  const st = stage('runway', 4, {
    focus: 0.6, sky: [h('div', { class: 'sky' }, clouds), plane],
    over: [crew('marshal-cheer', 'left full'), h('div', { class: 'wheels' }, 'Wheels up', h('small', null, `${plural(g.counts.cleared, 'passenger')} on board · nothing was sent`)),
      say('MARSHAL', [h('b', null, `${plural(g.counts.cleared, 'passenger')} on board. `), 'Nothing was sent. Your files are ready.'], { left: '22cqw', bottom: '62%' }),
      h('button', { class: 'btn small again', onclick: () => fly(st) }, '↻ Watch again')],
  });
  st.classList.add('flight');
  fly(st);
  return [
    st,
    h('div', { class: 'grid3 files' },
      h('div', { class: 'card' },
        h('h3', null, 'boarded.csv'),
        h('p', { class: 'muted small' }, `${plural(g.counts.cleared, 'clean lead')}. Twins merged, fixes applied, all your original columns kept. Load this into your sending tool.`),
        h('button', { class: 'btn primary', onclick: () => dl(`${base}-boarded.csv`, boardedCSV(m, g)) }, 'Download')),
      h('div', { class: 'card' },
        h('h3', null, 'held.csv'),
        h('p', { class: 'muted small' }, `${plural(g.counts.held + g.counts.heldAtBaggage, 'lead')} held back, each with its reason, so nothing is silently dropped.`),
        h('button', { class: 'btn', onclick: () => dl(`${base}-held.csv`, heldCSV(m, g)) }, 'Download')),
      h('div', { class: 'card' },
        h('h3', null, 'changes.csv'),
        h('p', { class: 'muted small' }, `${plural(m.changes.length + m.stats.twinsMerged, 'change')}, before and after, for your audit trail.`),
        h('button', { class: 'btn', onclick: () => dl(`${base}-changes.csv`, changesCSV(m)) }, 'Download'))),
    h('p', { class: 'note next' }, 'Any cell that starts with =, +, - or @ is saved as plain text, so it can’t run as a formula in Excel or Sheets.'),
  ];
}

// Roll, rotate, climb: the camera tilts up to follow the plane into the sky.
function fly(st) {
  st.classList.remove('go', 'done', 'still');
  if (state.calm) { st.classList.add('still'); return; }
  void st.offsetWidth;
  st.classList.add('go');
  setTimeout(() => sfx.jet(7.2), 150);
}

// ---------- Sweep the hangar ----------
function sweep() {
  Object.assign(state, {
    view: 'checkin', fileName: '', parsed: null, map: null, manifest: null, steps: blankSteps(), starter: true,
    gate: null, gateStale: true, reason: null, passenger: null, query: '', bigWarning: false,
  });
  render();
}

initRadio();
render();
