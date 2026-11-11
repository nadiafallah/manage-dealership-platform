-- Package 7: a reminder may point to one part line of its car (spec §9 «وصل به خودرو یا قطعه»).
-- Additive and nullable: existing reminders keep their car link only. Down: src/db/down/0022_reminder_part.down.sql
ALTER TABLE "reminders" ADD COLUMN "part_request_id" uuid;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_part_request_id_part_requests_id_fk" FOREIGN KEY ("part_request_id") REFERENCES "public"."part_requests"("id") ON DELETE no action ON UPDATE no action;
