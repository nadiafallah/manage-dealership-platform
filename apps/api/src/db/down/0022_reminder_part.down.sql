-- Reverses 0022_reminder_part: reminders lose their part link and keep their car link.
-- No data of other tables is touched.
ALTER TABLE "reminders" DROP CONSTRAINT IF EXISTS "reminders_part_request_id_part_requests_id_fk";
ALTER TABLE "reminders" DROP COLUMN IF EXISTS "part_request_id";
