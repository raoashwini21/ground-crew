// Bundles everything into one self-contained file: dist/Ground Crew.html.
// No module imports, no worker files, no remote anything. The page carries
// a Content-Security-Policy that blocks every network request, and the
// script is allowed by its own hash, so nothing else can run.

import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const appDir = join(root, 'src/app');

const js = await build({
  entryPoints: [join(appDir, 'main.js')],
  bundle: true,
  format: 'iife',
  minify: true,
  write: false,
  target: ['es2020'],
  legalComments: 'none',
});
let script = js.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

// Art, fonts and sounds become data: URLs inside the CSS and script.
const assetsDir = join(root, 'assets');
const MIME = { '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg' };
const assets = {};
if (existsSync(assetsDir)) {
  for (const sub of readdirSync(assetsDir, { recursive: true })) {
    const ext = extname(sub);
    if (!MIME[ext]) continue;
    assets[sub.replace(/\\/g, '/')] = `data:${MIME[ext]};base64,${readFileSync(join(assetsDir, sub)).toString('base64')}`;
  }
}
// Fonts are only needed by the CSS; art and sounds are handed to the script.
const forScript = Object.fromEntries(Object.entries(assets).filter(([k]) => !k.startsWith('fonts/')));
script = `window.__ASSETS__=${JSON.stringify(forScript)};` + script;

let css = readFileSync(join(appDir, 'style.css'), 'utf8');
css = css.replace(/url\(["']?asset:([^"')]+)["']?\)/g, (m, name) => {
  if (!assets[name]) throw new Error(`missing asset ${name}`);
  return `url("${assets[name]}")`;
});

const hash = s => "'sha256-" + createHash('sha256').update(s, 'utf8').digest('base64') + "'";
const csp = [
  "default-src 'none'",
  `script-src ${hash(script)}`,
  `style-src ${hash(css)}`,
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

const html = readFileSync(join(appDir, 'index.html'), 'utf8')
  .replace('%CSP%', csp)
  .replace('%CSS%', () => css)
  .replace('%SCRIPT%', () => script);

mkdirSync(join(root, 'dist'), { recursive: true });
const out = join(root, 'dist', 'Ground Crew.html');
writeFileSync(out, html);
console.log(`dist/Ground Crew.html  ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB`);
