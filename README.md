# JobOps (Cloudflare fork)

Personal fork of [DaKheera47/job-ops](https://github.com/DaKheera47/job-ops), re-platformed to run on Cloudflare Workers + Durable Objects.

JobOps searches many job boards from one screen, scores each role against your profile with an LLM, tailors your CV per job, exports PDFs, and tracks applications (including Gmail-based status detection). It does not auto-apply.

**Live:** [jobdb.alanchiu.net](https://jobdb.alanchiu.net) — deployed from `main`.

---

## Status

| Area                | State                                                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Runtime             | **Live on Cloudflare.** Express API runs inside the `AppStore` Durable Object with DO SQLite (`DB_BACKEND=do`); SPA served from Workers Assets. Production data (jobs + users) migrated from D1. |
| Scraping            | `ScrapeCoordinatorDO` dedupes scrapes per company/title on a rolling 24 h window and dispatches to Worker, Browser, or `ScraperContainer` pool runtimes. Hourly cron.                            |
| Files               | PDFs, documents, and design-resume assets on R2 (`job-ops-data`) via `BlobStore`.                                                                                                                |
| In progress         | Verifying HTTP sources on `runtime: "worker"` in prod; Cloudflare Browser Rendering binding not attached yet, so `browser` sources fall back.                                                    |
| Pending cleanup     | Remove `d1-sync.ts` and the in-process discovery path after the soak; slim the container image.                                                                                                  |
| Removed vs upstream | Visa-sponsor lookup and tracer links. Hosted "JobOps Cloud" billing/quotas are upstream-only.                                                                                                    |

Full plan and task tracker: [`docs/cloudflare-migration-plan.md`](docs/cloudflare-migration-plan.md).

---

## Job sources

| Source                                  | Runtime   | Notes                     |
| --------------------------------------- | --------- | ------------------------- |
| JobSpy (LinkedIn, Indeed, Glassdoor, …) | container | Python                    |
| Hiring Cafe                             | container |                           |
| Naukri                                  | container | India                     |
| Gradcracker                             | browser   | STEM/grads (UK)           |
| UK Visa Jobs                            | browser   | Sponsoring employers (UK) |
| Adzuna                                  | worker    | Multi-country API         |
| startup.jobs                            | worker    |                           |
| Working Nomads                          | worker    | Remote                    |
| Golang Jobs                             | worker    |                           |
| Seek                                    | worker    | AU/NZ                     |
| Jobindex                                | worker    | Denmark                   |
| FreeHire                                | worker    |                           |
| WUZZUF                                  | worker    | Egypt                     |
| Khamsat                                 | worker    | Egypt (freelance)         |

Career-site boards (Greenhouse, Workday, BambooHR) live in [`career-boards/`](career-boards). Each source's runtime is set in its `manifest.ts`.

---

## Repo layout

| Path                            | What                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| `orchestrator/`                 | Express API + React client; `src/server/do-entry.ts` is the Durable Object bundle     |
| `cloudflare/`                   | Worker entry, `AppStore`, `ScrapeCoordinatorDO`, `ScraperContainer`, `wrangler.jsonc` |
| `extractors/`, `career-boards/` | Job source scrapers                                                                   |
| `shared/`                       | Shared types                                                                          |
| `docs-site/`                    | Docusaurus docs, bundled into the deployed app at `/docs`                             |

Infrastructure that isn't the Worker (R2 bucket, custom domain) is OpenTofu in [`job-ops-infra`](https://github.com/RitoGamingPLZ/job-ops-infra).

---

## Develop

```bash
npm ci
npm --workspace orchestrator run dev   # local app
npm run check:types
npm run test:all
```

The original self-hosted Docker path still builds:

```bash
docker compose up -d   # http://localhost:3005
```

## Deploy

Push to `main` → [`.github/workflows/deploy-cloudflare.yml`](.github/workflows/deploy-cloudflare.yml) builds the client, DO bundle, and docs, then runs `wrangler deploy` from `cloudflare/`. Manual: `cd cloudflare && npm run deploy`.

---

## Upstream

Feature docs (extractors, AI providers, post-application tracking, SSO) still apply: [jobops.dakheera47.com/docs](https://jobops.dakheera47.com/docs/). Sync with `git fetch upstream`.

## License

AGPLv3 + Commons Clause, inherited from upstream. See [LICENSE](LICENSE).
