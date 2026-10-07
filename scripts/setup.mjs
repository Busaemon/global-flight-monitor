import { spawnSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [major, minor] = process.versions.node.split('.').map(Number);

if (major < 24 || (major === 24 && minor < 5)) {
  console.error(`Node.js 24.5 以上が必要です。現在: ${process.versions.node}`);
  process.exit(1);
}

try {
  const { DatabaseSync } = await import('node:sqlite');
  const probe = new DatabaseSync(':memory:');
  try { probe.prepare('SELECT 1').get(); }
  finally { probe.close(); }
} catch {
  console.error('この Node.js で SQLite を利用できません。Node.js 24 の標準配布版を使用してください。');
  process.exit(1);
}

// npm.cmd requires cmd.exe on Windows. Only fixed commands are passed to the shell.
// The working directory is an option, so paths with spaces need no shell interpolation.
const environment = {
  ...process.env,
  npm_config_cache: process.env.NPM_CONFIG_CACHE || process.env.npm_config_cache
    || join(tmpdir(), 'global-flight-monitor-npm-cache'),
};
const steps = [
  { label: '依存関係をインストール', args: ['ci', '--no-audit', '--no-fund'] },
  { label: 'データベースを準備（既存データを保持）', args: ['run', 'db:init'] },
  { label: '型検査と画面のビルド', args: ['run', 'build'] },
];

for (const [index, step] of steps.entries()) {
  console.log(`\n[${index + 1}/${steps.length}] ${step.label}`);
  const result = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npm ${step.args.join(' ')}`], {
      cwd: projectDirectory, env: environment, stdio: 'inherit',
    })
    : spawnSync('npm', step.args, { cwd: projectDirectory, env: environment, stdio: 'inherit' });

  if (result.error || result.signal || result.status !== 0) {
    console.error(`セットアップを中断しました: ${step.label}。上のエラーを確認してください。`);
    process.exit(result.status && result.status > 0 ? result.status : 1);
  }
}

console.log('\n準備が完了しました。npm run dev で開発画面を起動できます。');
console.log('Windows の PowerShell では npm.cmd run dev を使用できます。');
