# API reference

This reference describes the TypeScript platform on the personal-authentication branch (PR #21 and its descendants). The legacy prototype companion has a separate API and is not connected to this application.

## Transport and authentication

Base path: `/api/v1`. The browser uses the Next.js same-origin proxy; the API and database stay internal on hosted Preview. JSON bodies are limited to 2 MB. State-changing requests require `x-manage-client: web` (any nonempty value identifies an intentional API client). Send `Content-Type: application/json` for JSON. Never put credentials in URLs or reports.

`GET /auth/options` returns `{ "totpEnabled": true }` in personal mode. With `TOTP_AUTH_ENABLED=false`, the local synthetic demo uses `POST /auth/login` with `username` and `password`. Personal mode rejects this legacy password-only login.

Personal login:

1. `POST /auth/email/login`: `{ "email": "operator@example.invalid", "password": "<personal-password>" }` returns `challengeId`, `proof`, `expiresIn` (300 seconds).
2. `POST /auth/email/verify`: `{ "challengeId": "<uuid>", "proof": "<challenge-proof>", "code": "<six-digit-code>" }` returns the current user and sets the session cookie. A code/challenge is single-use; do not automatically replay verification.
3. Send the cookie with subsequent requests. `GET /auth/me` returns identity/roles/permissions; `POST /auth/logout` revokes the session and returns 204.

The cookie is HttpOnly, SameSite=Lax and Secure when `COOKIE_SECURE=true`. Cookie name is defined in [auth.types.ts](../apps/api/src/auth/auth.types.ts). There is no public bearer-token API or SMTP login service.

Invitations require `user.manage`: `POST /auth/invitations` takes `email`, `displayName`, `roles` and returns a private activation URL; `GET /auth/invitations` lists invitations. Public accept takes `token` and a password (12–128 characters), returns an enrollment challenge plus confidential QR/secret; confirm takes `challengeId`, `proof`, `code`. Confirmation activates the account; then sign in normally. See [Persian guide](PERSONAL_AUTH_FA.md). Never log invitation URLs, proofs, QR seeds, passwords or cookies.

`POST /auth/users/:id/recovery` requires `user.manage` and the actual owner; returns `recoveryUrl` (single use, one hour) and `expiresAt`. Errors: 403 for anyone else, 404 outside the tenant, 409 `RECOVERY_OWNER` and `RECOVERY_NOT_ACTIVE`. The link uses the same public accept and confirm endpoints. On confirmation the password and Authenticator are replaced and all sessions of that user are revoked; roles and permissions do not change.

## Domain contracts

The exact request fields and enums are [shared schemas](../packages/shared/src/schemas.ts); personal-auth contracts are [email.contracts.ts](../apps/api/src/auth/email.contracts.ts). Controllers below name the schema passed to `ZodPipe`. All IDs are UUIDs. Tenant comes from the session; clients cannot select a tenant. [Permissions](../packages/shared/src/permissions.ts) and service-level workflow rules are enforced on the server.

- Cases: create/search/detail/update, stage, tasks, blockers and timeline. List query validation includes filters/pagination; use `caseListQuerySchema` rather than inventing filter names.
- Assessments: draft versions and items, finalization, recorded official authorization. Manage records official decisions; it does not issue them.
- Parts: request, create from approved assessment, import, lifecycle actions. Import is a JSON/base64 contract defined by `importPartsSchema`, not multipart upload; preview before committing. The UI supplies a synthetic template.
- Finance: shares, proposed advance/exception, separate approval and receipt, settlement payments. A proposer cannot approve their own request.
- Completion: QC rounds, independent technical/financial close, handover. Service rules recheck prerequisites; changing stage cannot bypass them.
- Reminders (phase 3, any signed-in user): `POST /reminders` (`reminderSendSchema`: `userIds` and/or `role`, optional `caseId`/`plate`, `body` ≤ 300, `urgency`), `GET /reminders/inbox` (open cards), `GET /reminders` (received and sent with each recipient's status and reply), `POST /reminders/:recipientId/respond` (`seen` / `done` / `reply`). Recipients must be active users of the same dealership (422 `INVALID_RECIPIENT`); the sender is never a recipient (422 `NO_RECIPIENTS`). A technician attaches only a case of an own job and reports a problem with `POST /workshop/my-tasks/:id/problem` (`technicianProblemSchema`), which reaches the case's accident responsible.
- Technician wages (phase 3): `PUT /tasks/:id/wage` (`wage.manage`; `expectedVersion` 0 for a new wage; a change needs `reason`, 422 `WAGE_REASON_REQUIRED`), `GET /cases/:id/wages` and `GET /tasks/:id/wage-history` (`wage.manage` or `wage.report`), `GET /reports/wages[?month=1405-08]` and `/reports/wages/export` (Excel, `wage.report`). The technician reaches only `GET /workshop/my-work[?month=]`, `POST /workshop/my-tasks/:id/wage-seen` and the own `wage` field of `GET /workshop/my-tasks`; no assessment amount or other person's wage is returned to them.
- Responsibility (phase 3): `GET /cases/:id/responsibility`, `POST /cases/:id/transfer` (`caseTransferSchema`, `case.update`; target must be an active accident coordinator, 422 `INVALID_RESPONSIBLE` / `SAME_RESPONSIBLE`), `GET /reports/responsibility[?month=]` (`report.manager`).
- Owner controls (phase 3, actual owner only): `GET /access/system-admins`, `PUT /access/users/:id/staff-admin` (`staffAdminSchema`: grant or remove `user.manage` of a system administrator through the personal override), `GET /access/admin-actions[?month=]` (audit rows of non-owner system administrators). A non-owner system administrator gets 422 `SUPPORT_REASON_REQUIRED` when unlocking a technician (new PIN, activation), correcting a recorded case value, moving a case back a stage, editing a repair job or transferring a case without a reason.

Updates and actions use the appropriate `expectedVersion` from the latest server response where required by their schema. On 409, refetch and show the conflict; never silently overwrite. Amounts are whole Rials; timestamps are UTC ISO strings. Convert to Jalali for display only.

`Idempotency-Key` (at most 100 characters) supports sequential replay of authenticated POST/PATCH domain requests, scoped to tenant/user. Use a fresh key for a distinct command and keep the same payload on retry. Authentication responses are excluded, PUT is not cached, and this mechanism does not guarantee exactly-once concurrent commands or implement LAN sync.

## Responses and failure handling

Error envelope: `{ "statusCode": 409, "code": "<stable-code>", "message": "<Persian-message>", "details": {}, "requestId": "<id>" }` (optional fields may be absent). Handle the stable `code`; do not parse translated messages. 400 = invalid request, 401 = no usable session, 403 = permission/mode/CSRF rejection, 404 = missing or inaccessible tenant entity, 409 = version/workflow conflict, 429 = throttled. Expired personal-login challenges require starting again.

Synthetic local smoke check (no credentials):

```bash
curl --fail http://localhost:3000/api/v1/health
curl --fail http://localhost:3000/api/v1/auth/options
```

Health includes DB/environment/commit fields; commit can be null if no build SHA was supplied. Hosted gate visibility can differ from direct internal health. [Integration tests](../apps/api/test) provide executable synthetic examples; no Swagger/OpenAPI endpoint is currently published.

## Route inventory

Generated from controller decorators by `node scripts/check-docs.mjs --write`; CI checks for drift. The linked controller declares each route's permissions, schema and status overrides.

<!-- routes:start -->
| Method | Route | Controller |
| --- | --- | --- |
| GET | `/api/v1/access/admin-actions` | [source](../apps/api/src/people/people.controllers.ts) |
| GET | `/api/v1/access/presets` | [source](../apps/api/src/auth/access.controller.ts) |
| GET | `/api/v1/access/system-admins` | [source](../apps/api/src/people/people.controllers.ts) |
| GET | `/api/v1/access` | [source](../apps/api/src/auth/access.controller.ts) |
| GET | `/api/v1/alerts` | [source](../apps/api/src/alerts/alerts.controller.ts) |
| GET | `/api/v1/auth/invitations/email/status` | [source](../apps/api/src/auth/email-auth.controller.ts) |
| GET | `/api/v1/auth/invitations` | [source](../apps/api/src/auth/email-auth.controller.ts) |
| GET | `/api/v1/auth/me` | [source](../apps/api/src/auth/auth.controller.ts) |
| GET | `/api/v1/auth/options` | [source](../apps/api/src/auth/email-auth.controller.ts) |
| GET | `/api/v1/cases/:id/alerts/history` | [source](../apps/api/src/alerts/alerts.controller.ts) |
| GET | `/api/v1/cases/:id/assessments` | [source](../apps/api/src/assessments/assessments.controller.ts) |
| GET | `/api/v1/cases/:id/completion` | [source](../apps/api/src/completion/completion.controller.ts) |
| GET | `/api/v1/cases/:id/external-work` | [source](../apps/api/src/parts/parts-operations.controller.ts) |
| GET | `/api/v1/cases/:id/finance` | [source](../apps/api/src/finance/finance.controller.ts) |
| GET | `/api/v1/cases/:id/parts-statement/export` | [source](../apps/api/src/parts/parts-operations.controller.ts) |
| GET | `/api/v1/cases/:id/parts-statement` | [source](../apps/api/src/parts/parts-operations.controller.ts) |
| GET | `/api/v1/cases/:id/parts` | [source](../apps/api/src/parts/parts.controller.ts) |
| GET | `/api/v1/cases/:id/provenance` | [source](../apps/api/src/vehicle-import/vehicle-import.controller.ts) |
| GET | `/api/v1/cases/:id/responsibility` | [source](../apps/api/src/people/people.controllers.ts) |
| GET | `/api/v1/cases/:id/timeline` | [source](../apps/api/src/accident/accident.controllers.ts) |
| GET | `/api/v1/cases/:id/wages` | [source](../apps/api/src/people/people.controllers.ts) |
| GET | `/api/v1/cases/:id` | [source](../apps/api/src/accident/accident.controllers.ts) |
| GET | `/api/v1/cases` | [source](../apps/api/src/accident/accident.controllers.ts) |
| GET | `/api/v1/control-room` | [source](../apps/api/src/control-room/control-room.controller.ts) |
| GET | `/api/v1/daily-reports/imports/:id/report` | [source](../apps/api/src/daily-reports/daily-reports.controller.ts) |
| GET | `/api/v1/daily-reports/imports/:id/rows` | [source](../apps/api/src/daily-reports/daily-reports.controller.ts) |
| GET | `/api/v1/daily-reports/imports/:id` | [source](../apps/api/src/daily-reports/daily-reports.controller.ts) |
| GET | `/api/v1/daily-reports/imports` | [source](../apps/api/src/daily-reports/daily-reports.controller.ts) |
| GET | `/api/v1/daily-reports/profiles/:kind` | [source](../apps/api/src/daily-reports/daily-reports.controller.ts) |
| GET | `/api/v1/daily-reports/status` | [source](../apps/api/src/daily-reports/daily-reports.controller.ts) |
| GET | `/api/v1/dashboard` | [source](../apps/api/src/accident/accident.controllers.ts) |
| GET | `/api/v1/departments` | [source](../apps/api/src/reference/reference.controller.ts) |
| GET | `/api/v1/desk/folders/:id` | [source](../apps/api/src/desk/desk.controller.ts) |
| GET | `/api/v1/desk/folders` | [source](../apps/api/src/desk/desk.controller.ts) |
| GET | `/api/v1/emdad/requests/:id` | [source](../apps/api/src/daily-reports/daily-reports.controller.ts) |
| GET | `/api/v1/health` | [source](../apps/api/src/health/health.controller.ts) |
| GET | `/api/v1/notifications` | [source](../apps/api/src/daily-reports/daily-reports.controller.ts) |
| GET | `/api/v1/part-discrepancies/:id/history` | [source](../apps/api/src/discrepancies/discrepancies.controller.ts) |
| GET | `/api/v1/part-discrepancies` | [source](../apps/api/src/discrepancies/discrepancies.controller.ts) |
| GET | `/api/v1/parts/contractors` | [source](../apps/api/src/parts/parts-operations.controller.ts) |
| GET | `/api/v1/parts/desk` | [source](../apps/api/src/parts/parts.controller.ts) |
| GET | `/api/v1/parts/external-work` | [source](../apps/api/src/parts/parts-operations.controller.ts) |
| GET | `/api/v1/parts/operations/notices` | [source](../apps/api/src/parts/parts-operations.controller.ts) |
| GET | `/api/v1/parts/workbench/notices` | [source](../apps/api/src/parts/parts-operations.controller.ts) |
| GET | `/api/v1/parts/workbench` | [source](../apps/api/src/parts/parts.controller.ts) |
| GET | `/api/v1/price-notices` | [source](../apps/api/src/parts/parts.controller.ts) |
| GET | `/api/v1/reference-data/:kind/sample` | [source](../apps/api/src/reference-data/reference-data.controller.ts) |
| GET | `/api/v1/reference-data/:kind` | [source](../apps/api/src/reference-data/reference-data.controller.ts) |
| GET | `/api/v1/reference-imports/:id/report` | [source](../apps/api/src/reference-data/reference-data.controller.ts) |
| GET | `/api/v1/reference-imports/:id` | [source](../apps/api/src/reference-data/reference-data.controller.ts) |
| GET | `/api/v1/reminders/inbox` | [source](../apps/api/src/people/people.controllers.ts) |
| GET | `/api/v1/reminders/people` | [source](../apps/api/src/people/people.controllers.ts) |
| GET | `/api/v1/reminders` | [source](../apps/api/src/people/people.controllers.ts) |
| GET | `/api/v1/reports/export` | [source](../apps/api/src/reports/reports.controller.ts) |
| GET | `/api/v1/reports/pdf` | [source](../apps/api/src/reports/reports.controller.ts) |
| GET | `/api/v1/reports/responsibility` | [source](../apps/api/src/people/people.controllers.ts) |
| GET | `/api/v1/reports/views` | [source](../apps/api/src/reports/reports.controller.ts) |
| GET | `/api/v1/reports/wages/export` | [source](../apps/api/src/people/people.controllers.ts) |
| GET | `/api/v1/reports/wages` | [source](../apps/api/src/people/people.controllers.ts) |
| GET | `/api/v1/reports` | [source](../apps/api/src/reports/reports.controller.ts) |
| GET | `/api/v1/settings/alerts` | [source](../apps/api/src/alerts/alerts.controller.ts) |
| GET | `/api/v1/staff/technicians` | [source](../apps/api/src/auth/technicians.controller.ts) |
| GET | `/api/v1/stock/options` | [source](../apps/api/src/daily-reports/daily-reports.controller.ts) |
| GET | `/api/v1/stock/reservations/export` | [source](../apps/api/src/daily-reports/daily-reports.controller.ts) |
| GET | `/api/v1/stock/reservations` | [source](../apps/api/src/daily-reports/daily-reports.controller.ts) |
| GET | `/api/v1/tasks/:id/wage-history` | [source](../apps/api/src/people/people.controllers.ts) |
| GET | `/api/v1/users/assignable` | [source](../apps/api/src/reference/reference.controller.ts) |
| GET | `/api/v1/vehicle-imports/:id/report` | [source](../apps/api/src/vehicle-import/vehicle-import.controller.ts) |
| GET | `/api/v1/vehicle-imports/:id` | [source](../apps/api/src/vehicle-import/vehicle-import.controller.ts) |
| GET | `/api/v1/vehicle-imports/sample` | [source](../apps/api/src/vehicle-import/vehicle-import.controller.ts) |
| GET | `/api/v1/vehicle-imports` | [source](../apps/api/src/vehicle-import/vehicle-import.controller.ts) |
| GET | `/api/v1/workshop/calendar/iran-holidays` | [source](../apps/api/src/workshop/workshop.controller.ts) |
| GET | `/api/v1/workshop/calendar` | [source](../apps/api/src/workshop/workshop.controller.ts) |
| GET | `/api/v1/workshop/my-tasks` | [source](../apps/api/src/workshop/workshop.controller.ts) |
| GET | `/api/v1/workshop/my-work` | [source](../apps/api/src/people/people.controllers.ts) |
| GET | `/api/v1/workshop/overview` | [source](../apps/api/src/workshop/workshop.controller.ts) |
| GET | `/api/v1/workshop/plan-suggestion` | [source](../apps/api/src/workshop/workshop.controller.ts) |
| GET | `/api/v1/workshop/quotes` | [source](../apps/api/src/workshop/workshop.controller.ts) |
| GET | `/api/v1/workshop/staff` | [source](../apps/api/src/workshop/workshop.controller.ts) |
| GET | `/api/v1/workshop/stations` | [source](../apps/api/src/workshop/workshop.controller.ts) |
| PATCH | `/api/v1/assessment-items/:id` | [source](../apps/api/src/assessments/assessments.controller.ts) |
| PATCH | `/api/v1/cases/:id` | [source](../apps/api/src/accident/accident.controllers.ts) |
| PATCH | `/api/v1/daily-reports/profiles/:kind` | [source](../apps/api/src/daily-reports/daily-reports.controller.ts) |
| PATCH | `/api/v1/emdad/requests/:id/follow-up` | [source](../apps/api/src/daily-reports/daily-reports.controller.ts) |
| PATCH | `/api/v1/parts/contractors/:id` | [source](../apps/api/src/parts/parts-operations.controller.ts) |
| PATCH | `/api/v1/tasks/:id` | [source](../apps/api/src/accident/accident.controllers.ts) |
| PATCH | `/api/v1/workshop/stations/:id` | [source](../apps/api/src/workshop/workshop.controller.ts) |
| POST | `/api/v1/assessment-items/:id/remove` | [source](../apps/api/src/assessments/assessments.controller.ts) |
| POST | `/api/v1/assessments/:id/authorization` | [source](../apps/api/src/assessments/assessments.controller.ts) |
| POST | `/api/v1/assessments/:id/finalize` | [source](../apps/api/src/assessments/assessments.controller.ts) |
| POST | `/api/v1/assessments/:id/import` | [source](../apps/api/src/assessments/assessments.controller.ts) |
| POST | `/api/v1/assessments/:id/items` | [source](../apps/api/src/assessments/assessments.controller.ts) |
| POST | `/api/v1/auth/email/login` | [source](../apps/api/src/auth/email-auth.controller.ts) |
| POST | `/api/v1/auth/email/verify` | [source](../apps/api/src/auth/email-auth.controller.ts) |
| POST | `/api/v1/auth/invitations/accept` | [source](../apps/api/src/auth/email-auth.controller.ts) |
| POST | `/api/v1/auth/invitations/confirm` | [source](../apps/api/src/auth/email-auth.controller.ts) |
| POST | `/api/v1/auth/invitations/email/check` | [source](../apps/api/src/auth/email-auth.controller.ts) |
| POST | `/api/v1/auth/invitations/email` | [source](../apps/api/src/auth/email-auth.controller.ts) |
| POST | `/api/v1/auth/invitations` | [source](../apps/api/src/auth/email-auth.controller.ts) |
| POST | `/api/v1/auth/login` | [source](../apps/api/src/auth/auth.controller.ts) |
| POST | `/api/v1/auth/logout` | [source](../apps/api/src/auth/auth.controller.ts) |
| POST | `/api/v1/auth/technician-login` | [source](../apps/api/src/auth/auth.controller.ts) |
| POST | `/api/v1/auth/users/:id/recovery` | [source](../apps/api/src/auth/email-auth.controller.ts) |
| POST | `/api/v1/blockers/:id/follow-up` | [source](../apps/api/src/accident/accident.controllers.ts) |
| POST | `/api/v1/blockers/:id/resolve` | [source](../apps/api/src/accident/accident.controllers.ts) |
| POST | `/api/v1/cases/:id/alerts/respond` | [source](../apps/api/src/alerts/alerts.controller.ts) |
| POST | `/api/v1/cases/:id/assessments` | [source](../apps/api/src/assessments/assessments.controller.ts) |
| POST | `/api/v1/cases/:id/blockers` | [source](../apps/api/src/accident/accident.controllers.ts) |
| POST | `/api/v1/cases/:id/delivery` | [source](../apps/api/src/completion/completion.controller.ts) |
| POST | `/api/v1/cases/:id/external-work` | [source](../apps/api/src/parts/parts-operations.controller.ts) |
| POST | `/api/v1/cases/:id/finance/approvals` | [source](../apps/api/src/finance/finance.controller.ts) |
| POST | `/api/v1/cases/:id/finance/payments` | [source](../apps/api/src/finance/finance.controller.ts) |
| POST | `/api/v1/cases/:id/financial-close` | [source](../apps/api/src/completion/completion.controller.ts) |
| POST | `/api/v1/cases/:id/parts-statement/:partId/consume` | [source](../apps/api/src/parts/parts-operations.controller.ts) |
| POST | `/api/v1/cases/:id/parts-statement` | [source](../apps/api/src/parts/parts-operations.controller.ts) |
| POST | `/api/v1/cases/:id/parts/from-assessment` | [source](../apps/api/src/parts/parts.controller.ts) |
| POST | `/api/v1/cases/:id/parts/import` | [source](../apps/api/src/parts/parts.controller.ts) |
| POST | `/api/v1/cases/:id/parts` | [source](../apps/api/src/parts/parts.controller.ts) |
| POST | `/api/v1/cases/:id/qc` | [source](../apps/api/src/completion/completion.controller.ts) |
| POST | `/api/v1/cases/:id/repair-plan/steps` | [source](../apps/api/src/accident/accident.controllers.ts) |
| POST | `/api/v1/cases/:id/stage` | [source](../apps/api/src/accident/accident.controllers.ts) |
| POST | `/api/v1/cases/:id/tasks` | [source](../apps/api/src/accident/accident.controllers.ts) |
| POST | `/api/v1/cases/:id/technical-close` | [source](../apps/api/src/completion/completion.controller.ts) |
| POST | `/api/v1/cases/:id/transfer` | [source](../apps/api/src/people/people.controllers.ts) |
| POST | `/api/v1/cases` | [source](../apps/api/src/accident/accident.controllers.ts) |
| POST | `/api/v1/daily-reports/imports/:id/apply` | [source](../apps/api/src/daily-reports/daily-reports.controller.ts) |
| POST | `/api/v1/daily-reports/imports/:id/discard` | [source](../apps/api/src/daily-reports/daily-reports.controller.ts) |
| POST | `/api/v1/daily-reports/imports/:id/retry` | [source](../apps/api/src/daily-reports/daily-reports.controller.ts) |
| POST | `/api/v1/daily-reports/uploads` | [source](../apps/api/src/daily-reports/daily-reports.controller.ts) |
| POST | `/api/v1/emdad/requests/:id/match` | [source](../apps/api/src/daily-reports/daily-reports.controller.ts) |
| POST | `/api/v1/emdad/requests/export` | [source](../apps/api/src/daily-reports/daily-reports.controller.ts) |
| POST | `/api/v1/emdad/requests/search` | [source](../apps/api/src/daily-reports/daily-reports.controller.ts) |
| POST | `/api/v1/financial-approvals/:id/decision` | [source](../apps/api/src/finance/finance.controller.ts) |
| POST | `/api/v1/financial-approvals/:id/payment` | [source](../apps/api/src/finance/finance.controller.ts) |
| POST | `/api/v1/notifications/read` | [source](../apps/api/src/daily-reports/daily-reports.controller.ts) |
| POST | `/api/v1/part-discrepancies/:id/assign` | [source](../apps/api/src/discrepancies/discrepancies.controller.ts) |
| POST | `/api/v1/part-discrepancies/:id/resolve` | [source](../apps/api/src/discrepancies/discrepancies.controller.ts) |
| POST | `/api/v1/parts/:id/actions` | [source](../apps/api/src/parts/parts.controller.ts) |
| POST | `/api/v1/parts/:id/flow` | [source](../apps/api/src/parts/parts.controller.ts) |
| POST | `/api/v1/parts/contractors` | [source](../apps/api/src/parts/parts-operations.controller.ts) |
| POST | `/api/v1/parts/external-work/:id/actions` | [source](../apps/api/src/parts/parts-operations.controller.ts) |
| POST | `/api/v1/parts/workbench/:id/actions` | [source](../apps/api/src/parts/parts.controller.ts) |
| POST | `/api/v1/price-notices/:id/respond` | [source](../apps/api/src/parts/parts.controller.ts) |
| POST | `/api/v1/reference-data/:kind/search` | [source](../apps/api/src/reference-data/reference-data.controller.ts) |
| POST | `/api/v1/reference-imports/:id/apply` | [source](../apps/api/src/reference-data/reference-data.controller.ts) |
| POST | `/api/v1/reference-imports/inspect` | [source](../apps/api/src/reference-data/reference-data.controller.ts) |
| POST | `/api/v1/reference-imports` | [source](../apps/api/src/reference-data/reference-data.controller.ts) |
| POST | `/api/v1/reminders/:id/respond` | [source](../apps/api/src/people/people.controllers.ts) |
| POST | `/api/v1/reminders/parts-ready/:id` | [source](../apps/api/src/people/people.controllers.ts) |
| POST | `/api/v1/reminders` | [source](../apps/api/src/people/people.controllers.ts) |
| POST | `/api/v1/staff/technicians/:id/sign-out` | [source](../apps/api/src/auth/technicians.controller.ts) |
| POST | `/api/v1/staff/technicians` | [source](../apps/api/src/auth/technicians.controller.ts) |
| POST | `/api/v1/stock/aliases` | [source](../apps/api/src/daily-reports/daily-reports.controller.ts) |
| POST | `/api/v1/stock/reservations/:id/actions` | [source](../apps/api/src/daily-reports/daily-reports.controller.ts) |
| POST | `/api/v1/stock/reservations` | [source](../apps/api/src/daily-reports/daily-reports.controller.ts) |
| POST | `/api/v1/tasks/:id/actions` | [source](../apps/api/src/accident/accident.controllers.ts) |
| POST | `/api/v1/tasks/:id/part-pickup` | [source](../apps/api/src/parts/parts.controller.ts) |
| POST | `/api/v1/vehicle-imports/:id/apply` | [source](../apps/api/src/vehicle-import/vehicle-import.controller.ts) |
| POST | `/api/v1/vehicle-imports` | [source](../apps/api/src/vehicle-import/vehicle-import.controller.ts) |
| POST | `/api/v1/workshop/calendar` | [source](../apps/api/src/workshop/workshop.controller.ts) |
| POST | `/api/v1/workshop/my-tasks/:id/actions` | [source](../apps/api/src/workshop/workshop.controller.ts) |
| POST | `/api/v1/workshop/my-tasks/:id/problem` | [source](../apps/api/src/people/people.controllers.ts) |
| POST | `/api/v1/workshop/my-tasks/:id/wage-seen` | [source](../apps/api/src/people/people.controllers.ts) |
| POST | `/api/v1/workshop/parts/:id/quotes` | [source](../apps/api/src/workshop/workshop.controller.ts) |
| POST | `/api/v1/workshop/quotes/:id/decision` | [source](../apps/api/src/workshop/workshop.controller.ts) |
| POST | `/api/v1/workshop/setup-trades` | [source](../apps/api/src/workshop/workshop.controller.ts) |
| POST | `/api/v1/workshop/stations` | [source](../apps/api/src/workshop/workshop.controller.ts) |
| PUT | `/api/v1/access/templates/:role` | [source](../apps/api/src/auth/access.controller.ts) |
| PUT | `/api/v1/access/users/:id/staff-admin` | [source](../apps/api/src/people/people.controllers.ts) |
| PUT | `/api/v1/access/users/:id` | [source](../apps/api/src/auth/access.controller.ts) |
| PUT | `/api/v1/cases/:id/finance/shares` | [source](../apps/api/src/finance/finance.controller.ts) |
| PUT | `/api/v1/settings/alerts` | [source](../apps/api/src/alerts/alerts.controller.ts) |
| PUT | `/api/v1/staff/technicians/:id/active` | [source](../apps/api/src/auth/technicians.controller.ts) |
| PUT | `/api/v1/staff/technicians/:id/pin` | [source](../apps/api/src/auth/technicians.controller.ts) |
| PUT | `/api/v1/tasks/:id/wage` | [source](../apps/api/src/people/people.controllers.ts) |
<!-- routes:end -->

## Staff invitation email

GET /auth/invitations/email/status requires user.manage and returns only { configured: boolean }, not credentials. POST /auth/invitations/email accepts the same email/displayName/roles schema, commits a pending account and then attempts one SMTP delivery. It returns { id, status: "invited", emailDelivery: "sent" | "failed" }; no invitation URL is returned. Missing configuration fails with 503 INVITATION_MAIL_NOT_CONFIGURED before creating an account. A failed send returns a persisted failed status, not a false success or raw SMTP error. Explicit resend creates a new invitation for the same pending account and invalidates older tokens; active users return 409. Authentication responses are no-store and excluded from the replay cache. A failed send also returns failure: a category (dns_failed, connection_blocked, tls_failed, auth_failed, recipient_rejected, unknown), never the raw error. POST /auth/invitations/email/check (user.manage, 3/min) connects, negotiates TLS and authenticates the sender without sending, returns { status: "ready" | "not_configured" } or { status: "failed", failure }, and audits only that result. GET /auth/invitations adds invitationDelivery, invitationSentAt, invitationFailure and invitationExpiresAt from the latest tenant-scoped invite; active account status takes precedence. SMTP acceptance does not guarantee inbox delivery. See [staff guide](STAFF_FA.md).

## Existing-vehicle import

`case.import` (service manager) only. `POST /vehicle-imports` takes { fileName, fileBase64 (≤1 MB .xlsx), decisions: { dateWithoutTime, deadlineAs: none | forecast | official } } and stores a preview without touching cases. It returns VehicleImport: the sheet and header row found, blank template rows, unmapped columns, per-outcome counts, and every data row with its original cells (source), identity, matched case, field changes and Persian messages. Outcomes: new, update, unchanged, duplicate, incomplete, needs_review, error. `POST /vehicle-imports/:id/apply` re-evaluates the stored rows against current data and writes new/update rows one by one: status applied, or partial if a row failed (that row becomes error with a message). Applying twice returns 409 IMPORT_NOT_PREVIEW. `GET /vehicle-imports`, `GET /vehicle-imports/:id`, `GET /vehicle-imports/:id/report` (.xlsx with issued case numbers) and `GET /vehicle-imports/sample` (synthetic template). `GET /cases/:id/provenance` (case.read) lists applied import rows of a case with original cells. Invalid files return IMPORT_FILE_INVALID; empty sheets IMPORT_EMPTY; more than 1000 rows IMPORT_TOO_LARGE. Rules: [vehicle import guide](VEHICLE_IMPORT_FA.md).

## Reports center

`GET /reports/views` returns the views the caller's permissions allow (manager: report.manager; parts: part.manage; accident: case.update; workshop: task.manage or qc.inspect), the role's default view, and the default responsible filter ("me" for an accident expert). `GET /reports?view=…` accepts period (today | week | month | custom with Jalali from/to, inclusive), responsibleUserId (uuid | me | none), departmentId, stage, coverage, blockerReason, partStatus, q (case/admission number, plate, VIN or chassis), kind, page and pageSize (≤200). It returns ReportResult: the generation time, a test-data flag, the period and the same-length previous period, filter labels, up to 6 KPIs (unit, definition, linked case-list query or work-list kind), charts (bars or trend with a table alternative, excluded counts where data is missing), events compared with the previous period, and the prioritized work list paged on the server. A view the role may not open returns 403. `GET /reports/export?…` returns an .xlsx with a summary sheet (title, time, period, filters, KPIs) and every filtered work-list row (up to 5000, with a notice when truncated). No customer phone numbers are included. The case list also accepts `blockerReason` and the flags `overdue_official`, `overdue_forecast` and `no_deadline`. Definitions: [REPORTS_FA.md](REPORTS_FA.md).

## Assessment dispatch and day-based planning

`POST /cases/:id/parts/from-assessment` accepts `{assessmentId, expectedVersion, itemIds, source?}` for explicit single/bulk dispatch. Selection is validated atomically against the current draft/final version, tenant and technical-line identities; repeat selection creates no duplicate, and only incremental quantities are sent. Reduced quantities, changed requested codes, rejected/labour or foreign line IDs fail rather than altering supply history. The legacy empty body dispatches all ready needs. Generic assessment authorization is not a dispatch/company-order gate; external buying still requires a recorded quote of the exact price/quantity/supplier.

Case create/update accept `repairDurationDays` in quarter-day steps (0.25–365); the server derives internal forecast and nullable `repairPlan` from the admission anchor and frozen working calendar. Existing official dates are independent; revising an existing plan requires a reason. Task create/update accept `durationDays` (0.25–180) instead of `durationMinutes`; the two cannot be combined. With no explicit start, day plans follow the maximum planned predecessor end or the case/admission start. Read reports expose original planned work/day units and non-overlapping case allocations; earlier task baselines/calendar snapshots are retained.
