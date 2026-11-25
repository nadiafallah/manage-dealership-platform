-- Rehearsal rollback only. Never run on production without a verified backup.
-- Reverts 0037_night_list: the nightly list of the reception module («لیست شب»).
-- Nothing else references these tables; receptions, accident cases, parts and stock are untouched.
DROP TABLE IF EXISTS "night_list_items";
DROP TABLE IF EXISTS "night_lists";
