import { createHash } from 'node:crypto';
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const buildDirectory = join(projectDirectory, 'dist');
const templatePath = join(projectDirectory, 'public', 'sw-template.js');

async function listFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

const assets = (await listFiles(buildDirectory))
  .map((path) => relative(buildDirectory, path).split(sep).join('/'))
  .filter((path) => path === 'index.html'
    || /^assets\/.+-[A-Za-z0-9_-]{8,}\.(?:js|css)$/.test(path)
    || /^icons\/[A-Za-z0-9_-]+\.(?:png|svg)$/.test(path))
  .sort();

if (!assets.includes('index.html') || !assets.some((path) => path.endsWith('.js'))
  || !assets.includes('icons/icon-192.png') || !assets.includes('icons/icon-512.png')
  || !assets.includes('icons/maskable-512.png')) {
  throw new Error('The app build or required PWA icons are missing. Run vite build first.');
}

const template = await readFile(templatePath, 'utf8');
const digest = createHash('sha256').update(template);
for (const asset of assets) {
  digest.update(asset).update('\0').update(await readFile(join(buildDirectory, asset)));
}
const version = digest.digest('hex').slice(0, 20);
const worker = template
  .replace('__SKYTRACE_VERSION__', version)
  .replace('__SKYTRACE_ASSETS__', JSON.stringify(assets.map((asset) => `/${asset}`)));
if (worker.includes('__SKYTRACE_')) throw new Error('A service-worker template token was not replaced.');

await writeFile(join(buildDirectory, 'sw.js'), worker, 'utf8');
await rm(join(buildDirectory, 'sw-template.js'), { force: true });
console.log(`PWA app shell: ${assets.length} assets, version ${version}`);
