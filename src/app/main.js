// Ground Crew, the page. Everything is built with textContent, never HTML,
// so a lead's data can't run as code. Nothing here touches the network.

import {
  parseCSV, guessColumns, FIELDS, FIELD_LABELS, buildManifest, checkCampaignChunked,
  towerCheck, PRESETS, boardedCSV, heldCSV, changesCSV, tagFor,
} from '../engine/index.js';
import { makeSkyline, SEQUENCE_PLANTED } from '../engine/skyline.js';

// ---------- tiny DOM helper ----------
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const fmt = n => Number(n).toLocaleString('en-US');
const plural = (n, one, many = one + 's') => `${fmt(n)} ${n === 1 ? one : many}`;

// ---------- state ----------
const STATIONS = [
  ['checkin', 'Check-in'],
  ['baggage', 'Baggage Claim'],
  ['tower', 'Control Tower'],
  ['gate', 'Boarding Gate'],
  ['takeoff', 'Take-off'],
];
const blankSteps = () => [
  { subject: '', body: 'Hi {{first_name}},\n\n\n\nWorth a quick chat?\n' },
];
const state = {
  view: 'checkin',
  fileName: '',
  parsed: null,
  map: null,
  manifest: null,
  steps: blankSteps(),
  preset: 'operator',
  gate: null,
  gateStale: true,
  baggageTab: 'boarding',
  query: '',
  shown: 100,
  reason: null,
  passenger: null,
  bigWarning: false,
};

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
    h('span', { class: 'dot' }),
    radio.transmissions
      ? `${plural(radio.transmissions, 'transmission')}`
      : radio.locked ? 'Radio silence · 0 transmissions' : 'Radio check: not locked (dev build)',
    radio.blocked ? ` · ${fmt(radio.blocked)} blocked` : '',
  );
  radioEl.title = radio.locked
    ? "This page's security policy blocks every network request. Nothing you load here can leave this computer."
    : 'This copy was opened without its security policy.';
}

// ---------- layout ----------
function canVisit(id) {
  if (id === 'checkin') return true;
  if (id === 'baggage' || id === 'tower') return !!state.manifest;
  if (id === 'gate') return !!state.manifest;
  if (id === 'takeoff') return !!state.gate && !state.gateStale;
  return false;
}
function go(id) {
  if (!canVisit(id)) return;
  state.view = id;
  render();
  window.scrollTo({ top: 0 });
}

function render() {
  radioEl = h('div', { class: 'radio' });
  const nav = h('nav', { class: 'stations' }, STATIONS.map(([id, label], i) =>
    h('button', { class: state.view === id ? 'on' : '', disabled: !canVisit(id), onclick: () => go(id) },
      h('span', { class: 'n' }, String(i).padStart(2, '0')), label)));
  const views = { checkin: viewCheckin, baggage: viewBaggage, tower: viewTower, gate: viewGate, takeoff: viewTakeoff };
  app.replaceChildren(
    h('header', { class: 'top' }, h('div', { class: 'wrap' },
      h('div', { class: 'brand' }, '✈ GROUND CREW'), nav, radioEl)),
    h('main', null, h('div', { class: 'wrap' }, views[state.view]())),
    h('footer', null, h('div', { class: 'wrap row' },
      h('span', null, 'Ground Crew · the pre-flight check for outbound. No signal needed.'),
      h('span', { class: 'spacer' }),
      state.manifest ? h('button', { class: 'btn small ghost', onclick: sweep }, '🧹 Sweep the hangar') : null)),
  );
  paintRadio();
}

function marshal(...text) {
  return h('div', { class: 'marshal' }, h('div', { class: 'who' }, '🦺'), h('p', null, ...text));
}

// ---------- 00 Check-in ----------
function viewCheckin() {
  const input = h('input', { type: 'file', accept: '.csv,text/csv,text/plain', hidden: true, onchange: e => e.target.files[0] && loadFile(e.target.files[0]) });
  const drop = h('div', {
    class: 'drop',
    onclick: () => input.click(),
    ondragover: e => { e.preventDefault(); drop.classList.add('over'); },
    ondragleave: () => drop.classList.remove('over'),
    ondrop: e => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) loadFile(f); },
  }, h('strong', null, 'Drop your lead list here'), h('span', { class: 'muted' }, 'A CSV from Apollo, Clay, Sales Navigator, a spreadsheet… It stays on this computer.'), input);

  const parts = [
    h('h1', null, 'You built it. Now get it out there.'),
    h('p', { class: 'lede' }, 'Ground Crew checks every email, for every lead, across every step, before your campaign takes off. It runs on your laptop with the Wi-Fi off. Nothing is uploaded and nothing is sent.'),
    marshal('Welcome to Ground Crew. ', h('b', null, 'Nothing takes off until it’s checked.')),
    drop,
    h('div', { class: 'row', style: null }, h('span', { class: 'muted small' }, 'No list handy?'),
      h('button', { class: 'btn small', onclick: loadDemo }, 'Try it with Skyline Leads (3,000 made-up leads)')),
  ];

  if (state.bigWarning) {
    parts.push(h('div', { class: 'card' }, h('p', null, `This list has ${fmt(state.parsed.rows.length)} rows. Ground Crew can handle it, but the checks may take a little while on this computer.`)));
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
      grid.append(h('span', null, FIELD_LABELS[f]), sel);
    }
    parts.push(h('div', { class: 'card' },
      h('h3', null, `Luggage tags for “${state.fileName}”`),
      h('p', { class: 'muted small' }, `${plural(state.parsed.rows.length, 'row')} · ${plural(state.parsed.headers.length, 'column')}. Here’s which column Ground Crew thinks is which. Change anything that’s wrong; every other column is kept and can be used as a tag.`),
      grid,
      h('div', { class: 'row' }, h('span', { class: 'spacer' }),
        h('button', { class: 'btn primary', onclick: board }, 'Send the bags to Baggage Claim →'))));
  }
  return parts;
}

async function loadFile(file) {
  const text = await file.text();
  setParsed(parseCSV(text), file.name);
}
function loadDemo() {
  const s = makeSkyline(3000);
  state.steps = SEQUENCE_PLANTED.map(x => ({ ...x }));
  setParsed({ headers: s.headers, rows: s.rows }, 'skyline-leads.csv');
}
function setParsed(parsed, name) {
  if (!parsed.headers.length) { alert('That file looks empty.'); return; }
  state.parsed = parsed;
  state.fileName = name;
  state.map = guessColumns(parsed.headers);
  state.manifest = null;
  state.gate = null;
  state.gateStale = true;
  state.bigWarning = parsed.rows.length > 50000;
  render();
}
function board() {
  if (!('email' in state.map)) { alert('Ground Crew needs to know which column holds the email.'); return; }
  if (!('first_name' in state.map) && !('full_name' in state.map)) { alert('Pick a first name (or full name) column so greetings can be checked.'); return; }
  state.manifest = buildManifest(state.parsed, state.map);
  state.gateStale = true;
  state.baggageTab = 'boarding';
  state.query = '';
  state.shown = 100;
  go('baggage');
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
    ['boarding', `Manifest (${fmt(m.leads.length)})`],
    ['fixed', `Fixed (${fmt(fixedLeads.length)})`],
    ['twins', `Twins (${fmt(m.twins.length)})`],
    ['lost', `Lost & Found (${fmt(m.lostFound.length)})`],
  ];
  const search = h('input', {
    type: 'search', placeholder: 'Search the manifest', value: state.query,
    oninput: e => { state.query = e.target.value; state.shown = 100; paintTable(); },
  });
  const tableHolder = h('div');

  function paintTable() {
    tableHolder.replaceChildren(baggageTable(m, changesByLead, fixedLeads));
  }
  paintTable();

  return [
    h('h2', null, 'Baggage Claim'),
    h('p', { class: 'lede' }, 'The list comes in messy and leaves clean. Every fix is shown, and nothing is changed without a reason. Your original file is never touched.'),
    marshal(`Bags are on the belt. `, h('b', null, `${plural(m.stats.twinsMerged, 'twin')} merged, ${plural(m.stats.fixes, 'field')} fixed, ${plural(m.stats.lostFound, 'bag')} in Lost & Found.`)),
    h('div', { class: 'stats' },
      stat(m.stats.rows, 'rows checked in'),
      stat(m.stats.boarding, 'ready to board'),
      stat(m.stats.twinsMerged, 'twins merged'),
      stat(m.stats.fixes, 'fields fixed'),
      stat(m.stats.lostFound, 'in Lost & Found')),
    h('div', { class: 'row' },
      h('div', { class: 'tabs' }, tabs.map(([id, label]) =>
        h('button', { class: state.baggageTab === id ? 'on' : '', onclick: () => { state.baggageTab = id; state.shown = 100; render(); } }, label))),
      h('span', { class: 'spacer' }), search),
    tableHolder,
    h('p', { class: 'note' }, 'Green cells were fixed. Hover one to see what it was before and why it changed.'),
    h('div', { class: 'row' }, h('span', { class: 'spacer' }),
      h('button', { class: 'btn primary', onclick: () => go('tower') }, 'Over to the Control Tower →')),
  ];
}

function stat(n, label) {
  return h('div', { class: 'stat' }, h('b', null, fmt(n)), h('span', null, label));
}

function matches(cells) {
  const q = state.query.trim().toLowerCase();
  return !q || cells.some(c => String(c).toLowerCase().includes(q));
}

function baggageTable(m, changesByLead, fixedLeads) {
  const tab = state.baggageTab;
  if (tab === 'twins') {
    const rows = m.twins.filter(t => matches(m.leads.concat(m.lostFound.map(x => x.lead)).find(l => l.id === t.keepId)?.cells || []));
    if (!rows.length) return h('div', { class: 'empty' }, 'No twins in this list.');
    const leadById = new Map([...m.leads, ...m.lostFound.map(x => x.lead)].map(l => [l.id, l]));
    return h('div', { class: 'tablewrap' }, h('table', null,
      h('thead', null, h('tr', null, h('th', null, 'Kept row'), h('th', null, 'Name'), h('th', null, 'Email'), h('th', null, 'Merged rows'), h('th', null, 'Why'))),
      h('tbody', null, rows.slice(0, state.shown).map(t => {
        const l = leadById.get(t.keepId);
        return h('tr', null,
          h('td', { class: 'rownum' }, t.keepRow),
          h('td', null, nameOf(m, l)),
          h('td', null, l.cells[m.map.email] || ''),
          h('td', { class: 'mono' }, t.mergedRows.join(', ')),
          h('td', null, t.why));
      }))), more(rows.length));
  }
  if (tab === 'lost') {
    const rows = m.lostFound.filter(x => matches(x.lead.cells));
    if (!rows.length) return h('div', { class: 'empty' }, 'Nothing in Lost & Found.');
    return h('div', { class: 'tablewrap' }, h('table', null,
      h('thead', null, h('tr', null, h('th', null, 'Row'), h('th', null, 'Why it’s held'), m.headers.map(x => h('th', null, x)))),
      h('tbody', null, rows.slice(0, state.shown).map(x => h('tr', null,
        h('td', { class: 'rownum' }, x.lead.row),
        h('td', null, h('span', { class: 'pill lost' }, x.reasons.join(' · '))),
        x.lead.cells.slice(0, m.headers.length).map(c => h('td', { title: c }, c)))))), more(rows.length));
  }
  const list = (tab === 'fixed' ? fixedLeads : m.leads).filter(l => matches(l.cells));
  if (!list.length) return h('div', { class: 'empty' }, 'No rows match.');
  return h('div', { class: 'tablewrap' }, h('table', null,
    h('thead', null, h('tr', null, h('th', null, 'Row'), m.headers.map(x => h('th', null, x)))),
    h('tbody', null, list.slice(0, state.shown).map(l => {
      const ch = changesByLead.get(l.id);
      return h('tr', null,
        h('td', { class: 'rownum' }, l.row),
        l.cells.slice(0, m.headers.length).map((c, i) => {
          const fix = ch && ch.get(i);
          return h('td', { class: fix ? 'fixed' : null, title: fix ? `Was “${fix.before}” · ${fix.why}` : c }, c);
        }));
    }))), more(list.length));
}

function more(total) {
  if (total <= state.shown) return null;
  return h('div', { class: 'row' }, h('span', { class: 'muted small' }, `Showing ${fmt(state.shown)} of ${fmt(total)}`),
    h('button', { class: 'btn small', onclick: () => { state.shown += 200; render(); } }, 'Show more'));
}

function nameOf(m, l) {
  const f = 'first_name' in m.map ? l.cells[m.map.first_name] : '';
  const s = 'last_name' in m.map ? l.cells[m.map.last_name] : '';
  return `${f} ${s}`.trim() || '(no name)';
}

// ---------- 02 Control Tower ----------
const towerTimers = new Map();
let lastField = null;

function viewTower() {
  const m = state.manifest;
  const chips = m.headers.map(x => h('button', {
    class: 'chip', title: `Insert ${tagFor(x)}`,
    onmousedown: e => e.preventDefault(),
    onclick: () => insertTag(tagFor(x)),
  }, tagFor(x)));

  const legs = state.steps.map((step, i) => towerLeg(step, i));
  return [
    h('h2', null, 'Control Tower'),
    h('p', { class: 'lede' }, 'Write or paste each step of your sequence. The tower checks the copy as you type. The score is a writing guide, not a promise of replies.'),
    marshal('Over to the tower. ', h('b', null, 'They’ll talk you through the copy.')),
    h('div', { class: 'card' },
      h('div', { class: 'row' },
        h('span', { class: 'small muted' }, 'Tags from your list (click to insert):'),
        h('span', { class: 'spacer' }),
        h('label', { class: 'small muted' }, 'Rules '),
        (() => {
          const sel = h('select', { onchange: e => { state.preset = e.target.value; render(); } },
            h('option', { value: 'operator' }, 'Outbound operator'), h('option', { value: 'gentle' }, 'Gentle (Maydays and length only)'));
          sel.value = state.preset;
          return sel;
        })()),
      h('div', { class: 'chips' }, chips),
      h('p', { class: 'note' }, 'Add a fallback for blanks like {{company|your team}}.')),
    h('div', { class: 'legs' }, legs),
    h('div', { class: 'row' },
      state.steps.length < 6 ? h('button', { class: 'btn', onclick: () => { state.steps.push({ subject: '', body: 'Hi {{first_name}},\n\n\n' }); state.gateStale = true; render(); } }, '+ Add a follow-up') : null,
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn primary', onclick: () => go('gate') }, 'Head to the Boarding Gate →')),
  ];
}

function towerLeg(step, i) {
  const callsBox = h('div', { class: 'calls' });
  const paint = () => {
    const t = towerCheck(step, i, { manifest: state.manifest, enabled: PRESETS[state.preset] });
    const bar = h('i');
    bar.style.width = t.score + '%';
    bar.style.background = t.calls.some(c => c.kind === 'mayday') ? 'var(--red)' : t.clear ? 'var(--green)' : 'var(--yellow)';
    callsBox.replaceChildren(
      h('div', { class: 'alt' }, h('span', { class: 'small muted' }, 'ALTIMETER'), h('div', { class: 'bar' }, bar), h('b', null, t.score)),
      h('ul', null, t.calls.length
        ? t.calls.map(c => h('li', null, h('span', { class: `pill ${c.kind}` }, c.kind === 'mayday' ? 'MAYDAY' : 'TURB'), h('span', null, c.line)))
        : h('li', null, h('span', { class: 'pill clear' }, 'CLEAR'), h('span', null, 'Clear skies. Roger that.'))),
      h('p', { class: 'note' }, `${plural(t.words, 'word')}`));
  };
  const schedule = () => {
    state.gateStale = true;
    clearTimeout(towerTimers.get(i));
    towerTimers.set(i, setTimeout(paint, 120));
  };
  const subject = h('input', {
    type: 'text', value: step.subject, placeholder: i === 0 ? 'Subject line' : '(empty = reply in the same thread)',
    oninput: e => { step.subject = e.target.value; schedule(); }, onfocus: e => { lastField = { el: e.target, step, key: 'subject' }; },
  });
  const body = h('textarea', {
    rows: 10, value: step.body,
    oninput: e => { step.body = e.target.value; schedule(); }, onfocus: e => { lastField = { el: e.target, step, key: 'body' }; },
  });
  paint();
  const day = [0, 3, 7, 12, 18, 25][i];
  return h('div', { class: 'leg' },
    h('div', { class: 'strip' },
      h('div', { class: 'row' }, h('b', { class: 'mono' }, `LEG ${i + 1}`), h('span', { class: 'muted small' }, i === 0 ? 'First email' : `Follow-up · around day ${day}`),
        h('span', { class: 'spacer' }),
        state.steps.length > 1 ? h('button', { class: 'btn small ghost', onclick: () => { state.steps.splice(i, 1); state.gateStale = true; render(); } }, 'Remove') : null),
      h('label', null, 'Subject'), subject,
      h('label', null, 'Body'), body),
    callsBox);
}

function insertTag(tag) {
  if (!lastField || !document.body.contains(lastField.el)) return;
  const el = lastField.el;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  el.value = el.value.slice(0, start) + tag + el.value.slice(end);
  el.selectionStart = el.selectionEnd = start + tag.length;
  el.focus();
  el.dispatchEvent(new Event('input'));
}

// ---------- 03 Boarding Gate ----------
let running = false;

function viewGate() {
  const g = state.gate;
  const parts = [
    h('h2', null, 'Boarding Gate'),
    h('p', { class: 'lede' }, 'Security Check fills in every step for every lead, exactly as the inbox would see it, and checks the finished email. Any Mayday holds the passenger. Turbulence boards, but is listed so you can decide.'),
  ];
  const progress = h('div', { class: 'progress' }, h('i'));
  const progressText = h('p', { class: 'muted small' });

  if (!g || state.gateStale) {
    const m = state.manifest;
    parts.push(marshal(g ? 'The copy changed since the last check. ' : 'Ready when you are. ', h('b', null, `${plural(m.leads.length, 'passenger')} × ${plural(state.steps.length, 'step')} = ${plural(m.leads.length * state.steps.length, 'email')} to check.`)));
    const btn = h('button', {
      class: 'btn primary', disabled: running, onclick: async () => {
        running = true; btn.disabled = true;
        const t0 = performance.now();
        const res = await checkCampaignChunked(m, state.steps, p => {
          progress.firstChild.style.width = (p.done / p.total * 100).toFixed(1) + '%';
          progressText.textContent = `Scanning ${fmt(p.done)} of ${fmt(p.total)} passengers · ${fmt(p.emails)} emails checked`;
        });
        res.ms = performance.now() - t0;
        state.gate = res; state.gateStale = false; state.reason = null; state.passenger = null;
        running = false;
        render();
      },
    }, 'Run the Security Check');
    parts.push(h('div', { class: 'card' }, btn, progress, progressText));
    return parts;
  }

  const c = g.counts;
  const flight = state.fileName.replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/gi, ' ').trim().toUpperCase().slice(0, 18) || 'OUTBOUND';
  parts.push(marshal(
    g.status === 'CLEARED' ? h('b', null, 'Cleared for take-off. Nice flying.')
      : [`Hold the gate. `, h('b', null, `${plural(c.held, 'passenger')} would get a broken email.`), ' Fix them in the tower or the list, or take off without them.']));
  parts.push(h('div', { class: 'board' },
    h('span', { class: 'k' }, 'FLIGHT'), h('span', { class: 'v' }, flight),
    h('span', { class: 'k' }, 'LEGS'), h('span', { class: 'v' }, c.steps),
    h('span', { class: 'k' }, 'EMAILS CHECKED'), h('span', { class: 'v' }, fmt(c.emails)),
    h('span', { class: 'k' }, 'BOARDED'), h('span', { class: 'v ok' }, fmt(c.cleared)),
    h('span', { class: 'k' }, 'HELD AT GATE'), h('span', { class: 'v bad' }, fmt(c.held)),
    h('span', { class: 'k' }, 'LOST & FOUND'), h('span', { class: 'v' }, fmt(c.heldAtBaggage)),
    h('span', { class: 'k' }, 'STATUS'), h('span', { class: 'v ' + (g.status === 'CLEARED' ? 'ok' : 'bad') }, g.status)));
  parts.push(h('p', { class: 'note' }, `Checked in ${(g.ms / 1000).toFixed(2)} s on this computer, with no internet.`));

  // Reasons
  if (g.reasons.length) {
    parts.push(h('h3', null, 'What the scanner found'));
    parts.push(h('div', { class: 'tablewrap' }, h('table', null,
      h('thead', null, h('tr', null, h('th', null, ''), h('th', null, 'Problem'), h('th', null, 'Leads'), h('th', null, 'Step'), h('th', null, 'Example'), h('th', null, 'Fix'))),
      h('tbody', null, g.reasons.map(r => h('tr', {
        class: 'click', onclick: () => { state.reason = r.key; state.passenger = null; render(); },
      },
        h('td', null, h('span', { class: `pill ${r.level}` }, r.level === 'mayday' ? 'MAYDAY' : 'TURB')),
        h('td', null, r.label),
        h('td', { class: 'mono' }, fmt(r.count)),
        h('td', { class: 'mono' }, r.steps.length ? r.steps.join(', ') : '—'),
        h('td', { title: r.example }, r.example),
        h('td', { class: 'muted', title: r.hint }, r.hint)))))));
  }

  // Passengers for the chosen reason, or a random sample
  const resultsById = new Map(g.results.map(r => [r.lead.id, r]));
  const chosen = g.reasons.find(r => r.key === state.reason);
  const sampleBtn = h('button', {
    class: 'btn small', onclick: () => {
      const pool = g.results;
      const pick = new Set();
      while (pick.size < Math.min(5, pool.length)) pick.add(pool[Math.floor(Math.random() * pool.length)].lead.id);
      state.reason = '__sample'; state.sample = [...pick]; state.passenger = state.sample[0]; render();
    },
  }, 'Show me 5 random passengers');
  const ids = chosen ? chosen.leadIds : state.reason === '__sample' ? state.sample : [];
  parts.push(h('div', { class: 'row' }, h('h3', null, chosen ? `Passengers: ${chosen.label}` : state.reason === '__sample' ? 'A random spot-check' : 'Pick a problem above to see who it affects'), h('span', { class: 'spacer' }), sampleBtn));

  const m = state.manifest;
  const list = ids.slice(0, 200).map(id => resultsById.get(id)).filter(Boolean);
  const left = list.length ? h('div', { class: 'tablewrap' }, h('table', null,
    h('thead', null, h('tr', null, h('th', null, 'Row'), h('th', null, 'Passenger'), h('th', null, 'Company'), h('th', null, 'Status'))),
    h('tbody', null, list.map(r => h('tr', { class: 'click', onclick: () => { state.passenger = r.lead.id; render(); } },
      h('td', { class: 'rownum' }, r.lead.row),
      h('td', null, nameOf(m, r.lead)),
      h('td', null, 'company' in m.map ? r.lead.cells[m.map.company] : ''),
      h('td', null, h('span', { class: 'pill ' + (r.status === 'held' ? 'mayday' : 'clear') }, r.status === 'held' ? 'HELD' : 'BOARDED'))))))) : h('div', { class: 'empty' }, 'No passengers selected.');
  const pr = resultsById.get(state.passenger);
  parts.push(h('div', { class: 'grid2' }, left, pr ? boardingPass(pr) : h('div', { class: 'empty' }, 'Click a passenger to open their boarding pass: the exact emails they would get.')));

  parts.push(h('div', { class: 'row' },
    h('button', { class: 'btn', onclick: () => go('tower') }, '← Back to the tower'),
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn primary', onclick: () => go('takeoff') }, 'Cleared passengers to the runway →')));
  return parts;
}

function boardingPass(r) {
  const m = state.manifest;
  const l = r.lead;
  return h('div', { class: 'pass' },
    h('div', { class: 'head' },
      h('span', null, `PASSENGER  ${nameOf(m, l).toUpperCase()}`),
      h('span', null, r.status === 'held' ? 'HELD' : 'BOARDED')),
    h('div', { class: 'small' }, `${l.cells[m.map.email] || ''}${'company' in m.map ? ' · ' + (l.cells[m.map.company] || '(no company)') : ''} · row ${l.row}`),
    r.rendered.map(e => {
      const iss = r.issues.filter(x => x.step === e.step);
      return [
        h('h4', null, `LEG ${e.step}`),
        h('pre', null, e.subject ? h('div', { class: 'subj' }, e.subject) : null, e.body),
        iss.length ? h('div', { class: 'iss' }, iss.map(x => h('div', null, h('span', { class: `pill ${x.level}` }, x.level === 'mayday' ? 'MAYDAY' : 'TURB'), ' ', x.label))) : null,
      ];
    }),
    r.issues.filter(x => !x.step).map(x => h('div', { class: 'iss' }, h('span', { class: `pill ${x.level}` }, 'TURB'), ' ', x.label)));
}

// ---------- 04 Take-off ----------
function viewTakeoff() {
  const m = state.manifest, g = state.gate;
  const base = state.fileName.replace(/\.[^.]+$/, '') || 'campaign';
  const dl = (name, text) => {
    const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
    const a = h('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  return [
    h('h2', null, 'Take-off'),
    h('p', { class: 'lede' }, 'Your files are ready. Ground Crew never sends anything: load the boarded file into your sending tool.'),
    marshal(h('b', null, 'Wheels up. '), `${plural(g.counts.cleared, 'passenger')} boarded. Nothing was sent.`),
    h('div', { class: 'grid2' },
      h('div', { class: 'card' },
        h('h3', null, 'boarded.csv'),
        h('p', { class: 'muted small' }, `${plural(g.counts.cleared, 'clean lead')}, twins merged, fixes applied, all your original columns kept.`),
        h('button', { class: 'btn primary', onclick: () => dl(`${base}-boarded.csv`, boardedCSV(m, g)) }, 'Download boarded.csv')),
      h('div', { class: 'card' },
        h('h3', null, 'held.csv'),
        h('p', { class: 'muted small' }, `${plural(g.counts.held + g.counts.heldAtBaggage, 'lead')} held back, each with its reason, so nothing is silently dropped.`),
        h('button', { class: 'btn', onclick: () => dl(`${base}-held.csv`, heldCSV(m, g)) }, 'Download held.csv')),
      h('div', { class: 'card' },
        h('h3', null, 'changes.csv'),
        h('p', { class: 'muted small' }, `${plural(m.changes.length + m.stats.twinsMerged, 'change')}, before and after, for an audit trail.`),
        h('button', { class: 'btn', onclick: () => dl(`${base}-changes.csv`, changesCSV(m)) }, 'Download changes.csv'))),
    h('p', { class: 'note' }, 'Any cell that starts with =, +, - or @ is saved as plain text, so it can’t run as a formula in Excel or Sheets.'),
  ];
}

// ---------- Sweep the hangar ----------
function sweep() {
  Object.assign(state, {
    view: 'checkin', fileName: '', parsed: null, map: null, manifest: null, steps: blankSteps(),
    gate: null, gateStale: true, reason: null, passenger: null, query: '', bigWarning: false,
  });
  render();
}

initRadio();
render();
