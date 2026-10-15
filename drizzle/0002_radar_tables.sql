CREATE TABLE "app_settings" (
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"value" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_settings_user_id_key_pk" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
CREATE TABLE "network" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"full_name" text NOT NULL,
	"company" text,
	"position" text,
	"linkedin_url" text,
	"email" text,
	"connected_on" date,
	"source" text DEFAULT 'linkedin' NOT NULL,
	"company_key" text,
	"dedupe_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"radar_item_id" uuid NOT NULL,
	"contact_id" uuid,
	"deal_id" uuid,
	"purpose" text DEFAULT 'invest' NOT NULL,
	"stage" text DEFAULT 'prospect' NOT NULL,
	"email" text,
	"email_source" text,
	"linkedin_url" text,
	"warm_path" text,
	"subject" text,
	"body" text,
	"linkedin_note" text,
	"intro_request" text,
	"followup_1" text,
	"followup_2" text,
	"drafted_by" text,
	"drafted_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"last_touch_at" timestamp with time zone,
	"next_followup_at" date,
	"touches" integer DEFAULT 0 NOT NULL,
	"replied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outreach_purpose_check" CHECK ("outreach"."purpose" in ('invest', 'ambassador', 'buyer', 'press', 'intro')),
	CONSTRAINT "outreach_stage_check" CHECK ("outreach"."stage" in ('prospect', 'drafted', 'sent', 'replied', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "radar_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"feed" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"source" text,
	"summary" text DEFAULT '' NOT NULL,
	"why_relevant" text DEFAULT '' NOT NULL,
	"score" integer DEFAULT 50 NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"event_date" date,
	"deadline" date,
	"location" text,
	"dedupe_key" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"task_id" text,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"digested_at" timestamp with time zone,
	"contact_id" uuid,
	"company_id" uuid,
	"deal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "radar_items_feed_check" CHECK ("radar_items"."feed" in ('sooz', 'personal', 'career')),
	CONSTRAINT "radar_items_status_check" CHECK ("radar_items"."status" in ('new', 'seen', 'saved', 'dismissed', 'approved')),
	CONSTRAINT "radar_items_score_check" CHECK ("radar_items"."score" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "radar_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"task_id" text NOT NULL,
	"feed" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"found" integer DEFAULT 0 NOT NULL,
	"inserted" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network" ADD CONSTRAINT "network_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach" ADD CONSTRAINT "outreach_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach" ADD CONSTRAINT "outreach_radar_item_id_radar_items_id_fk" FOREIGN KEY ("radar_item_id") REFERENCES "public"."radar_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach" ADD CONSTRAINT "outreach_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach" ADD CONSTRAINT "outreach_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radar_items" ADD CONSTRAINT "radar_items_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radar_items" ADD CONSTRAINT "radar_items_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radar_items" ADD CONSTRAINT "radar_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radar_items" ADD CONSTRAINT "radar_items_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radar_runs" ADD CONSTRAINT "radar_runs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "network_user_dedupe_idx" ON "network" USING btree ("user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "network_user_company_key_idx" ON "network" USING btree ("user_id","company_key");--> statement-breakpoint
CREATE UNIQUE INDEX "outreach_radar_item_idx" ON "outreach" USING btree ("radar_item_id");--> statement-breakpoint
CREATE INDEX "outreach_user_stage_idx" ON "outreach" USING btree ("user_id","stage");--> statement-breakpoint
CREATE INDEX "outreach_contact_idx" ON "outreach" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "outreach_deal_idx" ON "outreach" USING btree ("deal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "radar_items_user_dedupe_idx" ON "radar_items" USING btree ("user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "radar_items_user_feed_status_idx" ON "radar_items" USING btree ("user_id","feed","status");--> statement-breakpoint
CREATE INDEX "radar_items_contact_idx" ON "radar_items" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "radar_items_deal_idx" ON "radar_items" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "radar_runs_user_started_idx" ON "radar_runs" USING btree ("user_id","started_at" DESC NULLS LAST);