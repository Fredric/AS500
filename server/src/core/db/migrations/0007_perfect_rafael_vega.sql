CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_type" varchar(16) NOT NULL,
	"action" varchar(32) NOT NULL,
	"source" varchar(16) NOT NULL,
	"user_id" integer,
	"username" varchar(64),
	"client_id" varchar(64),
	"config_id" varchar(64),
	"record_id" varchar(128),
	"ok" boolean NOT NULL,
	"error_code" varchar(64),
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"ip_address" "inet",
	"user_agent" text,
	"before_data" jsonb,
	"after_data" jsonb,
	"params_hash" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_audit_log_created_at" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_log_event_type" ON "audit_log" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_audit_log_user_id" ON "audit_log" USING btree ("user_id") WHERE "audit_log"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_audit_log_config_id" ON "audit_log" USING btree ("config_id") WHERE "audit_log"."config_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_audit_log_source" ON "audit_log" USING btree ("source");