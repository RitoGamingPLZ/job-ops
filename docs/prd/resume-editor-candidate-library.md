# PRD: Co-work resume editor — Candidate Library

Status: **Draft v1 — rebuilt on the fork's main (739ee91)**
Owner: Alan
Last updated: 2026-11-11
Replaces: Phase 12 plan in the gemini-ai-proxy context (`.ctx/PLAN.md` §Phase 12, `task-p12-*.md`). Keeps its data contract (one `experience_bullets` table with `kind` + `data`, "Sync from resumes", tailoring that selects from the library) and adds the editor behaviour agreed in the review rounds.

---

## 1. Today (`/resumes/:jobId`, co-work page)

| Column | Shows | Code |
|---|---|---|
| Left | Co-work chat (Ask AI, suggestions) | `GhostwriterPanel` |
| Middle | The job's resume on A4 paper, always editable. Reorder sections, entries, bullets here. | `cowork/ResumeEditor.tsx` |
| Right | Tabs: **Job match** / **Duties** | `cowork/JobMatchPanel.tsx`, `cowork/DutyLibrary.tsx` |

Data: the library (`experience_bullets`) holds **experience duties only**, as flat rows with company/role/dates as plain text. Projects, skills, education, awards and certifications exist only in the base resume (Resume Studio) and each job's copy (`job_resumes.document`). Inserting a duty **copies** its text: nothing links a resume bullet back to the library.

Problems:
1. The right column is a tool panel, not "what we know about the candidate". Half the candidate's data isn't in it.
2. No link between library and resume, so fixing a duty in the library doesn't fix it anywhere, and you can't see which resume lines were reworded.
3. No way to see the final PDF without leaving the page.

## 2. Goal

- **Right column = Candidate Library.** Everything we know about the candidate, as a plain checklist. Ticks = on *this job's* resume.
- **Middle column = this job's resume.** Only ticked items. Rewording here never changes the library. Library edits still reach lines you haven't reworded. Reworded lines are highlighted.
- **Edit ⇄ Preview** toggle in the middle column.

Non-goals (v1): changing the chat; changing PDF themes; Word export; multi-user.

## 3. Core stories

1. I see all my jobs → roles → duties, projects, skills, schools, awards and certifications in one place, including ones not on this resume.
2. I add, edit and delete them in the library.
3. I tick an item to put it on this job's resume and untick to take it off. Nothing is lost.
4. I reorder everything on the resume in the middle column only.
5. I reword a line on the resume; the library keeps its text; the line is highlighted.
6. I reset a reworded line to the library text, or save the rewording to the library.
7. If I fix a duty in the library, every not-yet-applied job resume that uses it and hasn't reworded it shows the fix.
8. Targeting a job builds its resume by picking from the library (one LLM call), and those picks are linked too.

## 4. Layout

```
┌───────────┬──────────────────────────────────┬──────────────────────────────┐
│ Chat      │ RESUME — Acme · Sr Engineer      │ [Library] [Job match]        │
│           │ [Edit ⇄ Preview]  Undo  Save ... │ Experience · Projects ·      │
│           │                                  │ Skills · Education · Awards ·│
│           │ Acme Corp                        │ Certifications               │
│           │  Senior Engineer · 2022 – now    │ ☑ Acme Corp · London         │
│           │   • Led migration to …  ░░░░░░   │   ☑ Senior Engineer · 2022–  │
│           │   • Built CI pipeline …          │      ☑ Led migration … ░░░   │
│           │  Engineer · 2020 – 2022          │      ☑ Built CI pipeline …   │
│           │   • Owned billing …              │      ☐ Mentored juniors …    │
│           │                                  │      + Add duty              │
│           │                                  │   + Add role                 │
│           │                                  │ + Add job                    │
└───────────┴──────────────────────────────────┴──────────────────────────────┘
░ = reworded on this resume
```

### Left — Chat
Unchanged. Its suggestions that change a linked line make it reworded (R4).

### Middle — Resume
- One **Edit ⇄ Preview** toggle button. Edit = today's paper editor. Preview = the rendered PDF shown inline in the same column (same render as "Render PDF"). Remembered per browser.
- All ordering stays here (already true today): sections, entries, roles, bullets, skills.
- New: × on a line = untick it in the library. Reworded lines tinted, with **Reset to library text** and **Save to library** in the existing line toolbar.
- Blank rewording = cancel (never saves an empty bullet).

### Right — Candidate Library (replaces the Duties tab; Job match stays as the second tab)
Very straightforward:
- A one-line section switch at the top: Experience · Projects · Skills · Education · Awards · Certifications (wraps on narrow panes). Only the chosen section is listed. No search, no accordions.
- **Experience**: job line → indented roles → indented duties. Each line has a checkbox. Click text to edit in place (Enter saves, Esc cancels). Trash on hover/focus. "+ Add duty" per role, "+ Add role" per job, "+ Add job".
  - Job fields: company, location, website. Role fields: position, period.
- **Projects**: project line (name, period, link) → its points, ticks as above.
- **Skills**: one row per skill group: checkbox + editable label text field + **searchable multi-select** of keywords (chips; typing filters; "Create '…'" adds and ticks; × on chip unticks; delete from inside the list). Built on `components/ui/searchable-dropdown.tsx`.
- **Education**: one line — school, degree (one line), location, duration.
- **Awards**: one line — title, optional date.
- **Certifications**: one line — description, issuer (text), link, date.
- One-line items: checkbox + inline fields, no points.
- Tags, "Rank for this job", "Paste & extract" and drag-to-chat stay visible on duties as they are today (N5).
- "Sync from resumes" (from Phase 12) sits next to the section switch.

## 5. Behaviour rules

| # | Rule |
|---|---|
| R1 | The library holds the facts. Each job resume stores which items are on it, their order, and per-line rewording. |
| R2 | Ticking adds the item at the end of its place on the resume (duty → end of its role; role → end of its job; job/project/… → end of section). Unticking removes it; the library keeps it. |
| R3 | A resume line that is not reworded shows the library text ("linked"). |
| R4 | Editing a linked line in the middle (by hand or by accepting an AI suggestion) makes it reworded for this job only. The library is never changed from the middle column except by **Save to library**. |
| R5 | Reworded lines are tinted with the same colour in both columns; hovering shows the library text. Never in the PDF. |
| R6 | Library edits update linked lines in job resumes of jobs **not yet applied**. Applied (and later) job resumes are frozen: what was sent stays as sent. |
| R7 | Deleting a library item that is on any resume asks first and names how many resumes use it. Frozen resumes keep their text (as an unlinked line). |
| R8 | Experience is job → role → duty, each tickable. A job with no ticked roles is not on the resume. Each ticked role is its own resume entry (company line repeated), which the current PDF themes already render. |
| R9 | Entry fields (company, position, dates, school, …) are edited in the library only and always linked. |
| R10 | Skills keywords are ticked, not reworded. |
| R11 | Autosave, undo and the revision-conflict dialog work as today and cover ticks and rewording. |
| R12 | The AI never writes contact details, employers, job titles, dates, schools or certificate names (existing rule). |

## 6. Data model

Builds on Phase 12's contract.

- **`experience_bullets` → candidate library** (table not renamed): add `kind` (`role`, `bullet`, `project`, `project_point`, `skill`, `education`, `award`, `certification`) and `data` json, plus `parent_id` (bullet → role, project_point → project) and `position` (library order).
  - `role`: text = position; data = `{ company, location, website, period }`. Jobs are roles grouped by company.
  - `bullet`: text = duty; `parent_id` = role. (Existing company/role/dates columns kept for old readers; filled from the role.)
  - `skill`: text = label; data = `{ keywords: string[] }`.
  - `education` / `award` / `certification`: text = the one line; data = the other fields (§4).
  - Existing readers (context builder, rank, chat prompt, labelling, scorer) keep reading `bullet` only by default.
- **Per-job links**: stored with the job resume (same save, same revision): for every resume line, the library id it came from and its reworded text (null = linked). Exact storage (column vs field in the document) is decided in the plan; it must survive the v5 schema parse.
- **Rendering**: the job resume document is rebuilt from base resume skeleton + library + links whenever links or (for unapplied jobs) the library change, so PDF, chat, screening and scorer keep reading plain v5 JSON.

## 7. Library filling and migration

- First open after release: **Sync from resumes** runs automatically once — union of the base resume and every job resume, deduped (Phase 12 rules). Roles are created from experience entries; duties are linked to their role.
- Existing job resumes: each line is matched to a library item by normalised text within its section/role. Matched → linked; text differs only by edits → reworded; no match → a new library item is created and linked. Nothing on any resume changes visually.
- Converting old fields to one-line items folds extras into the line with " · " (education grade/description, award awarder/description, certification description). Certification issuer and education location keep their own fields. Nothing is dropped.
- File/RxResume import (Resume Studio) still sets the base resume; afterwards Sync adds anything new to the library. Sync never removes items and never changes existing resumes' selections.

## 8. Targeting (from Phase 12 step 73)

Targeting builds the job resume by selecting from the library in one LLM call (skeleton from the base resume; selected roles/duties/skills/projects/awards/certifications; headline + summary). Every selected line is stored as **linked** (R3), so later library fixes reach it until the job is applied.

## 9. Success measures

- Library item counts per kind grow after Sync; duties edited in the library.
- Fewer "Insert" copies, more ticks. Events: `library_item_added`, `resume_item_toggled`, `resume_line_reworded`, `resume_line_reset`, `resume_line_saved_to_library`, `resume_preview_toggled`.

## 10. Decisions carried over from the Resume Studio PRD

| # | Decision |
|---|---|
| Q1 | Edit ⇄ Preview toggle in the middle column; Preview = exact PDF. |
| Q2 | Library edits flow to unreworded lines; reworded lines highlighted. Now limited to unapplied jobs (R6). |
| Q3 | Import fills the library; resumes are built by picking (now: targeting / ticking). |
| Q4 | Sections: experience (job → role → duty), projects, skills, education, awards, certifications. |
| Q6 | All ordering in the middle column (already true). |
| Q7 | Points per role. |
| Q9 | Project "must include / AI may pick" flags stay; the tick replaces "hidden". |
| Q10 | Skills: editable label + searchable multi-select. |
| Q11 | Certification issuer and education location fields; everything else folded into the one line. |

Changed: Q12 (several roles under one job) — each ticked role is its own entry (R8) instead of sub-headings, since the co-work editor and themes already render one entry per role.

## 11. Open questions

| # | Question | Answer |
|---|---|---|
| N1 | Keep **Job match** as a second tab in the right column? | **Decided:** yes, Library first. |
| N2 | R6: freeze resumes from "applied" onward? | **Decided:** yes, library fixes reach unapplied jobs only. |
| N3 | Untargeted jobs: still no editor (current rule)? | Proposed: unchanged in v1. |
| N4 | Resume Studio (base resume editor) stays as is for basics/summary/section defaults? | Proposed: yes; library replaces it for the six sections later. |
| N5 | Tags / Rank / Paste & extract — hide in a menu? | **Decided:** keep them visible as today. |
