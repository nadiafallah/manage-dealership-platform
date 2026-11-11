> **Superseded (package 6, 2026-11-10):** the Signature theme and the `?ui=classic` switch were removed. The current design system is [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md); this file is kept as history.

# HEDAX Signature Spatial System — design system

Source of truth: `apps/web/app/signature.css` (removed). Every rule is scoped to `html[data-ui="signature"]` inside `@media screen`.

## 1. Material ladder

| Layer | Token | Value | Used for |
| --- | --- | --- | --- |
| Ground (obsidian, matte) | `--sx-obsidian` → `--ground`, `--paper` | `#0a0c0f` + fixed warm/cool light field + 3.5% mineral grain | Page background (painted once on `body::before`, never animated) |
| Rail | `--navy` | `#07090c` with a warm top wash | Navigation rail, one layer above the workspace |
| Plate (graphite, satin) | `--surface` | `#14171c` + `--sx-plate` sheen | Panels, case sections, cards, KPIs |
| Raised plate | `--sx-graphite-2/3` | `#1a1e24` / `#222830` | Hover, selected tab, open inspector header |
| Machined edge | `--line`, `--sx-rim` | `#262c35`; inset 1px highlight + 1px occlusion | Every plate edge |
| Smoked glass | — | `rgba(20,23,28,.94)` + `backdrop-filter: blur(18px)` | Dialogs and the mobile top bar only |
| Anodised champagne | `--sx-champagne` `#d8bb7f`, `--sx-champagne-hi` `#ecd8aa`, `--sx-champagne-deep` `#8e7342` | Primary action key, active destination, focus ring, the two plinth motifs |
| Electric blue (restrained) | `--blue` `#7ea4ff`, `--blue-strong` `#a9c3ff` | Links and informational chips only |

The licence plate is a physical object. It stays white with black characters and gets a stamped edge.

## 2. Semantic colour (independent of decoration)

| Meaning | Text / mark | Tint background | Edge |
| --- | --- | --- | --- |
| Success | `--ok` `#63d19e` | `--ok-soft` `#10261d` | `#1f4a36` |
| Warning | `--warn` `#eab863` | `--warn-soft` `#2a2111` | `#56431d` |
| Critical | `--bad` `#f47e8f` | `--bad-soft` `#2e151a` | `#5a2731` |
| Information | `--blue-strong` | `--blue-soft` `#172036` | `#2c3d63` |
| Neutral | `#c3c6cc` | `--silver-2` `#1b1f26` | `#303744` |

All text and background pairs pass WCAG AA. The automated scan in `e2e/signature-evidence.spec.ts` checks every visible text node on 23 screens and the sign-in page, and found 0 failures.

## 3. Elevation

`--sx-z1` (resting plate) → `--sx-z2` (opened inspector, technician current job) → `--sx-z3` (hovered card, hero bands) → `--sx-z4` (dialog, sign-in card). Each level combines the rim, a short contact shadow and a long soft ambient shadow. Elevation is also expressed by luminance: higher surfaces are lighter.

## 4. Spatial behaviours

| Behaviour | Where | How |
| --- | --- | --- |
| Rail above workspace | Shell | Rail z-index, edge highlight, cast shadow toward the workspace |
| Lit keycap | Active navigation item | Champagne edge, warm wash, raised plate, glowing icon |
| Route settle | Every page | The page heading paints still; the following blocks settle 10px forward with a 1.5° tilt in 240 ms (transform only, never opacity) |
| Contextual inspector | Case sections | An opened section rises to z2 and its body unfolds (340 ms) |
| Depth-sensitive hover | Desk cards, action cards, stage rail, attention rows, KPIs, readouts | Lift by 2–3px; the key light follows the pointer (`--mx/--my`); desk cards tilt ≤2° |
| Separate layer | Dialogs | Enter from behind (`translateZ(-40px)`, 7°) over a blurred backdrop |
| Showroom plinth | Sign-in, dashboard dial | Concentric rings at `rotateX(72–74deg)`, pure CSS, decorative (`aria-hidden`) |

## 5. Motion tokens

`--sx-micro` 140 ms (buttons, rows), `--sx-route` 240 ms (route settle, hover lift), `--sx-panel` 340 ms (inspector, dialog). Easing is `--sx-ease` = `cubic-bezier(.2,.7,.2,1)`. One-time arrival moments: the sign-in light sweep (2.2 s), the plinth rings (1.4 s) and the dial (0.9 s). Nothing loops. After a page settles, 0 animations are running (measured). Under `prefers-reduced-motion: reduce`, all animation and transition is removed (measured: 0 animations).

## 6. Typography

Vazirmatn (SIL OFL, self-hosted). Body is 14px/1.7 at 400. Labels are 600. Headings and figures are 800. Large figures use `tabular-nums`. Persian text has no letter-spacing. The sign-in claim uses a warm metallic gradient fill; it is large display text and was checked by eye.

## 7. Icons

`components/AppIcon.tsx` ships two drawings per icon. The **Signature set** is built on a 24px grid with 1.6 stroke, straight runs, 45° chamfers instead of round corners, and mitred joins. People and settings use hexagonal and octagonal "nut" geometry, and vehicles are drawn front-on. The classic drawings remain for `?ui=classic`. Both are single-path SVGs with no icon font and no third-party set.

## 8. Component mapping

The redesign reuses the existing components; it adds no parallel component library.

| Concept (owner brief) | Existing component / class |
| --- | --- |
| AppShell, NavigationRail | `Shell.tsx`: `.shell`, `.sidebar`, `.nav` |
| WorkspaceHeader | `.page-context`, `.page-head`, `.entry-welcome`, `.workshop-heading` |
| SpatialSurface | `.panel`, `.case-section`, `.workspace-card`, `.kpi`, … (section 3 of `signature.css`) |
| MetricDisplay | `.pipeline`, `.kpi`, new `OperationsInstrument` |
| OperationalStatus | `.chip-*`, `.callout-*`, `.tone-*` |
| CaseTimeline | `.timeline`, `.responsibility-periods`, `.repair-route` |
| ContextInspector | `CaseSection` (`details.case-section[open]`) |
| DataTable | `.table` |
| ActionBar | `.page-actions`, `.technician-bar` |
| Modal | `Dialog.tsx` (`dialog.dialog`) |
| FormField | `.field`, `.input` |
| Notification | `.toast`, `NotificationBar`, `ReminderCards` |
| EmptyState, LoadingState | `EmptyState.tsx`, `.empty-state` |
| RoleWorkspace | `WorkspaceLauncher`, `/accidents/*` desks |

## 9. Rules for future screens

1. Use the semantic tokens (`--surface`, `--line`, `--ink`, `--ok`…), never hex values, and both themes follow automatically.
2. A new box gets a plate only if it is a box in the classic layout.
3. Gold appears at most once per region as a fill (the primary action).
4. Any new motion must be transform-only, at most 340 ms, and must not run on idle.
5. Run `SIGNATURE_EVIDENCE=1 … playwright test signature-evidence` and keep overflow and contrast failures at zero.
