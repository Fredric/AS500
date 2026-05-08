CREATE TABLE "motorcycles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"brand" text NOT NULL,
	"model" text NOT NULL,
	"year" integer NOT NULL,
	"purchase_date" date,
	"sell_date" date,
	"cost" numeric(10, 2),
	"nickname" text,
	"odometer_km" integer,
	"engine_cc" integer,
	"color" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "motorcycles" ADD CONSTRAINT "motorcycles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_motorcycles_user_id" ON "motorcycles" USING btree ("user_id");