CREATE TABLE "thing_folders" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"parent_id" integer,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "my_things" ADD COLUMN "folder_id" integer;--> statement-breakpoint
ALTER TABLE "thing_folders" ADD CONSTRAINT "thing_folders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_thing_folders_user_id" ON "thing_folders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_thing_folders_parent_id" ON "thing_folders" USING btree ("parent_id");--> statement-breakpoint
ALTER TABLE "my_things" ADD CONSTRAINT "my_things_folder_id_thing_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."thing_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_my_things_folder_id" ON "my_things" USING btree ("folder_id");