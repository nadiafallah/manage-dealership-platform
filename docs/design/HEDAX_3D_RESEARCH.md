> **Superseded (package 6, 2026-11-10):** the Signature theme and the `?ui=classic` switch were removed. The current design system is [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md); this file is kept as history.

# HEDAX Signature — design research

Status: 2026-11-07, branch `feature/hedax-signature-3d-manage`. This file records what informed the design and what was deliberately rejected.

## Limitation, stated first

**No live web browsing was performed for this research.** The implementation session did not visit or capture Awwwards, CSS Design Awards, Codrops or any other site, so this document contains no screenshots, no claims about which projects currently win awards, and no description of specific pages that I could not verify. The material below is drawn from widely documented, long-standing public knowledge about these sources and about interface practice (W3C/WCAG, platform guidelines, browser rendering behaviour). URLs are the stable home or specification pages only.

Before the owner signs off on the visual direction, a short live review of current references is recommended. The **Next research step** section at the end lists what to check.

## Sources considered and what they teach

| Source | URL | What it is useful for | What we take | What we avoid |
| --- | --- | --- | --- | --- |
| Awwwards | https://www.awwwards.com | Curated visual and interaction craft, mostly marketing sites | Restraint in palette, one strong focal element per view, deliberate typography scale | Scroll-jacking, preloaders, cursor followers, full-screen WebGL: wrong for a daily work tool |
| CSS Design Awards | https://www.cssdesignawards.com | Similar curation, more UI and UX categories | Material contrast (matte vs. lit), micro-interaction timing | Decorative motion that delays content |
| Codrops | https://tympanus.net/codrops/ | Open tutorials on CSS and WebGL effects, with code | Techniques: perspective layers, pointer-position lighting with CSS custom properties, clip and mask reveals | Copying demo code or visual identity; heavy shader effects |
| Automotive configurators (manufacturer sites) | — | Showroom staging of a physical product | The "plinth" idea: an object presented on a lit platform; dark studio ground with a warm key light | Real car models or renders (licensing, weight, and Manage is not a sales site) |
| Premium instrument clusters and industrial HMI | — | Dense information that must stay legible under pressure | A dial for one headline ratio, tabular numerals, status colours that never depend on decoration | Skeuomorphic chrome, glare, low-contrast "luxury" grey-on-grey |
| Enterprise SaaS with dark themes | — | Long-session readability | Raised surfaces are lighter than the ground (elevation by luminance, not only by shadow); borders stay visible | Pure black (#000) grounds and pure-white text, which cause halation |
| WCAG 2.2 | https://www.w3.org/TR/WCAG22/ | Contrast, focus visibility, motion | 4.5:1 text, visible focus, `prefers-reduced-motion` honoured | — |
| web.dev / Core Web Vitals | https://web.dev/articles/vitals | Loading and stability metrics | Measure LCP/CLS before and after; never hold the largest paint behind an animation (this finding changed our motion, see QA) | — |

## Findings turned into rules

1. **Depth must carry meaning.** The navigation rail sits one layer above the workspace. An opened case section rises one layer. Dialogs are a separate layer. Everything else stays flat. Tables and forms stay flat so they remain fast and printable.
2. **Light, not glow.** There is one warm key light (champagne, top-start) and one cool fill (blue, bottom-end). Gold is reserved for the primary action, the active destination and focus. Red, amber and green keep their meaning on their own.
3. **Material contrast instead of uniform gloss.** Matte obsidian ground, satin graphite plates, machined 1px edge highlights, smoked glass only for overlays (dialog, mobile top bar). No component is glossy everywhere.
4. **Motion confirms, it never waits.** Routine changes take 140–240 ms. Panels take about 340 ms. Arrival moments (sign-in sweep, dial) run once. Nothing loops. Nothing blocks input. Everything stops under reduced motion.
5. **Originality through a motif, not ornament.** The HEDAX motif is the *showroom plinth*: concentric machined rings laid back in perspective. It appears in exactly two places (sign-in, dashboard dial) and nowhere else.
6. **Persian-first type.** Vazirmatn (OFL, self-hosted, already in the project) is kept. The weight ladder is 400 body, 600 labels, 800 headings and figures. Numbers are tabular. There is no letter-spacing on Persian text.

## Rejected directions

- A navigable 3D workshop or repair-bay scene, which the owner explicitly rejected.
- A full WebGL application shell, or Three.js for decoration. It would add roughly 150 KB+ of JavaScript and GPU load on dealership PCs with no operational benefit. It stays open as a future option for one isolated, lazy-loaded visual.
- Glassmorphism on every card. Backdrop blur is reserved for two overlays because of its GPU cost.
- Bento grids of identical KPI tiles. The dashboard keeps its information architecture and gains one hierarchical hero.

## Next research step (recommended before release)

A 60-minute live review with the owner. Collect 5–8 current references, each with a URL and date: two automotive brand sites, two dark enterprise tools, two award-listed sites with restrained motion. Record what to emulate and what to avoid for each, and compare against `docs/design/hedax-signature/after/`.
