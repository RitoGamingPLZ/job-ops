# PLAN — Co-work candidate library

Spec: `docs/prd/resume-editor-candidate-library.md` (read it first).
Base branch: `worktree-resume-studio-library-prd` (fork main 739ee91 + PRD + contract).
Each step runs in its own child worktree branched from it and commits there.
The lead reviews, merges, and does the page wiring (step W).

## Fixed contract (committed by the lead — do not change; tell the lead if wrong)

- `shared/src/types/cowork.ts`: `CandidateItemKind` (+ per-kind `data` shape in
  its doc comment), `ExperienceBullet.kind/data/parentId/position`,
  `ExperienceBulletInput.kind/data/parentId/position`, source `"job_resume"`,
  `LibraryItemUsage`, `LibrarySyncResult`.
- `orchestrator/src/server/services/rxresume/schema/v5.ts`: base item gets
  optional `libraryId` and `bulletRefs` (so they survive every parse).
- `shared/src/resume-links.ts`: signatures and doc comments are the spec.
  Links live inside the job resume document: `item.libraryId`,
  `item.bulletRefs` (aligned with `splitDescription(description).bullets`).
  **Reworded = linked line whose text differs from the library text**
  (`sameLineText`); nothing else is stored.
- `orchestrator/src/client/components/cowork/rewordTint.ts`:
  `REWORDED_TINT_CLASS` — the only tint for reworded lines (both columns).
- Frozen job (R6) = status `applied` or `in_progress`. Library edits never
  change a frozen job's resume.

### HTTP API (step B implements, step D calls; co-work router is mounted at `/api` root)
Keep the existing response envelope and shapes of today's routes.
| Method | Path | Behaviour |
|---|---|---|
| GET | `/library` | `{ items: ExperienceBullet[] }`, every kind, library order. If the scope has no `role` rows yet, run sync once first (PRD §7 "first open"). |
| GET | `/experience-bullets` | unchanged: kind `bullet` only |
| POST | `/experience-bullets` | accepts kind/data/parentId/position (validate kind; data plain object or null; parent must exist and be the right kind) |
| PATCH | `/experience-bullets/:id?skipJobId=` | update; then `applyLibraryUpdate` on every non-frozen job resume except `skipJobId` (save with revision+1) |
| DELETE | `/experience-bullets/:id?skipJobId=` | delete item + children; non-frozen resumes except `skipJobId`: `removeFromResume`; frozen: untouched (its refs now point at a missing id = unlinked) |
| GET | `/library/:id/usage` | `LibraryItemUsage` (children count toward their parent) |
| POST | `/library/sync` | `LibrarySyncResult`: union of base resume + every job resume into the library (PRD §7, Phase 12 dedupe rules + one-line folding), legacy parentless bullets attached to roles built from company/role/dates, then `stampLibraryRefs` on every job resume. Replaces `POST /experience-bullets/import-resume` (delete it). No LLM. |

Existing library readers (context builder, rank, label, chat prompt, scorer,
screening) keep seeing kind `bullet` only — make that the repo default.

## Steps (A, B, D, E in parallel; C after A+B are merged)

### A — shared links logic
Owns: `shared/src/resume-links.ts` (bodies), `shared/src/resume-links.test.ts`.
Use `splitDescription`/`joinDescription` from `shared/src/resume-bullets.ts`.
Tests: add/remove every kind (R2 parent auto-add), applyLibraryUpdate leaves
reworded lines and frozen-agnostic, entry fields re-derived, intro prose kept,
refs stay aligned, stampLibraryRefs never changes text, no-op returns same object.

### B — server library
Owns: `server/db/schema.ts` + `server/db/migrate.ts` (experience_bullets parts
only: `kind` text not null default 'bullet', `data` json, `parent_id`,
`position` int default 0; additive ALTER for old DBs) + migrate test,
`server/repositories/experience-bullets.ts` (replace the lead's placeholder in
`publicBullet`), new `server/services/candidate-library.ts` (+ test),
`server/api/routes/cowork.ts` (library/experience-bullets routes only) + its
test. Use `@shared/resume-links` (step A writes the bodies in parallel; mock it
in your unit tests, and say in your report which tests need A to pass for real).
Tests: migration on an old DB; default kind filter; sync union/dedupe/fold/
skill keyword merge/idempotent; legacy bullets → roles; propagation skips
frozen and skipJobId; delete strips refs on frozen; tenant isolation.

### C — generate from library on targeting (after A+B merged)
Owns: `server/services/job-resume.ts`, new `server/services/resume-from-library.ts`
(+ test), and removal of the target-flow calls it replaces.
Same as the fork's `task-p12-generate.md` (one LLM call selecting ids;
skeleton from base resume; validation; throw on failure; Phase 11 guarantees),
plus: every selected item/line is built with `libraryItemToResumeItem` /
linked lines so the new resume is fully linked (R3).

### D — right column: Library tab
Owns: new `client/components/cowork/CandidateLibrary.tsx` (+ test),
`client/components/cowork/DutyLibrary.tsx` (+ test) only to extract or reuse
the duty extras, `orchestrator/src/components/ui/searchable-multi-select.tsx` (+ test),
`client/api/cowork.ts`, `client/pages/ResumesPage.tsx` (library page uses the
new panel without ticks).
Export:
```ts
export function CandidateLibrary(props: {
  /** Omit for library-only mode (/library): no ticks. */
  jobId?: string;
  /** Job is applied/in progress (R6): edits and deletes never touch `document`; ticks still do. */
  frozen?: boolean;
  document?: ReactiveResumeV5Document;
  onDocumentChange?: (update: (doc: ReactiveResumeV5Document) => ReactiveResumeV5Document) => void;
  /** Insert-to-chat / drag sources keep working as today. */
  onReferenceBullet?: (bullet: ExperienceBullet) => void;
}): JSX.Element;
```
It loads `GET /library` itself. PRD §4 "Right": section switch, plain
checklists (job → role → duty; project → points; one-line edu/award/cert;
skills label + searchable multi-select), click-to-edit (Enter/Esc), trash with
usage-aware confirm (R7), "+ Add …", Sync button + toast. Duty extras (tags,
Rank for this job, Paste & extract, drag) stay visible as today (N5).
Ticks call `onDocumentChange(doc => addToResume/removeFromResume(...))`.
Edits: PATCH with `skipJobId=jobId`, then
`onDocumentChange(doc => applyLibraryUpdate(doc, before, after))`.
Reworded lines (linked line text ≠ library text) use `REWORDED_TINT_CLASS`.
Mock `@shared/resume-links` and the API in tests.

### E — middle column: editor links
Owns: `client/components/cowork/ResumeEditor.tsx` + `.css` + test,
`editor.ts` + test, `resumeReorder.ts` + test, `BulletText.tsx` + test.
New optional props on `ResumeEditor`:
```ts
library?: ExperienceBullet[];               // for reworded detection + reset
onSaveLineToLibrary?: (libraryId: string, text: string) => void;
```
- Every bullet operation (edit, add, delete, move within/between items, drop
  from library/chat, AI suggestion accept) keeps `bulletRefs` aligned — go
  through `getItemLines`/`setItemLines`. Library drops create linked lines.
- Reworded lines: `REWORDED_TINT_CLASS`; title shows the library text;
  line toolbar gains **Reset to library text** (`resetLine`) and
  **Save to library** (`onSaveLineToLibrary`).
- × on a linked item/line = `removeFromResume`.
- Blank rewording of a linked line = cancel.
Mock `@shared/resume-links` where needed.

### W — page wiring (lead, after D and E)
`ResumeCoworkPage.tsx`: right tabs **Library | Job match**; Edit ⇄ Preview
toggle (inline PDF, remembered per browser); load library once and pass to
editor; save-to-library = PATCH with skipJobId + update open document; Job
match "Insert" creates linked lines.

## Rules for every step
- Read the PRD and this plan first. Touch only the files your step owns.
- Never read or copy `orchestrator/data` or `.env`; tests use fake data only;
  mock the LLM. Do not use the dev server on :5173/:3001. No new dependencies.
- Checks before reporting (repo root):
  - `printf "globalThis.__dirname = process.cwd();\n" > /tmp/cw-vite-preload.mjs; NODE_OPTIONS=--import=/tmp/cw-vite-preload.mjs TYPST_PACKAGE_CACHE_PATH=$(mktemp -d) DATA_DIR=$(mktemp -d) npm --workspace orchestrator run test:run -- --configLoader runner --cache false <your test files>`
  - `npx tsc -p orchestrator --noEmit`
  - `./orchestrator/node_modules/.bin/biome check --write <changed files>`
- Commit on your branch in your worktree. Do not merge, push, or start agents.
