# Visual harness

Renders the **real** web pages and CSS of `apps/web` in a browser with an in-page,
synthetic API (`src/backend.ts`), so screens can be checked and photographed without
the API, a database or a Next.js build. It was used for the package 9 screenshots,
the interaction recording and the layout/contrast/focus/print probes
([TEST_REPORT](../../docs/TEST_REPORT.md)).

It is an auxiliary check, not a substitute for the Playwright suite in `apps/web/e2e`,
which runs the built app against the real API and PostgreSQL in CI.

- Every number on screen is derived from synthetic folders through the same shared
  rules the API uses (`folderNextStep`, `buildBays`, `buildFunnel`, `analysisSentences`…).
  Phones `0900…`, VINs `TESTVIN…`; the tenant is marked as test data.
- `next/link`, `next/navigation` and `swr` are replaced by small stand-ins
  (`src/next-link.tsx`, `src/next-navigation.ts`, `src/swr.ts`).
- Pick the signed-in role with `?as=` (`expert`, `expert2`, `expert3`, `parts`, `manager`,
  `admin`, `techBody`, `techPaint`, `techFront`, `none`).

## Run

```bash
# from the repository root, after pnpm install
ESBUILD_PATH=esbuild VAZIRMATN_DIR=/path/to/vazirmatn/webfonts node tools/visual-harness/build.mjs
node tools/visual-harness/serve.mjs &            # http://127.0.0.1:4400/control-room?as=manager
node tools/visual-harness/shots-all.mjs           # 8 screens × 1440 / 768 / 390 → $OUT_DIR
node tools/visual-harness/probe.mjs               # overflow at 360–1440, contrast, focus, reduced motion, print
node tools/visual-harness/record.mjs              # short interaction video (webm in /tmp/rec)
```

Optional environment: `NODE_PATHS` (folders holding `react`, `react-dom`, `zod`, `jalaali-js`),
`PLAYWRIGHT_MODULE` (default `@playwright/test`), `CHROME_PATH`, `OUT_DIR`, `PORT`.
Without `VAZIRMATN_DIR` the pages render with a system font.
