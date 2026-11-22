# Review round 1 — lead decisions

Reviews: /tmp/review-a.md, /tmp/review-b.md, /tmp/review-d.md, /tmp/review-e.md.
Contract changes are already in `shared/src/resume-links.ts` doc comments and the PLAN.

## Shared rules (all steps)

- A ref (bulletRefs entry or libraryId) to an id that is not in the library is
  **unlinked** everywhere: no tint, no Reset/Save, × is a plain delete,
  stamp leaves it as is.
- Delete never touches a frozen job's resume (no ref stripping).

## A (shared/src/resume-links.ts)

1. addToResume: a role goes right after the last experience entry with the same
   company when there is one, else end of section (PRD R2 "end of its job").
2. stampLibraryRefs: lines link only to children of the item's matched parent;
   no cross-parent fallback. Item without a matched parent gets no line links.
3. Ref to a missing id = unlinked (resetLine no-op, stamp leaves it).
4. Kept: folding behaviour for legacy one-line items; `—` placeholder.

## B (server)

- B1: legacy duties attach first by `sourceExperienceId` to the role built from
  that base experience item; and `key()` normalises the period (any dash/hyphen,
  any spacing → " – ").
- B2 + S1: Sync skips job-resume items/lines that already carry a ref to an
  existing library item. The base resume is read **only on the first build**,
  recorded by a one-time per-scope marker (not "no role rows"). Manual
  "Sync from resumes" reads job resumes only (unlinked items/lines). Deleted
  items do not come back: frozen resumes keep their dangling refs.
- DELETE: frozen resumes untouched (PLAN updated).
- S2: GET /library never fails because of the base resume: catch, log, continue
  with job resumes + legacy rows.
- S3: lead handles in W (page reloads the resume after a sync with linked > 0).
- S4: POST default position = sibling count; one ORDER BY (position, createdAt, id)
  in both readers.
- S6: add one integration test with the real `@shared/resume-links`
  (sync → stamp → edit → propagate → delete), unmocked.
- N1: reject `kind` change on PATCH. N2: parent change refreshes
  company/role/startDate/endDate. N3: company/role columns only for `bullet`.
  Others: leave.

## D (right column)

- 1: scan only experience/projects items (KIND_SECTION) for lines.
- 2: new optional prop `frozen?: boolean`: when true, edits and deletes never
  call onDocumentChange; ticks still do.
- 3: add form renders inline under the "+ Add …" that opened it.
- 4: one keyword picker: its own search input filters; "Create '…'" when no
  exact match (adds to library and ticks); small delete icon per option.
- Nits: 5 only `bullet` rows draggable into experience (points → projects only,
  or not draggable); 6 company required when adding a job; 8 unticking the last
  keyword removes the skill from the resume; 9 tinted row title = the resume
  wording; 10 keep rank scores after tag edits; 11 certification "Link" label.
  Leave DutyLibrary deletion to W.

## E (middle column)

- 1: replace the item in its array instead of Object.assign.
- 2: experience rows render from `getItemLines` only (one array).
- 3: dropping a library line already on the resume does nothing; a drop of a
  kind that does not match the section (not bullet → experience, not
  project_point → projects) inserts an unlinked line.
- Nit 7: project points use stable keys like experience.
