import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCSV, toCSV, safeCell, guessColumns, buildManifest, checkCampaign, towerCheck,
  boardedCSV, heldCSV, changesCSV,
} from '../src/engine/index.js';
import { skylineCSV, SEQUENCE_FIXED, SEQUENCE_PLANTED } from '../tools/skyline.mjs';

const sky = skylineCSV(3000);
const parsed = parseCSV(sky.csv);
const map = guessColumns(parsed.headers);
const manifest = buildManifest(parsed, map);
const gate = checkCampaign(manifest, SEQUENCE_FIXED);

const byRow = new Map();
for (const r of gate.results) byRow.set(r.lead.row, r);
const lostRows = new Map(manifest.lostFound.map(x => [x.lead.row, x]));
const mergedRows = new Set(manifest.twins.flatMap(t => t.mergedRows));
const keptRows = new Set(manifest.twins.map(t => t.keepRow));
const col = name => parsed.headers.indexOf(name);
const planted = kind => sky.planted.filter(p => p.kind === kind);

test('CSV: quotes, escaped quotes, CRLF, BOM, blank lines', () => {
  const p = parseCSV('﻿Name,Note\r\n"Rao, Priya","She said ""hi"""\r\n\r\nBob,"two\nlines"\n');
  assert.deepEqual(p.headers, ['Name', 'Note']);
  assert.deepEqual(p.rows, [['Rao, Priya', 'She said "hi"'], ['Bob', 'two\nlines']]);
});

test('CSV: semicolon files from European Excel', () => {
  const p = parseCSV('First Name;Email\nAna;ana@x.io\n');
  assert.deepEqual(p.rows, [['Ana', 'ana@x.io']]);
});

test('columns are guessed from common export headers', () => {
  assert.deepEqual(map, { first_name: 0, last_name: 1, email: 2, company: 3, title: 4, linkedin: 5, website: 6 });
  const apollo = guessColumns(['First Name', 'Last Name', 'Title', 'Company Name for Emails', 'Email', 'Person Linkedin Url']);
  assert.equal(apollo.company, 3);
  assert.equal(apollo.linkedin, 5);
});

test('every exact twin is merged into the earlier row', () => {
  for (const kind of ['dup_email', 'dup_email_caps', 'dup_linkedin']) {
    const list = planted(kind);
    for (let i = 0; i < list.length; i += 2) {
      const [a, b] = [list[i].row, list[i + 1].row].sort((x, y) => x - y);
      assert.ok(keptRows.has(a) && mergedRows.has(b), `${kind} rows ${a}/${b} should be one lead`);
    }
  }
});

test('Priya with different capitals is still one person', () => {
  const pair = planted('dup_email_caps').slice(0, 2);
  const rows = pair.map(p => p.row).sort((a, b) => a - b);
  const t = manifest.twins.find(t => t.keepRow === rows[0]);
  assert.ok(t && t.mergedRows.includes(rows[1]));
});

test('twins that disagree on company are merged but flagged', () => {
  const flagged = manifest.twins.filter(t => t.conflicts.length);
  assert.equal(flagged.length, 4);
  for (const t of flagged) {
    const c = t.conflicts[0];
    assert.equal(c.column, 'Company');
    assert.notEqual(c.kept, c.other);
    assert.ok(t.mergedRows.includes(c.row));
  }
  assert.equal(manifest.stats.twinConflicts, 4);
  const csv = changesCSV(manifest);
  assert.equal((csv.match(/twin disagreed/g) || []).length, 4);
});

test('twins that only differ in capitals or a blank are not flagged', () => {
  const p = parseCSV('First Name,Email,Company,Website\nAna,ana@x.io,ACME,https://www.acme.io/\nana,ANA@x.io,Acme,acme.io\nAna,ana@x.io,,acme.io\n');
  const m = buildManifest(p, guessColumns(p.headers));
  assert.equal(m.twins.length, 1);
  assert.deepEqual(m.twins[0].conflicts, []);
});

test('look-alikes and nicknames are NOT merged (different emails)', () => {
  for (const kind of ['lookalike', 'nickname']) {
    for (const p of planted(kind)) assert.ok(!mergedRows.has(p.row), `${kind} row ${p.row} must not merge`);
  }
});

test('a merge fills blanks from the twin', () => {
  const p = planted('dup_email').find(x => x.expect === 'kept');
  const twin = planted('dup_email')[planted('dup_email').indexOf(p) + 1];
  const keepRow = Math.min(p.row, twin.row);
  const r = byRow.get(keepRow);
  assert.ok(r, 'kept row boards');
  assert.ok(r.lead.cells[col('Title')], 'title filled');
});

test('names in capitals, extra spaces and titles are fixed', () => {
  for (const kind of ['caps_name', 'spaces_name', 'title_prefix']) {
    for (const p of planted(kind)) {
      const r = byRow.get(p.row);
      assert.ok(r, `${kind} row ${p.row} should board`);
      assert.equal(r.lead.cells[col('First Name')], p.expect);
    }
  }
});

test('junk, initials, missing names and bad emails go to Lost & Found', () => {
  for (const kind of ['junk_name', 'initial', 'missing_first', 'bad_email', 'missing_email']) {
    for (const p of planted(kind)) assert.ok(lostRows.has(p.row), `${kind} row ${p.row} should be in Lost & Found`);
  }
});

test('legal endings and shouting companies are cleaned', () => {
  for (const kind of ['legal', 'shouting_company']) {
    for (const p of planted(kind)) {
      const r = byRow.get(p.row) || [...gate.results].find(x => x.lead.twinRows.includes(p.row));
      assert.ok(r, `${kind} row ${p.row} boards`);
      assert.equal(r.lead.cells[col('Company')], p.expect);
    }
  }
});

test('long titles keep only the main title', () => {
  for (const p of planted('long_title')) assert.equal(byRow.get(p.row).lead.cells[col('Title')], p.expect);
});

test('missing company with no fallback is held at the gate, with the reason', () => {
  for (const p of planted('missing_company')) {
    const r = byRow.get(p.row);
    assert.equal(r.status, 'held', `row ${p.row}`);
    assert.ok(r.issues.some(x => x.kind === 'empty_tag' && x.key === 'empty_tag:company'));
  }
});

test('a fallback clears the same leads', () => {
  const seq = SEQUENCE_FIXED.map(s => ({ ...s, body: s.body.replace(/\{\{company\}\}/g, '{{company|your team}}') }));
  const g = checkCampaign(manifest, seq);
  for (const p of planted('missing_company')) {
    const r = g.results.find(x => x.lead.row === p.row);
    assert.equal(r.status, 'cleared');
    assert.match(r.rendered[0].body, /teams like your team/);
  }
});

test('role addresses board but are flagged', () => {
  for (const p of planted('role_email')) {
    const r = byRow.get(p.row);
    assert.equal(r.status, 'cleared');
    assert.ok(r.issues.some(x => x.kind === 'role_address'));
  }
});

test('a copied "personal" line is flagged', () => {
  for (const p of planted('copied_ice').slice(0, 20)) {
    const r = byRow.get(p.row);
    if (!r) continue; // may have been held for another reason
    assert.ok(r.issues.some(x => x.kind === 'copied_line'), `row ${p.row}`);
  }
});

test('a sentence that grows too long once filled is flagged', () => {
  for (const p of planted('long_company')) {
    assert.ok(byRow.get(p.row).issues.some(x => x.kind === 'long_line'), `row ${p.row}`);
  }
});

test('clean rows clear with no issues', () => {
  const plantedRows = new Set(sky.planted.map(p => p.row));
  const clean = gate.results.filter(r => !plantedRows.has(r.lead.row) && !r.lead.twinRows.length);
  assert.ok(clean.length > 1000);
  const bad = clean.filter(r => r.status !== 'cleared' || r.issues.length);
  assert.equal(bad.length, 0, JSON.stringify(bad.slice(0, 2).map(b => b.issues)));
});

test('a misspelled tag holds everyone and suggests the right column', () => {
  const g = checkCampaign(manifest, SEQUENCE_PLANTED);
  assert.equal(g.counts.cleared, 0);
  const r = g.reasons.find(x => x.key === 'unknown_tag:frist_name');
  assert.ok(r);
  assert.match(r.hint, /\{\{first_name\}\}/);
});

test('every email is checked: leads x steps', () => {
  assert.equal(gate.counts.emails, manifest.leads.length * 3);
  assert.equal(gate.counts.cleared + gate.counts.held, manifest.leads.length);
});

test('counts reconcile: every input row is boarded, held, lost or merged', () => {
  const merged = manifest.twins.reduce((n, t) => n + t.mergedRows.length, 0);
  assert.equal(gate.counts.cleared + gate.counts.held + manifest.lostFound.length + merged, parsed.rows.length);
  const boarded = parseCSV(boardedCSV(manifest, gate));
  const held = parseCSV(heldCSV(manifest, gate));
  assert.equal(boarded.rows.length, gate.counts.cleared);
  assert.equal(held.rows.length, gate.counts.held + manifest.lostFound.length);
});

test('exports neutralise formula cells', () => {
  assert.equal(safeCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(safeCell('+1 555'), "'+1 555");
  assert.equal(safeCell('@channel'), "'@channel");
  assert.equal(safeCell('Priya'), 'Priya');
  const out = boardedCSV(manifest, gate) + heldCSV(manifest, gate);
  assert.ok(!/(^|,)=HYPERLINK/m.test(out), 'no live formula in any export');
  assert.ok(out.includes("'=HYPERLINK"));
});

test('the original rows are never changed', () => {
  const again = parseCSV(sky.csv);
  assert.deepEqual(parsed.rows, again.rows);
});

test('same input, same result', () => {
  const g2 = checkCampaign(buildManifest(parseCSV(sky.csv), map), SEQUENCE_FIXED);
  assert.deepEqual(g2.counts, gate.counts);
  assert.deepEqual(g2.reasons.map(r => [r.key, r.count]), gate.reasons.map(r => [r.key, r.count]));
});

test('changes file lists every fix and merge', () => {
  const ch = parseCSV(changesCSV(manifest));
  assert.ok(ch.rows.length >= manifest.changes.length);
  assert.ok(ch.rows.some(r => r[1] === '(whole row)'));
});

test('cells are never treated as code', () => {
  const p = parseCSV('First Name,Company,Email\nAva,<img src=x onerror=alert(1)>,a@b.io\n');
  const m = buildManifest(p, guessColumns(p.headers));
  const g = checkCampaign(m, [{ subject: 'hi', body: 'Hi {{first_name}} at {{company}}, worth a chat?' }]);
  assert.match(g.results[0].rendered[0].body, /<img src=x/i); // plain text, shown with textContent
});

test('tower: planted copy problems all get a call', () => {
  const t = towerCheck(SEQUENCE_PLANTED[0], 0, { manifest });
  const rules = new Set(t.calls.map(c => c.rule));
  for (const r of ['unknown_tag', 'blank_tag', 'loud_subject', 'spam', 'links', 'cliche', 'exclaim', 'em_dash', 'me_heavy']) {
    assert.ok(rules.has(r), `missing ${r}: ${[...rules]}`);
  }
  const f = towerCheck(SEQUENCE_PLANTED[1], 1, { manifest });
  assert.ok(f.calls.some(c => c.rule === 'weak_followup'));
});

test('tower: a clean step is clear skies', () => {
  const seq = SEQUENCE_FIXED.map(s => ({ ...s, body: s.body.replace(/\{\{company\}\}/g, '{{company|your team}}') }));
  seq.forEach((s, i) => {
    const t = towerCheck(s, i, { manifest });
    assert.equal(t.clear, true, JSON.stringify(t.calls));
  });
});

test('tower: a sign-off does not hide the ask', () => {
  const t = towerCheck({ subject: 'hi', body: 'Hi {{first_name}},\n\nWorth a quick chat next week?\n\nBest,\nAsh' }, 0, { manifest });
  assert.ok(!t.calls.some(c => c.rule === 'no_ask'));
  const t2 = towerCheck({ subject: 'hi', body: 'Hi {{first_name}},\n\nWe build tools.\n\nBest,\nAsh' }, 0, { manifest });
  assert.ok(t2.calls.some(c => c.rule === 'no_ask'));
});

test('tower: a misspelled tag suggests the right one', () => {
  const t = towerCheck({ subject: '', body: 'Hi {{frist_name}}, worth a chat?' }, 0, { manifest });
  assert.match(t.calls.find(c => c.rule === 'unknown_tag').line, /Did you mean \{\{first_name\}\}/);
});

test('single-character names in scripts without initials are real names', () => {
  const p = parseCSV('First Name,Email\n雷,lei@x.io\nJ.,j@x.io\nK,k@x.io\n');
  const m = buildManifest(p, guessColumns(p.headers));
  assert.deepEqual(m.leads.map(l => l.cells[0]), ['雷']);
  assert.equal(m.lostFound.length, 2);
});

test('markup or digits in a first name hold the row', () => {
  const p = parseCSV('First Name,Email\n<script>alert(1)</script>,x@x.io\nR2D2,r@x.io\nAnne-Marie,a@x.io\n');
  const m = buildManifest(p, guessColumns(p.headers));
  assert.deepEqual(m.leads.map(l => l.cells[0]), ['Anne-Marie']);
  assert.match(m.lostFound[0].reasons[0], /doesn't look like a name/);
});

test('a header-only file has nobody to board and nothing breaks', () => {
  const p = parseCSV('First Name,Email\n');
  const m = buildManifest(p, guessColumns(p.headers));
  const g = checkCampaign(m, [{ subject: 'hi', body: 'Hi {{first_name}}' }]);
  assert.equal(g.counts.leads, 0);
  assert.equal(g.counts.emails, 0);
});

import { variant, spinInfo, unionText, hasSpintax } from '../src/engine/spintax.js';

const HER_COPY = `{Hi|Hey} {{first_name}},
{You find the perfect candidate on LinkedIn. You're not connected. Now what?|Quick question. When the perfect candidate isn't a connection, what do you do?}
{Most recruiters either spend an InMail and hope, or move on to someone easier.|For most firms it's an InMail and a prayer, or you give up and move on.}
{It reaches people outside your network.|It can reach people you aren't connected to.}
{Should I send it over?|Want me to send over how it works?}
%sender-firstname%
SalesRobot`;

test('spintax is not a broken tag, and every version is counted', () => {
  assert.ok(hasSpintax(HER_COPY));
  assert.deepEqual(spinInfo(HER_COPY), { groups: 5, versions: 32 });
  const t = towerCheck({ subject: '', body: HER_COPY }, 0, { manifest });
  assert.ok(!t.calls.some(c => c.rule === 'broken_tag' || c.rule === 'unknown_tag'), JSON.stringify(t.calls));
  assert.equal(t.spin.versions, 32);
  const g = checkCampaign(manifest, [{ subject: '{quick question|a thought}, {{first_name}}', body: HER_COPY }]);
  assert.ok(!g.reasons.some(r => r.kind === 'broken_tag' || r.kind === 'unknown_tag'), JSON.stringify(g.reasons.map(r => r.key)));
});

test('a fallback with a pipe is still a fallback, not spintax', () => {
  assert.equal(hasSpintax('Hi {{first_name|there}}'), false);
  assert.equal(variant('Saw {{company|your team}} {is|was} hiring', 'x').includes('{{company|your team}}'), true);
});

test('nested spintax and tags inside options', () => {
  const text = '{Hi {{first_name}}|Hey {there|you}}!';
  const seen = new Set();
  for (let i = 0; i < 60; i++) seen.add(variant(text, 'lead' + i));
  assert.deepEqual([...seen].sort(), ['Hey there!', 'Hey you!', 'Hi {{first_name}}!']);
  assert.equal(variant(text, 'same'), variant(text, 'same'));
  assert.match(unionText(text), /\{\{first_name\}\}/);
});

test('a real broken brace is still caught next to spintax', () => {
  const g = checkCampaign(manifest, [{ subject: '', body: '{Hi|Hey {{first_name}}, worth a chat?' }]);
  assert.ok(g.reasons.some(r => r.kind === 'broken_tag'));
});

test('a blank tag in any version of a spun step holds the lead', () => {
  const g = checkCampaign(manifest, [{ subject: '', body: '{Hi {{first_name}}, saw {{company}} is hiring.|Hi {{first_name}}, quick one.} Worth a chat?' }]);
  for (const p of planted('missing_company')) {
    const r = g.results.find(x => x.lead.row === p.row);
    assert.equal(r.status, 'held', `row ${p.row}`);
  }
});

test('sender variables are filled by the sending tool, never flagged', () => {
  const g = checkCampaign(manifest, [{ subject: '', body: 'Hi {{first_name}}, worth a chat?\n\n{{sender_name}}\n{{signature}}\n{{unsubscribe}}' }]);
  assert.ok(!g.reasons.some(r => r.kind === 'unknown_tag'), JSON.stringify(g.reasons.map(r => r.key)));
  const t = towerCheck({ subject: '', body: 'Hi {{first_name}}, worth a chat?\n\n{{sender_first_name}}' }, 0, { manifest });
  assert.ok(!t.calls.some(c => c.rule === 'unknown_tag'));
});

test('tower: an ask above a signature block with an address still counts', () => {
  const t = towerCheck({ subject: 'hi', body: 'Hi {{first_name}},\nWe help with lists.\n{Should I send it over?|Want me to send it?}\n%sender-firstname%\nSalesRobot\nSuite 651 N Broad St, Middletown, Delaware, 19709' }, 0, { manifest });
  assert.ok(!t.calls.some(c => c.rule === 'no_ask'), JSON.stringify(t.calls));
  const t2 = towerCheck({ subject: 'hi', body: 'Hi {{first_name}},\nWe help with lists.\n%sender-firstname%\nSuite 651 N Broad St, Middletown, Delaware' }, 0, { manifest });
  assert.ok(t2.calls.some(c => c.rule === 'no_ask'));
});
