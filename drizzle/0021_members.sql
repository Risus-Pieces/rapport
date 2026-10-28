CREATE TABLE "members" (
	"user_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "members_role_check" CHECK ("members"."role" in ('owner', 'member'))
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "shared" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_workspace_id_user_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "members_one_owner_idx" ON "members" USING btree ("role") WHERE "members"."role" = 'owner';--> statement-breakpoint
CREATE INDEX "members_workspace_idx" ON "members" USING btree ("workspace_id");