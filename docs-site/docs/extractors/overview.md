---
id: overview
title: Extractors Overview
description: Technical index of supported extractors and how they work.
sidebar_position: 1
---

This page helps you choose the right extractor for your run, understand key constraints, and navigate to detailed technical guides.

Extractor integrations are now registered through manifests and loaded automatically at orchestrator startup. Runtime discovery only scans `extractors/*/(manifest.ts|src/manifest.ts)` and does not read manifests from `orchestrator/**`. Extractor-specific run logic should also remain in `extractors/<name>/` so orchestrator stays source-agnostic. To add a new source, follow [Add an Extractor](/docs/next/workflows/add-an-extractor).

## Extractor chooser

| Extractor                                        | Best use case                                                | Core constraints/dependencies                                                                       | Notable controls                                                                                                           | Output/behavior notes                                                                                                                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [JobSpy](/docs/next/extractors/jobspy)           | Multi-source discovery (Indeed, LinkedIn)                    | Requires Python wrapper execution per term; source availability and quality vary by site/location   | `JOBSPY_SITES`, `JOBSPY_SEARCH_TERMS`, `JOBSPY_RESULTS_WANTED`, `JOBSPY_HOURS_OLD`, `JOBSPY_LINKEDIN_FETCH_DESCRIPTION`    | Produces JSON per term, emits structured location evidence, then orchestrator normalizes and de-duplicates by `jobUrl`                                                                          |
| [Adzuna](/docs/next/extractors/adzuna)           | API-based multi-country discovery with low scraping overhead | Requires valid App ID/App Key; country must be in Adzuna-supported list                             | `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `ADZUNA_MAX_JOBS_PER_TERM`                                                              | API pagination to dataset output, emits structured location evidence, and orchestrator maps progress and de-duplicates by `sourceJobId`/`jobUrl`                                                |
| [Hiring Cafe](/docs/next/extractors/hiring-cafe) | Browser-backed discovery using Hiring Cafe search APIs       | Subject to upstream anti-bot checks; uses browser context and encoded search-state payloads         | `HIRING_CAFE_SEARCH_TERMS`, `HIRING_CAFE_COUNTRY`, `HIRING_CAFE_MAX_JOBS_PER_TERM`, `HIRING_CAFE_DATE_FETCHED_PAST_N_DAYS` | Uses existing pipeline term/country/budget knobs, emits structured location evidence, and maps directly to normalized jobs                                                                      |
| [Jobindex](/docs/next/extractors/jobindex)       | Denmark job search through Jobindex result pages             | Denmark-only; city filtering depends on resolving selected cities to Jobindex `geoareaid` values    | existing pipeline `searchTerms`, selected country/cities, `JOBINDEX_MAX_JOBS_PER_TERM` / automatic run budget              | Parses the embedded Stash payload, applies resolved `geoareaid` filters when available, paginates result pages, maps card metadata and direct apply links, and de-duplicates by source id / URL |
| [FreeHire](/docs/next/extractors/freehire)       | Broad job discovery through FreeHire's public agent API      | No credentials required; API availability and rate limits are controlled by FreeHire                | existing pipeline `searchTerms`, selected country/cities, `jobspyResultsWanted`, workplace type                            | Requests full Markdown descriptions and enriched job metadata, then de-duplicates original upstream URLs across sources                                                                         |
| [Manual Import](/docs/next/extractors/manual)    | One-off jobs not covered by scrapers                         | Inference quality depends on model/provider and input quality; some URLs cannot be fetched reliably | App/API endpoints (`/api/manual-jobs/infer`, `/api/manual-jobs/import`)                                                    | Accepts text/HTML/URL, runs inference, then saves and scores job after review                                                                                                                   |

## Which extractor should I use?

- Use **JobSpy** for broad first-pass sourcing across common boards.
- Use **Adzuna** when you want API-first discovery in supported non-UK markets.
- Use **Hiring Cafe** when you want another term/country-driven source without adding credentials.
- Use **Jobindex** when targeting Denmark roles from the local Jobindex board.
- Use **FreeHire** for broad API-backed coverage without another credential.
- Use **Manual Import** when you already have a specific posting and need direct import.

Many runs combine sources: broad discovery first, then manual import for high-priority jobs that scraping misses.

## Common problems

### How do I health-check an extractor?

- Every runtime-registered extractor source exposes `GET /api/:source/health`.
- Use the source id from the shared extractor catalog, for example `/api/linkedin/health` or `/api/freehire/health`.
- The health check runs a minimal live probe for that source with a fixed search term and a result limit of `1`.
- A `200` response means the extractor returned at least one valid normalized job for that source.
- A `503` response means the extractor could not run successfully, returned no jobs, or returned invalid jobs.
- A `404` response means the source id is unknown or not registered at runtime on that instance.

## Related extractor docs

- [JobSpy](/docs/next/extractors/jobspy)
- [Adzuna](/docs/next/extractors/adzuna)
- [Hiring Cafe](/docs/next/extractors/hiring-cafe)
- [Jobindex](/docs/next/extractors/jobindex)
- [FreeHire](/docs/next/extractors/freehire)
- [Manual Import](/docs/next/extractors/manual)
- [Add an Extractor](/docs/next/workflows/add-an-extractor)
