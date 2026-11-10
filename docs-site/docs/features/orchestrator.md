---
id: orchestrator
title: Orchestrator
description: Search Jobs, targeting opportunities, resume preparation, and PDF preview.
sidebar_position: 1
---

## What it is

Search Jobs (the Orchestrator workspace) is where you discover and target opportunities in JobOps.

![Orchestrator jobs workspace](/img/features/orchestrator-jobs.png)

It controls:

- job lifecycle states
- shortlisting with the Target button
- resume preparation on Target, and editing in the resume editor (**Open resume**)
- PDF generation and regeneration
- job-level titled markdown notes on the dedicated job page
- handoff to post-application tracking

Job states:

- `discovered`: found by crawler/import; resume not prepared yet
- `processing`: resume being prepared (shown as **Preparing resume…**)
- `ready`: resume prepared and ready to apply
- `applied`: marked as applied
- `skipped`: explicitly excluded from active queue
- `expired`: deadline passed

## Why it exists

Orchestrator centralizes the transition from discovered opportunities to application-ready artifacts.

It exists to ensure:

- a consistent path from discovery to tailored output
- clear status transitions across manual and automated workflows
- predictable regeneration behavior when job data changes
- a place to keep application-specific answers, interview contacts, and general reminders close to the job
- visibility when a reposted role looks like a job you already applied to, even if the URL changed
- deliberate shortlisting before spending time on tailoring
- one place to filter and sort jobs across every orchestrator tab

## How to use it

### Find opportunities or add an existing job

- Select **Find jobs** to describe a search or enter its criteria, review the existing configuration form, then select **Run search**.
- Select **Add a job** to import a link, description, or PDF you already have.

See [Find jobs](/docs/next/features/pipeline-run) for the search review flow.

### Target and apply

1. Select a discovered job and click **Target**, the single primary job action in Search Jobs.
2. Targeting prepares the job's resume in the background; the job shows **Preparing resume…** until it is ready. Targeting never submits an application.
3. Click **Open resume** on the board or job page to edit the resume in the editor, or **Preview PDF** to render the editor resume. If preparation failed, click **Prepare resume** to retry. The job stays in Targeted until you mark it Applied.
4. Apply on the employer's site, then mark the job **Applied** from the board or job page.
5. Track **Recruiter Screen → Technical Interview → Behaviour Question → Team Match → Offer**. Rejections and withdrawals share **Reject**, with a withdrawn note for withdrawals.

Click the targeted job's **Untarget** control to remove it from the shortlist. You cannot untarget while the resume is being prepared. You can still **Edit details** and **Copy info** in Search Jobs. Targeted jobs also offer **Open resume** and **Preview PDF**; apply, skip, recalculate, and Ghostwriter actions are no longer part of the Search Jobs action menu.

The pipeline discovers and scores jobs; it does not prepare resumes for them. Resume preparation starts when you click **Target**. If it fails, the job returns to `discovered` but stays targeted. Its targeting date is retained after PDF generation.

When you select a job, the detail panel shows the available title, employer,
status, and listing information immediately. A loading skeleton fills the
remaining detail area until the full job arrives. If that request fails, use
**Retry** in the panel; actions that require full details stay unavailable.

### Using the Filters panel

The main jobs page has a `Filters` button on the top-right next to `Search`.

Use it when you need to narrow the current tab without changing tabs.

What the panel includes:

- source filters
- sponsor status filters
- salary filters
- date filters
- sorting controls

Job rows and the detail header can also show a `Previously Applied` warning when JobOps finds a high-confidence fuzzy match against one of your past applied or in-progress jobs using title and company, not just URL dedupe. To avoid flagging genuinely new openings, JobOps only shows this warning when the matched historical application falls within 30 days of the current job's discovery date.

Date filters work on every jobs tab:

- `Discovered`
- `All Jobs`

Available date dimensions:

- `Ready` (the targeting date)
- `Applied`
- `Closed`
- `Discovered`

Each selected date dimension uses the same range:

- quick presets: `7`, `14`, `30`, `90` days
- custom `Start date` and `End date`

Jobs match when they fit the current tab and at least one selected date dimension falls in range.

### Sorting by date

The sort section includes `Sort by Date`.

Use it with:

- `Most recent`
- `Least recent`

Date sorting follows the active date-filter context. If multiple date dimensions are enabled, JobOps uses this priority:

1. `Ready` (the targeting date)
2. `Applied`
3. `Closed`
4. `Discovered`

If a job does not have the first selected timestamp, JobOps falls back to the next available date in that order.

### Job notes

The dedicated job page includes a full-width `Notes` section below the stage timeline and job details area.

Use it for things like:

- answers to application questions, such as why you want the role or how your experience fits
- notes about recruiters, hiring managers, and interviewers
- reminders, follow-ups, and other job-specific context you want to keep with the application

Each note has a title and a markdown body. The section shows a notes list on the left and a full TipTap editor on the right when you click **Edit** or **Add note**.

To use it:

1. Open a job in the dedicated job page.
2. Scroll below the stage timeline and application details cards to the `Notes` section.
3. Click **Add note** or **Edit** on an existing note.
4. Use the TipTap editor on the right to enter a title and write the note body.
5. Save the note, then edit or delete it later from the same section if needed.

The saved view renders markdown by default, so links, lists, headings, and emphasis stay readable without leaving the job page.

### Opening documentation from the sidebar

1. Open the sidebar menu.
2. In the footer section under `Version vX.Y.Z`, click **Documentation**, which opens the locally hosted docs in a new tab.

### Generating PDFs

PDF generation uses:

- base resume selected from RxResume
- job description
- tailored summary/headline/skills/projects
- the configured PDF renderer (`rxresume` export or local LaTeX via `tectonic`)

Common paths:

- Target a job and prepare its resume in the background: `POST /api/jobs/:id/target`
- Untarget: `DELETE /api/jobs/:id/target`
- Prepare (or retry) a targeted job's resume: `POST /api/jobs/:id/process`
- Render the editor resume as a PDF: `POST /api/jobs/:id/generate-pdf`

### Rendering the PDF after edits (copy-pasteable examples)

Preview PDF and Download PDF render the editor resume again when the stored PDF is out of date. To do the same from the API:

```bash
curl -X PATCH "http://localhost:3001/api/jobs/<jobId>" \
  -H "content-type: application/json" \
  -d '{
    "jobDescription": "<new JD>",
    "tailoredSummary": "<optional>",
    "tailoredHeadline": "<optional>",
    "tailoredSkills": [{"name":"Backend","keywords":["TypeScript","Node.js"]}],
    "selectedProjectIds": "p1,p2"
  }'
```

```bash
curl -X POST "http://localhost:3001/api/jobs/<jobId>/summarize?force=true"
curl -X POST "http://localhost:3001/api/jobs/<jobId>/generate-pdf"
```

### External payload and sanitization defaults

- LLM prompts send minimized profile/job fields.
- Webhooks are sanitized and whitelisted by default.
- Logs and error details are redacted/truncated by default.
- Correlation fields include `requestId`, and when available `pipelineRunId` and `jobId`.

## Common problems

### Job is stuck in `processing`

- `processing` is transient; failures generally revert the job to `discovered`.
- Check run logs and retry generation.

### PDF does not reflect recent edits

- Edit the resume with **Open resume**; the editor resume is the source of the PDF.
- Click **Preview PDF**; it renders a fresh PDF when the stored one is out of date.

### Notes do not appear as expected

- Make sure you are on the dedicated job page, not the orchestrator detail panel.
- Confirm the note was saved after entering both a title and note content.
- If markdown looks plain, check for unsupported formatting or paste the note into the saved view again after editing.

### Reopen skipped/applied jobs

- Patch `status` back to `discovered` to return the job to the active queue.

### Date filter returns no jobs

- Open `Filters` and confirm at least one date dimension is selected.
- Check that your date range matches the lifecycle timestamp you care about.

## Related pages

- [Job Search Bar](/docs/next/features/job-search-bar)
- [Pipeline Run](/docs/next/features/pipeline-run)
- [Ghostwriter](/docs/next/features/ghostwriter)
- [Reactive Resume](/docs/next/features/reactive-resume)
- [Post-Application Tracking](/docs/next/features/post-application-tracking)
