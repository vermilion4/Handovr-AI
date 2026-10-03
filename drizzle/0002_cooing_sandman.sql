CREATE TABLE "holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"milestone_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"paypal_order_id" text NOT NULL,
	"authorization_id" text,
	"amount_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"status" text DEFAULT 'awaiting_approval' NOT NULL,
	"simulated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"authorized_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"renewed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"milestone_id" uuid NOT NULL,
	"hold_id" uuid NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"request_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"paypal_id" text,
	"detail" text DEFAULT '' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"paypal_event_id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "milestones" ADD COLUMN "submitted_from" text;--> statement-breakpoint
ALTER TABLE "milestones" ADD COLUMN "release_kind" text;--> statement-breakpoint
ALTER TABLE "milestones" ADD COLUMN "return_to" text;--> statement-breakpoint
ALTER TABLE "milestones" ADD COLUMN "split_freelancer_cents" integer;--> statement-breakpoint
ALTER TABLE "holds" ADD CONSTRAINT "holds_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_hold_id_holds_id_fk" FOREIGN KEY ("hold_id") REFERENCES "public"."holds"("id") ON DELETE no action ON UPDATE no action;