ALTER TABLE "endpoints" ADD COLUMN "consecutive_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "endpoints" ADD COLUMN "failing_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "endpoints" ADD COLUMN "circuit_open_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "endpoints" ADD COLUMN "last_success_at" timestamp with time zone;