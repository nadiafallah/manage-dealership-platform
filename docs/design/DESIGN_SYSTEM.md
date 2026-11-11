# Manage design system (package 6)

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
