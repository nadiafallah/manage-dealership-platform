<div align="center">

<img src="apps/web/public/brand/logo-light.png" alt="Manage by HEDAX" width="300">

### Dealership operations, from intake to delivery.

[فارسی](README.md) · [Architecture](docs/ARCHITECTURE.md) · [API](docs/API.md) · [Roadmap](docs/ROADMAP.md) · [Progress](PROGRESS.md)

</div>

Manage follows every vehicle in a dealership workshop from admission to handover, so the service manager, accident supervisor, assessors, parts, cashier and quality control always know where each car is, what it is waiting for and who has to act. The interface is Persian (RTL) and the data model separates dealerships (tenants) from day one, for multi-dealership and multi-brand use.

**Status:** the first module (accident repair) is in use and under test at an Iran Khodro dealership. Integrations with official systems (manufacturer, roadside assistance, insurers, accounting) and offline operation are on the [roadmap](docs/ROADMAP.md). Release notes: [CHANGELOG.md](CHANGELOG.md).

<p align="center">
  <img src="docs/screenshots/readme-dashboard.jpg" alt="Service manager dashboard" width="74%">
  &nbsp;
  <img src="docs/screenshots/readme-cases-mobile.jpg" alt="Case list on a phone" width="22%">
  <br><sub>Service manager dashboard and the case list on a phone (synthetic data).</sub>
</p>

## A vehicle's route

| Stage | What Manage covers |
| --- | --- |
| Intake and case | Vehicle and owner, search by plate, VIN, chassis, name, phone or case number; Excel import of vehicles already in the workshop; coverage type |
| Assessment and approval | Versioned assessment and supplements, assessment import from Excel, official approval records, partial item approval |
| Parts and sourcing | Part needs from the assessment, orders and ETAs, receipt and inspection, reservations from the daily stock report, discrepancy queue |
| Repair and stations | Coded repair plan per department and station; start, blocker, completion and supervisor approval; working calendar and holidays |
| Finance | Payer shares, prepayment with manager and cashier approval, capped exceptions, settlement |
| Quality and handover | QC with corrective work, separate technical and financial close, vehicle handover and archive |
| Management | Role-based workspaces, "needs action" dashboard, reports with PDF and Excel export, three independent times (official deadline, internal forecast, actual delivery) |
| Security and access | Configurable roles and permissions enforced by the API, email + Google Authenticator sign-in, append-only audit trail, installable mobile app (PWA) |

## Run locally (no Docker, no PostgreSQL install)

Requires Node.js 22+ and pnpm 10.

```bash
git clone https://github.com/ali-hedax/manage-dealership-platform.git
cd manage-dealership-platform
git switch main
pnpm install --frozen-lockfile
pnpm dev
```

Web on <http://localhost:3000>, API health on <http://localhost:4000/api/v1/health>. The first run creates a synthetic demo dealership; usernames and the shared password are written to `apps/api/.data/demo-credentials.local.txt` (git-ignored).

## Full stack on PostgreSQL

```bash
cp .env.example .env   # set POSTGRES_PASSWORD and SEED_DEMO_PASSWORD
docker compose up -d --build
```

## Tests

```bash
pnpm test       # unit + API integration tests (embedded PostgreSQL)
pnpm build
pnpm test:e2e   # Playwright
```

Latest results: [docs/TEST_REPORT.md](docs/TEST_REPORT.md).

## Layout

`apps/api` (NestJS, Drizzle, PostgreSQL) · `apps/web` (Next.js) · `packages/shared` (contracts, permissions, Jalali dates) · `docs/`. The earlier single-file prototype is kept unchanged in `legacy/index (4).html`; see the [feature migration plan](docs/PROTOTYPE_MIGRATION.md).

## Documentation

[Architecture](docs/ARCHITECTURE.md) · [Database](docs/DATABASE.md) · [API](docs/API.md) · [Workflows](docs/WORKFLOWS.md) · [Deployment](docs/DEPLOYMENT.md) · [Backup/restore](docs/BACKUP_RESTORE.md) · [Offline roadmap](docs/OFFLINE_SYNC.md) · [Roadmap](docs/ROADMAP.md) · [Security](SECURITY.md) · [Changelog](CHANGELOG.md) · [Progress](PROGRESS.md)

## Rights

© HEDAX. All rights reserved. No open-source license is granted; the code and the brand may not be redistributed. Maintainer: [ali-hedax](https://github.com/ali-hedax).
