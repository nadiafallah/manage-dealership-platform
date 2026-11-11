# Manage design system (packages 6 and 9)

Source of truth: [سند جامع محصول §۱۲](../PRODUCT_SPEC_FA.md) and the approved mockups in [mockups/](mockups/).
Implementation: [`apps/web/app/manage-ui.css`](../../apps/web/app/manage-ui.css) (components, both spaces) on top of the paper tokens in [`apps/web/app/globals.css`](../../apps/web/app/globals.css).

## Two spaces, one language

| Space | Where | Ground | Ink | Accent | Warning | Stop |
|---|---|---|---|---|---|---|
| Paper | desks, case folder, technician, every work page | `#F3F1EC` (paper `#FFFEFB`, line `#E6E2D9`) | `#15181D` / `#5F6672` | `#0E5F66` | `#FBEFD9` / `#7A4A0B` | `#FBE7E3` / `#8E2E1F` |
| Dark | login, control room | `#07090D` with radial `#10202A` | `#F2F4F7` / `#8A93A3` | `#7FE3D3` / `#5ED0BF` | `#F2B45C` | `#F07A6E` |

Coverage tabs: golden card `#F6EBD3`/`#7A5617`, insurance `#E3ECF8`/`#1E4A85`, personal `#ECEBE8`/`#4A505A`.

## Components

| Component | Class / file | Notes |
|---|---|---|
| Folder card | `.folder` · `components/FolderCard.tsx` | coverage tab, staple, two sheets under it, big plate, «پرونده … · پذیرش …», place, days, one «قدم بعدی» |
| Desk | `.desk`, `.chips`, `.srch` · `components/DeskBoard.tsx` | greeting («صبح بخیر، …»), count waiting for me, filter chips with counts, search |
| Plate | `.plate.xl` · `components/Plate.tsx` | flag, letter, «ایران» and region; `size="xl"` on folders |
| Case folder | `.cf-sheet`, `.journey`, `.cf-tabs`, `.cf-next` · `components/CaseFolderHeader.tsx` | five-step journey, tabs «کار امروز · کارشناسی · قطعات · مدارک · تاریخچه», role-specific «قدم بعدی شما» |
| Technician | `.tc-*` · `app/(app)/workshop/technician/page.tsx` | month wage, one big changing button, «قطعه ندارم» |
| Repair path | `.plan-step` · `components/RepairPlanEditor.tsx` | ordered steps, «هم‌زمان با قبلی», total days |
| Buttons | `.m-btn`, `.m-btn2`, `.m-btn-s` | ≥ 44px; one primary per view |
| Login | `.lg-root`, `.f3d`, `.floor` · `app/login/page.tsx` | CSS 3D scene of floating folders, two doors |
| Control room | `.cr-*` · `components/ControlRoom.tsx` | dark space, isometric live workshop map (package 7) |

## Rules

- Persian digits, RTL with logical properties only (`inline-start/end`, `block-start/end`).
- 390px wide with no horizontal scroll; tap targets ≥ 44px.
- Motion only under `@media (prefers-reduced-motion: no-preference)`: card lift on hover, slow float of login folders.
- Icons only where meaning would be lost; no emoji.
- Search: Ctrl+K (or `/`) focuses the search bar of the shell; each desk has its own small search.

## Package 9 — the owner's approved visual direction

Five owner references (sign-in, expert desk, case folder, parts desk, control room) set the look; they are appearance concepts with synthetic data, so their incidental texts, numbers, role labels and stage sequences were **not** copied. Reference-versus-actual images and the screen set at 1440/768/390: [p9/](p9/) (`compare-*.jpg`), with a short interaction recording (`interaction-harness.mp4`).

| Area | Class / file | What it looks like |
|---|---|---|
| Shell | `.app-side`, `.app-top` · `components/Shell.tsx` | light sidebar «میز کار · اتاق کنترل · پرونده‌ها · قطعات · گزارش‌ها · تنظیمات» (by permission) and «ابزارهای بیشتر»; top bar with search (Ctrl+K), notifications, account; the whole shell turns dark petrol on the control room (`.shell-dark`) |
| Sign-in | `.lg-*` · `app/login/page.tsx` | warm ivory card on the right; on the left a dark workshop (the control-room drawing, blurred, `WorkshopBackdrop`) with the «پرونده خودرو» folder on a steel bench; wordmark and claim as real text |
| Desk | `.desk`, `.folder` · `DeskBoard.tsx`, `FolderCard.tsx` | paper sheet over a coverage-coloured flap and tab, metal clip, big plate, «باز کردن پرونده» |
| Case folder | `.cf`, `.cf-clip`, `.cf-cover-tab`, `.journey`, `.cf-tabs` · `CaseFolderHeader.tsx`, `CaseToday.tsx` | binder clip and coverage tab, five chevrons (place under «تعمیر»), folder tabs; «کار امروز» = next step + cost alert + repair-plan table + case history |
| Parts desk | `.pdesk-*`, `.ledger*` · `PartsDesk.tsx`, `PartsLedger.tsx` | car list, folder-sheet ledger (container query: table ≥ 700px, stacked rows below), stock card, «گام بعدی» |
| Control room | `.cr-*` · `ControlRoom.tsx`, `WorkshopScene.tsx` | KPI cards with coloured edges, stage trapezoids, live isometric workshop, cream folder tabs on dark sheets |
| Settings | `.settings-*` · `app/(app)/settings/page.tsx` | one card per settings area the account may open |
| Inline plate | `.plate-text` · `PlateText` in `Plate.tsx` | one line in the physical order of the plate, for tables, chips and reminders |

### The isometric workshop (`components/WorkshopScene.tsx`)

- Drawn on every refresh from `ControlRoomSnapshot.bays` (stations plus «انتظار قطعه»): oblique projection, x along the row of bays (right to left like the page), y from the back wall to the lane, z up. Six bays per row; more stations add rows.
- SVG for the building, lifts, light strips and cars (body colour from the case id, ring colour from the state: `#3FD6C2` on plan, `#F2B45C` behind, `#F0605D` stopped). No WebGL, no images; one blur filter for glow — cheap on ordinary phones.
- Every word is HTML laid over the drawing at projected positions (`cqi` font sizes). Each bay is a keyboard-focusable `role="button"` polygon with a spoken summary; choosing a bay lists its cars as links to their folders (`aria-live`).
- Phones: the drawing keeps a 560px minimum inside its own horizontal scroller (the page itself never scrolls sideways); the bay list below works without the drawing. Print: the drawing is replaced by a plain list of bays.
- Reduced motion: the stopped-ring pulse and skeleton shimmer only run under `prefers-reduced-motion: no-preference`.

### Contrast and states

Grey text on paper is at least `#656B75` (≥ 5:1 on `#FFFEFB`/`#FAF8F3`), journey and ledger meta `#575D66`. On the dark sheets muted text is `#8A93A3` (≥ 4.9:1) and figures use the tone ink (`#8BE9DA`, `#F6C77E`, `#F59B91`). The redesigned desks, parts desk and control room announce loading with `role="status"` (skeletons are `aria-hidden`), show an error with «تلاش دوباره», and write empty states as a sentence («هشدار بی‌پاسخی نیست…», «این جایگاه الان خالی است.»).
