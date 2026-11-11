---
id: design-resume
title: Co-work resume editor
description: Edit your base and job resumes, choose candidate library items, and preview the rendered PDF.
sidebar_position: 4
---

## What it is

The co-work editor is JobOps' resume editor. Open your base resume at `/resumes/base` or a job resume at `/resumes/<jobId>`.

Job resumes show chat on the left, the resume in the middle, and **Library** / **Job match** tabs on the right. The base resume has the editor and library without job chat. Resume documents are stored locally in Reactive Resume v5 format.

## Why it exists

Keep reusable candidate facts in one library, choose what belongs on each job resume, and review the PDF without leaving the editor.

## How to use it

1. Open `/resumes/base`. Click **Import** to choose a PDF, DOCX, or JSON file, or use **Import from RxResume** with your configured Reactive Resume account. Import replaces the base resume; existing job resumes keep their content.
2. Use **Sync from resumes** in the right panel to collect candidate items from your resumes into the library.
3. Open a job resume at `/resumes/<jobId>`. In **Library**, switch between **Contact**, **Experience**, **Projects**, **Skills**, **Education**, **Awards**, and **Certifications**. Tick items to add them to this resume; untick to remove them while keeping them in the library. The base resume's library has no selection ticks.
4. Click library text to edit it, use **Add** to create items, and manage tags beside supported items. Contact items support email, phone, location, website, and social profiles. Expand experience roles to see duties; use the searchable keyword picker for skills. Duty tools include **Rank for this job** and **Paste & extract**.
5. Edit and reorder content in the middle column. Reworded linked lines are highlighted in both columns. Use **Reset to library text** to restore a line or **Save to library** to reuse the new wording.
6. Changes autosave; **Save now** saves immediately and **Undo** reverses edits. Use the **Edit** / **Preview** toggle in the middle column; **Preview** renders a fresh inline PDF, and clicking it again re-renders. The Edit/Preview choice is remembered in this browser.

Library edits update linked, unreworded content in unapplied job resumes. Jobs marked **Applied** or **In progress** keep their saved content when the library changes. You can still edit those resumes directly or change their ticks. Deleting a library item used by resumes asks for confirmation; frozen resumes keep their text.

### Generate or replace a job resume

Targeting a job prepares a resume from your candidate library. To fill gaps across targeted jobs, open **In Progress Board** and click **Generate missing resumes** in the Targeted lane header. That batch preserves saved documents and hand edits, rendering a fresh PDF when needed; uploaded PDFs are skipped.

To select library facts again for one targeted job with a prepared resume, click **Regenerate resume** on its job page or detail panel and confirm. This replaces the saved co-work document, including hand edits, and replaces any uploaded PDF with a generated PDF. Review your library first, then review the new resume when generation finishes. Merely previewing a PDF renders your saved document without re-tailoring it.

Library-based generation recognizes both top-level experience roles and roles nested under an employer. Base-resume roles are retained even when the model omits them. Skills are selected by library identity, so groups with the same label keep their own keywords.

### Candidate library data sent to the LLM

For library-based resume preparation and **Regenerate resume**, JobOps sends the configured tailoring LLM:

- Job title, employer, and the plain-text job description, capped at 25,000 characters.
- Writing style preferences, resolved output language, and project rules (required and AI-selectable project IDs, plus the target count).
- Non-contact library items, including their IDs, kinds, text, parent relationships, and tags. Extra data is limited to company, location, period, school, issuer, date, and skill keywords.
- Up to 150 duty bullets. Selection reserves up to three highest-overlap duties per role, giving each role one before allocating a second or third, then fills remaining slots by job-description overlap. More than 150 roles with duties can exceed this coverage budget.

Contact library items are excluded from these prompts. Photos, URL fields, and arbitrary library data fields are also excluded. Other item text and tags are sent as written, so review them for personal information before generation. These limits describe library-based resume tailoring; other AI tools, such as editor chat, have their own context.

The model writes a headline and summary and selects existing duty IDs, skill keywords, projects, certifications, and awards. Duty text is copied from the library rather than reworded. The combined generation prompt is limited to 100,000 bytes; oversized libraries fail before the LLM call.

## Common problems

- **Import fails:** check the file format, or verify your Reactive Resume URL, API key, and selected base resume in **Settings**.
- **An item is missing from the library:** use **Sync from resumes** after importing or adding resume content.
- **A library edit did not change a job resume:** check whether the line was reworded or the job is Applied or In progress.
- **The PDF shows older content:** click **Preview** again after editing. If rendering fails, check the configured PDF renderer in **Settings**.
- **Save conflict:** choose which copy to keep in the conflict dialog before continuing. If another action regenerated this resume and **Resume changed elsewhere** appears, choose **Use latest** to keep the regenerated resume. **Keep mine** overwrites it with your editor's content.

## Related pages

- [Orchestrator: resume generation](/docs/next/features/orchestrator#generating-pdfs)
- [In Progress Board](/docs/next/features/in-progress-board)
- [Reactive Resume](/docs/next/features/reactive-resume)
- [Settings](/docs/next/features/settings)
- [Ghostwriter](/docs/next/features/ghostwriter)
