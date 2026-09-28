CREATE TABLE "job_runners" (
	"id" text PRIMARY KEY NOT NULL,
	"capabilities" text[],
	"version" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "my_things" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"source_path" text,
	"source_mime" text,
	"source_width" integer,
	"source_height" integer,
	"processed_path" text,
	"processed_mime" text,
	"processed_width" integer,
	"processed_height" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"stage" text,
	"progress" integer,
	"blocked_reason" text,
	"prompt" text,
	"seed" bigint,
	"model" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thing_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"thing_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"processor" text NOT NULL,
	"params" jsonb,
	"state" text DEFAULT 'queued' NOT NULL,
	"stage" text,
	"progress" integer,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"error" text,
	"traceback" text,
	"result" jsonb,
	"locked_by" text,
	"locked_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "my_things" ADD CONSTRAINT "my_things_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thing_jobs" ADD CONSTRAINT "thing_jobs_thing_id_my_things_id_fk" FOREIGN KEY ("thing_id") REFERENCES "public"."my_things"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_my_things_user_id" ON "my_things" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_my_things_status" ON "my_things" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_thing_jobs_state_created" ON "thing_jobs" USING btree ("state","created_at");--> statement-breakpoint
CREATE INDEX "idx_thing_jobs_thing_id" ON "thing_jobs" USING btree ("thing_id");