CREATE TABLE "outreach_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"outreach_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"period" text DEFAULT '' NOT NULL,
	"subject" text,
	"body" text,
	"status" text DEFAULT 'ready' NOT NULL,
	"gmail_draft_id" text,
	"gmail_thread_id" text,
	"pushed_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"replied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outreach_messages_kind_check" CHECK ("outreach_messages"."kind" in ('first', 'followup_1', 'followup_2', 'update', 'launch_ask', 'launch_followup')),
	CONSTRAINT "outreach_messages_status_check" CHECK ("outreach_messages"."status" in ('ready', 'in_gmail', 'sent', 'replied', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "shortlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"week" date NOT NULL,
	"radar_item_id" uuid NOT NULL,
	"bucket" text NOT NULL,
	"rank" integer DEFAULT 0 NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"ask" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shortlist_bucket_check" CHECK ("shortlist"."bucket" in ('investor', 'buyer')),
	CONSTRAINT "shortlist_status_check" CHECK ("shortlist"."status" in ('proposed', 'approved', 'skipped'))
);
--> statement-breakpoint
ALTER TABLE "outreach" ADD COLUMN "gmail_ok" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_outreach_id_outreach_id_fk" FOREIGN KEY ("outreach_id") REFERENCES "public"."outreach"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shortlist" ADD CONSTRAINT "shortlist_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shortlist" ADD CONSTRAINT "shortlist_radar_item_id_radar_items_id_fk" FOREIGN KEY ("radar_item_id") REFERENCES "public"."radar_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "outreach_messages_unique_idx" ON "outreach_messages" USING btree ("outreach_id","kind","period");--> statement-breakpoint
CREATE INDEX "outreach_messages_user_status_idx" ON "outreach_messages" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "shortlist_user_week_item_idx" ON "shortlist" USING btree ("user_id","week","radar_item_id");--> statement-breakpoint
CREATE INDEX "shortlist_item_idx" ON "shortlist" USING btree ("radar_item_id");