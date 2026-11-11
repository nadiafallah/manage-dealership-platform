> **Superseded (package 6, 2026-11-10):** the Signature theme and the `?ui=classic` switch were removed. The current design system is [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md); this file is kept as history.

# HEDAX Signature — implementation

Branch `feature/hedax-signature-3d-manage`, based on `main` at `5cf9c72` (merge of #60, 2026-11-07). Implementation commit `dbe8c0a`; later commits on the branch refine motion and add documentation.

## Architecture

```text
app/layout.tsx           html[data-ui] + 1-line pre-paint script (?ui= / localStorage)
 ├─ app/globals.css      unchanged classic design (light, print)
 └─ app/signature.css    Signature layer, @media screen, html[data-ui="signature"] only
components/
 ├─ AppIcon.tsx           classic + engineered drawings per icon (CSS shows one)
 ├─ SpatialLight.tsx      pointer key light / tilt (fine pointer, motion allowed)
 └─ OperationsInstrument.tsx  dashboard dial + readouts from /dashboard data
app/(app)/page.tsx       renders <OperationsInstrument data={data}/>
app/login/page.tsx       adds decorative <div class="sx-stage"> (aria-hidden)
e2e/signature-evidence.spec.ts  opt-in evidence: screens, overflow, contrast, metrics, motion, print, focus, switch, video
```

**Untouched:** API, database, migrations, shared contracts, permissions, RBAC checks, authentication, finance rules, routes, deployment files, `.env`, `deploy/**` and `.github/**`.

## Theme switch (reversible)

| Mechanism | Effect |
| --- | --- |
| `NEXT_PUBLIC_UI_THEME=classic` at build time | Default becomes the classic UI for everyone |
| `?ui=classic` / `?ui=signature` on any URL | Switches this browser and remembers the choice (`localStorage['manage-ui']`) |
| Print | Always classic (all Signature rules are inside `@media screen`) |
| `git revert` of the branch commits | Removes the layer entirely; no data or schema to undo |

Verified: classic mode on this branch matches `main` pixel for pixel on login, dashboard, case list, parts workbench, technician station and launch desk. The only differences are live timestamps on the dashboard and reports. See [QA](HEDAX_3D_QA.md).

## Route coverage

All 23 implemented screens (plus sign-in, activation and password reset, which use the same login layout) receive the Signature material through the shared tokens and component classes. The table separates **bespoke** work from **system-level** restyling, so nothing is overstated.

| Area | Routes | Treatment |
| --- | --- | --- |
| Sign-in | `/login`, `/activate`, `/reset-password` | Bespoke: obsidian stage, plinth, light sweep, glass card, metallic claim, keycap tabs |
| Shell | all `(app)` routes | Bespoke: lit rail, keycap active state, glass mobile bar, cast shadow, global search well |
| Dashboard | `/` | Bespoke: Operations instrument (dial + 4 readouts), lit stage rail, attention tones; existing panels kept |
| Launch / desks | `/launch`, `/accidents/*` | Spatial desk cards (lift, tilt, key light), champagne symbols |
| Cases | `/cases`, `/cases/[id]`, `/cases/new`, `/cases/import`, `/cases/[id]/edit` | System: tables, chips, plate; case sections as contextual inspector; lit timeline; responsibility bar |
| Parts | `/accidents/parts`, `/stock`, `/emdad`, `/daily-reports` | System: plates, stats, forms, notices |
| Workshop | `/workshop`, `/workshop/settings` | System: summary tiles, route bars, heading rule in champagne |
| Technician | `/workshop/technician`, `/workshop/technician/work` | Bespoke: lit greeting band, current-job ring, finish key, month bar |
| People | `/users`, `/reminders`, `/reports/people` | System: tabs, roles, reminder cards (urgent tint), owner controls |
| Reports | `/reports` | System: KPIs with key light, champagne bars, tables |
| Reference / modules | `/reference-data`, `/modules/[key]` | System |
| States | empty, permission denied, error, loading, toast, dialog | System: lit empty-state medallion, glass dialog layer, toast layer |

## Why there is no WebGL

The visual goals (layered depth, lighting response, one hero object) are met with CSS 3D transforms and gradients. That costs +7.5 KB of JavaScript (uncompressed, mostly the instrument and pointer light) and +29 KB of CSS. Three.js or React Three Fiber would add more than 150 KB and continuous GPU work on dealership PCs. If the owner later wants a real-time object, such as a rotating vehicle silhouette on the sign-in screen, it should be one lazy-loaded island, paused when hidden, with this CSS as the fallback.

## Known limitations

- **Research:** not browsed live (see [research](HEDAX_3D_RESEARCH.md)).
- **Coverage depth:** most module screens are restyled at system level (tokens, surfaces, controls, states), not individually re-composed. Their layout and information architecture are unchanged on purpose, so there is no retraining and no workflow risk. The bespoke compositions are sign-in, shell, dashboard, desks and the technician station.
- **Devices:** measured only in headless Chromium in a Linux container. Real dealership PCs, Windows Edge, iOS Safari (`backdrop-filter`, `background-clip:text`) and low-end Android still need a hands-on check.
- **LCP:** about 25 ms more on a cold sign-in, and about 50 ms more on the dashboard (instrument render). Details in [QA](HEDAX_3D_QA.md).
- **Light-theme Signature:** not provided. The Signature theme is dark only, and classic remains the light option.
