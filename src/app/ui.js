// Small building blocks for the airport. Icons and the plane are fixed SVG
// written here; anything from a lead's data only ever goes in as text.

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  // Clickable rows work from the keyboard too (Tab to reach, Enter to open).
  if (tag === 'tr' && /\bclick\b/.test(el.className)) {
    el.tabIndex = 0;
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); } });
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const ICONS = {
  checkin: '<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M7 8V5h10v3M3 13h18M9 16h6"/>',
  baggage: '<rect x="4" y="7" width="16" height="13" rx="2"/><path d="M9 7V4h6v3M8 7v13M16 7v13"/>',
  tower: '<path d="M9 22l1-9h4l1 9M7 13h10l-1-5H8zM8 8l1-4h6l1 4M12 4V2"/>',
  gate: '<path d="M2 20h20M5 16l12-5 4 1-3 3-11 2-2-1zM10 13l-2-4 2-1 4 3"/>',
  takeoff: '<path d="M2 21h20M3 16l14-8c1.5-.8 3.5-.4 4 .6.4.9-.4 1.8-1.6 2.4L7 17l-3-.2zM9 12L6 7l2-1 6 3"/>',
  radio: '<path d="M5 12a7 7 0 0114 0M8 12a4 4 0 018 0"/><circle cx="12" cy="12" r="1.5"/><path d="M12 14v7"/>',
  board: '<rect x="2" y="4" width="20" height="14" rx="2"/><path d="M6 9h3M11 9h7M6 13h3M11 13h7"/>',
  plane: '<path d="M2 16l8-2 4-8h2l-1 7 6-1 1-3h2l-1 5 1 5h-2l-1-3-6-1 1 7h-2l-4-8-8-2z"/>',
};

export function icon(name) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('class', 'ico');
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = ICONS[name] || '';
  return el;
}

export function jet() {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', '0 0 200 70');
  el.setAttribute('class', 'jet');
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `
    <path fill="currentColor" d="M34 24 L20 3 L38 3 L62 24Z"/>
    <path fill="#d9e2ee" d="M10 37 C10 29 22 24 42 24 L152 24 C172 24 189 30 195 35 C189 41 172 46 152 46 L42 46 C22 46 10 44 10 37Z"/>
    <path fill="#ffcc1a" d="M12 40 C40 43 120 43 190 38 C186 41 172 46 152 46 L42 46 C24 46 14 44 12 40Z"/>
    <path fill="#b9c6d6" d="M88 38 L122 64 L140 64 L118 38Z"/>
    <path fill="#b9c6d6" d="M24 30 L10 22 L18 22 L36 30Z"/>
    <g fill="#33475f">${Array.from({ length: 11 }, (_, i) => `<circle cx="${64 + i * 9}" cy="32" r="2.4"/>`).join('')}</g>
    <path fill="#33475f" d="M170 29 L184 31 L186 35 L172 35Z"/>`;
  return el;
}

// ---------- Split-flap tiles ----------
const FLAP_CHARS = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789&-.,';

export function flaps(text, cls = '') {
  const wrap = h('span', { class: `flaps ${cls}`, 'aria-label': text });
  for (const ch of String(text).toUpperCase()) wrap.append(h('span', { class: 'flap' }, ch));
  return wrap;
}

// Clatter each tile through a few letters before it lands.
export function clatter(root, calm, onTick) {
  if (calm) return;
  const tiles = [...root.querySelectorAll('.flap')];
  tiles.forEach((tile, i) => {
    const target = tile.textContent;
    const turns = 3 + ((i * 7) % 6);
    let n = 0;
    const step = () => {
      if (n >= turns) { tile.textContent = target; tile.classList.remove('spin'); return; }
      tile.textContent = FLAP_CHARS[Math.floor(Math.random() * FLAP_CHARS.length)];
      tile.classList.remove('spin');
      void tile.offsetWidth;
      tile.classList.add('spin');
      if (onTick && i % 4 === 0) onTick();
      n++;
      setTimeout(step, 55);
    };
    setTimeout(step, i * 18);
  });
}

// ---------- Altimeter ----------
export function gauge(score, kind) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', '0 0 100 100');
  const col = kind === 'mayday' ? '#ff6b6b' : kind === 'clear' ? '#4fd69c' : '#ffd36b';
  const ticks = Array.from({ length: 11 }, (_, i) => {
    const a = (-135 + i * 27) * Math.PI / 180;
    const r1 = 40, r2 = i % 5 === 0 ? 31 : 35;
    return `<line x1="${50 + r1 * Math.sin(a)}" y1="${50 - r1 * Math.cos(a)}" x2="${50 + r2 * Math.sin(a)}" y2="${50 - r2 * Math.cos(a)}" stroke="#5fae8a" stroke-width="${i % 5 === 0 ? 2.4 : 1.4}"/>`;
  }).join('');
  const angle = -135 + (Math.max(0, Math.min(100, score)) * 2.7);
  el.innerHTML = `
    <circle cx="50" cy="50" r="46" fill="#030806" stroke="#173326" stroke-width="2"/>
    ${ticks}
    <g class="needle" transform="rotate(${angle} 50 50)">
      <path d="M50 50 L48 46 L50 16 L52 46Z" fill="${col}"/>
    </g>
    <circle cx="50" cy="50" r="5" fill="#173326" stroke="${col}" stroke-width="2"/>`;
  return el;
}

// Stable colour for a suitcase, picked from the name.
const CASE_COLOURS = ['#3fb8a5', '#ff8a72', '#f4b942', '#a993e8', '#6aa9e8', '#e86a9a', '#8bd36b', '#e8925a'];
export function caseColour(seed) {
  let x = 0;
  for (const c of String(seed)) x = (x * 31 + c.charCodeAt(0)) >>> 0;
  return CASE_COLOURS[x % CASE_COLOURS.length];
}
