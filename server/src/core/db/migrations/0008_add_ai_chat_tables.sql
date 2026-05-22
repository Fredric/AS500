-- AI chat history tables (used by the AS500 AI Agent integration)
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_chats" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_messages" (
  "id" serial PRIMARY KEY NOT NULL,
  "chat_id" text NOT NULL,
  "role" varchar(16) NOT NULL,
  "content" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ai_chats_user_id" ON "ai_chats" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ai_messages_chat_id" ON "ai_messages" ("chat_id");
