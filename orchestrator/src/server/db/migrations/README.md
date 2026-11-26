# Database migrations

Every schema change is a numbered `.sql` file in this folder. They run in order, once per
database, on both Node (SQLite file) and Cloudflare Durable Objects. Applied migrations are
recorded in `_portable_migrations` with a checksum.

## Adding a migration

1. Create the next file: `NNNN_snake_case_name.sql` (ids are contiguous from `0001`, no gaps).
2. Write plain SQLite. Separate statements with a line containing exactly
   `--> statement-breakpoint`:

   ```sql
   ALTER TABLE "jobs" ADD COLUMN "notes_count" integer NOT NULL DEFAULT 0;
   --> statement-breakpoint
   CREATE INDEX IF NOT EXISTS "idx_jobs_notes_count" ON "jobs" ("notes_count");
   ```

3. Update `src/server/db/schema.ts` to match (Drizzle types).
4. `npm run db:migrate` applies it locally. Deploys apply it automatically.

## Rules

- **Never edit or rename a migration that has shipped.** Its checksum is stored in every
  database that ran it, and the runner throws on a mismatch. Fix forward with a new file.
- Make statements safe to retry (`IF NOT EXISTS`, `INSERT OR IGNORE`). A migration is not
  wrapped in a transaction, so one that fails halfway is retried from its first statement.
  `ALTER TABLE ... ADD COLUMN` on a column that already exists is skipped automatically.
- Do not add schema changes to `legacy-upgrade.ts`. It is frozen and only upgrades databases
  that predate these files.
- Keep migrations LF-only (`.gitattributes` enforces it); line endings are part of the checksum.

`0001`-`0005` are the original baseline exported from the old inline TypeScript list; their
checksums are pinned in `portable-migrations.test.ts`.
