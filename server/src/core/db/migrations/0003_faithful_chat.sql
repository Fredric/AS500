CREATE TABLE "mods" (
	"id" serial PRIMARY KEY NOT NULL,
	"motorcycle_id" integer NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"cost" numeric(10, 2),
	"installed_date" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "services_performed" (
	"id" serial PRIMARY KEY NOT NULL,
	"motorcycle_id" integer NOT NULL,
	"service_type" text NOT NULL,
	"service_date" date NOT NULL,
	"odometer_km" integer,
	"cost" numeric(10, 2),
	"shop" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mods" ADD CONSTRAINT "mods_motorcycle_id_motorcycles_id_fk" FOREIGN KEY ("motorcycle_id") REFERENCES "public"."motorcycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services_performed" ADD CONSTRAINT "services_performed_motorcycle_id_motorcycles_id_fk" FOREIGN KEY ("motorcycle_id") REFERENCES "public"."motorcycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_mods_motorcycle_id" ON "mods" USING btree ("motorcycle_id");--> statement-breakpoint
CREATE INDEX "idx_services_performed_motorcycle_id" ON "services_performed" USING btree ("motorcycle_id");