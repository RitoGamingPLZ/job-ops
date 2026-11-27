---
id: design-resume
title: Co-work resume editor
description: Edit your base and job resumes, choose candidate library items, and preview the rendered PDF.
sidebar_position: 4
---

## What it is

The co-work editor is JobOps' resume editor. Open your base resume at `/resumes/base` or a job resume at `/resumes/<jobId>`.

Job resumes show chat on the left, the resume in the middle, and **Library** / **Job match** tabs on the right. The base resume has the editor and library without job chat. Resume documents are stored locally in the JobOps v5 resume format.

## Why it exists

Keep reusable candidate facts in one library, choose what belongs on each job resume, and review the PDF without leaving the editor.

## How to use it

1. Open `/resumes/base`. Click **Import** to choose a PDF, DOCX, or JSON file. Import replaces the base resume; existing job resumes keep their content.
2. Use **Sync from resumes** in the right panel to collect candidate items from your resumes into the library.
3. Open a job resume at `/resumes/<jobId>`. In **Library**, switch between **Contact**, **Experience**, **Projects**, **Skills**, **Education**, **Awards**, and **Certifications**. Tick items to add them to this resume; untick to remove them while keeping them in the library. The base resume's library has no selection ticks.
4. Click library text to edit it, use **Add** to create items, and manage tags beside supported items. Contact items support email, phone, location, website, and social profiles. Expand experience roles to see duties; use the searchable keyword picker for skills. Duty tools include **Rank for this job** and **Paste & extract**.
5. Edit and reorder content in the middle column. Reworded linked lines are highlighted in both columns. Edits to linked items stay on this resume and keep their library links. Use **Reset to library text** to restore a line or **Save to library** to update the reusable wording and other resumes using it.
6. Changes autosave; **Save now** saves immediately and **Undo** reverses edits. Use the **Edit** / **Preview** toggle in the middle column. For generated and base resumes, **Preview** saves your edits before rendering an inline PDF; clicking it again refreshes the PDF. Uploaded PDFs keep their original bytes until you save edited resume content in the editor, after which **Preview** and **Download PDF** render a fresh PDF from the edited resume.
7. From **Resumes**, **In Progress Board**, or **Search Jobs**, choose **Open resume** to enter Edit or **Preview PDF** to enter Preview for the selected job. Both actions open the same resume workspace. These entry actions override the browser's remembered mode. Bare links and links with an invalid mode keep the remembered choice. For example, `/resumes/<jobId>?mode=edit` opens Edit and `/resumes/<jobId>?mode=preview` opens Preview.

Entry Preview displays an existing current or unedited uploaded PDF without requiring an editable resume or candidate library. **Download PDF** downloads that artifact. Choose **Edit** to load the editable source; an uploaded PDF alone does not provide editable JSON. Missing or out-of-date generated PDFs—and uploaded PDFs whose resume content has been edited in the editor—are rendered from the saved resume before display, preserving tailored content and revisions. Preview does not re-tailor a resume.

The default PDF theme is **Navy Serif**, which shares its typography, colors, and spacing with Edit mode. To match Edit on a workspace with custom PDF settings, select **Typst** and **Navy Serif** in **Settings → Resume PDF**.

Library edits update linked fields and lines in unapplied job resumes only where they still match the previous library value. Locally edited fields and reworded lines keep their wording. Jobs marked **Applied** or **In progress** keep their saved content when the library changes. You can still edit those resumes directly or change their ticks. Deleting a library item used by resumes asks for confirmation; frozen resumes keep their text.

### Education, awards, and certifications

In **Library**, click an item to edit its degree or title separately from its details:

- **Education:** degree, school, location, period, area of study, grade, description, and website.
- **Awards:** title, date, awarder, description, and website.
- **Certifications:** title, issuer, date, description, and website.

A one-time migration runs automatically on upgrade. Where a matching saved resume provides one unambiguous version, it recovers the separate degree or title and its details, including descriptions and websites. Unrecognised or ambiguous rows keep their full existing text and any known details; new fields are empty for you to fill in. It does not guess how to split combined text or change saved resumes. Review these items in **Library** after upgrading.

### Co-work chat suggestions

Open **Use from candidate library** in Co-work chat and search for a role, project, or phrase. Select a result to add it under **Library evidence**. To direct the edit to a particular part of the resume, use **Ask AI** on that part. You can remove either selection before sending. If the selected evidence exceeds the chat budget or a source was removed, remove the affected selection or choose fewer sources and send again.

For a rewrite, compare **Current resume wording** with **Proposed wording**. When Ghostwriter cites library evidence, the card shows the source and its parent role or project. Choose **Apply to this resume** to use the wording for this job. To add an existing library item with its link, choose **Include on this resume**.

Before updating a shared item, review its current and proposed fields and the count of linked resumes. **Cancel** keeps the tailored wording in the job resume. **Update library item** commits the shared edit. For a new fact, **Save to library and resume** creates or reuses the library item and includes it in one save. After a connection failure, retry the confirmation. If another edit conflicts, review the refreshed values first.

Ask chat to adapt the job resume, then review its suggestions before accepting them. It can propose:

- **Include library item** or **Exclude library item** to change this resume's selection.
- **Add to library** for a new fact you provide, optionally including it on this resume.
- **Save to library** when you explicitly ask to reuse an edited linked line or entry.
- Add, remove, or reorder entries in experience, education, projects, skills, awards, and certifications.
- Add, rewrite, remove, or reorder experience bullets and project points; edit introductions, the headline, summary, or entry fields; and update a skill group's keywords.

Accepting edits to linked items keeps the link and changes only this job's resume. Library writes are opt-in: review and accept **Add to library** and **Save to library** separately. **Save to library** updates other resumes using that item, subject to the local-edit and job-status rules above. **Accept all** skips both kinds of library change and leaves them for separate review.

### Generate or replace a job resume

Targeting a job prepares a resume from your candidate library. If it creates a new tailored resume for a job with an uploaded PDF, Preview uses the new resume. To fill gaps across targeted jobs, open **In Progress Board** and click **Generate missing resumes** in the Targeted lane header. That batch preserves saved documents and hand edits, rendering a fresh PDF when needed; uploaded PDFs are skipped.

To select library facts again for one targeted job with a prepared resume, click **Regenerate resume** on its job page or detail panel and confirm. This replaces the saved co-work document, including hand edits, and replaces any uploaded PDF with a generated PDF. Review your library first, then review the new resume when generation finishes. Previewing keeps existing current and uploaded PDFs; when a generated PDF needs rendering, it uses your saved document without re-tailoring it.

Library-based generation recognizes both top-level experience roles and roles nested under an employer. Base-resume roles are retained even when the model omits them. Generation selects education and project points as well as experience duties, skills, projects, awards, and certifications. It may reword experience bullets, project points, and introductions for the job. These rewrites stay on that job's resume, keep their library links, and are never copied into the library by **Sync from resumes**. Updating the library requires an explicit **Save to library** action. Skills are selected by library identity, so groups with the same label keep their own keywords.

### Candidate library data sent to the LLM

For library-based resume preparation and **Regenerate resume**, JobOps sends the configured tailoring LLM:

- Job title, employer, and the plain-text job description, capped at 25,000 characters.
- Writing style preferences, resolved output language, and project rules (required and AI-selectable project IDs, plus the target count).
- Non-contact library items, including their IDs, kinds, text, parent relationships, and tags. Extra data is limited to company, location, period, school, area of study, grade, awarder, description, issuer, date, and skill keywords. Experience and project introductions from the base resume are also included.
- Up to 150 duty bullets. Selection reserves up to three highest-overlap duties per role, giving each role one before allocating a second or third, then fills remaining slots by job-description overlap. More than 150 roles with duties can exceed this coverage budget.

Contact library items are excluded from these prompts. Photos, URL fields, and arbitrary library data fields are also excluded. Other item text and tags are sent as written, so review them for personal information before generation. These limits describe library-based resume tailoring; other AI tools, such as editor chat, have their own context.

The model writes a headline and summary, selects library items and existing skill keywords, and may tailor bullet and introduction wording for this job. The combined generation prompt is limited to 100,000 bytes; oversized libraries fail before the LLM call.

## Common problems

- **Import fails:** check the file format, and that your AI model is configured (PDF and DOCX imports use it).
- **An item is missing from the library:** use **Sync from resumes** after importing or adding resume content.
- **A library edit did not change a job resume:** check whether the field or line was edited locally or the job is Applied or In progress. After the migration, linked education, award, or certification items still holding the old combined text stop receiving library updates until re-added. Untick and re-tick the item in **Library** to use its structured version; copy any local edits you want to keep first.
- **Cloudflare PDF rendering:** previews and saved PDFs use the internal render container. Typst is included in that image; LaTeX requires Tectonic, which the Cloudflare image does not include. If rendering reports a container error, check the container binding and internal secret, then retry. Only the resume document, render options, job identifier, and any visible uploaded picture bytes are sent to this internal service.
- **Preview fails:** use **Retry** in the preview. If your session expired, sign in again. Wait for preparation or PDF regeneration to finish before retrying. If Edit reports a missing source, import or configure your base resume; an existing PDF can still be previewed without it.
- **The PDF shows older content:** click **Preview** again after editing. If rendering fails, check the configured PDF renderer in **Settings**.
- **Save conflict:** choose which copy to keep in the conflict dialog before continuing. If another action regenerated this resume and **Resume changed elsewhere** appears, choose **Use latest** to keep the regenerated resume. **Keep mine** overwrites it with your editor's content.

## Related pages

- [Orchestrator: resume generation](/docs/next/features/orchestrator#generating-pdfs)
- [In Progress Board](/docs/next/features/in-progress-board)
- [Resume PDF and projects](/docs/next/features/resume-pdf)
- [Settings](/docs/next/features/settings)
- [Ghostwriter](/docs/next/features/ghostwriter)
