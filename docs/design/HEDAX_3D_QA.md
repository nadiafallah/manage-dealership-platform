> **Superseded (package 6, 2026-11-10):** the Signature theme and the `?ui=classic` switch were removed. The current design system is [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md); this file is kept as history.

# HEDAX Signature — QA record

Environment: Linux container, Node 22.23, pnpm 10.34.6, Playwright 1.64 with Chromium build 1243 headless. Synthetic demo data only. Date 2026-11-07.

## Repository gates (signature theme as default)

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | pass |
| `pnpm -r lint` | pass |
| `pnpm -r typecheck` | pass |
| `pnpm build` | pass |
| `pnpm test` (shared + API; `NODE_OPTIONS=--max-old-space-size=4096` because the container's default heap is too small for one process, same as on `main`) | API **223 passed, 9 skipped** (PostgreSQL-only), 0 failed; shared passed |
| `pnpm test:e2e`, main config | **43 passed**, 9 skipped (opt-in screenshot/evidence specs), 0 failed |
| `pnpm test:e2e`, daily/owner config | **4 passed**, 0 failed |
| `node scripts/check-docs.mjs` | pass |
| GitHub Actions on PR #62 (run 42357733293, head `b79375a`) | **all six jobs passed** |

The e2e suites cover login, case creation and updates, assessment, parts and finance, QC and delivery, technician station, staff and permissions, reminders, reports, workspaces, PWA and logout. All of them ran on the Signature theme.

## Design evidence (`e2e/signature-evidence.spec.ts`, 5/5 passed)

| Check | Signature | Classic (`?ui=classic`) |
| --- | --- | --- |
| Horizontal overflow, 23 screens × 6 widths (360, 390, 768, 1024, 1440, 1920) | **0** | 0 |
| WCAG AA text-contrast scan, every visible text node, 23 screens + sign-in | **0 failures** | 1 (existing dashboard zero-count grey `#cbd5e0`, also on `main`) |
| Animations at load / running after settle | 5 / **0** | — |
| With `prefers-reduced-motion: reduce` | **0 / 0** | — |
| Print: panel background / body text | `rgb(255,255,255)` / `rgb(18,26,42)` (classic print layout) | same |
| Keyboard: first Tab | skip link «رفتن به محتوای صفحه»; next element shows a focus ring | — |
| Switch `?ui=classic` → instrument hidden, choice remembered; `?ui=signature` → instrument shown | pass | — |

Raw reports: [`hedax-signature/evidence-after.json`](hedax-signature/evidence-after.json), [`evidence-classic.json`](hedax-signature/evidence-classic.json), [`evidence-main-baseline.json`](hedax-signature/evidence-main-baseline.json).

**Classic = main.** Classic-mode screenshots of this branch were compared pixel by pixel with screenshots taken on unchanged `main` before any change. Login, case list, parts workbench, technician station and launch desk are identical. The dashboard differs in 122 pixels (the timestamp). Reports differ in 0.46% of pixels (timestamps and dates).

## Performance

Same build, three fresh browser contexts per theme ([`lcp-ab.txt`](hedax-signature/lcp-ab.txt)):

| Page | LCP classic (ms) | LCP signature (ms) | CLS classic → signature | Long tasks | Worst frame |
| --- | --- | --- | --- | --- | --- |
| Dashboard | 248 / 304 / 340 | 356 / 340 / 364 | 0.0002 → 0.0003 | 0 → 0 | 17 ms → 17 ms |
| Case list | 256 / 260 / 256 | 256 / 256 / 288 | 0.053 → **0.034** | 0 → 0 | 17 → 17 |
| Sign-in (fresh context) | 64 / 100 / 96 | 264 / 256 / 300 | 0.0009 → 0.0009 | 0 → 0 | 17 → 17 |
| Sign-in, same context: cold, then 3 warm loads | 268, 108, 112, 104 | 296, 92, 108, 104 | — | — | — |

**Reading the numbers honestly:**

- The fresh-context sign-in gap (about 95 → 270 ms) disappears when both themes are loaded under identical cache conditions (last row). Cold loads differ by about 28 ms and warm loads are equal. The fresh-context runs were partly measuring cache state, so the last row is the fair comparison.
- The dashboard is about 50 ms slower to its largest paint, from rendering the instrument and parsing the extra CSS.
- JavaScript +7.5 KB uncompressed (1,225,568 → 1,233,152 bytes on the dashboard). CSS +29 KB uncompressed (62.8 → 91.7 KB). JS heap 8.5 → 8.6 MB.
- Frame pacing: 60 fps with no frame over 20 ms during a one-second idle sample on all three pages.
- **Fixed during QA:** the first version faded route content in from opacity 0. That held back LCP (case list 232 → 452 ms in one run) because Chrome does not count invisible content. The motion is now transform-only, and the page heading is painted still.

These are local headless measurements with small samples. They should be repeated on a real dealership PC and a mid-range phone before release.

## Issues found and fixed during QA

1. Plate digits were inherited as light text on the white plate and became unreadable. The plate is now forced to black; caught by eye on the case detail.
2. A global link-colour rule turned navigation and attention titles blue. Removed.
3. The plinth rings under the dial were off-centre. Now centred with auto margins.
4. Flat wrappers (`.staff-panel`, `.notice`, the reminder composer and owner card) were given plate surfaces, so text touched the box edge. The plate list was restricted to components that are boxes in the classic layout.
5. LCP regression from the fade, as described above.
6. The contrast scanner initially skipped plates and gradient buttons. Plates are now scanned, and the buttons got a solid `background-color` fallback.

## Review round 2 — 2026-11-07

Reviewed the dashboard, sign-in, case list and detail, and parts workbench against the design brief after PR #62 was opened. No reviewer comments yet; CI run 42358401074 green on `d890f2c`.

- **Changed:** dashboard only. The welcome band and the operations instrument were two stacked heavy plates; the band is now a flat page heading when the instrument follows it (CSS `:has()`, Signature theme only). Same title, timestamp and buttons; about 85 px less vertical space before the operational figures; one focal surface per view.
- **Unchanged on purpose:** sign-in, case list and detail, parts workbench. They are coherent and readable, and further changes would add risk without a clear benefit.
- **Re-run after the change:** lint, typecheck, build, docs check pass; Playwright 43 passed + 4 passed; evidence 5/5, 0 overflow, 0 contrast failures, 0 animations under reduced motion; dashboard: no long tasks, worst frame 17 ms, CSS +0.4 KB.

## Not done or open

- Live research browsing, real-device testing (Edge on Windows, iOS Safari, Android), and a screen-reader pass (NVDA/VoiceOver).
- An owner visual review of the dark-only direction.
