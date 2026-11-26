---
id: database-backups
title: Database Backups
description: Configure, create, download, and restore JobOps database backups.
sidebar_position: 2
---

## What it is

JobOps database backups create consistent point-in-time snapshots of your database and store them outside the live database engine:

- **Cloudflare Workers / Durable Objects:** stored in Cloudflare R2 under the `backups/` prefix (using the configured `DATA_BUCKET`, or an optional dedicated `BACKUP_BUCKET` binding).
- **Self-hosted / Docker:** stored in `<DATA_DIR>/backups/` by default, or in `<BACKUP_DIR>/backups/` when `BACKUP_DIR` is set to a separate directory or volume mount.

Each backup is written as a compressed gzipped JSON snapshot (`*.json.gz`) containing every user table plus per-table row counts and SHA-256 checksums.

## Why it exists

In Cloudflare Durable Object deployments, the primary database runs in Durable Object SQLite (`AppStore`), not as a local `jobs.db` file on container disk. Storing backups as portable `.json.gz` snapshots in R2 keeps backups in an isolated, durable object store that can be downloaded from the UI, fetched via Wrangler, or re-imported if the database ever needs recovery.

## How to use it

Backup management is restricted to system admins. Normal workspace users cannot list, create, download, or delete backups.

### Backup types and retention

- **Automatic backups:**
  - Filename format: `jobs_YYYY_MM_DD.json.gz` (UTC date).
  - Scheduled daily at the configured UTC hour (`backupHour`, `0-23`, default `2`).
  - Automatic retention keeps up to `backupMaxCount` (`1-5`, default `5`); older automatic backups are deleted automatically.
  - If today's automatic backup already exists, JobOps skips creating a duplicate.
- **Manual backups:**
  - Filename format: `jobs_manual_YYYY_MM_DD_HH_MM_SS.json.gz` (UTC timestamp; `_1`, `_2`, ... appended on same-second collisions).
  - Triggered from **Settings → Backups** or `POST /api/backups`.
  - Manual backups are **not** deleted by automatic retention cleanup.

### Configure in Settings

1. Open **Settings → Backups** as a system admin.
2. Toggle **Enable automatic backups** (default: disabled).
3. Set **Backup Hour** (`0-23` UTC, default: `2`).
4. Set **Max Backups to Keep** (`1-5`, default: `5`).
5. Click **Save changes**.
6. Use **Create Backup Now** to create an on-demand snapshot, or use the download and delete icons in **Backup History**.

### API reference

```bash
# List backups, next scheduled run time, and active storage location
curl "http://localhost:3001/api/backups"
```

```bash
# Create a manual backup
curl -X POST "http://localhost:3001/api/backups"
```

```bash
# Download a backup archive
curl -L -o "jobs_manual_2026_11_26_01_00_00.json.gz" \
  "http://localhost:3001/api/backups/jobs_manual_2026_11_26_01_00_00.json.gz/download"
```

```bash
# Delete a specific backup
curl -X DELETE "http://localhost:3001/api/backups/jobs_manual_2026_11_26_01_00_00.json.gz"
```

```bash
# Update backup settings via Settings API
curl -X PATCH "http://localhost:3001/api/settings" \
  -H "content-type: application/json" \
  -d '{
    "backupEnabled": true,
    "backupHour": 2,
    "backupMaxCount": 5
  }'
```

### Restore workflow

#### From the app (admins)

Open **Settings → Backups** and press **Restore** on a `.json.gz` backup (or call `POST /api/backups/:filename/restore`). JobOps verifies the backup's checksums, saves a safety backup of the current data (a new manual backup), and then replaces all data with the backup's contents in a single transaction, so a failed restore leaves your data untouched. While it runs, every request that could write to the database (any non-`GET` request) is rejected with `503` and a `Retry-After` header. Reads keep working. If your account is not in the backup you will be signed out afterwards.

#### Cloudflare Durable Object (`AppStore`)

1. Download the `.json.gz` backup from **Settings → Backups**, `GET /api/backups/:filename/download`, or R2 (`wrangler r2 object get job-ops-data/backups/<filename> --file backup.json.gz --remote`).
2. Decompress the archive (`gzip -d backup.json.gz` -> `backup.json`). Its `tables` and `checksums` match `/_cf/do/import`.
3. Enable write freeze (`WRITE_FREEZE=1`) during maintenance and POST the extracted JSON payload to `/_cf/do/import` with your admin bearer token (`CRON_SECRET` / `WEBHOOK_SECRET`), then unset `WRITE_FREEZE`.

#### Legacy self-hosted `.db` backups

Older `jobs_*.db` SQLite binary backups remain listable, downloadable, and deletable. To restore a legacy `.db` file locally, stop JobOps, copy the `.db` file over `<DATA_DIR>/jobs.db`, and start JobOps again.

## Common problems

### Automatic backups are not running

- Confirm **Enable automatic backups** (`backupEnabled`) is enabled and saved.
- Confirm **Backup Hour** is configured in **UTC**, not local time.
- On self-hosted installs, ensure the server process is running at the scheduled hour; on Cloudflare, ensure the hourly Worker cron trigger and `CRON_SECRET` are configured.

### `POST /api/backups` fails

- Confirm the database has been initialized and is readable.
- On Cloudflare, verify the `DATA_BUCKET` R2 binding is configured on the Worker.
- In demo mode (`DEMO_MODE=true`), creating, downloading, and deleting backups are blocked.

### Cannot download or delete a backup

- Only valid backup filenames (`jobs_YYYY_MM_DD.json.gz`, `jobs_manual_YYYY_MM_DD_HH_MM_SS.json.gz`, or legacy `.db` equivalents) are accepted.
- System admin authentication is required.

### Next scheduled time is null

- Automatic backups are currently disabled (`backupEnabled` is false).

## Related pages

- [Settings](/docs/next/features/settings)
- [Self-Hosting](/docs/next/getting-started/self-hosting)
