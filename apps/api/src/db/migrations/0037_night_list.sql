CREATE TABLE "night_lists" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"day" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"sent_by" uuid,
	"late_notified_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"is_test" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "night_list_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"list_id" uuid NOT NULL,
	"reception_id" uuid NOT NULL,
	"reason" text,
	"reason_note" text,
	"current_station" text,
	"next_stations" text,
	"carried" boolean DEFAULT false NOT NULL,
	"set_by" uuid,
	"set_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_test" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "night_lists" ADD CONSTRAINT "night_lists_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "night_lists" ADD CONSTRAINT "night_lists_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "night_list_items" ADD CONSTRAINT "night_list_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "night_list_items" ADD CONSTRAINT "night_list_items_list_id_night_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."night_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "night_list_items" ADD CONSTRAINT "night_list_items_reception_id_receptions_id_fk" FOREIGN KEY ("reception_id") REFERENCES "public"."receptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "night_list_items" ADD CONSTRAINT "night_list_items_set_by_users_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "night_lists_tenant_day_uq" ON "night_lists" USING btree ("tenant_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "night_list_items_list_reception_uq" ON "night_list_items" USING btree ("list_id","reception_id");--> statement-breakpoint
CREATE INDEX "night_list_items_tenant_reception_idx" ON "night_list_items" USING btree ("tenant_id","reception_id");
