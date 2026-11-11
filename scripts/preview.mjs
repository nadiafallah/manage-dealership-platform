#!/usr/bin/env node
// Local Preview of Manage by HEDAX: production build, APP_ENV=preview,
// embedded PostgreSQL (PGlite) persisted under apps/api/.data/preview and the
// synthetic demo dealership. No external service, server or DNS is touched.
//
//   pnpm preview            build if needed, then start (http://localhost:3100)
//   pnpm preview --build    rebuild first
//   pnpm preview --reset    delete the preview database (fresh demo data)
//   pnpm preview --lan      listen on all interfaces so phones on the same
//                           network can open it (Windows may ask to allow
//                           Node.js through the firewall; that is your choice)
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const API_PORT = Number(process.env.PREVIEW_API_PORT ?? 4100);
const WEB_PORT = Number(process.env.PREVIEW_WEB_PORT ?? 3100);
const dataDir = join(root, 'apps/api/.data/preview');
const dbDir = join(dataDir, 'pglite');
const credentialsFile = join(dataDir, 'credentials.local.txt');

const DEMO_USERS = [
  ['expert', 'کارشناس تصادفات'],
  ['supervisor', 'کارشناس تصادفات دوم'],
  ['qc', 'کارشناس تصادفات سوم'],
  ['parts', 'مسئول قطعات'],
  ['technician', 'تکنسین جایگاه'],
  ['manager', 'مدیر خدمات'],
  ['admin', 'مدیر سیستم'],
];

if (args.has('--reset')) {
  rmSync(dbDir, { recursive: true, force: true });
  console.log('Preview database removed; the demo dealership is recreated on start.');
}

const built = existsSync(join(root, 'apps/api/dist/main.js')) && existsSync(join(root, 'apps/web/.next/BUILD_ID'));
if (args.has('--build') || !built) {
  console.log('Building (this takes a few minutes)…');
  const r = spawnSync('pnpm', ['build'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// One password for all synthetic demo accounts, kept for this preview database.
mkdirSync(dataDir, { recursive: true });
let password = process.env.SEED_DEMO_PASSWORD;
if (!password && existsSync(credentialsFile)) {
  password = /password \(all accounts\): (\S+)/.exec(readFileSync(credentialsFile, 'utf8'))?.[1];
}
if (!password) {
  password = randomBytes(9).toString('base64url');
  const lines = [
    'Manage by HEDAX — local Preview accounts (synthetic data only). Do not share or commit.',
    `password (all accounts): ${password}`,
    '',
    ...DEMO_USERS.map(([u, role]) => `${u.padEnd(12)} ${role}`),
    '',
  ];
  writeFileSync(credentialsFile, lines.join('\n'), { encoding: 'utf8', mode: 0o600 });
  rmSync(dbDir, { recursive: true, force: true }); // accounts must match the new password
}

const host = args.has('--lan') ? '0.0.0.0' : '127.0.0.1';
const children = [];
function start(name, cmdArgs, cwd, env) {
  const child = spawn(process.execPath, cmdArgs, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = (chunk) =>
    chunk
      .toString()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => `[${name}] ${l}`)
      .join('\n');
  child.stdout.on('data', (c) => console.log(prefix(c)));
  child.stderr.on('data', (c) => console.error(prefix(c)));
  child.on('exit', (code) => {
    console.log(`[${name}] exited (${code})`);
    stop(code ?? 1);
  });
  children.push(child);
}
function stop(code = 0) {
  for (const c of children) if (c.exitCode === null) c.kill();
  process.exit(code);
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

start('api', ['dist/main.js'], join(root, 'apps/api'), {
  APP_ENV: 'preview',
  DB_DRIVER: 'pglite',
  PGLITE_DATA_DIR: dbDir,
  API_PORT: String(API_PORT),
  NODE_ID: 'preview-local',
  SEED_DEMO_PASSWORD: password,
  COOKIE_SECURE: 'false',
});
start(
  'web',
  [join(root, 'apps/web/node_modules/next/dist/bin/next'), 'start', '--port', String(WEB_PORT), '--hostname', host],
  join(root, 'apps/web'),
  { API_INTERNAL_URL: `http://127.0.0.1:${API_PORT}` },
);

// Announce once both answer.
const deadline = Date.now() + 120_000;
async function ready() {
  try {
    const [api, web] = await Promise.all([
      fetch(`http://127.0.0.1:${API_PORT}/api/v1/health`),
      fetch(`http://127.0.0.1:${WEB_PORT}/login`),
    ]);
    if (api.ok && web.ok) {
      const lan = args.has('--lan')
        ? Object.values(networkInterfaces())
            .flat()
            .filter((i) => i && i.family === 'IPv4' && !i.internal)
            .map((i) => `http://${i.address}:${WEB_PORT}`)
        : [];
      console.log('\nManage by HEDAX — local Preview is ready (synthetic data only)');
      console.log(`  open:        http://localhost:${WEB_PORT}`);
      for (const u of lan) console.log(`  same network: ${u}`);
      console.log(`  accounts:    ${credentialsFile}`);
      console.log('  stop:        Ctrl+C\n');
      return;
    }
  } catch {
    // not up yet
  }
  if (Date.now() > deadline) {
    console.error('Preview did not start within 2 minutes.');
    stop(1);
  }
  setTimeout(ready, 1000);
}
void ready();
