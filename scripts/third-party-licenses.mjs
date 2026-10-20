// Writes public/third-party-licenses.txt: the license of everything techo ships to the
// browser (runtime dependencies, the service worker's Workbox modules, the banner font).
// Runs before every build (npm run build); the output is not committed.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));

// Workbox is a build tool (dev dependency) but these parts end up in sw.js / the page.
const SHIPPED_DEV = ['workbox-core', 'workbox-precaching', 'workbox-routing', 'workbox-strategies', 'workbox-window'];

const packages = Object.entries(lock.packages)
  .filter(([key, p]) => key.startsWith('node_modules/') && (!p.dev || SHIPPED_DEV.includes(key.slice(13))))
  .map(([key, p]) => ({ name: key.slice(13), version: p.version, license: p.license, dir: path.join(root, key) }))
  .filter(p => !p.name.includes('/node_modules/'))
  .sort((a, b) => a.name.localeCompare(b.name));

const licenseText = dir => {
  const file = fs.existsSync(dir) && fs.readdirSync(dir).find(f => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f));
  return file ? fs.readFileSync(path.join(dir, file), 'utf8').trim() : null;
};

// Packages with the very same license text share one copy of it.
const groups = new Map();
for (const p of packages) {
  const text = licenseText(p.dir) || `${p.license} (see https://www.npmjs.com/package/${p.name})`;
  if (!groups.has(text)) groups.set(text, []);
  groups.get(text).push(`${p.name} ${p.version} (${p.license})`);
}

const out = [
  'techo uses the following third-party software. Thank you to their authors.',
  'techo itself is MIT licensed: https://github.com/t-bfny/techo/blob/main/LICENSE',
  '',
];
for (const [text, names] of groups) out.push('='.repeat(72), ...names, '-'.repeat(72), text, '');
out.push('='.repeat(72), 'Space Grotesk (font, public/fonts/SpaceGrotesk-Variable.woff2)', '-'.repeat(72),
  fs.readFileSync(path.join(root, 'public/fonts/OFL.txt'), 'utf8').trim(), '');

fs.writeFileSync(path.join(root, 'public/third-party-licenses.txt'), out.join('\n'));
console.log(`third-party-licenses.txt: ${packages.length} packages + 1 font`);
