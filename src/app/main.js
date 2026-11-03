// Ground Crew, the page. Lead data only ever goes in as text, never HTML,
// so a cell can't run as code. Nothing here touches the network.

import {
  parseCSV, guessColumns, FIELDS, FIELD_LABELS, buildManifest, checkCampaignChunked,
  towerCheck, PRESETS, boardedCSV, heldCSV, changesCSV, tagFor, compile,
} from '../engine/index.js';
import { makeSkyline, SEQUENCE_PLANTED } from '../engine/skyline.js';
import { h, icon, jet, flaps, clatter, gauge, caseColour } from './ui.js';

const fmt = n => Number(n).toLocaleString('en-US');
const plural = (n, one, many = one + 's') => `${fmt(n)} ${n === 1 ? one : many}`;

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
  sample: [], bigWarning: false, justRan: false,
  calm: readPref('calm') === '1',
};

function readPref(k) { try { return localStorage.getItem('gc.' + k); } catch { return null; } }
function writePref(k, v) { try { localStorage.setItem('gc.' + k, v); } catch {} }

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
  const views = { checkin: viewCheckin, baggage: viewBaggage, tower: viewTower, gate: viewGate, takeoff: viewTakeoff };
  const brand = h('div', { class: 'brand' }, h('span', { class: 'plane' }, icon('plane')), flaps('GROUND CREW', 'white'));
  app.replaceChildren(
    h('header', { class: 'top' }, h('div', { class: 'wrap' }, brand, nav, h('div', { class: 'hdr-tools' }, calm, radioEl))),
    h('main', null, h('div', { class: 'wrap' }, views[state.view]())),
    h('footer', null, h('div', { class: 'edge' }), h('div', { class: 'wrap row' },
      h('span', null, 'Ground Crew · the pre-flight check for outbound. No signal needed.'),
      h('span', { class: 'spacer' }),
      state.manifest ? h('button', { class: 'btn small ghost', onclick: sweep }, '🧹 Sweep the hangar') : null)));
  paintRadio();
  if (state.view === 'checkin' && !state.parsed) clatter(brand, state.calm);
}

function stationSign(i) {
  const [, label, ic] = STATIONS[i];
  return h('div', { class: 'station-sign' },
    h('span', { class: 'num' }, String(i).padStart(2, '0')),
    h('span', { class: 'name' }, icon(ic), label));
}

function marshal(...text) {
  return h('div', { class: 'marshal' },
    h('div', { class: 'who', title: 'The Marshal' }, '🦺'),
    h('div', { class: 'bubble' }, h('span', { class: 'tag' }, 'MARSHAL'), ...text));
}

function ltag(n, label, cls = '') {
  return h('div', { class: `ltag ${cls}` }, h('b', null, fmt(n)), h('span', null, label));
}

// ---------- 00 Check-in ----------
function viewCheckin() {
  const input = h('input', { type: 'file', accept: '.csv,text/csv,text/plain', hidden: true, onchange: e => e.target.files[0] && loadFile(e.target.files[0]) });
  const ticket = h('div', {
    class: 'ticket', role: 'button', tabindex: '0',
    onclick: () => input.click(),
    onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } },
    ondragover: e => { e.preventDefault(); ticket.classList.add('over'); },
    ondragleave: () => ticket.classList.remove('over'),
    ondrop: e => { e.preventDefault(); ticket.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) loadFile(f); },
  },
  h('div', { class: 'main' },
    h('div', { class: 'airline' }, 'GROUND CREW · CHECK-IN'),
    h('strong', null, 'Drop your lead list here'),
    h('div', { class: 'sub' }, 'A CSV from Apollo, Clay, Sales Navigator or any spreadsheet. It stays on this computer.'),
    h('div', { class: 'fields' },
      h('span', null, 'FROM', h('b', null, 'YOUR LIST')),
      h('span', null, 'TO', h('b', null, 'INBOX')),
      h('span', null, 'SIGNAL', h('b', null, 'NONE NEEDED')))),
  h('div', { class: 'stub' }, h('span', { class: 'airline' }, 'GATE'), h('span', { class: 'big' }, 'GC'), h('div', { class: 'barcode' })),
  input);

  const board = h('div', { class: 'board big' },
    h('div', { class: 'bhead' }, icon('board'), 'Departures'),
    h('div', { class: 'rows' },
      h('span', { class: 'k' }, 'Flight'), flaps('GC 001'),
      h('span', { class: 'k' }, 'To'), flaps('INBOX', 'white'),
      h('span', { class: 'k' }, 'Status'), flaps(state.parsed ? 'CHECKING IN' : 'CHECK-IN OPEN', 'green')));

  const parts = [
    stationSign(0),
    h('div', { class: 'hero' },
      h('div', null,
        h('h1', null, 'You built it. Now get it out there.'),
        h('p', { class: 'lede' }, 'Ground Crew checks every email, for every lead, across every step, before your campaign takes off. It runs on your laptop with the Wi-Fi off. Nothing is uploaded, nothing is sent.'),
        marshal('Welcome aboard. ', h('b', null, 'Nothing takes off until it’s checked.'))),
      board),
    ticket,
    h('div', { class: 'row demo-row' }, h('span', { class: 'muted small' }, 'No list handy?'),
      h('button', { class: 'btn small', onclick: loadDemo }, '✈ Try it with Skyline Leads (3,000 made-up leads)')),
  ];
  setTimeout(() => clatter(board, state.calm), 50);

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
        h('button', { class: 'btn primary', onclick: board_ }, 'Bags to Baggage Claim →'))));
  }
  return parts;
}

async function loadFile(file) {
  setParsed(parseCSV(await file.text()), file.name);
}
function loadDemo() {
  const s = makeSkyline(3000);
  state.steps = SEQUENCE_PLANTED.map(x => ({ ...x }));
  setParsed({ headers: s.headers, rows: s.rows }, 'skyline-leads.csv');
}
function setParsed(parsed, name) {
  if (!parsed.headers.length) { alert('That file looks empty.'); return; }
  Object.assign(state, {
    parsed, fileName: name, map: guessColumns(parsed.headers), manifest: null,
    gate: null, gateStale: true, bigWarning: parsed.rows.length > 50000,
  });
  render();
}
function board_() {
  if (!('email' in state.map)) { alert('Ground Crew needs to know which column holds the email.'); return; }
  if (!('first_name' in state.map) && !('full_name' in state.map)) { alert('Pick a first name (or full name) column so greetings can be checked.'); return; }
  state.manifest = buildManifest(state.parsed, state.map);
  Object.assign(state, { gateStale: true, baggageTab: 'boarding', query: '', shown: 100 });
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
    ['boarding', `Manifest ${fmt(m.leads.length)}`],
    ['fixed', `Fixed ${fmt(fixedLeads.length)}`],
    ['twins', `Twins ${fmt(m.twins.length)}`],
    ['lost', `Lost & Found ${fmt(m.lostFound.length)}`],
  ];
  const search = h('input', {
    type: 'search', placeholder: 'Search passengers', value: state.query,
    oninput: e => { state.query = e.target.value; state.shown = 100; holder.replaceChildren(baggageTable(m, changesByLead, fixedLeads)); },
  });
  const holder = h('div', null, baggageTable(m, changesByLead, fixedLeads));
  const flight = flightName();

  return [
    stationSign(1),
    h('p', { class: 'lede' }, 'The list comes in messy and leaves clean. Every fix is shown with what it was before. Your original file is never touched.'),
    marshal('Bags are on the belt. ', h('b', null, `${plural(m.stats.twinsMerged, 'twin')} merged, ${plural(m.stats.fixes, 'tag')} fixed, ${plural(m.stats.lostFound, 'bag')} with no name tag held in Lost & Found.`)),
    carousel(m),
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
    h('div', { class: 'manifest-head' }, icon('board'), `PASSENGER MANIFEST · FLIGHT ${flight}`),
    holder,
    h('p', { class: 'note' }, 'Green cells were fixed. Hover one to see what it said before, and why it changed.'),
    h('div', { class: 'row next' }, h('span', { class: 'spacer' }),
      h('button', { class: 'btn primary', onclick: () => go('tower') }, 'Over to the Control Tower →')),
  ];
}

// The belt carries real luggage tags from this list: twins and held bags too.
function carousel(m) {
  const pick = [];
  const twinIds = new Set(m.twins.map(t => t.keepId));
  const twins = m.leads.filter(l => twinIds.has(l.id)).slice(0, 4);
  const lost = m.lostFound.slice(0, 3).map(x => x.lead);
  const rest = m.leads.filter(l => !twinIds.has(l.id));
  for (let i = 0; i < 18 && i < rest.length; i++) pick.push({ lead: rest[Math.floor(i * rest.length / 18)], kind: '' });
  twins.forEach((l, i) => pick.splice(2 + i * 5, 0, { lead: l, kind: 'twin' }));
  lost.forEach((l, i) => pick.splice(4 + i * 6, 0, { lead: l, kind: 'held' }));
  const bag = ({ lead, kind }) => {
    const first = lead.cells[m.map.first_name] || '(no name)';
    const co = 'company' in m.map ? lead.cells[m.map.company] : '';
    const colour = caseColour(first + co);
    const one = h('div', { class: 'case', style: { background: colour } });
    return h('div', { class: `bag ${kind}` },
      h('div', { class: 'cases' }, one, kind === 'twin' ? h('div', { class: 'case', style: { background: colour } }) : null),
      h('span', { class: 'label' }, kind === 'twin' ? `${first} ×2` : first, h('small', null, kind === 'held' ? 'NO NAME TAG' : kind === 'twin' ? 'TWIN · MERGED' : co || '—')));
  };
  const lane = h('div', { class: 'lane' }, pick.map(bag), pick.map(bag));
  return h('div', { class: 'carousel', 'aria-hidden': 'true' }, h('span', { class: 'sign' }, `BELT 1 · ${flightName()}`), lane, h('div', { class: 'belt' }));
}

function matches(cells) {
  const q = state.query.trim().toLowerCase();
  return !q || cells.some(c => String(c).toLowerCase().includes(q));
}

function baggageTable(m, changesByLead, fixedLeads) {
  const tab = state.baggageTab;
  const leadById = new Map([...m.leads, ...m.lostFound.map(x => x.lead)].map(l => [l.id, l]));
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
    if (!rows.length) return h('div', { class: 'empty' }, 'Nothing in Lost & Found.');
    return h('div', null, h('div', { class: 'tablewrap' }, h('table', null,
      h('thead', null, h('tr', null, h('th', null, 'Row'), h('th', null, 'Why it’s held'), m.headers.map(x => h('th', null, x)))),
      h('tbody', null, rows.slice(0, state.shown).map(x => h('tr', null,
        h('td', { class: 'rownum' }, x.lead.row),
        h('td', null, h('span', { class: 'pill lost' }, x.reasons.join(' · '))),
        x.lead.cells.slice(0, m.headers.length).map(c => h('td', { title: c }, c))))))), more(rows.length));
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

  return [
    stationSign(2),
    h('p', { class: 'lede' }, 'Each step of your sequence is a flight strip. The tower radios in as you type. The altimeter is a writing guide, not a promise of replies.'),
    marshal('Over to the tower. ', h('b', null, 'They’ll talk you through the copy.')),
    h('div', { class: 'card' },
      h('div', { class: 'row' },
        h('span', { class: 'small muted' }, 'Tags from your list · click to drop one in where you’re typing'),
        h('span', { class: 'spacer' }), h('span', { class: 'small muted' }, 'Rules'), preset),
      h('div', { class: 'chips' }, chips),
      h('p', { class: 'note' }, 'Blanks in a column? Add a fallback like {{company|your team}}.')),
    h('div', { class: 'bay next' }, state.steps.map((step, i) => towerLeg(step, i))),
    h('div', { class: 'row next' },
      state.steps.length < 6 ? h('button', { class: 'btn', onclick: () => { state.steps.push({ subject: '', body: 'Hi {{first_name}},\n\n\n' }); state.gateStale = true; render(); } }, '+ Add a follow-up') : null,
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn primary', onclick: () => go('gate') }, 'Head to the Boarding Gate →')),
  ];
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
    towerTimers.set(i, setTimeout(paint, 120));
  };
  const subject = h('input', {
    type: 'text', value: step.subject, placeholder: i === 0 ? 'Subject line' : 'Empty = reply in the same thread',
    oninput: e => { step.subject = e.target.value; schedule(); }, onfocus: e => { lastField = e.target; },
  });
  const body = h('textarea', {
    rows: 9, value: step.body,
    oninput: e => { step.body = e.target.value; schedule(); }, onfocus: e => { lastField = e.target; },
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

// ---------- 03 Security Check + Boarding Gate ----------
let running = false;

function viewGate() {
  const g = state.gate;
  const m = state.manifest;
  const parts = [
    stationSign(3),
    h('p', { class: 'lede' }, 'Security Check fills in every step for every lead, exactly as the inbox would see it, and scans the finished email. Any Mayday holds the passenger. Turbulence boards, but is listed so you can decide.'),
  ];

  if (!g || state.gateStale) {
    const total = m.leads.length * state.steps.length;
    parts.push(marshal(g ? 'The copy changed since the last scan. ' : 'Line up for security. ', h('b', null, `${plural(m.leads.length, 'passenger')} × ${plural(state.steps.length, 'leg')} = ${plural(total, 'email')} to scan.`)));
    const sc = scanner(m);
    const btn = h('button', {
      class: 'btn primary', disabled: running, onclick: async () => {
        running = true; btn.disabled = true;
        sc.start();
        const t0 = performance.now();
        const res = await checkCampaignChunked(m, state.steps, p => sc.update(p));
        res.ms = performance.now() - t0;
        sc.update({ done: res.counts.leads, total: res.counts.leads, emails: res.counts.emails, held: res.counts.held });
        // Let the belt run a moment so the scan is visible; the counts are real either way.
        if (!state.calm) await new Promise(r => setTimeout(r, Math.max(0, 1500 - res.ms)));
        Object.assign(state, { gate: res, gateStale: false, reason: null, passenger: null, justRan: true });
        running = false;
        render();
      },
    }, 'Start the Security Check');
    parts.push(h('div', { class: 'card' }, btn, sc.el));
    return parts;
  }

  const c = g.counts;
  parts.push(marshal(
    g.status === 'CLEARED' ? h('b', null, 'Cleared for take-off. Nice flying.')
      : ['Hold the gate. ', h('b', null, `${plural(c.held, 'passenger')} would get a broken email.`), ' Fix them in the tower or the list, or take off without them.']));
  const board = h('div', { class: 'board' },
    h('div', { class: 'bhead' }, icon('board'), 'Departures · Gate GC'),
    h('div', { class: 'rows' },
      h('span', { class: 'k' }, 'Flight'), flaps(flightName()),
      h('span', { class: 'k' }, 'Emails scanned'), flaps(fmt(c.emails), 'white'),
      h('span', { class: 'k' }, 'Boarded'), flaps(fmt(c.cleared), 'green'),
      h('span', { class: 'k' }, 'Held at gate'), flaps(fmt(c.held), c.held ? 'red' : 'green'),
      h('span', { class: 'k' }, 'Lost & found'), flaps(fmt(c.heldAtBaggage)),
      h('span', { class: 'k' }, 'Status'), flaps(g.status, g.status === 'CLEARED' ? 'green' : 'red')));
  parts.push(board);
  if (state.justRan) { state.justRan = false; setTimeout(() => clatter(board, state.calm), 30); }
  parts.push(h('p', { class: 'note' }, `Scanned in ${(g.ms / 1000).toFixed(2)} s on this computer. No internet used.`));

  if (g.reasons.length) {
    parts.push(h('h3', { class: 'next' }, 'What the scanner found · click one to see who'));
    parts.push(h('div', { class: 'tablewrap round' }, h('table', null,
      h('thead', null, h('tr', null, h('th', null, ''), h('th', null, 'Problem'), h('th', null, 'Leads'), h('th', null, 'Leg'), h('th', null, 'Example'), h('th', null, 'Fix'))),
      h('tbody', null, g.reasons.map(r => h('tr', {
        class: 'click' + (state.reason === r.key ? ' sel' : ''), onclick: () => {
          state.reason = r.key; state.passenger = r.leadIds[0]; render();
        },
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
  parts.push(h('div', { class: 'row next' }, h('h3', null, chosen ? `Passengers · ${chosen.label}` : state.reason === '__sample' ? 'Random spot-check' : 'Boarding passes'), h('span', { class: 'spacer' }), sampleBtn));

  const list = ids.slice(0, 200).map(id => resultsById.get(id)).filter(Boolean);
  const left = list.length ? h('div', { class: 'tablewrap round' }, h('table', null,
    h('thead', null, h('tr', null, h('th', null, 'Seat'), h('th', null, 'Passenger'), h('th', null, 'Company'), h('th', null, 'Status'))),
    h('tbody', null, list.map(r => h('tr', { class: 'click' + (state.passenger === r.lead.id ? ' sel' : ''), onclick: () => { state.passenger = r.lead.id; render(); } },
      h('td', { class: 'rownum' }, r.lead.row),
      h('td', null, nameOf(m, r.lead)),
      h('td', null, 'company' in m.map ? r.lead.cells[m.map.company] : ''),
      h('td', null, h('span', { class: 'pill ' + (r.status === 'held' ? 'mayday' : 'clear') }, r.status === 'held' ? 'HELD' : 'BOARDED'))))))) : h('div', { class: 'empty' }, 'Pick a problem above, or spot-check 5 random passengers.');
  const pr = resultsById.get(state.passenger);
  parts.push(h('div', { class: 'grid2' }, left, pr ? boardingPass(pr) : h('div', { class: 'empty' }, 'Click a passenger to open their boarding pass: the exact emails they’d get.')));

  parts.push(h('div', { class: 'row next' },
    h('button', { class: 'btn', onclick: () => go('tower') }, '← Back to the tower'),
    h('span', { class: 'spacer' }),
    c.cleared
      ? h('button', { class: 'btn primary', onclick: () => go('takeoff') }, `Board ${fmt(c.cleared)} and taxi →`)
      : h('button', { class: 'btn primary', disabled: true, title: 'Fix the Maydays first' }, 'Nobody can board yet')));
  return parts;
}

// The scanner: a belt of real passengers' bags through the X-ray, while the
// real check runs. Counts on it come straight from the engine.
function scanner(m) {
  const sample = m.leads.slice(0, 40);
  const cases = sample.map(l => h('div', { class: 'case', style: { background: caseColour((l.cells[m.map.first_name] || '') + (l.cells[m.map.company] || '')) } }));
  const flow = h('div', { class: 'flow' }, cases, cases.map(c => c.cloneNode()));
  const beam = h('span', { class: 'beam' }, 'X-RAY READY');
  const count = h('div', { class: 'count' }, `0 / ${fmt(m.leads.length * state.steps.length)} EMAILS`);
  const inspect = h('div', { class: 'inspect' }, '');
  const bar = h('i');
  const el = h('div', null,
    h('div', { class: 'scanner' }, count, inspect, flow, h('div', { class: 'tunnel' }, beam), h('div', { class: 'belt' })),
    h('div', { class: 'progress' }, bar));
  flow.style.animationPlayState = 'paused';
  let lastHeld = 0;
  return {
    el,
    start() { flow.style.animationPlayState = 'running'; beam.textContent = 'SCANNING'; },
    update(p) {
      bar.style.width = (p.done / p.total * 100).toFixed(1) + '%';
      count.textContent = `${fmt(p.emails)} / ${fmt(m.leads.length * state.steps.length)} EMAILS · ${fmt(p.done)} PASSENGERS`;
      if (p.held !== lastHeld) {
        lastHeld = p.held;
        beam.textContent = 'MAYDAY';
        beam.classList.add('alarm');
        const victim = cases[Math.floor(Math.random() * cases.length)];
        victim.classList.add('held');
        setTimeout(() => { beam.textContent = 'SCANNING'; beam.classList.remove('alarm'); }, 260);
      }
      inspect.textContent = p.held ? `INSPECTION LANE · ${fmt(p.held)}` : '';
    },
  };
}

// The boarding pass: the exact emails one lead would get. Filled-in values
// are underlined; a blank tag shows as a red gap so you can see the hole.
function boardingPass(r) {
  const m = state.manifest;
  const l = r.lead;
  const held = r.status === 'held';
  const name = nameOf(m, l);
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
          h('span', null, 'PASSENGER', h('b', null, name)),
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
          h('pre', null,
            s.subject && s.subject.trim() ? h('div', { class: 'subj' }, marked(s.subject, l)) : null,
            marked(s.body, l)),
          iss.length ? h('div', { class: 'iss' }, iss.map(x => h('div', null, h('span', { class: `pill ${x.level}` }, x.level === 'mayday' ? 'MAYDAY' : 'TURBULENCE'), ' ', x.label, x.hint ? h('span', { class: 'muted' }, ` · ${x.hint}`) : null))) : null,
        ];
      }),
      r.issues.filter(x => !x.step).map(x => h('div', { class: 'iss' }, h('div', null, h('span', { class: `pill ${x.level}` }, 'TURBULENCE'), ' ', x.label)))));
}

function marked(text, lead) {
  const m = state.manifest;
  const c = compile(text, m.headers, m.map);
  const out = document.createDocumentFragment();
  for (const p of c.parts) {
    if ('text' in p) { out.append(p.text); continue; }
    if (p.col === -1) { out.append(h('span', { class: 'gap', title: 'Not a column in your list' }, p.raw)); continue; }
    const v = String(lead.cells[p.col] ?? '').trim();
    if (v) out.append(v);
    else if (p.fallback !== null) out.append(p.fallback);
    else out.append(h('span', { class: 'gap', title: `${p.name} is blank for this lead` }, `${p.name}?`));
  }
  return out;
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
  const runway = h('div', { class: 'runway', 'aria-hidden': 'true' },
    h('div', { class: 'sun' }), h('div', { class: 'strip' }), h('div', { class: 'lights' }), jet(),
    h('div', { class: 'caption' }, 'Wheels up'));
  setTimeout(() => runway.classList.add('go'), state.calm ? 0 : 500);
  return [
    stationSign(4),
    runway,
    marshal(h('b', null, `${plural(g.counts.cleared, 'passenger')} boarded. `), 'Nothing was sent. Load boarded.csv into your sending tool when you’re ready.'),
    h('div', { class: 'grid3 files' },
      h('div', { class: 'card' },
        h('h3', null, 'boarded.csv'),
        h('p', { class: 'muted small' }, `${plural(g.counts.cleared, 'clean lead')}. Twins merged, fixes applied, all your original columns kept.`),
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
