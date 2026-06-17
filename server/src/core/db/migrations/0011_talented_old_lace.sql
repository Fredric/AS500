CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "document_chunks" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"document_item_id" integer NOT NULL,
	"folder_id" integer,
	"text" text NOT NULL,
	"embedding" vector(768) NOT NULL,
	"node_path" text NOT NULL,
	"node_description" text,
	"document_title" text NOT NULL,
	"document_description" text,
	"page_number" integer,
	"page_end" integer,
	"section_title" text,
	"content_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_folders" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "document_folders" ADD COLUMN "ai_summary" text;--> statement-breakpoint
ALTER TABLE "document_folders" ADD COLUMN "title_embedding" vector(768);--> statement-breakpoint
ALTER TABLE "document_folders" ADD COLUMN "description_embedding" vector(768);--> statement-breakpoint
ALTER TABLE "document_folders" ADD COLUMN "ai_summary_embedding" vector(768);--> statement-breakpoint
ALTER TABLE "document_items" ADD COLUMN "ai_summary" text;--> statement-breakpoint
ALTER TABLE "document_items" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "document_items" ADD COLUMN "ingest_status" text DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_item_id_document_items_id_fk" FOREIGN KEY ("document_item_id") REFERENCES "public"."document_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_folder_id_document_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."document_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_document_chunks_user_id" ON "document_chunks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_document_chunks_folder_id" ON "document_chunks" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "idx_document_chunks_document_item_id" ON "document_chunks" USING btree ("document_item_id");--> statement-breakpoint
CREATE INDEX "idx_document_items_content_hash" ON "document_items" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "idx_document_chunks_embedding" ON "document_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "idx_document_folders_title_embedding" ON "document_folders" USING hnsw ("title_embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "idx_document_folders_description_embedding" ON "document_folders" USING hnsw ("description_embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "idx_document_folders_ai_summary_embedding" ON "document_folders" USING hnsw ("ai_summary_embedding" vector_cosine_ops);