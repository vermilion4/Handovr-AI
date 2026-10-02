CREATE TABLE "criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"key" uuid NOT NULL,
	"position" integer NOT NULL,
	"description" text NOT NULL,
	"test_plan" text NOT NULL,
	"kind" text NOT NULL,
	"category" text,
	"share_cents" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "criteria_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"milestone_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"author_id" uuid,
	"reason" text DEFAULT '' NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "criteria_versions_milestone_id_version_unique" UNIQUE("milestone_id","version")
);
--> statement-breakpoint
CREATE TABLE "signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"signed_name" text NOT NULL,
	"signed_email" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signatures_version_id_user_id_unique" UNIQUE("version_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "milestones" ADD COLUMN "criteria_draft_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "criteria" ADD CONSTRAINT "criteria_version_id_criteria_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."criteria_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "criteria_versions" ADD CONSTRAINT "criteria_versions_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "criteria_versions" ADD CONSTRAINT "criteria_versions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_version_id_criteria_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."criteria_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;