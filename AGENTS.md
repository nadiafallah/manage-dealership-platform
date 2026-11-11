# AGENTS.md — working rules for coding agents and contributors

Read this file and [PROGRESS.md](PROGRESS.md) before changing anything. Continue from the last recorded state; do not restart work that is already done.

**Single source of truth:** [docs/PRODUCT_SPEC_FA.md](docs/PRODUCT_SPEC_FA.md) (approved by the owner on 1405-08-19 / 2026-11-10). Wherever code, README, PROGRESS.md or another document differs from it, the specification is right. Approved mockups: [docs/design/mockups/](docs/design/mockups/). History before 2026-11-10: [docs/archive/PROGRESS_2026-11.md](docs/archive/PROGRESS_2026-11.md).

## Product and scope

- Manage by HEDAX: dealership operations platform. Phase 1 = accident-repair cases for one Iran Khodro dealership; multi-dealership and other brands later.
- **Source by HEDAX is a separate project.** Never touch its code, data, servers, deployment or credentials (for example the `source_arvan_ed25519` SSH key on the owner's machine). If resources are shared, only report capacity and propose isolation.
- Persian RTL is the default UI language. Keep logical CSS properties (`inline-start/end`) so LTR can be added.

## Hard rules

1. **Explicit owner approval required** for: merging to `main`, production deployment, DNS changes, choosing/configuring the final domain, firewall changes, logins to external services, access to or migration of real data, deleting or closing branches/PRs/issues, choosing a license.
2. Work on branches (`feature/…`, `fix/…`, `docs/…`) and open PRs. CI must pass. No automatic production deploy.
3. Never commit secrets. `.env` is ignored; `.env.example` holds placeholders only. Do not print secrets in logs, reports or screenshots.
4. Test data is synthetic (`is_test = true`, phones `0900…`, VINs `TESTVIN…`). Never copy real customer data into tests or demos.
5. A feature is **done** only when its tests ran and the result is recorded in [docs/TEST_REPORT.md](docs/TEST_REPORT.md). A green build alone is not done.
6. Never present a demo screen as an operational feature. Planned modules show "در دست توسعه" and have no actions.
7. Official approvals (golden card, insurance) are valid only when recorded in the official system; Manage records them, it does not replace them. AI never issues financial approval or assigns blame.
8. Offline/sync is not "complete" until installed and tested on the dealership LAN.

## Engineering conventions

- Monorepo (pnpm): `packages/shared` (contracts), `apps/api` (NestJS 11 + Drizzle), `apps/web` (Next.js 16).
- Every tenant-owned row has `tenant_id`; every query filters by `actor.user.tenantId`.
- Every mutation runs in one transaction that also calls `AuditService.record()` (audit row + change-log row). Mutable rows use `version` for optimistic locking; clients send `expectedVersion`.
- RBAC: add permissions in `packages/shared/src/permissions.ts`, enforce with `@RequirePermissions()` and, for action-dependent rules, inside the service. Frontend hiding is cosmetic only.
- Errors: throw `AppError` helpers (`badRequest`, `conflict`, …) with a stable `code` and a Persian message.
- Timestamps are UTC (`timestamptz`); Jalali conversion uses the fixed Tehran offset in `packages/shared/src/jalali.ts`.
- Schema change: edit `apps/api/src/db/schema.ts`, run `pnpm --filter @manage/api db:generate`, add a matching file in `apps/api/src/db/down/`, document it in [docs/DATABASE.md](docs/DATABASE.md).
- Pinned majors (TypeScript 5.9, NestJS 11, Next 16, Zod 4, Drizzle 0.45); see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before upgrading.

## Commands

```bash
pnpm install && pnpm dev          # local stack on embedded PostgreSQL (PGlite)
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm test:e2e                     # Playwright (Windows: installed Edge)
```

## Before stopping

Update [PROGRESS.md](PROGRESS.md) with: last commit, test status, unfinished work, exact next step. Update [CHANGELOG.md](CHANGELOG.md) for user-visible changes.

## Current branch boundary

Since 2026-11-05 (PR #49) main holds the whole published platform (#16–#48) plus staff recovery; the old stacked PRs were closed with owner approval and their branches are listed for deletion in docs/GITHUB_AUDIT.md. Branch new platform work from current main and target PRs at main; consult docs/GITHUB_AUDIT.md and PROGRESS.md before choosing a base. Keep legacy prototype work in its own branch. Documentation links and API inventory: node scripts/check-docs.mjs (CI enforced). Read-only server inspection is not deployment approval; never run the existing deploy script against unpreserved changes.
