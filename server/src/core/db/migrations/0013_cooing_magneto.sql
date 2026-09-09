CREATE TABLE "world_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"thing_id" integer NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"color" varchar(16) DEFAULT 'yellow' NOT NULL,
	"updated_by_user_id" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "world_notes_thing_id_unique" UNIQUE("thing_id")
);
--> statement-breakpoint
ALTER TABLE "world_notes" ADD CONSTRAINT "world_notes_thing_id_world_things_id_fk" FOREIGN KEY ("thing_id") REFERENCES "public"."world_things"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_notes" ADD CONSTRAINT "world_notes_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;