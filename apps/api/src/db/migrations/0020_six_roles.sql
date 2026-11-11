-- Package 1 (docs/PRODUCT_SPEC_FA.md section 3): five role codes plus the owner flag.
-- accident_coordinator, accident_supervisor and qc_inspector become accident_expert;
-- cashier has no successor. An account left without any role (cashier only) is kept
-- but deactivated. Every changed row is logged with its previous value so the down
-- script can restore it exactly. Role templates return to the code defaults of the
-- specification; personal allow/deny overrides are untouched.
CREATE TABLE "role_migration_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"migration" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "role_migration_log" ("migration", "entity", "entity_id", "tenant_id", "before", "after")
SELECT '0020', 'user', u."id", u."tenant_id",
	jsonb_build_object('roles', to_jsonb(u."roles"), 'is_active', u."is_active"),
	jsonb_build_object('roles', to_jsonb(n."roles"), 'is_active', CASE WHEN cardinality(n."roles") = 0 AND NOT u."is_owner" THEN false ELSE u."is_active" END)
FROM "users" u
CROSS JOIN LATERAL (
	SELECT coalesce(array_agg(DISTINCT x."m" ORDER BY x."m") FILTER (WHERE x."m" IS NOT NULL), '{}'::text[]) AS "roles"
	FROM unnest(u."roles") AS r("role")
	CROSS JOIN LATERAL (
		SELECT CASE
			WHEN r."role" IN ('accident_coordinator', 'accident_supervisor', 'qc_inspector') THEN 'accident_expert'
			WHEN r."role" = 'cashier' THEN NULL
			ELSE r."role"
		END AS "m"
	) x
) n
WHERE u."roles" && ARRAY['accident_coordinator', 'accident_supervisor', 'qc_inspector', 'cashier']::text[];
--> statement-breakpoint
UPDATE "users" u SET
	"roles" = ARRAY(SELECT jsonb_array_elements_text(l."after"->'roles')),
	"is_active" = (l."after"->>'is_active')::boolean,
	"version" = u."version" + 1,
	"updated_at" = now()
FROM "role_migration_log" l
WHERE l."migration" = '0020' AND l."entity" = 'user' AND l."entity_id" = u."id";
--> statement-breakpoint
UPDATE "sessions" s SET "revoked_at" = now()
FROM "role_migration_log" l
WHERE l."migration" = '0020' AND l."entity" = 'user' AND l."entity_id" = s."user_id"
	AND (l."after"->>'is_active')::boolean = false AND s."revoked_at" IS NULL;
--> statement-breakpoint
INSERT INTO "role_migration_log" ("migration", "entity", "entity_id", "tenant_id", "before", "after")
SELECT '0020', 'tenant', t."id", t."id",
	jsonb_build_object('permission_templates', t."permission_templates", 'permission_version', t."permission_version"),
	jsonb_build_object('permission_templates', '{}'::jsonb, 'permission_version', t."permission_version" + 1)
FROM "tenants" t
WHERE t."permission_templates" <> '{}'::jsonb;
--> statement-breakpoint
UPDATE "tenants" t SET
	"permission_templates" = '{}'::jsonb,
	"permission_version" = t."permission_version" + 1
FROM "role_migration_log" l
WHERE l."migration" = '0020' AND l."entity" = 'tenant' AND l."entity_id" = t."id";
--> statement-breakpoint
INSERT INTO "role_migration_log" ("migration", "entity", "entity_id", "tenant_id", "before", "after")
SELECT '0020', 'reminder', r."id", r."tenant_id",
	jsonb_build_object('target_role', r."target_role"),
	jsonb_build_object('target_role', CASE WHEN r."target_role" = 'cashier' THEN NULL ELSE 'accident_expert' END)
FROM "reminders" r
WHERE r."target_role" IN ('accident_coordinator', 'accident_supervisor', 'qc_inspector', 'cashier');
--> statement-breakpoint
UPDATE "reminders" r SET "target_role" = l."after"->>'target_role'
FROM "role_migration_log" l
WHERE l."migration" = '0020' AND l."entity" = 'reminder' AND l."entity_id" = r."id";
