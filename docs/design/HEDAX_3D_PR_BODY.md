> **Superseded (package 6, 2026-11-10):** the Signature theme and the `?ui=classic` switch were removed. The current design system is [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md); this file is kept as history.

# PR text — HEDAX Signature

Title: `HEDAX Signature: spatial dark-material redesign with classic switch`

Base `ali-hedax/manage-dealership-platform:main` ← head `nadiafallah:feature/hedax-signature-3d-manage`. Open as **Draft**.

---

> Draft for owner review. **Do not merge or deploy without explicit owner approval.** Persian summary: [`docs/design/HEDAX_3D_HANDOVER_FA.md`](https://github.com/nadiafallah/manage-dealership-platform/blob/feature/hedax-signature-3d-manage/docs/design/HEDAX_3D_HANDOVER_FA.md)

## Problem and resulting behavior

The owner asked for a premium, spatial interface for the whole platform, with dark mineral materials, machined metal, smoked glass and controlled gold and blue light, without generic AI-dashboard patterns and without making daily work harder. This PR implements the "HEDAX Signature" visual layer on top of the existing interface. Planning reference: #56.

- **Theme layer** `apps/web/app/signature.css`. Every rule is under `html[data-ui="signature"]` and screen media. The obsidian/graphite/champagne material is remapped onto the existing semantic tokens, so every route (23 screens plus sign-in, activation and reset) changes consistently.
- **Spatial behaviour.** The navigation rail sits above the workspace. The active destination is a lit keycap. An opened case section rises as a contextual inspector. Dialogs enter as a separate layer. Desk cards lift and catch a pointer-driven key light (fine pointers only). Route content settles with a transform-only motion. A lit timeline marks the newest event.
- **Dashboard** `OperationsInstrument.tsx`. A dial shows the share of active cases within their deadline, next to four readouts (overdue, blocked, due within 48 h, ready). All values come from the existing `/dashboard` summary, and each readout links to the existing filtered case list.
- **Sign-in.** A pure-CSS showroom plinth, a one-time light sweep and a glass card.
- **Icons.** An engineered drawing for each icon (chamfers, mitred joins). The classic drawings are kept.
- **Reversible.** `?ui=classic` (remembered per browser) or `NEXT_PUBLIC_UI_THEME=classic` restores the previous UI, verified pixel-identical to `main` apart from timestamps. Print always uses the light layout. Reduced motion removes all motion.
- **Unchanged.** API, schema, permissions, authentication, finance rules, routes, workflows, `deploy/**`, `.github/**` and `.env`. No new dependency. No WebGL; the reasons are in the implementation doc.

Before and after screens (synthetic data): [`docs/design/hedax-signature/`](https://github.com/nadiafallah/manage-dealership-platform/tree/feature/hedax-signature-3d-manage/docs/design/hedax-signature). The interaction recording is `signature-interactions.webm` in the same folder.

## Validation performed

- [x] `pnpm lint && pnpm typecheck && pnpm test && pnpm build`: pass. API 223 passed, 9 skipped (PostgreSQL-only). Run with `NODE_OPTIONS=--max-old-space-size=4096`, which the container needs for `main` as well.
- [x] `pnpm test:e2e` on the Signature theme: 43 passed, 9 skipped (opt-in) in the main config; 4 passed in the daily/owner config.
- [x] `docs/TEST_REPORT.md` updated; full record in `docs/design/HEDAX_3D_QA.md`.
- New opt-in `e2e/signature-evidence.spec.ts`, 5/5 passing:
  - 0 horizontal overflow on 23 screens × 6 widths (360–1920)
  - 0 WCAG AA text-contrast failures
  - 0 animations under reduced motion, and none running after a page settles
  - print stays light
  - visible keyboard focus
  - the theme switch works
- Performance (same build, headless): no long tasks, no frame over 20 ms, CLS equal or lower. LCP is about +25 ms on a cold sign-in and about +50 ms on the dashboard. JS +7.5 KB, CSS +29 KB uncompressed.
- Not run: GitHub Actions (pending on this PR), real devices (Windows Edge, iOS Safari, Android), screen reader, live design research (limitation stated in `HEDAX_3D_RESEARCH.md`).

## Data and integration impact

- [x] Synthetic data used; no customer or staff records included.
- [x] Persian RTL layout checked (360 / 390 / 768 / 1024 / 1440 / 1920).
- [x] Implemented integrations distinguished from planned work. Planned modules still show «در دست توسعه».
- [x] No schema change.
- [x] No permission change.
- [x] No secrets, server addresses or real data in code, logs, screenshots or this description.

## Branch and rollout

- Base: `main` at `5cf9c72`. This PR is independent of #56 (planning doc only).
- Deployed SHA: not deployed.
- Implementation commit `dbe8c0a`; documentation and motion refinement `d322319`; this PR text in the following commit.
- [x] `node scripts/check-docs.mjs` passes.
- [x] The main merge and any server/DNS/production change need separate explicit owner approval before execution.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_017zEkfp1hKmQ39qUCyt2uU1
