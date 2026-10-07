import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const manifest = JSON.parse(readFileSync(join(dist, '.vite/manifest.json'), 'utf8'));
const entry = Object.keys(manifest).find(key => manifest[key].isEntry);
if (!entry) throw new Error('The build manifest has no application entry.');
const initial = new Set();
function visit(key) {
  const chunk = manifest[key];
  if (!chunk) throw new Error(`Missing build chunk: ${key}`);
  if (initial.has(chunk.file)) return;
  initial.add(chunk.file);
  (chunk.imports ?? []).forEach(visit);
}
visit(entry);
if ([...initial].some(file => file.includes('map-vendor'))) {
  throw new Error('The Leaflet map must stay outside the initial JavaScript download.');
}
const bytes = file => gzipSync(readFileSync(join(dist, file))).byteLength;
const assets = readdirSync(join(dist, 'assets')).map(file => `assets/${file}`);
const metrics = {
  initialJavaScriptKiB: [...initial].filter(file => file.endsWith('.js')).reduce((sum, file) => sum + bytes(file), 0) / 1024,
  totalJavaScriptKiB: assets.filter(file => file.endsWith('.js')).reduce((sum, file) => sum + bytes(file), 0) / 1024,
  totalCssKiB: assets.filter(file => file.endsWith('.css')).reduce((sum, file) => sum + bytes(file), 0) / 1024,
};
const limits = { initialJavaScriptKiB: 120, totalJavaScriptKiB: 300, totalCssKiB: 40 };
for (const [name, value] of Object.entries(metrics)) {
  if (value > limits[name]) throw new Error(`${name}: ${value.toFixed(1)} exceeds the ${limits[name]} KiB gzip budget.`);
}
console.log(JSON.stringify({ gzip: Object.fromEntries(Object.entries(metrics).map(([name, value]) => [name, Number(value.toFixed(1))])), limits }));
