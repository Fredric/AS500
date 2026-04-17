CREATE TABLE "motorcycles1" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"brand" text NOT NULL,
	"make" text NOT NULL,
	"model_year" integer NOT NULL,
	"purchase_date" date,
	"sell_date" date,
	"cost" numeric(12, 2),
	"odometer_km" integer,
	"displacement_cc" integer,
	"seat_height_mm" integer,
	"heated_grips" boolean DEFAULT false NOT NULL,
	"longest_trip_km" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "motorcycles1" ADD CONSTRAINT "motorcycles1_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_motorcycles1_user_id" ON "motorcycles1" USING btree ("user_id");