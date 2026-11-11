-- Restores the role codes, active flags, role templates and reminder target roles
-- exactly as they were before migration 0020, from role_migration_log. Sessions
-- revoked for deactivated accounts stay revoked (people sign in again).
UPDATE "users" u SET
	"roles" = ARRAY(SELECT jsonb_array_elements_text(l."before"->'roles')),
	"is_active" = (l."before"->>'is_active')::boolean,
	"version" = u."version" + 1,
	"updated_at" = now()
FROM "role_migration_log" l
WHERE l."migration" = '0020' AND l."entity" = 'user' AND l."entity_id" = u."id";
UPDATE "tenants" t SET
	"permission_templates" = l."before"->'permission_templates',
	"permission_version" = t."permission_version" + 1
FROM "role_migration_log" l
WHERE l."migration" = '0020' AND l."entity" = 'tenant' AND l."entity_id" = t."id";
UPDATE "reminders" r SET "target_role" = l."before"->>'target_role'
FROM "role_migration_log" l
WHERE l."migration" = '0020' AND l."entity" = 'reminder' AND l."entity_id" = r."id";
DROP TABLE "role_migration_log";
