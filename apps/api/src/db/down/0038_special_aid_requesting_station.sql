-- Rehearsal rollback only. Never run on production without a verified backup.
-- Reverts 0038_special_aid_requesting_station: the station that asked for a special-aid part.
ALTER TABLE "special_aid_items" DROP COLUMN IF EXISTS "requesting_station";
