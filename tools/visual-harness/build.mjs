// Visual harness build: bundles the real web pages with an in-page synthetic API.
// Env: ESBUILD_PATH (module path of esbuild), NODE_PATHS (":"-separated module dirs that
// hold react, react-dom, zod, jalaali-js), VAZIRMATN_DIR (folder with Vazirmatn-*.woff2).
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const web = `${repo}/apps/web`;
const { build } = await import(process.env.ESBUILD_PATH ?? 'esbuild');
const nodePaths = (process.env.NODE_PATHS ?? `${web}/node_modules:${repo}/node_modules:${repo}/packages/shared/node_modules`).split(':').filter(Boolean);
mkdirSync(join(here, 'out/fonts'), { recursive: true });
await build({
  entryPoints: [join(here, 'src/main.tsx')],
  bundle: true,
  outfile: join(here, 'out/app.js'),
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  sourcemap: 'inline',
  nodePaths,
  alias: {
    'next/link': join(here, 'src/next-link.tsx'),
    'next/navigation': join(here, 'src/next-navigation.ts'),
    swr: join(here, 'src/swr.ts'),
    '@manage/shared': `${repo}/packages/shared/src/index.ts`,
  },
  plugins: [{
    name: 'web-alias',
    setup(b) {
      b.onResolve({ filter: /^@\// }, async (a) => {
        const r = await b.resolve(`./${a.path.slice(2)}`, { resolveDir: web, kind: a.kind });
        return r.errors.length ? { errors: r.errors } : { path: r.path };
      });
      b.onResolve({ filter: /\.css$/ }, (a) => ({ path: a.path, namespace: 'css-skip' }));
      b.onLoad({ filter: /.*/, namespace: 'css-skip' }, () => ({ contents: '', loader: 'js' }));
    },
  }],
  define: { 'process.env.NODE_ENV': '"development"' },
  banner: { js: 'globalThis.process ??= { env: {} };' },
  logLevel: 'warning',
});
copyFileSync(`${web}/app/globals.css`, join(here, 'out/globals.css'));
copyFileSync(`${web}/app/manage-ui.css`, join(here, 'out/manage-ui.css'));
const fontsDir = process.env.VAZIRMATN_DIR;
let faces = '';
if (fontsDir && existsSync(fontsDir)) {
  for (const f of readdirSync(fontsDir).filter((x) => /^Vazirmatn-\w+\.woff2$/.test(x))) copyFileSync(join(fontsDir, f), join(here, 'out/fonts', f));
  faces = [[400, 'Regular'], [500, 'Medium'], [600, 'SemiBold'], [700, 'Bold'], [800, 'ExtraBold']].map(([w, n]) => `@font-face{font-family:Vazirmatn;font-weight:${w};font-display:block;src:url(/fonts/Vazirmatn-${n}.woff2) format('woff2')}`).join('\n');
} else console.warn('VAZIRMATN_DIR not set: pages render with a system font');
writeFileSync(join(here, 'out/fonts.css'), faces);
writeFileSync(join(here, 'out/index.html'), `<!doctype html><html lang="fa" dir="rtl" data-ui="paper"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Manage by HEDAX — visual harness</title>
<link rel="stylesheet" href="/fonts.css"><link rel="stylesheet" href="/globals.css"><link rel="stylesheet" href="/manage-ui.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`);
console.log('built tools/visual-harness/out');
