---
id: watchlist
title: Watchlist
description: Review watched careers-source roles, ignore irrelevant rows, and move matching jobs into the workspace.
sidebar_position: 14
---

## What it is

Watchlist is a review page for roles fetched from configured company career sources.

Watching a company means JobOps saves that company's careers source in your Watchlist and checks it again when you return, so you can review newly surfaced roles over time. It does not mean JobOps watches every hiring channel from that company, sends alerts automatically, or applies on your behalf.

Each fetched row has one effective state:

- `new`: visible by default and ready to review
- `ignored`: hidden by default
- `moved_to_workspace`: already imported into the JobOps workspace

## Core concepts

### Watching a company

Watching a company means watching that company's saved careers source in Watchlist.

JobOps stores the selected careers source in your workspace and remembers the result of its last check. Reopening Watchlist shows that stored result instead of re-checking every source; click **Check now** (or **Check this source again** on a failed source) to check again. Automatic runs also refresh it. This gives you a repeatable review loop for newly surfaced roles from that company.

It does not mean:

- watching every hiring channel from that company
- background crawling across the internet
- automatic alerts
- automatic applications

### Catalog source

A catalog source is a company already curated into the built-in Watchlist picker.

If you choose a company from the searchable company list, you are adding a catalog source. These shared entries come from JobOps' maintained source catalog.

### Custom source URL

A custom source URL is a careers board you paste manually for your workspace.

When you click **Add source** (or use the empty Watchlist prompt in **Find jobs** / **Daily search**), pasting a career site URL is the default and first option. Each custom source includes:

- **Career site URL**: paste any public HTTPS careers page URL (or ATS board link such as Workday, Greenhouse, Lever, Ashby, SmartRecruiters, Oracle, or BambooHR — JobOps automatically detects known ATS URLs).
- **Name**: a readable company or board name shown in your Watchlist.
- **Description**: optional context about the roles or teams you want from that board, used when AI suggests filters.

Click **Scan & suggest filter** (or **Suggest filters**) to let AI inspect the board's available facets and propose a filtered URL. Once scanned or saved, custom sources, their learned scraping recipes, discovered facets, and public filter plans are stored in the shared database (`watchlist_shared_sources` and `watchlist_filter_plans`). When another user adds or scans the same board, JobOps reuses the saved source, scraping plan, and filter plan instead of asking the LLM to regenerate them from scratch.

#### Search filters on a custom careers site

When JobOps has learned a custom careers site, it also learns which of the board's search controls actually work. Only controls that JobOps verified (the board returns a different set of postings when the control is used) are offered, so a keyword box or location menu on the source card always does something.

- **Keyword and choice inputs** appear on the source card. Editing one rebuilds the source URL, and **Save sources** applies it like any other custom URL. No AI call is made, so editing filters is instant and free.
- **Paging** is followed for you. When the board's page links keep your filters, JobOps reads up to five pages of results; otherwise it reads the first page.
- **Suggest filters** is available once the site's filter scan has an answer (it shows "Available once this site's search filters are ready" until then), and it can use a verified keyword box: when a board has one, the suggestion may fill it with your search terms. It reads the learned controls from the shared recipe; no extra scan or model call is needed to learn them.
- **Clearing every filter** returns the source to the board's normal unfiltered listing.
- **Automatic scan**: once a custom careers site is saved to your Watchlist, JobOps looks for its search filters by itself and the source card shows a loader while it works. An unsaved URL is not scanned. Your current setup keeps working until a verified result replaces it. If a scan could not finish (for example the scanner was still starting) the card says why and offers **Scan again**; a scan that finished and found no controls says so and is not repeated.
- Only boards that take their filters in the URL (a GET search form, with page numbers or offsets) are supported. Boards that need button clicks, infinite scroll, or a POST search still work unfiltered.

Your keywords stay in your own source URL. The learned controls are public and shared between users; what you type is not.

#### Salary, deadline, job type and level

While learning a site, JobOps also looks for a salary, an application deadline, a job type and a job level on the posting. Each one is kept only if it was read from a clear source on the page (structured job data or a labelled field) and showed a value on the sampled postings. When you import a posting, those values prefill the job. A posting that does not state one leaves that field blank; JobOps never fills in a guess.

A single search run reads at most 40 of your watchlist sources (you can save up to 50). If you have more, the first 40 in your list are searched and the run reports how many were left out.

If you ignore a posting while viewing one filter of a careers site, it also shows as ignored under your other filters of the same site, and unignoring it clears it everywhere.

### Source groups

A source group is a predefined bundle of catalog sources you can add in one click, so you do not have to pick companies one by one. If a user's Watchlist is empty after onboarding, starter groups and custom URL setup are also surfaced directly on **Find jobs** and **Daily search**.

Click **Groups** next to **Add source** and choose a group:

- `Finance`
- `Logistics`
- `Food and refrigeration` (food processors, distributors, grocers and cold-storage operators; USDA and FDA inspector roles are not covered)
- `Big tech`
- `WLB tech companies` (tech companies with a seed WLB rating of 8 or higher)

Every source card shows a **WLB** (work-life balance) and a **Pay** rating from 0 to 10 when the company has one. Ratings are stored in the `company_ratings` table and start from editorial estimates bundled in `orchestrator/src/server/config/company-ratings.json`, not survey data. Seeding only fills in companies that have no row yet, so edits are never overwritten. A system admin can change one with `PUT /api/watchlist/company-ratings` and a body like `{ "label": "Stripe", "wlb": 7.5, "salary": 9, "source": "manual" }`. Glassdoor is not fetched automatically because its terms forbid automated collection.

Adding a group only adds sources you do not already have. A company counts as already added when you have it under any source type or a custom URL, so Stripe on Greenhouse blocks Stripe on its own careers site. It never goes past the 50-source limit. The sources are added as unsaved drafts, so click **Save sources** to start watching them. Where a company has its own careers site in the catalog, groups use that original source.

LinkedIn is not a Watchlist source. To search LinkedIn, select it as a source in an Automatic run.

### Baseline check

The baseline check is the first successful Watchlist fetch for your saved sources.

JobOps uses that first successful check as the reference point for future `New since last check` badges. Before the baseline exists, there is nothing older to compare against.

### Ignored role

An ignored role is a Watchlist row hidden from your default review list for that user and workspace.

Ignoring a role does not delete it from the source website or from JobOps storage. It only removes that row from the default visible list until you choose to show ignored rows again.

## Why it exists

Watchlist helps you scan recurring roles from watched company sources without repeatedly seeing the same irrelevant jobs.

Ignored rows and watchlist check history are stored per user inside the active workspace. Jobs already imported into the workspace are detected from the source adapter's canonical source key and external job ID, so they stay visible as workspace jobs even if you ignored the same external role earlier.

## How to use it

1. Open **Watchlist** from the app navigation (or use the starter card on **Find jobs** if your Watchlist is empty).
2. Click **Add source**. New sources default to pasting a career site URL (also the first option in the company dropdown).
3. Enter the **Career site URL**, **Name**, and optional **Description** — or use **Choose company** to pick from curated catalog and shared community sources.
4. Click **Suggest filters** (or **Scan & suggest filter**) if you want AI to find filtered listings for the board; saved sources reuse existing scraping and filter plans automatically.
5. Click **Save sources**.
6. Review the visible rows.
7. Click **Check now** later to see roles marked **New since last check**.
8. Click **Ignore** on a role you do not want to keep seeing.
9. Turn on **Show ignored** to reveal ignored rows.
10. Click **Unignore** to restore an ignored role to the default visible list.
11. Click **Move to workspace** to import a new role.

Rows already imported into JobOps show **Already in workspace** and **Open workspace job**.

When you add a custom source URL, JobOps asks that source adapter to derive a readable company label. If the adapter cannot derive a better label, the URL may still be the clearest identifier.

### Source URL rules

- You can save up to 50 watched sources per user and workspace.
- Use the public careers URL, not an individual job posting URL.
- JobOps validates the URL through the selected source adapter when you save sources.
- Built-in catalog companies are saved as curated sources.
- Custom URLs are saved only in your workspace selections unless a contributor adds them to the shared catalog.
- Today, Workday and BambooHR are available Watchlist adapters. Additional source types can be added without changing the Watchlist page.

## Common problems

### A role disappeared

Turn on **Show ignored**. If the row has an `Ignored` badge, click **Unignore** to restore it.

### I do not see any `New since last check` badges yet

The first successful Watchlist fetch creates your personal baseline. Click **Check now** later to compare the latest results against that saved check. Opening the page alone shows the last stored check and does not re-check your sources.

### A role still appears after being imported

Imported roles stay visible intentionally. They show **Already in workspace** so you can open the existing workspace job instead of importing a duplicate.

### A duplicate import is blocked

JobOps uses the source adapter's canonical source key plus the external job ID as the dedupe key, for example `workday:autodesk` and `26WD97952`. Open the existing workspace job from the Watchlist row.

### A careers site says it is learning, or its browser is starting

Company careers sites without a known job-board API are read with a browser. When a company is on Greenhouse, JobOps uses that board's API instead. Otherwise, the first check of a new site learns how to read it, which takes a minute or two. On the hosted Cloudflare deployment the browser runs in the scraper container, which also has to start on first use. Click **Check this source again** after a minute.

### A careers site has no search filters

Filters are offered only after JobOps has verified them. A saved source is scanned automatically; the card shows a loader while it runs. If it then shows no keyword or choice inputs, the board either has none JobOps could verify or needs button clicks or scrolling to search. If the card says the last scan did not finish, click **Scan again** (this can use your LLM connection if the site is not a simple sitemap board). Otherwise paste a URL that already contains the board's own filter parameters.

### My custom URL is rejected

- Make sure you pasted a supported public careers site URL, not a specific job page.
- Confirm the URL still opens in the browser without requiring an authenticated employee session.
- If the company is missing from the built-in list, you can still use the source type's custom URL option when that adapter supports custom sources.

## Related pages

- [Orchestrator](/docs/next/features/orchestrator)
- [Job search bar](/docs/next/features/job-search-bar)
- [Pipeline run](/docs/next/features/pipeline-run)
