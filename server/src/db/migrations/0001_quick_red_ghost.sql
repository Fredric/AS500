CREATE TYPE "public"."user_role" AS ENUM('user', 'superuser', 'aiagent', 'admin');--> statement-breakpoint
CREATE TABLE "group_permissions" (
	"group_id" integer NOT NULL,
	"permission_key" text NOT NULL,
	CONSTRAINT "group_permissions_group_id_permission_key_pk" PRIMARY KEY("group_id","permission_key")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "groups_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"key" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role" "user_role" NOT NULL,
	"permission_key" text NOT NULL,
	CONSTRAINT "role_permissions_role_permission_key_pk" PRIMARY KEY("role","permission_key")
);
--> statement-breakpoint
CREATE TABLE "user_groups" (
	"user_id" integer NOT NULL,
	"group_id" integer NOT NULL,
	CONSTRAINT "user_groups_user_id_group_id_pk" PRIMARY KEY("user_id","group_id")
);
--> statement-breakpoint
CREATE TABLE "user_permissions" (
	"user_id" integer NOT NULL,
	"permission_key" text NOT NULL,
	"granted" boolean DEFAULT true NOT NULL,
	CONSTRAINT "user_permissions_user_id_permission_key_pk" PRIMARY KEY("user_id","permission_key")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" "user_role" DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "group_permissions" ADD CONSTRAINT "group_permissions_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_permissions" ADD CONSTRAINT "group_permissions_permission_key_permissions_key_fk" FOREIGN KEY ("permission_key") REFERENCES "public"."permissions"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_key_permissions_key_fk" FOREIGN KEY ("permission_key") REFERENCES "public"."permissions"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_groups" ADD CONSTRAINT "user_groups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_groups" ADD CONSTRAINT "user_groups_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_permission_key_permissions_key_fk" FOREIGN KEY ("permission_key") REFERENCES "public"."permissions"("key") ON DELETE cascade ON UPDATE no action;