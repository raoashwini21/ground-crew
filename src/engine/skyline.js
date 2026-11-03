// Skyline Leads: a made-up lead list with every problem planted on purpose.
// All people and companies are invented. Deterministic: the same seed gives
// the same list, so tests and the demo always see the same rows.
// Pure code, so the page can build the demo list itself, offline.

const FIRST = ['Priya', 'Arjun', 'Meera', 'Rahul', 'Ananya', 'Kiran', 'Sofia', 'Liam', 'Emma', 'Noah', 'Olivia', 'Mateo', 'Lucia', 'Wei', 'Yuki', 'Haruto', 'Amara', 'Kwame', 'Fatima', 'Omar', 'Leila', 'Sven', 'Ingrid', 'Lukas', 'Hannah', 'Diego', 'Camila', 'Ethan', 'Ava', 'Isla', 'Jack', 'Zara', 'Aisha', 'Tomas', 'Elena', 'Marco', 'Giulia', 'Nina', 'Oscar', 'Maya', 'Rohan', 'Divya', 'Sanjay', 'Chloe', 'Felix', 'Ines', 'Jonas', 'Mira', 'Theo', 'Asha', 'Daniel', 'Grace', 'Henry', 'Ivy', 'Kenji', 'Layla', 'Nadia', 'Pablo', 'Ruby', 'Samir'];
const LAST = ['Rao', 'Sharma', 'Iyer', 'Menon', 'Patel', 'Kapoor', 'Garcia', 'Rossi', 'Muller', 'Larsen', 'Novak', 'Okafor', 'Mensah', 'Haddad', 'Nakamura', 'Tanaka', 'Chen', 'Lindqvist', 'Moreau', 'Silva', 'Costa', 'Fischer', 'Walsh', 'Byrne', 'Clarke', 'Hughes', 'Reid', 'Kowalski', 'Andersen', 'Bianchi', 'Duarte', 'Ferreira', 'Hoffmann', 'Ivanova', 'Jensen', 'Khan', 'Lopez', 'Mehta', 'Nair', 'Pillai', 'Quinn', 'Saito', 'Torres', 'Varga', 'Weber', 'Young', 'Zhou', 'Bose', 'Das', 'Hegde'];
const PRE = ['North', 'Bright', 'Blue', 'Silver', 'Clear', 'Swift', 'Open', 'True', 'Cloud', 'Quiet', 'Bold', 'Pine', 'Harbor', 'Summit', 'Copper', 'Lumen', 'Maple', 'Cedar', 'Coral', 'Ember', 'Falcon', 'Granite', 'Indigo', 'Juniper', 'Kestrel', 'Lark', 'Meadow', 'Nimbus', 'Orbit', 'Prism', 'Quartz', 'River', 'Saffron', 'Tidal', 'Umber', 'Vela', 'Willow', 'Zephyr', 'Skylark', 'Bramble'];
const SUF = ['wave', 'peak', 'field', 'stack', 'forge', 'line', 'loop', 'path', 'beam', 'yard', 'grid', 'nest', 'mint', 'works', 'shore', 'gate'];
const KIND = ['', '', '', ' Labs', ' Analytics', ' Health', ' Logistics', ' Studio', ' Systems', ' Partners', ' Robotics', ' Finance'];
const TLD = ['io', 'com', 'co', 'ai', 'app'];
const TITLES = ['VP Sales', 'Head of Growth', 'Founder', 'CEO', 'Co-founder', 'Marketing Manager', 'SDR Lead', 'RevOps Manager', 'CTO', 'Head of Partnerships', 'Director of Demand Gen', 'Growth Lead', 'Head of Marketing', 'Sales Director', 'COO'];
const CITIES = ['Bengaluru', 'London', 'Austin', 'Berlin', 'Toronto', 'Sydney', 'Singapore', 'Dubai', 'Lisbon', 'Mumbai', 'Amsterdam', 'Denver'];
const ICE = [
  c => `Saw ${c} is hiring for two SDR roles this month`,
  c => `Noticed ${c} just launched a new pricing page`,
  c => `Read the ${c} write-up on moving upmarket`,
  c => `Spotted ${c} on the speaker list for the RevOps summit`,
  c => `Saw ${c} opened a second office this year`,
  c => `Liked the ${c} teardown of last quarter's pipeline`,
];
const COPIED_LINE = 'Loved your recent post on LinkedIn';
const NEUTRAL_ICE = [
  'Enjoyed your talk at the founders meetup',
  'Saw your thread on hiring a first SDR',
  'Caught your podcast episode on pricing',
  'Read your note on building in public',
  'Saw you are hiring for a growth role',
  'Liked your post about cold email benchmarks',
];
const NICK = [['Robert', 'Bob'], ['William', 'Bill'], ['Elizabeth', 'Liz'], ['Rajesh', 'Raj'], ['Katherine', 'Kate'], ['Michael', 'Mike'], ['Jennifer', 'Jen'], ['Alexander', 'Alex'], ['Christopher', 'Chris'], ['Margaret', 'Maggie']];

export const HEADERS = ['First Name', 'Last Name', 'Email', 'Company', 'Title', 'LinkedIn URL', 'Website', 'City', 'Icebreaker'];

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Planted problems for a 3,000-row list; scaled for other sizes.
const PLAN = [
  ['dup_email', 50], ['dup_email_caps', 10], ['dup_linkedin', 10], ['nickname', 20], ['lookalike', 10],
  ['caps_name', 100], ['spaces_name', 50], ['title_prefix', 20], ['junk_name', 25], ['initial', 15],
  ['missing_first', 50], ['bad_email', 15], ['missing_email', 15], ['missing_company', 80],
  ['legal', 200], ['shouting_company', 60], ['role_email', 30], ['long_company', 30],
  ['formula', 5], ['copied_ice', 300], ['long_title', 100],
];

export function makeSkyline(n = 3000, seed = 2026) {
  const rand = rng(seed);
  const pick = arr => arr[Math.floor(rand() * arr.length)];
  const companies = [];
  const usedCo = new Set();
  while (companies.length < Math.max(60, Math.round(n / 6))) {
    const name = pick(PRE) + pick(SUF) + pick(KIND);
    if (usedCo.has(name)) { if (usedCo.size > 3000) break; continue; }
    usedCo.add(name);
    const domain = name.split(' ')[0].toLowerCase() + '.' + pick(TLD);
    companies.push({ name, domain });
  }
  const usedEmail = new Set();
  const usedLi = new Set();

  function person(co = pick(companies)) {
    for (let k = 0; k < 50; k++) {
      const first = pick(FIRST), last = pick(LAST);
      const email = `${first}.${last}@${co.domain}`.toLowerCase();
      if (usedEmail.has(email)) continue;
      usedEmail.add(email);
      let li = `https://www.linkedin.com/in/${first}-${last}-${Math.floor(rand() * 9000 + 1000)}`.toLowerCase();
      while (usedLi.has(li)) li += 'x';
      usedLi.add(li);
      return {
        'First Name': first, 'Last Name': last, Email: email, Company: co.name,
        Title: pick(TITLES), 'LinkedIn URL': li, Website: `https://${co.domain}`,
        City: pick(CITIES), Icebreaker: pick(ICE)(co.name),
      };
    }
    throw new Error('ran out of unique people');
  }

  const scale = n / 3000;
  const rows = [];
  const planted = [];
  const plant = (kind, rec, expect) => { rows.push(rec); planted.push({ kind, index: rows.length - 1, expect }); };

  for (const [kind, base] of PLAN) {
    const count = Math.max(1, Math.round(base * scale));
    for (let k = 0; k < count; k++) {
      const p = person();
      switch (kind) {
        case 'dup_email': {
          plant(kind, p, 'kept');
          const twin = { ...p, Title: '', City: '', 'LinkedIn URL': '' };
          plant(kind, twin, 'merged');
          break;
        }
        case 'dup_email_caps': {
          if (k === 0) { p['First Name'] = 'Priya'; p['Last Name'] = 'Sharma'; p.Email = `priya.sharma@${p.Email.split('@')[1]}`; }
          plant(kind, p, 'kept');
          const parts = p.Email.split('@');
          plant(kind, { ...p, Email: ` ${parts[0][0].toUpperCase()}${parts[0].slice(1)}@${parts[1].toUpperCase()} `, 'LinkedIn URL': '' }, 'merged');
          break;
        }
        case 'dup_linkedin': {
          plant(kind, p, 'kept');
          const other = { ...p, Email: `${p['First Name'].toLowerCase()}@${p.Email.split('@')[1]}`, 'LinkedIn URL': p['LinkedIn URL'].replace('https://www.', 'http://') + '/' };
          plant(kind, other, 'merged');
          break;
        }
        case 'nickname': {
          const [full, nick] = NICK[k % NICK.length];
          const dom = p.Email.split('@')[1];
          plant(kind, { ...p, 'First Name': full, Email: `${full}.${p['Last Name']}@${dom}`.toLowerCase(), 'LinkedIn URL': p['LinkedIn URL'] + 'a' }, 'kept');
          plant(kind, { ...p, 'First Name': nick, Email: `${nick}@${dom}`.toLowerCase(), 'LinkedIn URL': '' }, 'kept');
          break;
        }
        case 'lookalike': {
          const q = person();
          q['First Name'] = p['First Name']; q['Last Name'] = p['Last Name'];
          q.Email = `${p['First Name']}.${p['Last Name']}@${q.Email.split('@')[1]}`.toLowerCase();
          if (q.Email === p.Email) q.Email = 'x' + q.Email;
          plant(kind, p, 'kept');
          plant(kind, q, 'kept');
          break;
        }
        case 'caps_name': plant(kind, { ...p, 'First Name': p['First Name'].toUpperCase(), 'Last Name': p['Last Name'].toUpperCase() }, p['First Name']); break;
        case 'spaces_name': plant(kind, { ...p, 'First Name': `  ${p['First Name'].toLowerCase()} ` }, p['First Name']); break;
        case 'title_prefix': plant(kind, { ...p, 'First Name': `Dr. ${p['First Name']}` }, p['First Name']); break;
        case 'junk_name': plant(kind, { ...p, 'First Name': pick(['Test', 'N/A', 'asdf', '-', 'Unknown']) }, 'lost'); break;
        case 'initial': plant(kind, { ...p, 'First Name': p['First Name'][0] + '.' }, 'lost'); break;
        case 'missing_first': plant(kind, { ...p, 'First Name': '' }, 'lost'); break;
        case 'bad_email': plant(kind, { ...p, Email: pick([p.Email.replace('@', ' at '), p.Email.split('@')[0], p.Email.replace(/\.[a-z]+$/, '')]) }, 'lost'); break;
        case 'missing_email': plant(kind, { ...p, Email: '' }, 'lost'); break;
        case 'missing_company': plant(kind, { ...p, Company: '', Icebreaker: pick(NEUTRAL_ICE) }, 'held_company'); break;
        case 'legal': {
          const end = pick(['Inc.', 'Inc., LLC', 'LLC', 'Ltd', 'Pvt Ltd', 'Private Limited', 'GmbH']);
          plant(kind, { ...p, Company: `${p.Company}${end.startsWith('Inc') ? ' ' : ' '}${end}` }, p.Company);
          break;
        }
        case 'shouting_company': plant(kind, { ...p, Company: p.Company.toUpperCase() }, p.Company); break;
        case 'role_email': plant(kind, { ...p, Email: `${pick(['info', 'sales', 'hello', 'contact'])}@${p.Email.split('@')[1]}`, 'LinkedIn URL': '' }, 'role'); break;
        case 'long_company': plant(kind, { ...p, Company: 'The Northfield Regional Cooperative Society for Applied Agricultural Research and Development Services' + ` ${k + 1}` }, 'long'); break;
        case 'formula': plant(kind, { ...p, Title: '=HYPERLINK("http://example.invalid","Click me")' }, 'neutralised'); break;
        case 'copied_ice': plant(kind, { ...p, Icebreaker: COPIED_LINE }, 'copied'); break;
        case 'long_title': plant(kind, { ...p, Title: `${p.Title} | Ex-${pick(['Northwave', 'Bluepeak', 'Clearloop'])} | Speaker | Mentor` }, p.Title); break;
      }
    }
  }
  while (rows.length < n) rows.push(person());

  // Shuffle so problems are spread through the list, tracking where they land.
  const order = rows.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const position = new Array(rows.length);
  order.forEach((orig, pos) => { position[orig] = pos; });
  const shuffled = order.map(i => rows[i]);
  const where = planted.map(p => ({ ...p, row: position[p.index] + 2 }));

  return { headers: HEADERS, rows: shuffled.map(r => HEADERS.map(h => r[h] ?? '')), planted: where };
}

export const SEQUENCE_PLANTED = [
  {
    subject: 'QUICK QUESTION FOR {{company}}!',
    body: 'Hi {{frist_name}},\n\nHope this finds you well. {{icebreaker}}.\n\nWe help teams like {{company}} book more meetings with outbound that is guaranteed to land in the inbox — and we have done it for teams of every size, from two-person startups to agencies with dozens of client lists. See https://example.com/case-study and https://example.com/pricing.\n\nI think we could really help. We would love to show you what our team has built. Our team is great!!\n\nBest,\nAsh',
  },
  { subject: '', body: 'Hi {{first_name}},\n\nJust following up on my last note. Did you get a chance to look?\n\nAsh' },
  { subject: '', body: "Hi {{first_name}},\n\nLast one from me. If outbound isn't a focus at {{company}} right now, no worries. Worth a quick chat next month?\n\nAsh" },
];

export const SEQUENCE_FIXED = [
  {
    subject: 'quick question, {{first_name}}',
    body: 'Hi {{first_name}},\n\n{{icebreaker}}.\n\nMost teams like {{company}} preview a handful of emails and hope the rest look fine. We check every one before it sends.\n\nWorth a look?\n\nAsh',
  },
  { subject: '', body: 'Hi {{first_name}},\n\nOne idea: a two-minute check of your next campaign before it goes out. Want me to send it over?\n\nAsh' },
  { subject: '', body: "Hi {{first_name}},\n\nLast note from me. If outbound isn't a focus at {{company}} right now, no worries at all. Should I check back next quarter?\n\nAsh" },
];
