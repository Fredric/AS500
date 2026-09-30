CREATE TABLE "folder_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"folder_id" integer NOT NULL,
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
ALTER TABLE "thing_folders" ADD COLUMN "cover_path" text;--> statement-breakpoint
ALTER TABLE "thing_folders" ADD COLUMN "cover_mime" text;--> statement-breakpoint
ALTER TABLE "thing_folders" ADD COLUMN "cover_width" integer;--> statement-breakpoint
ALTER TABLE "thing_folders" ADD COLUMN "cover_height" integer;--> statement-breakpoint
ALTER TABLE "thing_folders" ADD COLUMN "cover_signature" text;--> statement-breakpoint
ALTER TABLE "folder_jobs" ADD CONSTRAINT "folder_jobs_folder_id_thing_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."thing_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_folder_jobs_state_created" ON "folder_jobs" USING btree ("state","created_at");--> statement-breakpoint
CREATE INDEX "idx_folder_jobs_folder_id" ON "folder_jobs" USING btree ("folder_id");