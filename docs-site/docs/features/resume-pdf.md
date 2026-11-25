---
id: resume-pdf
title: Resume PDF and projects
description: How JobOps renders tailored resume PDFs locally and chooses which projects appear.
sidebar_position: 4
---

## What it is

JobOps stores your base resume and every job resume itself and renders PDFs locally, with no external resume service. You edit the resume in the [co-work resume editor](/docs/next/features/design-resume), and the PDF is rendered from that saved document.

Configure the renderer under **Settings → Resume PDF**.

## Project catalog

JobOps reads projects from `sections.projects.items` in the local base resume document.

Each project is identified by:

- `id`
- `name`
- `description`
- `date`
- `visible` (visible in base resume)

## Project selection controls

The Settings UI supports 4 project modes/controls:

- **Must include**: always sent to relevant AI contexts and always shown in tailored resumes.
- **AI can select**: sent to AI and available for automatic or manual job selection.
- **Don't include**: never sent to AI and never shown in tailored resumes.
- **Target**: desired final project count; JobOps keeps it at or above the Must-include count.

At generation time:

1. Must-include projects are added first.
2. A job's valid AI-selectable choices fill the remaining slots up to the target.
3. Excluded, deleted, stale, and duplicate IDs are removed.

Automatic selection fills every available slot. Manual selection may use fewer slots, but cannot exceed the target. PDF generation never makes a hidden project-selection AI call; it resolves the saved job choices against the current global policy, so the PDF matches the resume editor.

## Setup

1. Open `/resumes/base` and click **Import** to load a PDF, DOCX, or resume JSON file. Import replaces the base resume; existing job resumes keep their current content.
2. Open **Settings → Resume PDF** and choose a renderer, Typst theme, and paper size.
3. Adjust the project controls above.
4. Save settings. Existing generated PDFs affected by the policy are marked stale and queued for regeneration.

## Runtime behavior

### During PDF generation

Open the job resume at `/resumes/<jobId>` and switch the toggle to **Preview**. JobOps saves pending edits, renders the stored job resume using the configured renderer, and shows it inline. Click **Preview** again to re-render, or **Edit** to return to editing.

### What JobOps changes with AI

Library-based resume generation writes a headline and summary and selects existing experience duties, skill keywords, projects, certifications, and awards. It preserves base-resume roles, including roles nested under an employer, and copies selected duty text from the candidate library.

Contact library items are excluded from the tailoring prompt. See [Candidate library data sent to the LLM](/docs/next/features/design-resume#candidate-library-data-sent-to-the-llm) for the full field list and limits.

Rendering a saved co-work document does not re-tailor its content. To tailor again from the current library, use **Regenerate resume** on the targeted job's page or detail panel and confirm replacement of its saved edits and any uploaded PDF. See [Orchestrator](/docs/next/features/orchestrator#regenerate-a-jobs-resume).

### Renderers

JobOps generates the final PDF locally in one of two ways:

- `typst` (default): render with Typst and the selected Typst theme
- `latex`: render with the Jake Gutierrez-based LaTeX template

Notes:

- In Docker deployments, `tectonic` and `typst` are bundled into the image.
- In non-Docker local environments, install `tectonic` (optionally set `TECTONIC_BIN`) for LaTeX, and `typst` (optionally set `TYPST_BIN`) for Typst.
- A stored `pdfRenderer` value from an older version that is no longer available falls back to the default renderer.

### Typst themes

Typst themes are defined as folders under `orchestrator/src/server/services/resume-renderer/typst-themes`.

Each theme folder contains:

- `theme.json`: id, label, description, renderer kind, entrypoint, and native theme tokens
- `main.typ`: the Typst template used by the native renderer

After adding or changing a theme, run:

```bash
npm run typst-theme:generate
npm run typst-theme:validate
```

The generated shared metadata powers the settings dropdowns, so theme PRs do not need hand-written UI enum changes.

For package-backed themes, set `kind` to `adapted` and read the normalized resume document with `json(__RESUME_DATA_PATH__)` from the Typst entrypoint.

## Common problems

- Base resume is empty: open `/resumes/base`, click **Import**, and choose a file.
- Import fails: check the file format (PDF, DOCX, or resume JSON) and that your AI model is configured, since PDF and DOCX imports use it.
- Changes did not affect an already generated PDF: settings changes apply to new generation runs. Open the job resume and click **Preview** to render a fresh PDF.
- PDF generation fails because the renderer is unavailable: ensure `tectonic` (LaTeX) or `typst` is installed, or set `TECTONIC_BIN` / `TYPST_BIN`, then generate again.
- Project list is empty: add projects to the base resume in `/resumes/base`.

## Best practices

- Keep base resume projects complete and up to date.
- Use **Must Include** sparingly for cornerstone projects.
- Keep the AI-selectable pool broad enough for job-specific relevance.
- After major resume edits, preview the PDFs of active high-priority jobs to render them again.

### Add "context projects" even if they are usually hidden

The LLM only knows what exists in your resume data. Adding extra projects, even ones hidden by default, gives the AI more context about your skills and range, and lets it enable a project only when it is relevant to a role.

## Related pages

- [Settings](./settings)
- [Orchestrator](./orchestrator)
- [Ghostwriter](./ghostwriter)
- [Self-Hosting](../getting-started/self-hosting)
