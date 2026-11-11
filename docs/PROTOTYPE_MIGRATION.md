# Legacy prototype and gradual migration

## Evidence (2026-11-01)

`legacy/index (4).html` (moved from the repository root on 2026-11-10; content unchanged) on the current platform branch has the same Git blob as `main`: `5c622860cefde56d7311f00cf6c8c9f7a10ac037`. It is the original single-file dashboard, kept alongside the platform. The deployed stack builds `apps/web` (Next.js/TypeScript) and `apps/api` (NestJS/TypeScript); neither serves that root HTML file. `deploy/preview/gate.html` is a separate, intentional lightweight login gate, not the dealership UI.

The prototype is also an actively used local tool: `feature/b2b-auto-report` adds its own companion, report imports, browser storage and tests; PR #1 adds appointments and PR #3 proposes a filename change. Those features and IndexedDB records are not automatically part of the new accident-repair platform. Preserve these branches and their launch paths until the owner decides their future.

## Migration gates

1. Inventory each prototype report, calculation, import format, export and persistence key. Build synthetic golden fixtures for missing/zero values, leading-zero identifiers, overlapping reports and Jalali boundaries. Reuse tests as specifications, not wholesale HTML conversion.
2. Choose one module (for example appointments). Define shared TypeScript contracts and tenant/permission rules; port its pure parsing/calculation logic behind tests. Keep official B2B integration read-only and subject to separately authorized login.
3. Add a Next.js route using existing Persian RTL components, server validation and audited mutations. Compare the old and new calculations on the same synthetic fixtures; test desktop/mobile, invalid imports, duplicates and refresh persistence.
4. Design an explicit preview/export/import bridge for local IndexedDB data. Do not read or migrate real dealership data without owner authorization. Keep the source data intact and provide rollback/export before a pilot.
5. Pilot with acceptance criteria and record test evidence. Retire a prototype feature only after owner approval; renaming/removing the HTML and closing old PRs are separate decisions.

No app migration is needed merely to replace the file extension: the active platform is already TypeScript. Feature parity for prototype analytics and the B2B companion remains future work.
