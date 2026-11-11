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
6. Changes autosave; **Save now** saves immediately and **Undo** reverses edits. Switch between **Edit** and **Preview**, or click **Render PDF** in the middle column to render a fresh inline PDF. The Edit/Preview choice is remembered in this browser.

Library edits update linked, unreworded content in unapplied job resumes. Jobs marked **Applied** or **In progress** keep their saved content when the library changes. You can still edit those resumes directly or change their ticks. Deleting a library item used by resumes asks for confirmation; frozen resumes keep their text.

## Common problems

- **Import fails:** check the file format, or verify your Reactive Resume URL, API key, and selected base resume in **Settings**.
- **An item is missing from the library:** use **Sync from resumes** after importing or adding resume content.
- **A library edit did not change a job resume:** check whether the line was reworded or the job is Applied or In progress.
- **The PDF shows older content:** click **Render PDF** after editing. If rendering fails, check the configured PDF renderer in **Settings**.
- **Save conflict:** choose which copy to keep in the conflict dialog before continuing.

## Related pages

- [Reactive Resume](/docs/next/features/reactive-resume)
- [Settings](/docs/next/features/settings)
- [Ghostwriter](/docs/next/features/ghostwriter)
