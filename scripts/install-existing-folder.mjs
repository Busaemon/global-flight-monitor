import {
  copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync,
  readFileSync, readdirSync, realpathSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const source = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const destination = realpathSync(resolve(process.argv[2] ?? process.cwd()));
const files = [
  '.env.example', '.gitattributes', '.gitignore', '.nvmrc', 'README.md',
  'START-HERE.md', 'index.html', 'package.json', 'package-lock.json',
  'playwright.config.ts', 'tsconfig.json', 'tsconfig.server.json', 'tsconfig.server.build.json', 'vite.config.ts',
  '.dockerignore', '.env.production.example', 'Dockerfile', 'compose.yml', 'Caddyfile',
  'SECURITY.md', 'CONTRIBUTING.md',
];
const folders = ['.github', '.vscode', 'docs', 'public', 'scripts', 'server', 'shared', 'src', 'tests'];

if (!lstatSync(destination).isDirectory()) throw new Error('Destination must be an existing folder.');
if (source === destination) throw new Error('Run this installer from a separate downloaded copy.');

function collect(folder) {
  const location = join(source, folder);
  const stat = lstatSync(location);
  if (stat.isSymbolicLink()) throw new Error(`Source contains a symbolic link: ${folder}`);
  if (!stat.isDirectory()) throw new Error(`A source folder is needed: ${folder}`);
  for (const entry of readdirSync(location, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Source contains a symbolic link: ${path}`);
    if (entry.isDirectory()) collect(path);
    else if (entry.isFile()) files.push(path);
  }
}
folders.forEach(collect);

// Check every path before replacing anything, including existing directory components.
const changed = [];
for (const name of files) {
  const sourcePath = join(source, name);
  if (!lstatSync(sourcePath).isFile()) throw new Error(`Missing source file: ${name}`);
  let current = destination;
  const parts = name.split(sep);
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    const stat = lstatSync(current, { throwIfNoEntry: false });
    if (!stat) continue;
    if (stat.isSymbolicLink()) throw new Error(`Destination contains a symbolic link: ${name}`);
    if (index < parts.length - 1 && !stat.isDirectory()) throw new Error(`A folder is needed: ${current}`);
    if (index === parts.length - 1 && !stat.isFile()) throw new Error(`A file is needed: ${current}`);
  }
  const target = join(destination, name);
  if (existsSync(target) && !readFileSync(sourcePath).equals(readFileSync(target))) changed.push(name);
}

let backup = null;
if (changed.length) {
  backup = mkdtempSync(join(tmpdir(), 'skytrace-existing-files-'));
  for (const name of changed) {
    const target = join(backup, name);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(destination, name), target);
  }
  console.log(`Existing files backed up to: ${backup}`);
}

for (const name of files) {
  const target = join(destination, name);
  mkdirSync(dirname(target), { recursive: true });
  if (!existsSync(target) || !readFileSync(join(source, name)).equals(readFileSync(target))) {
    copyFileSync(join(source, name), target);
  }
}
console.log(`Installed ${files.length} project files in: ${destination}`);
console.log('Existing .git, .env, data and other files are retained.');
console.log('Next: npm.cmd run setup');
