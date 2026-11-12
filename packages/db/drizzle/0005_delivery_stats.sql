CREATE TABLE "delivery_stats_hourly" (
	"organization_id" text NOT NULL,
	"environment_id" text NOT NULL,
	"endpoint_id" text NOT NULL,
	"hour" timestamp with time zone NOT NULL,
	"succeeded" integer DEFAULT 0 NOT NULL,
	"retried" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"latency_histogram" integer[] NOT NULL,
	CONSTRAINT "delivery_stats_hourly_endpoint_id_hour_pk" PRIMARY KEY("endpoint_id","hour")
);
--> statement-breakpoint
ALTER TABLE "delivery_stats_hourly" ADD CONSTRAINT "delivery_stats_hourly_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_stats_hourly" ADD CONSTRAINT "delivery_stats_hourly_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_stats_hourly" ADD CONSTRAINT "delivery_stats_hourly_endpoint_id_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "delivery_stats_env_hour_idx" ON "delivery_stats_hourly" USING btree ("environment_id","hour");--> statement-breakpoint
-- Backfill from the attempts still retained (ADR-0017). Mirrors the worker's
-- rollup: a 2xx is "succeeded"; a failure is "failed" when it was a manual
-- replay or the delivery's last attempt before it failed/was cancelled,
-- otherwise "retried". Bounds = LATENCY_BOUNDS_MS (46 buckets), checked by
-- the worker's analytics test.
WITH a AS (
	SELECT d.organization_id, d.environment_id, d.endpoint_id,
		date_bin('1 hour', a.created_at, timestamptz '1970-01-01 00:00:00+00') AS hour,
		CASE
			WHEN a.status_code BETWEEN 200 AND 299 THEN 's'
			WHEN a.trigger = 'manual' OR (a.attempt_number = d.attempt_count AND d.status IN ('failed', 'cancelled')) THEN 'f'
			ELSE 'r'
		END AS outcome,
		CASE WHEN a.status_code IS NOT NULL THEN width_bucket(a.duration_ms, ARRAY[1,2,3,4,5,6,8,10,12,15,20,25,30,40,50,60,80,100,120,150,200,250,300,400,500,600,800,1000,1200,1500,2000,2500,3000,4000,5000,6000,8000,10000,12000,15000,20000,25000,30000,40000,60000]::int[]) + 1 END AS bucket
	FROM "delivery_attempts" a
	JOIN "deliveries" d ON d.id = a.delivery_id
),
counts AS (
	SELECT organization_id, environment_id, endpoint_id, hour,
		(count(*) FILTER (WHERE outcome = 's'))::int AS succeeded,
		(count(*) FILTER (WHERE outcome = 'r'))::int AS retried,
		(count(*) FILTER (WHERE outcome = 'f'))::int AS failed
	FROM a GROUP BY organization_id, environment_id, endpoint_id, hour
),
hist AS (
	SELECT endpoint_id, hour, bucket, count(*)::int AS n
	FROM a WHERE bucket IS NOT NULL GROUP BY endpoint_id, hour, bucket
)
INSERT INTO "delivery_stats_hourly" ("organization_id", "environment_id", "endpoint_id", "hour", "succeeded", "retried", "failed", "latency_histogram")
SELECT c.organization_id, c.environment_id, c.endpoint_id, c.hour, c.succeeded, c.retried, c.failed,
	ARRAY(
		SELECT coalesce(h.n, 0) FROM generate_series(1, 46) AS g(i)
		LEFT JOIN hist h ON h.endpoint_id = c.endpoint_id AND h.hour = c.hour AND h.bucket = g.i
		ORDER BY g.i
	)
FROM counts c;
