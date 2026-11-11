-- Package 3 (spec section 7): «اعلام قیمت». The parts clerk may announce the sale
-- price of one line; the accident expert confirms or gives another instruction.
-- Never blocks work. Additive only; price changes themselves stay in part_requests
-- and the audit trail. Part lines may now also have status 'returned' and stock
-- reservations status 'returned' (both text columns, no constraint change).
CREATE TABLE "part_price_notices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"part_request_id" uuid NOT NULL,
	"sale_unit_rial" bigint NOT NULL,
	"note" text,
	"announced_by" uuid NOT NULL,
	"announced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"response" text,
	"instruction" text,
	"responded_by" uuid,
	"responded_at" timestamp with time zone,
	"is_test" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "part_price_notices" ADD CONSTRAINT "part_price_notices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_price_notices" ADD CONSTRAINT "part_price_notices_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_price_notices" ADD CONSTRAINT "part_price_notices_part_request_id_part_requests_id_fk" FOREIGN KEY ("part_request_id") REFERENCES "public"."part_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_price_notices" ADD CONSTRAINT "part_price_notices_announced_by_users_id_fk" FOREIGN KEY ("announced_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_price_notices" ADD CONSTRAINT "part_price_notices_responded_by_users_id_fk" FOREIGN KEY ("responded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "part_price_notices_case_idx" ON "part_price_notices" USING btree ("tenant_id","case_id");--> statement-breakpoint
CREATE INDEX "part_price_notices_part_idx" ON "part_price_notices" USING btree ("part_request_id");
