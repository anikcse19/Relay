CREATE TYPE "public"."attempt_trigger" AS ENUM('scheduled', 'manual');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('pending', 'retrying', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."endpoint_status" AS ENUM('active', 'paused', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."environment_kind" AS ENUM('development', 'production');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('pending', 'active', 'dead');--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"environment_id" text NOT NULL,
	"name" text NOT NULL,
	"key_prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"environment_id" text NOT NULL,
	"event_id" text NOT NULL,
	"endpoint_id" text NOT NULL,
	"status" "delivery_status" DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"last_status_code" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"delivery_id" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"trigger" "attempt_trigger" DEFAULT 'scheduled' NOT NULL,
	"status_code" integer,
	"duration_ms" integer NOT NULL,
	"error_code" text,
	"error_message" text,
	"request_headers" jsonb,
	"response_headers" jsonb,
	"response_body" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "endpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"environment_id" text NOT NULL,
	"url" text NOT NULL,
	"description" text,
	"status" "endpoint_status" DEFAULT 'active' NOT NULL,
	"disabled_reason" text,
	"filter_event_types" text[],
	"signing_secret" text NOT NULL,
	"previous_signing_secret" text,
	"secret_rotated_at" timestamp with time zone,
	"rate_limit_per_second" integer,
	"headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "environments" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" "environment_kind" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_types" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"environment_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"schema" jsonb,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"environment_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "queue_jobs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "queue_jobs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"queue" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 25 NOT NULL,
	"locked_by" text,
	"locked_until" timestamp with time zone,
	"dedupe_key" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_endpoint_id_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "endpoints" ADD CONSTRAINT "endpoints_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "endpoints" ADD CONSTRAINT "endpoints_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_types" ADD CONSTRAINT "event_types_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_types" ADD CONSTRAINT "event_types_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_environment_idx" ON "api_keys" USING btree ("environment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_event_endpoint_uq" ON "deliveries" USING btree ("event_id","endpoint_id");--> statement-breakpoint
CREATE INDEX "deliveries_endpoint_id_idx" ON "deliveries" USING btree ("endpoint_id","id");--> statement-breakpoint
CREATE INDEX "deliveries_env_status_id_idx" ON "deliveries" USING btree ("environment_id","status","id");--> statement-breakpoint
CREATE INDEX "delivery_attempts_delivery_idx" ON "delivery_attempts" USING btree ("delivery_id","attempt_number");--> statement-breakpoint
CREATE INDEX "endpoints_environment_idx" ON "endpoints" USING btree ("environment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "environments_org_name_uq" ON "environments" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "event_types_env_name_uq" ON "event_types" USING btree ("environment_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "events_env_idempotency_uq" ON "events" USING btree ("environment_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "events_env_id_idx" ON "events" USING btree ("environment_id","id");--> statement-breakpoint
CREATE INDEX "events_env_type_id_idx" ON "events" USING btree ("environment_id","event_type","id");--> statement-breakpoint
CREATE INDEX "queue_jobs_dequeue_idx" ON "queue_jobs" USING btree ("queue","priority" DESC NULLS LAST,"run_at") WHERE "queue_jobs"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "queue_jobs_lease_idx" ON "queue_jobs" USING btree ("locked_until") WHERE "queue_jobs"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "queue_jobs_dedupe_uq" ON "queue_jobs" USING btree ("queue","dedupe_key") WHERE "queue_jobs"."dedupe_key" is not null and "queue_jobs"."status" <> 'dead';