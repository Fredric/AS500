CREATE TABLE "world_spaces" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"kind" varchar(32) DEFAULT 'office' NOT NULL,
	"layout" jsonb,
	"owner_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "world_spaces_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "world_things" (
	"id" serial PRIMARY KEY NOT NULL,
	"space_id" integer NOT NULL,
	"parent_thing_id" integer,
	"type" varchar(32) NOT NULL,
	"label" text NOT NULL,
	"slot" varchar(48),
	"zone" varchar(48),
	"transform" jsonb,
	"binding" jsonb,
	"owner_user_id" integer,
	"visibility" varchar(16) DEFAULT 'shared' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "world_spaces" ADD CONSTRAINT "world_spaces_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_things" ADD CONSTRAINT "world_things_space_id_world_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."world_spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_things" ADD CONSTRAINT "world_things_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_world_things_space_id" ON "world_things" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "idx_world_things_parent_id" ON "world_things" USING btree ("parent_thing_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_world_things_parent_slot" ON "world_things" USING btree ("parent_thing_id","slot") WHERE "world_things"."parent_thing_id" IS NOT NULL AND "world_things"."slot" IS NOT NULL;