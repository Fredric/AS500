CREATE TABLE "mcp_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" varchar(64),
	"user_id" integer,
	"tool_name" varchar(128) NOT NULL,
	"config_id" varchar(64) NOT NULL,
	"action" varchar(16) NOT NULL,
	"params_hash" varchar(64) NOT NULL,
	"ok" boolean NOT NULL,
	"error_code" varchar(64),
	"duration_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_clients" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"client_secret_hash" varchar(128),
	"client_name" varchar(255) NOT NULL,
	"redirect_uris" text NOT NULL,
	"token_endpoint_auth_method" varchar(32) NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE "oauth_consents" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"client_id" varchar(64) NOT NULL,
	"scope" varchar(255) NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD COLUMN "kind" varchar(20) DEFAULT 'as500' NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD COLUMN "client_id" varchar(64);--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD COLUMN "jti" varchar(64);--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD COLUMN "code_challenge" varchar(128);--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD COLUMN "code_challenge_method" varchar(8);--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD COLUMN "redirect_uri" text;--> statement-breakpoint
ALTER TABLE "oauth_consents" ADD CONSTRAINT "oauth_consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_consents" ADD CONSTRAINT "oauth_consents_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_mcp_audit_log_created_at" ON "mcp_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_mcp_audit_log_client_id" ON "mcp_audit_log" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "idx_mcp_audit_log_user_id" ON "mcp_audit_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_mcp_audit_log_config_id" ON "mcp_audit_log" USING btree ("config_id");--> statement-breakpoint
CREATE INDEX "idx_oauth_consents_user_client" ON "oauth_consents" USING btree ("user_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_auth_tokens_kind_jti" ON "auth_tokens" USING btree ("kind","jti") WHERE "auth_tokens"."jti" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_auth_tokens_client_id" ON "auth_tokens" USING btree ("client_id") WHERE "auth_tokens"."client_id" IS NOT NULL;