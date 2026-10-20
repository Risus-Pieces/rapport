ALTER TABLE "contacts" ADD COLUMN "relationship" text DEFAULT 'known' NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "relationship_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "relationship" text DEFAULT 'known' NOT NULL;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "relationship_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "contacts_user_relationship_idx" ON "contacts" USING btree ("user_id","section","relationship");--> statement-breakpoint
CREATE INDEX "deals_user_relationship_idx" ON "deals" USING btree ("user_id","section","relationship");--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_relationship_check" CHECK ("contacts"."relationship" in ('to_reach_out', 'known', 'ghosted', 'on_hold', 'dismissed'));--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_relationship_check" CHECK ("deals"."relationship" in ('to_reach_out', 'known', 'ghosted', 'on_hold', 'dismissed'));