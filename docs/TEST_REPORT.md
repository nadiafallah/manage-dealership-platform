# Test report

## Phase 3 role-based plan (reminders, wages, responsibility, owner controls) — 2026-11-06 — local suite green, **GitHub Actions CI pending**

Base `feature/phase2-parts` (`a1cd8c6`), branch `feature/phase3-people` (app commit `c38467d`). Synthetic data only. [PR #54](https://github.com/ali-hedax/manage-dealership-platform/pull/54). Under AGENTS rule 5 this phase is **not done** until the six GitHub Actions checks have run on the PR and their numbers are recorded here; this entry records the full local run that preceded that push (macOS, Node 26.7, pnpm 10.34.6 — CI targets Node 22 on Ubuntu).

- `pnpm install --frozen-lockfile`, `pnpm build:shared`, `pnpm -r lint`, `pnpm typecheck`, `pnpm build` (shared + API/Nest + web/Next production build): **all pass**, no errors or warnings.
- **API (Jest, one process per file, embedded PGlite unless noted): 184 passed, 0 failed** across 22 suites:
  - `people.e2e-spec.ts` **14/14** — reminders (one person, several people, a role; sender never a recipient; 300-character limit; seen → reply → done visible to the sender; only the recipient answers); unseen nudge at exactly two working hours with the lunch break skipped, not before, once only, not for a seen reminder; technician problem reaches the case's accident responsible only (another technician 403, no cross-tenant delivery, 422 `INVALID_RECIPIENT`); wages (required reason and history, equal share of the trade's assessment labour, counted only after approval and removed on reopen, totals per coverage, «تغییر کرد» after a seen change, technician 403 on all wage endpoints and payloads strip assessment/other-wage amounts, manager Excel report, support 403 by default); responsibility periods close/open on transfer (`SAME_RESPONSIBLE`, `INVALID_RESPONSIBLE`, 403 without `case.update`, pre-phase-3 case gets a computed `initial` period); owner grant/remove of «دعوت و غیرفعال کردن کارکنان» (403/200/409/422 cases, support corrections need a reason, owner-only report of support actions).
  - `technician-pin.e2e-spec.ts` **5/5** (updated): system administrator PIN reset/deactivation now require a reason — asserts `SUPPORT_REASON_REQUIRED` without one, success with one.
  - `access` 5, `accident` 30, `assessment-dispatch` 3, `assessment` 9, `daily-reports-large` 1, `daily-reports` 24, `demo-seed` 1, `discrepancies` 3, `iran-holidays` 3, `parts-finance` 12, `parts-workbench` 4, `personal-auth` 5, `qc-delivery` 4, `reference-data` 9, `reports` 10, `staff-invitations` 7, `staff-recovery` 7, `system-admin-access` 3, `vehicle-import` 6, `workshop` 10 — all green, no regressions from this phase's changes.
  - **Real PostgreSQL 17.11 (Homebrew, local), not just PGlite:** `daily-reports-postgres.e2e-spec.ts` **5/5** and `workshop-postgres.e2e-spec.ts` **4/4** (the two suites CI runs against its own `postgres:16-alpine` service), each against a fresh database with migrations auto-applied on boot (`APP_ENV=test`).
- **Shared unit tests (`node --test`): 21/21 passed** (Jalali, digits, plates, phones, RBAC, schemas, calendar, supply-code matching).
- **Playwright, main suite (`playwright test`, desktop 1366×860 + Pixel 7 mobile): 42 passed, 4 skipped by design** (optional screenshot regeneration tests). Includes `e2e/people.spec.ts` **2/2**: reminder from the case page, technician card at 390 px («دیدم», «انجام شد», own wage, «مشکل دارم», start/finish, no horizontal scroll), not counted in monthly work before approval, transfer with the responsibility bar, approved wage in «کارکرد من»; manager reminder from a report row (source `manager_report`, never to the manager) and the wage report page at 390 px.
- **Playwright, daily/owner suite (`playwright test -c playwright.daily.config.ts`): 4/4**, including `e2e/system-admin.spec.ts` (owner suite) — owner-configured support desk, and the owner switch for the system administrator with its effect on `/staff/technicians`.
  - First run found a real bug: at 390 px, `owner-admin.spec.ts`'s second test failed `document.documentElement.scrollWidth <= innerWidth` once the admin-actions table had rows. Cause: `.owner-admin-report` is a CSS Grid item (`.owner-admin { display:grid }`) with the default `min-width: auto`, so a table row with an unbroken action code (e.g. `daily_report.uploaded`) forced the grid track — and the whole page — wider than the viewport, even though the inner `.table-scroll` already had `overflow-x:auto`. Fixed with one rule, matching this codebase's existing pattern for the same bug elsewhere (`min-inline-size:0`, e.g. `.workshop-page fieldset`, `.permission-grid fieldset`): added `.owner-admin-report { min-inline-size:0; }` in [apps/web/app/globals.css](../apps/web/app/globals.css). Rebuilt and reran both Playwright suites after the fix: no regressions, the owner suite is now 4/4.
- **Documentation check:** `node scripts/check-docs.mjs` passed — 51 Markdown files, 164 API routes.
- **Screenshots generated** (previously missing) with `SCREENSHOTS=1 pnpm --filter @manage/web exec playwright test phase3-screenshots --project=desktop`: 10 PNGs (5 scenes × desktop 1440×900 / mobile 390×844) in `docs/screenshots/phase3/` — reminders, responsibility bar, technician card, my-work, owner controls. Visually reviewed: synthetic data only (`نمونه` accounts, `TESTVIN…` chassis numbers), no horizontal overflow at 390 px in any of them.
- **Not run:** DAST scan (no Docker daemon or scanner key locally; CI's `security` job covers it). The six GitHub Actions checks themselves — numbers will be added here once they complete on the PR, and any real failure will be fixed and the suite rerun.

## Phase 2 role-based parts workflow — 2026-11-06

Base `436575f`, branch `feature/phase2-parts`. Synthetic data only.

- Shared suite 21/21. The focused API regression run completed 62 tests, including four phase-2 scenarios covering exact stock commitments, assigned technician pickup, Emdad and market, priced handover, versioned Persian PDF/Excel, and external planning/late alerts. Nine PostgreSQL-only cases are reserved for the CI PostgreSQL job.
- The browser parts workbench test passed, including the old-queue disclosure and 390px viewport check. [Desktop 1440 × 900](screenshots/phase2/parts-workbench-desktop.webp) · [Mobile 390 × 844](screenshots/phase2/parts-workbench-mobile.webp).
- Existing QC/discrepancy fixtures provide an explicit synthetic sale price because handover now requires one. The technician readiness test checks the assigned pickup payload. The daily-report reminder assertion reflects the parts role's new upload access, and its browser fixture opens the relocated old queues.
- Build, lint, typecheck and documentation checks ran locally. Full-suite results and the GitHub Actions checks are tracked on the PR.

## Phase 1 of the role-based plan — 2026-11-05 — branch `feature/phase1-roles`, not deployed

Local Linux (Node 22, pnpm 10): docs check (129 API routes), shared build, lint and typecheck for shared/API/web pass. API test files run one per process: **200 passed, 0 failed**; 9 PostgreSQL-only tests skipped locally and covered by the CI PostgreSQL job.

- New `technician-pin.e2e-spec.ts` 5/5: technician created by user.manage signs in with username + PIN and gets only `task.execute`; wrong PINs → 401, fifth → 423 and stays locked; non-technician accounts never get a PIN session; PIN reset ends old sessions; deactivation blocks sign-in; works in personal (Authenticator) mode and a later role change invalidates the PIN session.
- `parts-finance.e2e-spec.ts` 12/12: purchases proceed and record `advance_missing` / `re_approval_required`; free pricing for personal cases; golden card needs payer approval only above the approved price; advance and parts-amount alerts listed, answered once, kept in history; threshold editable only with settings.manage.
- `workshop.e2e-spec.ts` 10/10: technician task shows parts waiting, then ready to collect after receipt.
- Browser: web typecheck passes; the technician tab of the login page is built on `feature/new-look` against `POST /api/v1/auth/technician-login`. Full Playwright: CI on the PR.
- Not tested: production images behind Arvan (not deployed).

## Navy and gold interface — 2026-11-05

Branch `feature/new-look`, base `6ae461f`, application `921e22f`.

- Local frozen install with pnpm 10.34.6, shared build, all workspace lint/typecheck, production build, and the documentation/API inventory check passed.
- Targeted Playwright checks passed at 1440×900 and 390×844 using the built web app and the synthetic PGlite API. Verified staff email/Authenticator presentation and actual seeded username sign-in, tab selection with keyboard and direct link, PIN focus/backspace/mixed-digit paste and ASCII payload, missing endpoint (real HTTP 404), simulated 401/423/405/network responses and simulated success navigation, mobile menu and no horizontal overflow on the captured routes.
- Reviewed 11 PNG screenshots for both login tabs, workspace selection, dashboard, case list, and the open mobile menu. Screenshots use synthetic data.
- Local browser tests ran on the Chromium 153 headless shell after the Playwright Chromium download returned an invalid archive. The shell restricts network interface enumeration, so the local harness skips that startup-only lookup. Repository CI uses its standard Node 22 and Playwright installation.
- The main Playwright suite passed 39 tests. Two optional screenshot regeneration tests were skipped by default. The daily-report and support suite passed all 3 tests.
- Live technician session issuance remains an integration check for `feature/phase1-roles`. All checks in this report section ran on the local synthetic stack.

## Integration into main — 2026-11-05 — passed, not yet deployed

PR #49 (`release/integrate-20261105`, head `e0f9e99`): published release `79f6585` + staff access recovery (#47). Conflicts only in CHANGELOG, PROGRESS and this report.

- CI on `e0f9e99`: all six checks passed (documentation/API inventory, lint/typecheck/build/unit+integration, PostgreSQL 16 migrations and seed, Playwright, Docker images and compose smoke test, dependency audit and secret scan). Merged as `1be462f`.
- Local Linux (Node 22, pnpm 10): docs check, shared build, lint and typecheck pass; shared 21/21. API test files run one per process because the single-process run exceeded 8 GB here: **192 passed, 0 failed**, 9 PostgreSQL-only tests skipped locally (covered by the CI PostgreSQL job). Includes `staff-recovery.e2e-spec.ts` 7/7.
- Not tested: staff recovery on the production images behind Arvan (deployment pending).

## Assessment dispatch and repair-day release — 2026-11-05 — passed and published

Application/test `79f6585`: [all six CI checks](https://github.com/ali-hedax/manage-dealership-platform/actions/runs/42016899492) passed: shared 21/21, API 188 plus 9 separate PostgreSQL tests, browser 35 passed/2 optional image skips and daily/support 3/3. Final local daily/support 3/3 after replacing a disclosure-enumeration race with a wait for rendered controls. [Release evidence](RELEASE_DISPATCH_DAYS_20261105.md) records exact images/source, restored-copy migration, original-row preservation, final backup restore and read-only live UI checks. Numeric day input and selection/dispatch controls verified in the owner session without submitting production operations. All original dates, users, official decisions and access preserved; only nullable repair_plan added. Published with the owner's continuing authorization, no main merge.

## Assessment dispatch and working-day repair plans — 2026-11-05 — in validation

Working branch `feature/assessment-parts-dispatch`, incorporating the current entry-workbench branch through 475a897 and preserving the production source f2a3758/domain configuration. Owner clarified that recording initial/supplement assessments and sending needs require no generic authorization; only outside-market buying needs recorded price coordination. Added single/all selection, current-version/tenant/transaction checks, exact-code/root matching, incremental quantities and explicit review for reductions/code changes. Complete supplement imports reconcile rather than duplicate existing lines; historical versions remain intact. Company supply is not blocked by a generic assessment or price-increase gate; outside-market quote approval and existing payment controls remain enforced.

Added a nullable repair-plan calendar snapshot (migration 0015, no backfill) for numeric working-day case intake and numeric station shares. Dates compute server-side, dependency successors start after planned predecessors, parallel intervals count once in the case budget; original task baselines and prior cases' dates stay preserved. One day uses the longest configured shift-day; Thursday consumes its actual shorter hours. Manual official dates remain in an optional disclosure.

Completed: related API assessment/parts/workshop/new flows 31/31; shared 21/21; shared/API/web builds and lint passed. Browser regression 35 passed / 2 optional image checks skipped, daily/support 3/3. CI exposed an obsolete synthetic demo expectation for generic approval; updated to the new stages and zero pending market quotes, targeted demo test 1/1 passed. Latest merged interface state is being rebuilt and browser-tested; not published. Exact-code/manual supply versus outside-market gate, calendar half-day/holiday examples, frozen snapshot and overlap assertions are included. Add final results, PR/CI and any release evidence before calling complete.
## Platform states and search — 2026-11-05 — branch `feature/ui-states`

Local Linux, built API + web: web typecheck and build pass. Full Playwright desktop + mobile **34 passed, 2 skipped**. First run exposed a duplicate accessible name between the new sidebar search and the case-list search; the sidebar field was renamed «جست‌وجوی سریع از هر صفحه» and the full suite rerun green. After the dashboard and stage-based case sections were added, the full suite was run again: **34 passed, 2 skipped**. Full CI pending on the PR.

## Staff access recovery — 2026-11-05 — not deployed

Branch `feature/staff-access-recovery`. No migration: `auth_challenges.purpose` is free text, and the new values are `recover` and `recover_enroll`.

- `apps/api/test/staff-recovery.e2e-spec.ts` 7/7 locally on PGlite: only the actual owner can issue; owner account, inactive and other-tenant targets refused; password and Authenticator replaced; old sessions, old password and old code refused; link single use; wrong code leaves old credentials working; expired, replaced, deactivated and forged links refused; owner protected if ownership moves mid-way; login and recovery challenges not interchangeable; audit rows present and free of the secret; response not stored by idempotency.
- Existing `personal-auth.e2e-spec.ts` still passes. API and web typecheck pass; API lint passes.
- Browser tests added to `personal-auth.spec.ts` and the full suite: see CI on the PR. They mock the API.
- **Not tested:** the flow on the production images behind Arvan, because it is not deployed.

## Interface polish — 2026-11-05 — branch `feature/ui-polish`

Local Linux, built API + web (PGlite synthetic seed): web typecheck and build pass. Full Playwright desktop + mobile **34 passed, 2 skipped (optional screenshots)**; the one initial failure (discrepancy queue filtered by the Latin case number) was updated to the Persian-digit case number and passed on rerun. Full CI pending on the PR.

## Login page refresh — 2026-11-05 — branch `feature/login-redesign`

Local, Linux, built web + API (PGlite synthetic seed): `pnpm --filter @manage/web typecheck` and `build` pass. Browser `entry-refresh`, `pwa`, `personal-auth` (desktop project) **10/10** passed, including Authenticator login, install guide keyboard/iPhone flows and phone-width overflow. Visual check at 1440×900 and 390×844 in username mode and in personal mode (auth options mocked to TOTP); password toggle switches the field type; no horizontal overflow. Full CI not yet run on this branch.

## ArvanCloud proxy, client address and sign-in — 2026-11-05

Client address, live through Arvan from a workstation at a known public address (`ad54f15`):

- API received the real address in all three cases: normal request, forged `X-Forwarded-For` through Arvan, forged header sent directly to the VM. Arvan's peer `94.101.183.7` is inside the trusted list.
- Login limit: same client 400 ×10 then 429 ×2; forged header stays 429; a different client still gets 400. Requests had an empty body, so nothing was written.
- Real activity: the first real sign-in recorded after the change has a non-Arvan address; no audit or session row since the change has an Arvan address.
- `X-Forwarded-Proto: https` arrives from Arvan (read from a temporary access log, removed immediately). The app decides nothing from the protocol: `COOKIE_SECURE=true` and `PUBLIC_APP_URL` are explicit.

Redirects: `http://www` goes to `https://www`, then the apex, then `/login`. It never lands on HTTP, but Arvan issues the first hop before reaching the VM, so it is **not a direct redirect**. The VM itself answers `http` + `www` with 301 to the apex.

Sign-in, Edge 21/21 on an **isolated copy**, not production: same api/web image IDs, same Caddyfile and certificate, real domain name mapped through an SSH tunnel, RAM database, synthetic owner, internal network, removed afterwards. Invitation link, password, enrollment, wrong password, replayed code, wrong code, sign-in with a fresh code, Secure + HttpOnly + SameSite=Lax + host-only cookie, verified session, sign-out, old cookie refused by the server. It does not cross the Arvan hop. Two earlier runs were discarded because of test-script faults: one sent requests to the real address with a synthetic cookie; they returned 401/204 and wrote nothing.

Forgot password: the login link opens a page telling the person to contact the administrator. **Self-service recovery does not exist.**

PWA, Edge 12/12 through Arvan on the real address: manifest parsed, icons served, no installability errors, phone guide opens, no horizontal scroll. There is no service worker, by design. **Not tested:** the install itself on a real phone.

**Not tested by this agent:** sign-in with a real account, which needs that person's Authenticator. CI: see the PR.

## Production domain switch — 2026-11-05 — live

Live from the workstation after `--dns-finish` and `switch-to-domain.sh` (`ad54f15`, same api/web/gate images by ID; no build, no migration):

- `curl -I`: `http://managebyhedax.ir` 301, `https://www.managebyhedax.ir` 301, `http://85.198.52.255` 301, all to `https://managebyhedax.ir/`.
- `curl -I https://managebyhedax.ir`: **302 to `/login`** for an anonymous client, by design; `/login` 200 with certificate verification OK. The 200 in the original request is reached only after that redirect.
- Former name over HTTP and HTTPS: 301 keeping path and query. Raw IP over HTTPS: handshake failed until `default_sni` was added, then 301; its certificate is self-signed, so browsers warn first. POST with client header and empty body 400, confirming the proxy chain. Manifest 200, `/api/v1/auth/me` 401, POST without client header 403.
- Certificate: Let's Encrypt YE1, both names, valid until 2027-02-03 08:08:19 UTC. DNS-01 issuance worked first time.
- Brand grep of this branch and of the running web, api and gate containers: no "Managed by HEDAX" or "Manage Preview" in any served file. Live title and manifest name: "Manage by HEDAX". "Manage Preview" remains only in script comments and historical docs. Database dump: no old address.
- **Not tested:** a real sign-in, because it needs the owner's Authenticator. CI not run: local commits only.

## Production domain preparation — 2026-11-05 — before the switch

Environment: production VM, read-only checks plus a transitional Caddy config; final config tested in a throwaway container with no published ports and a temporary self-signed certificate.

- Final config: `http` apex, `www`, raw IP and old name 301 to `https://managebyhedax.ir` with path and query kept; `https` www 301; `https` apex `/` 302 to `/login`, `/login` 200, manifest 200.
- Let's Encrypt staging over HTTP-01: **failed twice**, "Timeout during connect". Foreign TCP probes of 443 fail on all seven foreign nodes and succeed from Iran; a 70-second capture on eth0 during validation showed one external SYN to port 80, not the retries of a reachable validator. Port 80 from foreign nodes was not measured separately because that probe request timed out.
- DNS: foreign nodes resolve the domain to the VM; no CAA record. DNS-01 issuance, the certificate install step and `switch-to-domain.sh` past its certificate check are **not yet run**.
- `switch-to-domain.sh` on the VM with no certificate: exit 1 before any change; `.env` and the Caddyfile checksums unchanged.
- `node --test deploy/preview/gate.test.mjs`: 2/2. `node scripts/check-docs.mjs`: pass. shellcheck not available locally; CI does not cover the new script yet. CI not run: this branch is a local commit.

## Published entry/workbench — 2026-11-05

Application/test `ad54f15`; all six [CI 41974333191](https://github.com/ali-hedax/manage-dealership-platform/actions/runs/41974333191) pass: shared 17, API 185 plus nine PG-only tests separately, browser 34 with two optional screenshot skips, daily/support/reservation 3. Final local entry/Auth/ICS 6/6, workshop/holiday API 12/12, daily 3/3; build/lint pass. Older trials below are history, not the final gate. [Release evidence](RELEASE_ENTRY_20261105.md).

Live read-only review: all 17 existing cases and 30 menu destinations loaded. Published list filters folded; seven owner desk choices, repeated sidebar desk list removed; six per-part stock controls and no duplicate selector rows in a six-part case, reserve action reachable without creating a reservation. Google source timeout and local-file fallback confirmed in production settings. No business, calendar or permission mutation used as a test. Direct Google server refresh remains unverified/unavailable; local file path and same parser passed synthetic browser/API checks.

Exact CI source/tree/ZIP/image IDs verified. Restored-copy new-image probes and every table/migration fingerprint equal; frozen source switch preserves all rows, sessions, auth, 44 effective system-admin permissions and `.env`. No new migration/seed. Forty-second switch, healthy API/web/db/gate. Final backup 20261105T054714Z restored with equal fingerprints; exact scratch DBs removed; off-server DPAPI archive decrypted/checksummed and local plaintext removed. No Source/main/DNS/email change.

## Entry and operational workbench — 2026-11-05 — validation in progress

Branch `feature/entry-workbench-refresh`, based on the published 696eb6f chain. Initial targeted browser run 9/9; final daily report/reservation/support run 3/3; API workshop/holiday tests 12/12. Shared/API/web builds and lint passed before the ICS fallback addition; final build and lint repeated afterwards. Actual public Google Iran feed parsed as 56 holidays (25 tentative) for 2026–2027. Local Windows fetch HTTP 200; dedicated production host/container timed out against Google; no network changes. Direct server refresh is not claimed working on production. Local-file fallback and final complete browser run still require final validation.

The first daily attempt reached the completed reservation workflow, then failed because a history assertion still used the moved part selector; corrected to the actual history region, final 3/3. A full-browser attempt exposed the report test's old direct-desk assumption and was then invalidated by an overlapping build; it is not release evidence. Run the final built app serially, record results and require every CI job before publication. Live read-only review loaded all 17 existing cases with nine sections each; no business mutations.

## Short vehicle labels — 2026-11-05 — published, 696eb6f

All six [CI 41969252059](https://github.com/ali-hedax/manage-dealership-platform/actions/runs/41969252059) jobs passed: API 181 passed / 9 PostgreSQL-only skips covered separately on PostgreSQL; shared 17/17, full browser, security, docs and Docker/HTTPS. API typecheck/lint and shared/API/web builds passed locally; related browser **3/3** passed. The long-trim scenario verifies preserved source trim, a concise model label, and no engine/gearbox annotations in the list even when those were entered in model.

Exact CI artifact ZIP digest, source tree and running image IDs matched. Restored-copy read-only model-summary check passed with unchanged table fingerprints. Production switch preserved every table, session/user and byte-identical environment; no migration or seed. Live owner UI: 17 rows, owner below model, no engine/gearbox words, max model-label length 28. Final operational/20261105T044951Z backup restored with matching fingerprints; encrypted off-server recovery decrypted/checksummed in memory and local plaintext removed; three temporary DBs removed. [Release record](RELEASE_SHORT_LABEL_20261105.md).

## Published assessment intake and compact workbench — 2026-11-04, d0a66b2

Owner-approved publication completed using the exact CI 41849047449 images. GitHub artifact ZIP digest, inner archive SHA256, source tree and running image IDs matched. Restored-copy new-image read-only probes passed (exact vehicle lookup, relevant Emdad, assessment reads and a synthetic in-memory parser row); all table/migration fingerprints remained identical. No production migration or seed. All data, users, sessions and byte-identical environment matched through installation; 15 migrations retained, TOTP and effective support access 44 preserved. Health and public/private HTTP boundaries passed. [Release evidence](RELEASE_ASSESSMENT_20261104.md).

Live owner UI verified the compact desk, disclosures, related Emdad and repeat-admission lookup. No real assessment was created or sample uploaded; full upload/apply remains validated by the synthetic browser/API tests below, not claimed exercised on real records. Final backup operational/20261104T151335Z restored with matching full fingerprints; scratch DBs removed and off-server CurrentUser DPAPI recovery decrypted/checksummed in memory. Temporary local download chunks removed, test processes closed. Actual OS phone installation, LAN/offline, Push, SMTP and domain work remain outside this release.

## Assessment intake and compact workbench — 2026-11-04 — candidate, not deployed

**Final candidate `d0a66b2`: all six [CI 41849047449](https://github.com/ali-hedax/manage-dealership-platform/actions/runs/41849047449) jobs passed**, including API **181 passed / 9 PostgreSQL-only skips** in the main job and those **9/9** passing separately on real PostgreSQL; shared **17/17**; main browser **30 passed / 2 optional screenshot skips**, daily/support browser **3/3**; lint/types/build, documentation/security and Docker/HTTPS. [PR #39](https://github.com/ali-hedax/manage-dealership-platform/pull/39). No migration, new dependency or production change.

Serial local browser validation covered all 30 main scenarios (29 in the broad run, the adjusted vehicle-provenance scenario rerun **1/1**) plus daily/support **3/3**. Captures at 1366px and 390px were visually reviewed. Test listeners on 3400/3410/4400/4410 were closed after completion. No personal files, user browser session or unrelated service was removed. Application publication still requires explicit owner approval; the following notes preserve intermediate findings.

Targeted API/parser suites: **40 passed**. Covers sparse/reordered/repeated headers, separate priced labour, explicit currency, correction/rejected/equivalent rows, validation and duplicate detection, exact Emdad technical-code relevance including differing full options, read-only preview, permission denial, version conflicts and atomic audited apply. The owner workbook was inspected locally read-only: **3 valid part rows, 0 errors, 41 review/skipped notices** (including the equivalent-section notice); no customer records were copied into fixtures, tests or production.

Shared **17/17**, lint, web types and API/web builds passed locally. The new compact-case browser scenario passed with desktop/390px synthetic captures, assessment upload/preview/apply, safe profile prefill, same-fragment reopening and print-state restoration. Legacy scenarios initially assumed every section was expanded; their navigation now explicitly opens the required section. Running full API and two browser stacks simultaneously exhausted local memory (browser resource crashes and PGlite migration allocation failures); those runs were stopped and browser suites rerun serially. CI 41839362223 caught a test-fixture spread of an unknown JSON field during API typecheck; its explicit object type was corrected. Final successful evidence is recorded above.

## Released PWA and complete support desk — 2026-11-04, 9e82246

All six [CI 41783453350](https://github.com/ali-hedax/manage-dealership-platform/actions/runs/41783453350) jobs passed on the published application: API **171 passed / 9 PostgreSQL-only skips** in the main job, with real PostgreSQL migration/concurrency passing separately; main browser **29 passed / 2 optional screenshot skips**, daily/support browser **3/3**; shared/lint/types/build, docs/security and Docker/HTTPS passed. The docs-only `01c0e58` also passed all six CI 41784219492 jobs. Exact CI source tree, archive SHA256 and running image IDs matched; [release evidence](RELEASE_PWA_20261104.md).

Production verification passed: restored-copy migration probe without changing existing data, all existing operational/account fingerprints equal through installation, byte-identical environment, Production/PostgreSQL health, valid owner session and role-aware launch, grouped support desk/case queue, public HTTPS manifest, protected anonymous API and working install help/icon. No production migration or seed, real-case mutation, sample upload or native OS installation was performed for testing. A new existing personal denial of user.manage was preserved: template 45, effective support access 44, non-owner unchanged.

Final backup operational/20261104T062953Z restored with matching operational/account fingerprints, scratch databases removed; off-server recovery encrypted/decrypted/checksummed with CurrentUser DPAPI and local plaintext removed. Actual Android/iPhone/Safari installation, LAN/offline and Push remain unverified/unimplemented as applicable. Later pre-release entries document history, not current deployment status.

## Online mobile installation — 2026-11-04 — not deployed

**Final application CI:** all six jobs passed for release candidate `9e822467d20fe03cb8f6c078958f0c13165d1a0f` in [CI 41783453350](https://github.com/ali-hedax/manage-dealership-platform/actions/runs/41783453350): API/shared/lint/types/build, security, documentation, real PostgreSQL migration/concurrency, full browser and Docker/HTTPS. [PR #38](https://github.com/ali-hedax/manage-dealership-platform/pull/38) contains the PWA above the tested support-desk prerequisite. The subsequent record changes documentation only; production publication still requires explicit owner approval. Live access configuration is already applied separately.

Edge PWA browser **4/4** passed: manifest linkage/MIME, real PNG dimensions and Apple icon; help at 390px, keyboard Escape/focus return, prompt dismissal/acceptance and installed-event state; manual iPhone instructions and standalone display; role-aware technician/manager launch, network-loss warning and rejected technician action without success text. Native install events and iPhone flags were simulated on Edge; native OS installation and real Safari/phones are not claimed verified. No service worker is registered.

Workshop/mobile regressions **3/3** passed; web typecheck/build passed. Gate **2/2** passed, including public branding/manifest, denial of `/manifest.webmanifest/private`, protected launch/private API and retained TOTP/session rules. No new API/database behavior, dependencies or migrations. Final CI and owner-approved publication remain required. [Guide](PWA_FA.md).

Support prerequisite `db5ce5b` passed all six [CI 41782198650](https://github.com/ali-hedax/manage-dealership-platform/actions/runs/41782198650) jobs, including API, PostgreSQL, browser and Docker/HTTPS. The support UI remains unpublished at this record; its real 45-permission template is already active.

## System support workbench — 2026-11-04 — UI not yet deployed

Focused API **3/3** passed: a non-owner with the owner-configured full permission template can use operational endpoints and reminder settings; access catalog/template/user edits and owner stock definitions still return 403; the daily scheduler sends both pending report reminders to support at 11:00 Tehran and does not duplicate them. The initial fixture used an invalid currency token, then was corrected to IRR to test the owner boundary with valid input.

Real Edge browser **1/1** passed using a synthetic owner to configure the admin template, then a genuine non-owner admin session: grouped desk actions, searchable case queue, report freshness, 390px layout, actual XLSX preview upload, and owner controls hidden/blocked. It also verifies access to the coordinator desk and denial of the owner desk. Workspace regressions **2/2** passed. Web typecheck/build passed. Earlier browser fixture issues (ambiguous text locator and Uint8Array instead of Buffer) were corrected; the final run passed. CI is required after commit.

Production configuration only: the owner explicitly requested the existing support template be expanded from 32 to all 45 operational permissions. Saved from the owner's UI; ownership, passwords and TOTP were not changed. Both reminder profiles were already 11:00/all uploaders and were verified without modification. Backup operational/20261104T055024Z restored with matching fingerprints; scratch DB removed and encrypted off-server recovery verified. No real report file, case task, purchase or payment was submitted. Updated desk code has not been published at this record.

## Released accident workflow redesign — 2026-11-04, 880b121

All six final-head checks passed in [CI 41649871911](https://github.com/ali-hedax/manage-dealership-platform/actions/runs/41649871911). API 168 passes (9 PostgreSQL-only skips in the main job, all 9 separately passed on PostgreSQL 16), shared 17/17; main Chromium 25 passes / 2 optional screenshot skips; daily browser 2/2; security, docs, lint/types/build and Docker/HTTPS passed. The exact CI image IDs and source tree were verified before installation; see the [release record](RELEASE_ACCIDENT_20261104.md).

Production verification passed: pre-install restored-copy migration 0014 and WorkshopService read probes; all existing business/auth/policy fingerprints unchanged through installation; .env byte equality, Production/PostgreSQL health and healthy containers; owner browser session persisted, merged desk, workshop/calendar, an existing case and manager report station filter loaded. Calendar revision 1 and the missing engine-tuning trade were recorded from the owner UI. The owner separately approved exactly five additions to the existing system_admin template; saved 27→32, database comparison proved no removals or changes to other templates and no new price/release authority. No real case, purchase, payment or task was modified for testing.

Final backup `operational/20261104T051806Z` restored into a separate database, including calendar and approved permissions, with matching operational/account fingerprints. Three audited setup actions account for the only changes in departments, tenants, audit/change-log and idempotency rows. Fifteen cases and nine accounts remain. Scratch databases removed; encrypted off-server recovery copy decrypted/checksummed in memory and local plaintext removed. Actual technician phones/LAN, reviewed official holidays and generative AI are not claimed complete. No main merge or Source/DNS change. Application code was not changed by the release documentation.

## Accident workflow redesign — 2026-11-03 — historical pre-release validation

Implementation commits `09aa3dd`, `2a3908d`, `ce8f324` and `45b907c`, branch `feature/accident-workflow-redesign`, based on `9b07cb0` (the released daily-parts branch). Final-head CI, including real PostgreSQL and Docker, is linked from [PR #36 checks](https://github.com/ali-hedax/manage-dealership-platform/pull/36/checks). No production operation, real-data import or real account/permission change.

**Final application validation:** all six jobs passed on `d05b83b` in [CI 41648339573](https://github.com/ali-hedax/manage-dealership-platform/actions/runs/41648339573). API **168 passed / 9 PostgreSQL-only skips**, shared **17/17**; the separate PostgreSQL job passed all **5 daily-report + 4 workshop concurrency** scenarios. Chromium main browser **25 passed / 2 optional screenshot skips**, daily browser **2/2**; lint, types, build, docs, security and Docker/HTTPS passed. The subsequent handoff commit only updates PROGRESS and this report; application code is unchanged.

- `pnpm test`: shared **17/17**, API **166 passed / 9 skipped** (23 passing suites, two PostgreSQL-only suites skipped locally). Includes calendar working-hour calculations, lunch/Thursday/Friday/holidays, interval union, role boundaries, assigned-only technician actions, stale versions, dependency release only after coordinator approval, immutable baseline, station scope and quote/payer/price controls.
- `pnpm test:e2e`: main browser **25 passed / 2 optional screenshot skips** on installed Edge, including desktop and phone. The daily browser initially found an obsolete expectation that system support cannot read stock; the expectation and large-file actor were aligned with the owner's support role, then the daily suite passed **2/2** in 1.3 minutes. No real files or services were used.
- Extra market-security rerun after tightening above-assessment prices: **17/17** across parts-finance and workshop API scenarios. The full local suite above began before this final refinement; CI is the authoritative final-head run.
- Lint, typecheck and build passed locally. Documentation/API inventory passed: 36 Markdown files and 116 routes. Generated migration 0014 executed in synthetic PGlite integration tests. The new technician, station board and calendar were visually reviewed from browser screenshots; the start/end action has an asserted minimum height of 64 CSS pixels. Read-only calendars are shown as a compact table rather than a disabled editing form.
- All six jobs passed for the preceding head `549f78f` in [CI 41644496631](https://github.com/ali-hedax/manage-dealership-platform/actions/runs/41644496631), including the five daily-stock and four new workshop PostgreSQL concurrency scenarios, Docker/HTTPS and full Chromium browser flows. After that run, `2a3908d` adds station-code scope to legacy reports, events/trends, matching case-list links and Excel/PDF exports. Follow-up local checks: report/QC API **14/14**, focused report export API **10/10**, report/workshop browser **4/4**, lint/types/build. The synthetic station-filtered PDF was rendered and visually inspected, including literal alphanumeric station codes. Final-head CI remains authoritative for this refinement.
- Final calendar edge case: a task created without a schedule takes the effective calendar when first planned; existing scheduled/started work keeps its frozen calendar. Effective dates are ordered before revision numbers. Workshop API rerun: **8/8 passed**.
- Covered market-price decisions now require an explicit declaration that the golden-card/insurance permission is recorded in its official system; missing declaration returns `OFFICIAL_APPROVAL_REQUIRED`. The reference and declaration are audited; customer consent remains separate. Focused parts/workshop rerun: **18/18 passed**.
- Added PostgreSQL CI scenarios for competing calendar revisions, cross-task dependency cycles, competing market proposals and duplicate technician starts, alongside the existing five daily-stock concurrency tests. Docker daemon is unavailable locally; PostgreSQL/compose results are checked in the branch PR before review. Local skipped tests are not reported as PostgreSQL passes.
- Calendar holidays are entered/reviewed explicitly; automatic official-calendar coverage, actual technician rollout on dealership phones, LAN/offline sync and production deployment are not claimed. Generative AI analysis remains planned. The current report is based on recorded events, without assigning blame or generating financial authorization.

## Released daily parts reports — 2026-11-03, 40b389f

All six jobs passed in [CI 41614528596](https://github.com/ali-hedax/manage-dealership-platform/actions/runs/41614528596): API 159 passes (5 PostgreSQL-only tests skipped in that job, all 5 passed separately on PostgreSQL 16); shared 12/12; original browser 23 passes / 2 optional screenshot skips; daily browser 2/2; lint/types/build, security and Docker/HTTPS passed. Tested merge 8add505ee02c809c929154684417d5d3a66c5b12 has the same tree as release head; artifact checksum and both image IDs verified. API image b7caae62ee91c30d23cca6b8cf5d171fe212d7aae2b2f48b4afda89b59f436f6; web cfe744ea9e8a572fa7d8577d6b8086e600a706a9b56aee04511407fce0bc7628.

Before production installation, backup daily-parts-20261103T100142Z was restored to an isolated database; additive migrations 0012/0013, preserved account/policy/case/reference state, and real-format sample imports passed there. Stock 6697 published; Emdad 5183 inserted (99 exact matches, 5084 without a definitive match), total row excluded; case count remained 15. Those are rehearsal results only. No sample was applied in production and temporary raw input copies were removed.

Production installed with the operational wrapper; environment byte comparison, all prior case/reference IDs and credentials/policy fingerprints passed. SSH reset during restart; the completed source-after marker, all healthy services and Production/PostgreSQL health were independently rechecked. Existing owner browser confirmed the new navigation, notifications, correct stock/Emdad tab switch, empty operational import history, rial/ex-tax/full-warehouse/physical-quantity settings and 11:00 Tehran reminder. No real stock action or staff permission was changed for testing.

Final backup operational/20261103T123021Z restored with matching counts: 15 cases, 47045 catalog parts, 2732 customer histories, 9 users, 2 active enrolled accounts, 1 owner, 2 daily profiles, 0 daily stock items and 0 Emdad requests. Off-server recovery copy encrypted with Windows CurrentUser DPAPI, decrypted/checksummed in memory; local plaintext removed. Main and Source untouched. Earlier incomplete/failing entries below document the repair history.

## Codex continuation, 2026-11-03 — not released

The full Linux run on 39d4257 passed all 23 main browser tests (2 optional skips), then exposed a report-kind switch race: the Emdad file was posted to `kind=stock` while router navigation was pending. Changed this client-only tab switch to native history replacement (Next.js integrates this with useSearchParams); the browser test now waits for the selected type and checks the actual upload request kind and response. A new full CI run is required; no release performed from the failing run.

Follow-up: `dl.dl` was also shared by provenance in the full Linux run (41612221866), although the isolated local import test passed. Narrowed the locator to the unique panel headed «مشخصات» and assert that panel is unique before checking its chassis. All other five CI jobs passed. Awaiting the complete browser run, not treating an isolated pass as full coverage.

CI 41611054240 on 4de263b passed five jobs including all five real-PostgreSQL concurrency tests and Docker/HTTPS. The original browser suite had 22 passes, 2 optional skips and one strict-locator failure: TST00001 appears in both vehicle details and provenance. Scoped that assertion to the details definition list; awaiting new CI. The owner explicitly identified both supplied files as format samples, not current operational reports. No production apply of those samples is authorized or planned.

Update: the complete isolated daily browser suite passed **2/2** in 1.3 minutes, including the original arithmetic check, exact-case selection, human alias, Emdad follow-up, 390px layouts and the full-size file through the web proxy. CI 41609812965 on d746597 passed the full check/build and Docker jobs. Real PostgreSQL ran all five tests: four passed; the remaining test correctly rejected excess need with HTTP 422/OVER_NEED but expected 400. Corrected the assertion and explicitly check OVER_NEED; new CI must verify it. No concurrency protection was weakened.

- Reproduced the original browser failure with an independent API assertion: the persisted issue was `0.5`, reserved `0`, available `0`; only the mounted options table remained stale. Added SWR revalidation of options, reservation queues and daily totals after reservation changes/creation.
- New synthetic alias tests cover permission refusal, immutable standard-code grouping, version conflict, tenant isolation and detaching a human-approved alias. API scenarios: **24/24 passed** after correcting the test tenant-code length. Shared **12/12 passed**. API/web builds succeeded; final changes and full suites still require CI.
- Browser passed the former stock-arithmetic failure and the new nine-option alias grouping, then failed at an unstable native-select locator. Replaced it with the created case's exact ID; complete rerun pending. Do not infer mobile coverage from this partial run.
- Private read-only preflight using this code: stock 6697 rows = 6586 standard + 111 needs mapping; Emdad 5183 records + 1 total row; no missing required columns. Both source SHA256 values unchanged. This was parsing only, not a production import or database rehearsal.
- Real PostgreSQL lock tests, all API/browser tests and Docker/HTTPS remain unconfirmed for this continuation until CI runs. Migrations 0012/0013 have not been applied to production by this session.

## Daily parts reports — in progress, not done, not released (2026-11-03)

Local runs on `feature/daily-parts-reports` at `defcb9f` plus the uncommitted web UI. The branch is not pushed, so there is **no CI run**. See [the handoff](../HANDOFF_DAILY_PARTS.md).

| Check | Result |
| --- | --- |
| API daily reports (jest, `daily-reports` only, PGlite) | 5 suites passed: **39 passed, 5 skipped** |
| Real PostgreSQL locks (`daily-reports-postgres.e2e-spec.ts`) | **Not run** (the 5 skipped); needs `DAILY_PG_TEST_URL`, set only in CI |
| Shared | 12/12 |
| API typecheck and lint; web typecheck and build | Passed |
| `node scripts/check-docs.mjs` | Passed after `--write` regenerated `docs/API.md` |
| Browser, `playwright.daily.config.ts` (desktop, Edge) | **1 passed, 1 failed** |
| Full API suite, main Playwright suite, Docker/HTTPS smoke | **Not run** on this branch |
| Private preflight of the owner's real files with this code | **Not run** in this session |

Failure: `apps/web/e2e/daily-reports.spec.ts:100`. After issuing a reservation the "unreflected issue" column stays `۰` instead of `۰.۵`, while the reservation row updates correctly. The cause is not established; a stale option list is only a hypothesis. The rest of that test, including the 390 px check, did not execute in the browser.

Two UI bugs found by this test were fixed in the uncommitted `daily-reports/page.tsx`: the status panel stayed stale for up to 60 seconds after applying a report, and saving settings right after applying hit a version conflict.

Migration 0012 ran only on in-memory PGlite in these tests. The server was not inspected and nothing was deployed.

## Department workspaces and configurable access — released 2026-11-03

All six jobs passed for `e7319eb` in [CI 41587736101](https://github.com/ali-hedax/manage-dealership-platform/actions/runs/41587736101): API **118/118** (17 suites), shared **9/9**, browser **23 passed / 2 optional documentation captures skipped**, lint/types/build, security, docs/API inventory, PostgreSQL migration/seed/reset and Docker/Compose/HTTPS smoke. Local targeted access API **5/5** and workspace/owner browser **2/2** passed. Local full API attempt exhausted Windows/PGlite virtual memory and was stopped; not reported as passing. All tests synthetic.

New scenarios verify owner-only editing, existing-session grants and revocations, a real synthetic part mutation, effective-permission phone masking, cross-tenant/owner protection, strict payload and stale user/template versions, tenant defaults/personal exceptions, audit/change log, invitation delegation ceilings, workspace visibility, role landing, keyboard Escape/focus return, owner edit review, role presets, phone overflow, cold asynchronous section navigation and repeated same-anchor clicks. The live cold case-section link was visually verified after the follow-up installation. Reviewed generated desktop and phone screenshots; corrected a closed-mobile-sidebar capture artifact and hidden skip-link presentation.

Owner-authorized operational release: exact artifact merge `90d1e0e6` tree matched head; SHA256 and image IDs verified. Pre-release backup `/home/manage/backups/workspaces-20261103T061441Z` restored and additive migration 0011 plus exact-owner designation rehearsed; private account/case/reference snapshots compared. Only API/web recreated using the operational wrapper; production health and byte-identical environment confirmed. Credentials, roles, active state, all existing case IDs and reference IDs preserved. Exactly one existing owner designated transactionally with audit/change log; no password/TOTP/session or other staff access change.

Final backup `/home/manage/backups/operational/20261103T061550Z` restored successfully with matching 15 cases / 47,045 parts / 2,732 historical admissions / 9 users / 2 active enrolled accounts / 1 owner. Recovery copy encrypted off-server with Windows CurrentUser DPAPI and decrypted/SHA256-verified in memory; local plaintext removed. Owner's live browser showed the new navigation, workspace and owner access/default-template controls; no real staff permissions were changed for testing.

## Reference data — feature/reference-data — final validation

All six CI jobs passed for application commit `a25292e` in [run 41472058608](https://github.com/ali-hedax/manage-dealership-platform/actions/runs/41472058608): API **113/113** (16 suites), shared **9/9**, browser **21 passed / 2 optional documentation captures skipped**, lint/typecheck/build, security audit/secrets, docs/API inventory, PostgreSQL migrations/seed/reset and Docker/Compose/HTTPS smoke. Targeted local API/reference/XLSX regression **11/11** and browser **3/3** passed before the final existing-case lookup regression, which passed in CI. Earlier concurrent local full-suite attempts exhausted Windows virtual memory (PGlite/Edge DLL 1455); those attempts are not counted as passed. All test data synthetic.

Coverage includes long manufacturer trim, editable customer/plate/admission number, both identifiers in case/list/reports, combined Jalali date/time paste, leading-zero parts, explicit preview/mapping, batching, global-file duplicate detection, repeat import, stale previews/concurrent apply, historical owners, tenant/RBAC isolation, no automatic operational cases, XLSX sparse/shared-string allocation bounds, lookup in new and existing case forms filling only blank fields.

Owner-authorized live release: compared the artifact merge tree `4643fa6d` with `a25292e`, archive checksum and exact image IDs. Restored the pre-release dump and applied additive migration 0010 in a disposable PostgreSQL DB before live migration. Recreated only API/web through the operational wrapper; production health and byte-identical environment confirmed. Fingerprints before/after release and reference import confirm all previous cases and account credentials/roles/active state preserved (15 cases; 2 active enrolled accounts).

Real files were separately inspected and imported only into the owner's operational tenant, never tests/Git: 47,045 parts and 2,732 historical admissions, zero duplicates/conflicts. The single error outcome was the unmapped totals footer at source row 2734. Price/package count were not treated as stock; only selected owner/vehicle columns copied. Final backup `/home/manage/backups/operational/20261103T045554Z` restored to a disposable DB; counts 47,045 parts / 2,732 history / 15 cases / 2 active TOTP accounts matched. Disposable DB removed. Browser verification showed actual code/name lookup preserving leading zeros and both case/admission numbers in the 15-case list. After owner re-login, live existing-case edit lookup returned an actual monthly admission with its original admission number and long trim; current form fields remained unchanged and the form was cancelled without saving. Final recovery archive transferred off-server, encrypted with Windows CurrentUser DPAPI and decrypted/SHA256-verified in memory; local plaintext archive removed. No live form was saved for testing.

## Operational start — 2026-11-02

CI run `41451507538` for operations commit `165a020`: all six jobs passed (audit/secrets, docs, lint/types/build/unit/integration, PostgreSQL migration/seed, browser E2E, Docker/Compose smoke). Daily backup shell syntax verified on the host; cron active. A subsequent recovery archive was transferred to the owner's PC, encrypted with Windows CurrentUser DPAPI, decrypted in memory and compared by SHA256; plaintext local archive removed.

Application code/images unchanged from tested `5e529fd`. With explicit owner approval, tested the one-time promotion on a restored PostgreSQL backup before applying it to the actual VM. Verified exact five synthetic cases and seven non-personal demo users; credentials/roles/TOTP of the owner, all prior audit records and case counters preserved. Added 13 transactional audit records. Initial import through the existing service: 15 created, 7 incomplete, 1 delivered-row error retained, 0 duplicate; applying the same preview again was rejected. Database assertions: 15 real cases, 15 unique import keys. Restored the post-import backup to a separate temporary DB and verified 15/0/15 counts; removed temporary DBs. Browser owner's session, dealership name, absence of preview banner, 15-case list and actual case/import-history panel verified. API production/PostgreSQL health OK, all health-checked services healthy. Daily cron installed; immediate backup succeeded. See [operational notes](REAL_START_FA.md). No live synthetic tests or invented customer fields.

Last full run: **2026-11-01**, branch `feature/qc-delivery` (issue #12 on top of `feature/parts-finance`), Windows 10 / Node 26.8 locally (CI targets Node 22 on Ubuntu). All data synthetic.

## Summary

| Suite | Command | Result |
| --- | --- | --- |
| Lint (ESLint on API, tsc on shared/web) | `pnpm lint` | ✅ pass |
| Typecheck | `pnpm typecheck` | ✅ pass |
| Shared unit tests (Jalali, digits, plates, phones, RBAC, schemas) | `pnpm --filter @manage/shared test` | ✅ 9 / 9 |
| API unit + integration (Jest + supertest, real HTTP, embedded PostgreSQL) | `pnpm --filter @manage/api test` | ✅ 56 / 56 (6 suites; new `qc-delivery` suite with 4 tests, delivery test in `accident` updated to the new gates) |
| Production build (API + web) | `pnpm build` | ✅ pass |
| E2E (Playwright, desktop 1366×860 + Pixel 7) | `pnpm test:e2e` | ✅ 8 / 8 locally on Edge in three consecutive runs (incl. QC/settlement/handover flow; 2 documentation-screenshot tests skipped by design); ✅ on CI Chromium (PR #20, run 41294515754) |
| Dependency audit (prod, high) + gitleaks secret scan | `pnpm audit`, CI `security` | ✅ no known vulnerabilities; no secrets found. Dependency review is non-blocking until the repo's Dependency graph is enabled (#4) |
| `pnpm dev` from an empty database | manual | ✅ API healthy, demo auto-seeded, web proxy 200 |
| Local Preview `pnpm preview` | manual smoke | ✅ production build on :3100, login via web proxy 200, dashboard counts (5 active, 2 blocked, 1 awaiting authorization, 1 overdue part, 1 part to order, 1 pending finance), sample .xlsx served; restart without `--reset` keeps data and accounts |
| Migrations + seed + audit trigger + demo reset on PostgreSQL 16 | CI job `postgres` | ✅ pass (run 41276167117; with migration `0002_assessments` and the new demo seed: run 41279034901; with `0003_parts_finance`: run 41284274194; with `0004_qc_delivery`: run 41294515754) |
| Docker images + compose smoke test (health via web proxy, login, dashboard) | CI job `docker` | ✅ pass (run 41276167117). Not verifiable on the dev machine: 8 GB RAM, 5.6 GB free disk, Docker daemon crashed twice during builds |

## Acceptance scenarios (brief §11)

| # | Scenario | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Create a case and search it | ✅ | API: "creates a case … finds it by plate, VIN, name, phone and number"; E2E: supervisor flow ends with plate search |
| 2 | Golden card with official deadline, waiting for company part | ✅ | API "acceptance 2": part from the authorized line, gate open (no customer share), order with ETA, blocker on the activity names the part, ETA moved (first ETA kept), receipt, handover resolves the blocker and returns the activity to work, official deadline unchanged, "not arrived" after handover refused; wrong part rejected at receipt and re-ordered |
| 3 | Body insurance with price change and assessor approval | ✅ | API "acceptance 3": purchase above the approved price refused without assessor name + approval reference, accepted with them (stored); a line re-priced by a pending supplement cannot be ordered until the insurer's decision is recorded |
| 4 | Personal case with advance payment and customer approval | ✅ | API: customer authorization in person, gate "no estimate" → "advance missing"; expert proposes, expert cannot approve (403), cashier cannot confirm before approval, manager approves, cashier confirms → gate open, order recorded with basis "advance paid". E2E: manager → cashier → parts clerk in the browser on demo case 3 |
| 5 | Supplement after hidden damage | ✅ | API "acceptance 5": in-repair case, supplement with discovery time copies approved lines, new line + re-priced line, finalize → previous version superseded and unchanged (prices, total), delta +34 M Rial, financial re-review flag, forecast moved / official deadline unchanged, «مجوز» blocker from discovery time blocks delivery, partial approval excludes rejected line. E2E: same flow in the browser incl. superseded v1 total |
| 6 | Multiple departments and technicians, parallel and dependent work | ✅ | API: dependencies enforced, parallel start, weighted progress 50 %, cycle rejected; E2E: dependency-aware start button |
| 7 | "Part not arrived" while handover is recorded → reviewable discrepancy | ◐ | API: a "not arrived" blocker naming a handed-over part is refused with a discrepancy message. Review queue for the manager: issue #11 |
| 8 | Block costly purchase without financial approval, allow no-cost work | ✅ | API: purchase refused (`FINANCE_GATE`) while stock check, reservation and starting an activity succeed; a supplement raising the estimate closes the gate ("re-approval required"); exception with limit: proposer cannot approve, purchase within limit allowed, beyond limit refused, spending tracked |
| 9 | QC, corrective work, settlement, delivery | ✅ | API "acceptance 9": QC refused before all work is approved; technical close refused with reasons (approved line without installed part, QC missing); checklist rules (failed item needs description + unit, safety item cannot be skipped, all items required); failed round → corrective activity in the chosen unit, case back in repair; round 2 passes after the corrective work → technical close → "آماده تحویل"; handover refused until the financial close; balance due blocks the close, overpayment refused, cashier records the settlement, financial close; handover needs the recipient's confirmation, then delivered + archived (read-only, only under "all"), history has every step. A reopened activity invalidates the technical close (handover refused, stale QC → new round, close again); a changed customer share invalidates the financial close; closing with a balance due only by the service manager with a reason; role checks. E2E: demo case 5 — QC history and corrective activity, cashier settlement + financial close, expert handover → archived |
| 10 | Roles and denial of unauthorized access | ✅ | API: unauthenticated 401, CSRF 403, support roles 403 on create/tasks, expert cannot block activities, admin cannot read cases, masked phone, tenant isolation 404, lockout; E2E: parts clerk read-only view |
| 11 | Old vehicles with past admission date | ✅ | API: past admission + current stage + overdue/legacy filters; E2E: legacy entry form |
| 12 | Reports and correct Persian PDF | ○ | Issue #13. Print view exists; PDF not yet |
| 13 | Offline / sync / backup / restore | ○ | Design only (docs/OFFLINE_SYNC.md); needs server (issues #7, #15) |

✅ automated and passing · ◐ partly covered · ○ not built yet

## Other verified behaviour

- Audit rows cannot be updated or deleted, even with direct SQL (trigger); demo reset deletes only `is_test` tenants.
- Every change writes a change-log entry in the same transaction.
- Repeated `Idempotency-Key` replays the stored response instead of creating a duplicate case.
- Stale `expectedVersion` returns `409 VERSION_CONFLICT`.
- Dashboard card counts equal the totals of the lists they link to (all 7 flags).
- Demo seed creates 5 realistic cases through the real services (stages, overdue, blocker, ready, legacy); case 5 reaches "آماده تحویل" through two QC rounds (one failed with corrective work) and the technical close.
- The stage selector refuses "تحویل‌شده" (`DELIVERY_GATE`) and "آماده تحویل" (`TECHNICAL_CLOSE_REQUIRED`) even with all work approved.
- Phone width: no horizontal scrolling on dashboard and case list; menu opens.

## Assessment and supplements (issue #8)

API tests (`apps/api/test/assessment.e2e-spec.ts`, real HTTP on embedded PostgreSQL):

- Initial assessment: draft totals, stale `expectedVersion` → 409, empty finalize rejected, finalize → «مجوز» blocker + stage "در انتظار مجوز / تأیید", final lines immutable (`ASSESSMENT_FINAL`), manual resolve of the waiting blocker rejected (`BLOCKER_MANAGED`), insurer approval without official reference → 400, with reference → approved and blocker resolved, second decision rejected.
- Decision recorded afterwards is accepted; a decision older than the assessment is rejected; the wait starts at the assessment time.
- Only one initial assessment and one draft per case; no supplement before a final assessment.
- RBAC: parts clerk can read but not create (403).
- Acceptance 5 (above) and a supplement that only removes a line (no new authorization, negative delta, no blocker).

Demo seed test: demo case 1 now carries an approved assessment and a supplement waiting for authorization (blocked cases 1 → 2).

## Parts and financial gate (issues #9, #10)

API tests (`apps/api/test/parts-finance.e2e-spec.ts`): acceptance 2, 3, 4, 8 (above); payer shares for a mixed case (blocked until recorded, stale version → 409); Excel import (preview with per-row errors, file with errors imports nothing, valid file imports all rows, non-.xlsx rejected); permissions (cashier cannot create parts, expert cannot run part steps, parts clerk cannot propose finance); dashboard counts equal the new case-list filters.

E2E (`apps/web/e2e/parts-finance.spec.ts`): manager approves the advance, cashier confirms receipt, parts clerk orders (approved price prefilled), receives, hands over to a unit, imports the sample .xlsx (preview → 4 rows), manager sees the steps in the history.

## Pre-merge review of PRs #16, #17, #18 (2026-11-01)

| Check | Result |
| --- | --- |
| Merge conflicts | None: #16 → main (main has no commits missing from #16), #17 → #16, #18 → #17 |
| Authorization | Every domain endpoint carries `@RequirePermissions`; only login, logout, me and health are outside it (by design). Separation of duties enforced in services |
| Tenant isolation | New queries (assessments, parts, finance) filter by the actor's tenant or by ids already loaded under it |
| Secrets | No credential or key files tracked; no secret literals in code; gitleaks clean |
| Dependencies | `pnpm audit --prod`: no known vulnerabilities (fflate 0.8.3) |
| Session/passwords | httpOnly + SameSite=Lax cookie, Secure behind HTTPS; scrypt with per-user salt, constant-time compare |
| CI | All 5 jobs green on #16, #17 and #18 after the fixes below |

Found and fixed during the review:

| PR | Finding | Fix |
| --- | --- | --- |
| #16 | Web proxy forwarded the client's `X-Forwarded-For` verbatim, so a client reaching Next.js directly could bypass the per-address login rate limit | Forwarded only with `TRUST_PROXY_HEADERS=true` (behind Caddy/Nginx, which overwrite it) |
| #16 | Malformed or oversized JSON answered with a generic code and English text | Stable codes `INVALID_BODY` / `PAYLOAD_TOO_LARGE` with Persian messages (test added) |
| #18 | JSON body limit was the 100 KB default while the import accepts ~1 MB files: real sheets above ~75 KB failed | Limit 2 MB; test with a 1500-row sheet (~270 KB) |
| #18 | An .xlsx is a ZIP: a small upload could expand to gigabytes in memory | Only needed parts inflated; declared sizes capped (16 MB per entry, 32 MB total); decompression-bomb test |

## QC, closes and delivery (issue #12)

API tests (`apps/api/test/qc-delivery.e2e-spec.ts`): acceptance 9 end-to-end on a personal case; invalidation of both closes after later changes (golden card); balance-due close (cashier 403, manager without reason 400, manager with reason → accepted amount recorded); permissions (expert / parts clerk cannot record QC, QC inspector cannot close or hand over, expert cannot close financially, cashier cannot hand over; QC inspector reads the completion state).

E2E (`apps/web/e2e/qc-delivery.spec.ts`, demo case 5): QC inspector sees two rounds and the corrective activity, no handover button; cashier sees the balance blocking the close, records the settlement (balance prefilled), closes financially; expert hands over (submit disabled until the recipient's confirmation) → "تحویل‌شده", archived, no edit link. Screenshots of the panel and the QC form (desktop and phone) reviewed: `docs/screenshots/*-completion-demo.png`, `*-qc-form.png`.

CI (PR #20, run 41294515754): all 5 jobs green, incl. migration `0004_qc_delivery` + demo seed on PostgreSQL 16 and the Docker smoke test. Not covered yet: no printable delivery form or invoice (issue #13 / finance module).

## Defects found by tests and fixed

| Found by | Defect | Fix |
| --- | --- | --- |
| E2E | Resolving a blocker in the same minute it was recorded failed: the date field re-parsed the time at minute precision on blur, earlier than the exact creation time | Input keeps the precise value when its text is unchanged; API accepts minute precision for ordering checks (regression test added) |
| E2E (intermittent) | After committing the date, the time field could be reset while the user was typing, saving 00:00 | Input re-syncs only on external value changes |
| E2E | Search tests clicked the first row before the debounced search applied | Tests wait for the URL query and row count |
| Startup log | Express 5 rejected the logger's bare `*` route | Named wildcard |
| Audit | High-severity advisories in drizzle-orm and multer | Upgrade / override |
| Screenshot review | Signed delta "+25,000,000" rendered with the sign on the wrong side in RTL | Shown as «افزایش/کاهش …» |
| Screenshot review (phone) | Assessment line table cramped, status column off-screen | Lines become stacked cards under 860 px |
| Writing the demo seed | Authorization recorded afterwards was rejected because it predated finalization in Manage | Lower bound is the assessment time; regression test added |
| `pnpm audit` | fflate 0.8.2 (Excel import) can loop forever on a malformed ZIP64 upload (GHSA-px8p-9vwx-vf98) | Pinned fflate 0.8.3 |
| E2E (full suite) | Several role logins within a minute hit the login rate limit (10/min) | `LOGIN_RATE_LIMIT` setting; default unchanged, E2E uses 200 |
| E2E (3rd run, intermittent) | After clearing cookies, the old page's background 401 redirect aborted the next navigation | Test leaves the page before switching user |
| Screenshot review | History showed the authorization source as "part source" and numbers in Latin digits | Labels per event type, Persian digits |
| API test (issue #12) | Work re-approved within a minute of a QC round was not detected as "QC stale" (minute tolerance on backdatable times) | Stale when any activity changed after the round was recorded (application clock) |
| API test (issue #12) | A technical close made before reopened work counted as valid again after a new QC round, without the supervisor closing again | Close is valid only if made after the latest QC round |
| Screenshot spec | Button "رد" also matched «… موضوعیت ندارد» | Exact match |

## E2E consecutive runs (flakiness check)

After the date-input fix, on 2026-11-01 (desktop + mobile projects, Edge):

| Run | Result | Duration |
| --- | --- | --- |
| 1 | 5 passed | 54.8 s |
| 2 | 5 passed | 1.0 min |
| 3 | 5 passed | 57.8 s |

With the assessment flow (branch `feature/assessment-parts`, 2026-11-01): 6 passed in 38.5 s, 39.3 s and 39.8 s.

With parts and finance (branch `feature/parts-finance`, 2026-11-01, after the two E2E fixes above): 7 passed in 49.6 s, 48.7 s and 49.1 s.

With QC and delivery (branch `feature/qc-delivery`, 2026-11-01): 8 passed in 1.1 min, 1.2 min and 1.4 min (desktop + mobile, Edge).

## Live isolated Preview verification — 2026-11-01

See [deployment record](PREVIEW_DEPLOYMENT_20261101.md) for checks actually run, application SHA, limitations and recovery. HTTPS, password gate, PostgreSQL health, manager login, Secure/HttpOnly cookie, synthetic dashboard, port isolation and effective SSH policy passed. Both images rebuilt successfully. Modified setup script passed bash syntax and ShellCheck. Browser E2E on this host was not run; application CI passed on the deployed SHA.

## Browser compatibility follow-up — 2026-11-01

The in-app browser rejected the native Basic authentication challenge with ERR_INVALID_AUTH_CREDENTIALS. The Preview now uses the additional `docker-compose.form-gate.yml` overlay: Caddy proxies through an internal, non-root Node gate. Unauthenticated page requests redirect to a Persian HTML sign-in form; API requests receive 401 without a browser challenge. The same existing Preview password is retained, stored as a salted scrypt digest. Successful sign-in sets a signed, expiring, Secure/HttpOnly/SameSite=Strict host-only cookie. The gate checks login Origin, limits attempts and request size, and does not publish an additional host port. The old Basic header remains supported for smoke-test clients without a WWW-Authenticate challenge.

`setup-server.sh` configures form-gate secrets without printing them. `deploy.sh` includes the form overlay when PREVIEW_GATE_HASH exists in `.env`. Always include all three Compose files on this VM; using only the original two would restore the legacy browser challenge. No password, domain, DNS or production resource changed.

Verification: Node integration tests passed locally and in the Node 22 container (valid/invalid login, Origin rejection, rate limiting, Secure/HttpOnly cookie, tampered/expired token rejection and upstream credential stripping); shell syntax and ShellCheck passed. The actual in-app browser completed both login steps and displayed the manager dashboard with five synthetic cases. Screenshot evidence and access details were delivered privately to the owner. Earlier statements about anonymous `/login` returning 401 and no host browser test are superseded by this follow-up: anonymous pages now redirect, and in-app browser login was verified.
## Personal Authenticator authentication — 2026-11-01

Scope: isolated Manage Preview only. The final owner choice supersedes the earlier SMTP plan: email is an identifier, password is personal, and the second factor is Google Authenticator. Invitations are private links shared manually. No mail was sent and no Gmail setting was changed.

Validation in a disposable Node 22 staging container on the Manage VM (separate checkout, no live DB): full lint/typecheck, shared/API suite and API/web build passed before the last tenant-isolation assertion and UI contract additions. Final targeted API typecheck and `personal-auth.e2e-spec.ts`: **5/5 passed**, including RFC 6238, encrypted-seed tampering, role checks, no idempotency-secret cache, pending-account protection, activation, secure session issuance, replay rejection, concurrent verification, expired invites, attempts and cross-tenant conflict/isolation. `pnpm audit --prod --audit-level=high`: no known vulnerabilities. Local Node gate integration tests passed, including rejection of old shared cookies and password-only sessions in personal mode.

Two added Playwright tests exercise Persian personal-login and QR-enrollment UI using explicitly mocked synthetic challenge responses; they do not claim real MFA end-to-end coverage. CI execution is pending. Live rollout and the owner's own password/QR enrollment are pending. Automatic password/factor recovery and backup codes are not implemented.

## Live Preview after QC and delivery — 2026-11-01

Deployed SHA `88e1f6d` (merge of PR #20 into the Preview branch). 49/49 live checks over HTTPS through the form gate (gate, 6 role logins, dashboard, the five demo cases, full case flow from creation through finance gate, parts, QC with corrective work, both closes and handover) and a real-browser check on desktop and phone passed. Details: [deployment record](PREVIEW_DEPLOYMENT_20261101.md).

CI follow-up: secret scan identified only the public RFC 6238 Appendix B vector in the synthetic test, not an application credential. `.gitleaksignore` records that exact historical commit/path/rule/line fingerprint, preserving every other secret check. Deployment health checks now accept HTTP 200 for personal-login mode while retaining 401/302 for legacy mode. Current code integrates the already-deployed QC/hand-over changes; personal migration is **0005_personal_auth**, following 0004_qc_delivery. Final CI rerun pending.

Browser CI identified the activation password's helper text as part of its accessible label. Moved the length hint outside the label and associated it with `aria-describedby`, preserving the exact field name and the existing meaningful UI test. Other 9 browser tests passed (2 intentionally skipped). Re-running CI before rollout.

## Personal authentication rollout completed — 2026-11-01

Deployed application SHA: `58ad08c9ccb427de74ce2d2c2f008a29e043b972`, preserving QC/hand-over from the current Preview branch. PR #21 remains draft; no main merge. All **five CI jobs passed** in run [41297169933](https://github.com/ali-hedax/manage-dealership-platform/actions/runs/41297169933): lint/typecheck/build, shared 9, API 61, Playwright **10 passed / 2 intentionally skipped**, PostgreSQL 16 migration/seed/reset and Docker/HTTPS/gate smoke, dependency audit and secret scan. The two new UI tests use mocked challenges; the API suite verifies actual TOTP and session logic.

On the isolated Manage VM only: private DB/config backup verified with pg_restore listing; existing deployment preserved before update; web/API images built; additive migration **0005_personal_auth** applied. AUTH_TOKEN_SECRET was generated once on-server and saved only in mode-600 configuration/private backups. API and gate use the same personal-mode flag. All application services healthy, trusted HTTPS `/login` 200, auth/options true, anonymous dashboard API 401 and private cases 302, legacy demo/password endpoint 403. No shared site password can satisfy the personal gate. NTP synchronized.

Owner invitation was written privately for the owner-confirmed email; the actual in-app browser displayed the empty personal-password activation form. No real owner password was entered and no real owner QR was generated/viewed by the agent. **Owner activation and first personal login remain pending the owner's own actions.** No email was sent, Google account changed, Source/Production accessed, DNS changed, paid resource created, or customer data imported. Private invitation and configuration are not in Git. Subsequent documentation-only commits do not change the deployed application SHA.

## Repository documentation audit — 2026-11-01

No application/runtime/schema changes. Base 82152c2 has all five jobs successful in [run 41297553236](https://github.com/ali-hedax/manage-dealership-platform/actions/runs/41297553236). Added a dependency-free documentation check for local Markdown links and the API controller route inventory; local result and final PR CI are recorded in the PR. Original full application suites run in CI on this documentation PR.

Read-only evidence: primary platform and prior Preview checkout clean; deployed 58ad08c clean; prototype tooling/docs preserved separately in PR #22. Prototype synthetic npm test passed locally on Node 26.8.2 and in Windows/Node 22 CI [41307696880](https://github.com/ali-hedax/manage-dealership-platform/actions/runs/41307696880). Browser tests were not rerun and their historical autosync expectation failure remains documented. Owner confirms their own successful personal login; it is not claimed as an agent-run MFA test.

Local documentation validation passed: 26 Markdown files, 49 controller routes, `node --check scripts/check-docs.mjs` and `git diff --check`. No application dependencies, customer data or private runtime configuration are needed for this check.

## Reports center (stage 3a) — 2026-11-02 (branch `feature/reports-center`)

Definitions first (`docs/REPORTS_FA.md`), then implementation.

- **Unit tests** (`reports.spec.ts`, 5):
  - "today" starts at Tehran midnight (20:30 UTC); the week starts on Saturday; the month starts on the 1st of the Jalali month.
  - Previous period has the same length; an incomplete month is compared with the same elapsed time.
  - Custom Jalali range is inclusive, Persian digits are accepted, reversed and missing dates are rejected.
  - Priority uses Tehran days ("today" until 24:00 Tehran); a missing due date is "no due date", not late.
  - Views are opened by permission.
- **API tests** (`reports.e2e-spec.ts`, 8):
  - Role access in the report and the export (parts clerk 403 on the manager view, cashier no views).
  - Every manager KPI equals the total of the case list it links to, and stage bars sum to active cases.
  - Work-list rows per kind equal the KPI.
  - Per-reason bars equal the case list filtered by that reason.
  - A case with two part blockers and two parts counts once as a case and a vehicle, with physical quantities summed separately.
  - Ordering: overdue → today → soon → later → no due date, with server paging.
  - Legacy/imported cases are excluded from time-in-stage, with the count shown.
  - Events are compared with the same-length previous period; filtering by "me" works.
  - Workshop filter by unit, and bars link back to the report.
  - Export contains all filtered rows (not just the page), the title, time and test-data label, and no phone numbers.
  - Another dealership sees nothing, and a real dealership is not labelled test data.
- **Browser tests** (`reports.spec.ts`, 2):
  - Service manager: the KPI "دارای مانع" opens the case list with the same count.
  - Stage filter in the accident view, then open a case and go back: the filter and URL are kept.
  - Stats tab with the table alternative.
  - Parts clerk sees only the parts view, 6 KPIs, next actions, and no horizontal scroll.
- **Screenshots** (desktop and 390 px) were reviewed. Fixed after review: zero values were shown as "no data", some server text used Latin digits, and the KPI grid wrapped. Fixed after CI: two quick filter changes could overwrite each other (each change is now built from the live URL).
- **Full suite:** API 98/98 (13 suites), E2E 17/17, shared 9/9, lint, typecheck, build, docs check (62 routes), audit clean.

Not yet built (stage 3b): Persian PDF export with an embedded font and the dealership header; the parts discrepancy queue (#11).

## Existing-vehicle Excel import — 2026-11-02 (branch `feature/vehicle-excel-import`)

Built and tested with synthetic workbooks that reproduce the intake file's structure (sheet and header names read from the owner's Google Sheet; no real rows copied).

- Unit (`vehicle-sheet.spec.ts`, 5): header found on row 3 behind a guide sheet and two title rows, blank template rows reported; non-vehicle workbooks rejected; identifier keys keep leading zeros and Persian/Arabic digits; «بدون پذیرش»/«برگشتی» not unique; 8-character chassis is not a VIN, I/O/Q rejected; Jalali text and Excel serial dates; Tehran midnight boundary (1405/08/05 00:00 → 2026-10-26T20:30Z); times; stage and coverage wording.
- API (`vehicle-import.e2e-spec.ts`, 6): preview separates new / incomplete (no time without decision, no identity, no stage) / duplicate / error (invalid date, new case "delivered") and keeps every row; preview writes nothing; permission 403 and invalid file. Apply creates legacy cases (original admission text, chassis reference, precision, coverage, responsible, task in the named unit, no invented blocker), provenance with original cells, search by admission and chassis number; re-importing the same file → all unchanged, no new case or task; apply twice → 409; report .xlsx with issued case numbers. Updates fill only non-empty differences (empty owner cell does not clear; same plate in Persian digits is not a change), different admission date and ambiguous identifiers → needs review, unknown case number → error, "ready for delivery" left to the QC workflow. Failure in the middle (2nd row): finished rows kept, failed row marked, status partial; re-import completes without duplicates. Another dealership cannot read the import or provenance and does not match these cases or case numbers.
- E2E (`vehicle-import.spec.ts`): manager uploads the synthetic sample, decides "date without time", preview (2 new, incomplete, error, 2 blank rows), applies, opens the issued case: admission number, chassis, provenance with the original note, task. Desktop and 390 px screenshots reviewed (rows become cards on phones; no horizontal page scroll).
- Full suite: API 85/85 (11 suites), E2E 15/15, shared 9/9, lint, typecheck, build, docs check (59 routes), `pnpm audit --prod` clean.

Defect found by the tests and fixed: the next-action task was planned but not attached for new rows; comparisons now use normalized Persian text so re-imports do not report false changes.

## Invitation email diagnosis and delivery status — 2026-11-02 (branch `fix/invitation-email-delivery`)

Live server, read-only: deployed SHA `b7e4c93`, migrations 0000–0006, `PUBLIC_APP_URL` = the Preview HTTPS address, SMTP settings intentionally empty. Egress from the VM: Gmail 465/587/25/2525, Outlook, Yahoo, mail APIs (Brevo, SendGrid, Mailgun, Resend, Postmark, Gmail API), Google 443, Cloudflare, npm and api.github.com time out; domestic sites answer. From inside the API image, nodemailer verify to smtp.gmail.com with dummy credentials returns `ETIMEDOUT` after 10 s on 465 and 587 (an open path would return `EAUTH`). Conclusion: blocked before TLS/authentication by the network; not an application, TLS or password defect.

Local tests: API 74/74 (9 suites). New: failure classification; real sockets without mocks (closed port → `connection_blocked`, plain-text server on the TLS port → `tls_failed`, unresolvable host → `dns_failed`, missing settings → `not_configured`); failed send stores and shows only the category, successful resend clears it without a duplicate employee; connection check is admin-only, sends nothing, audits only the category. E2E 14/14 (new: failure reason and connection check on the staff page). Shared 9/9, gate 2/2, build, lint, typecheck, `pnpm audit --prod` clean. `configure-smtp.sh`: `bash -n` locally; ShellCheck in CI.

Not done: a real email from the Preview (network blocked); no message was sent in this step.

## Staff invitation email — 2026-11-01

Local lint/build passed. Shared 9/9, API 68/68 (including seven new invitation/transport tests) passed; production dependency audit reports no known vulnerabilities. Coverage: RBAC/readiness, no pending account on missing SMTP config, per-invitation delivery and sanitized audit, no token in response/cache/audit, send failure and explicit resend without duplicate identity, active-user protection, password/QR setup and real synthetic TOTP login; SMTP HTML escaping, TLS/STARTTLS and refusal handling. Transport tests mock the sender; they do not claim real Gmail delivery.

Browser checks: **3/3 passed locally on Edge**, covering owner form, explicit resend with exactly the invitation fields, no link-copy required for email, responsive 390px layout with no horizontal overflow, failed/unconfigured states and the optional private-link fallback. The third test uses the real API to create an invitation with a synthetic test-only signing key while email is unavailable. Desktop/mobile screenshots inspected; email UI results are mocked, not live Gmail. Documentation check: 27 Markdown files / 51 controller routes passed. The owner-approved integrated main eaa7c66 passed all six jobs in [41318062293](https://github.com/ali-hedax/manage-dealership-platform/actions/runs/41318062293). PR #24's initial aeb76a4 passed all six jobs in [41319910328](https://github.com/ali-hedax/manage-dealership-platform/actions/runs/41319910328); the private-link follow-up has its own CI. Private sender configuration and feature rollout remain separate verification steps; final CI is recorded in the PR.

## Stage 3b continuation audit — 2026-11-02

Resumed the preserved staged and unstaged changes on feature/reports-center after the previous agent reached its usage limit. Local lint/typecheck/build passed; full API 102/102 (14 suites), shared 9/9; browser 18 passed, 2 intentionally skipped documentation screenshot tests. Targeted report/discrepancy tests passed 12/12 after adding transactional detection/condition audit and version handling. Added regression coverage for repeat detection/condition events, cross-tenant reads and writes, and a PDF row longer than one page. Final regression results and CI are recorded in the subsequent release entry. PDF pages were rendered with pdfjs and inspected: embedded Persian fonts, RTL, complete width, repeated table header, footer and monochrome layout. No live records were removed or imported.

## Stage 3 release verification — 2026-11-02

Final regression: report/discrepancy 12/12 passed after transactional detection audit, versioning and cross-tenant checks; final oversized-row PDF regression 9/9 passed. Ordinary PDF (3 pages) and long-row PDF (4 pages) were rendered with pdfjs/canvas and every page visually inspected. Full application CI on 5e529fd: 6/6 jobs successful (41424078886), including PostgreSQL 16 migration/seed/reset, Chromium E2E and Docker HTTPS smoke. Local full API 102/102; shared 9/9; browser 18 passed and 2 optional documentation screenshot tests intentionally skipped.

Published to the owner-approved Preview after a verified restore drill. Health passed; owner browser session preserved; manager daily work and statistics, discrepancy queue and deployed PDF download verified. PDF from the live API rendered correctly with embedded Persian fonts. No real data import or demo purge. See PREVIEW_DEPLOYMENT_20261101.md for backup, version and rollback.
