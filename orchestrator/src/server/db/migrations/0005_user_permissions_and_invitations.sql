ALTER TABLE "users" ADD COLUMN "permissions" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_invitations" (
  "id" text PRIMARY KEY NOT NULL,
  "token_hash" text NOT NULL UNIQUE,
  "label" text NOT NULL,
  "permissions" text NOT NULL DEFAULT '{}',
  "expires_at" text NOT NULL,
  "created_by_user_id" text,
  "created_at" text NOT NULL DEFAULT (datetime('now')),
  "used_at" text,
  "used_by_user_id" text,
  "revoked_at" text
);
