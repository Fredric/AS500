CREATE TABLE IF NOT EXISTS "auth_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"access_expires_at" timestamp with time zone,
	"refresh_expires_at" timestamp with time zone,
	"device_id" text,
	"device_name" text,
	"user_agent" text,
	"ip_address" "inet",
	"last_used_at" timestamp with time zone DEFAULT now(),
	"revoked_at" timestamp with time zone,
	CONSTRAINT "auth_tokens_token_unique" UNIQUE("token"),
	CONSTRAINT "auth_tokens_access_token_unique" UNIQUE("access_token"),
	CONSTRAINT "auth_tokens_refresh_token_unique" UNIQUE("refresh_token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "day_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"day_id" integer NOT NULL,
	"start_hour" text NOT NULL,
	"end_hour" text NOT NULL,
	"jiratask" text,
	"description" text,
	"rowsum" numeric(5, 2) DEFAULT '0' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "days" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"workday" date NOT NULL,
	"daysum" numeric(5, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "days_user_id_workday_unique" UNIQUE("user_id","workday")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"full_name" text,
	"active" boolean DEFAULT true NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "day_items" ADD CONSTRAINT "day_items_day_id_days_id_fk" FOREIGN KEY ("day_id") REFERENCES "public"."days"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "days" ADD CONSTRAINT "days_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_auth_tokens_token" ON "auth_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_auth_tokens_access_token" ON "auth_tokens" USING btree ("access_token") WHERE "auth_tokens"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_auth_tokens_refresh_token" ON "auth_tokens" USING btree ("refresh_token") WHERE "auth_tokens"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_auth_tokens_user_id" ON "auth_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_auth_tokens_expires_at" ON "auth_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_auth_tokens_user_device" ON "auth_tokens" USING btree ("user_id","device_id") WHERE "auth_tokens"."revoked_at" IS NULL;
