CREATE TABLE "document_folders" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"parent_id" integer,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"folder_id" integer,
	"name" text NOT NULL,
	"file_type" text NOT NULL,
	"mime_type" text,
	"extension" text,
	"storage_path" text NOT NULL,
	"original_filename" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_folders" ADD CONSTRAINT "document_folders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_items" ADD CONSTRAINT "document_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_items" ADD CONSTRAINT "document_items_folder_id_document_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."document_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_document_folders_user_id" ON "document_folders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_document_folders_parent_id" ON "document_folders" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "idx_document_items_user_id" ON "document_items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_document_items_folder_id" ON "document_items" USING btree ("folder_id");