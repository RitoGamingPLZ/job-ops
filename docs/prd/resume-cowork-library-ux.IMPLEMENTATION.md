# Ghostwriter and candidate library implementation plan

Scope is the job resume Co-work editor. The companion [UX review](resume-cowork-library-ux.PLAN.md) describes the user journey. The sequence below delivers two independently usable improvements before changing persistence.

## 1. Select evidence in the composer

**Client.** In `orchestrator/src/client/pages/ResumeCoworkPage.tsx`, add a searchable “Use from candidate library” picker through the existing GhostwriterPanel referenceChips slot. Use the loaded library and existing reference handler for clicks, keyboard selection and drops. Show parent role/project and current inclusion state to distinguish similarly worded items. Keep resume focus and evidence in separately labelled groups. Exclude contacts, deduplicate by ID and retain the existing request limit. Give empty results and removed selections actionable feedback.

**Server.** In `server/services/cowork-ai.ts`, separate catalog selection from prompt serialization. Admit explicit IDs in selection order with their required parents, then fill the remaining byte budget with linked items and ranked candidates. Return admitted IDs alongside the prompt to the Ghostwriter service. If any explicit ID is unavailable or cannot fit, stop before the model call and use the existing error transport to ask the user to remove or narrow the selection. Resolve IDs only from the private-scope catalog. Return no details about inaccessible records.

**Acceptance.** Extend ResumeCoworkPage and cowork-ai tests with keyboard selection, duplicate drops, a large catalog, shared parents, an oversized selection and foreign IDs. Assert the serialized prompt contains each selected row and parent exactly once, or the client receives a recoverable error.

## 2. Show the source and destination of each suggestion

**Contract.** Extend the applicable rewrite variants in `shared/src/types/resume-suggestions.ts` and both runtime and model schemas in `shared/src/resume-suggestion-schema.ts` with optional source IDs, following insert_bullet.sourceBulletIds. Keep existing stored suggestions readable. In filterCoworkSuggestions validate citations against the admitted catalog for that response. Drop invalid citations. Preserve the distinction between evidence cited for a rewrite and a durable library link.

**UI.** Extract the suggestion preview from ResumeEditor.tsx. Use the existing editor.ts target resolution for current wording and stale checks. Show source text and parent, current wording, proposed wording, and one action naming its destination. For an include operation use “Include on this resume”. For a rewrite use “Apply to this resume”. For an uncited rewrite omit the source row. Keep the current resume-only bulk action and individual dismissal.

**Acceptance.** Test linked include, cited rewrite, uncited legacy suggestion, missing source, and stale target. Applying a cited rewrite must preserve local overrides and must issue zero library writes. This slice can ship with step 1.

## 3. Review the exact shared mutation

In ResumeCoworkPage.tsx route manual line save, manual entry save and assistant save_to_library to one review dialog. Move existing changed-field selection into a pure shared function used for preview and commit validation. Capture the target, resume revision, reviewed original field values, and proposed field values when opening. Display the diff and fetch the existing library/:id/usage endpoint on demand. Label its count as linked resumes. A linked resume can have local overrides, so a usage count alone cannot establish how many copies will visibly change.

Cancellation writes nothing. Keep the active draft and focus when the dialog closes. A dirty document must pass through the existing save coordinator before taking the reviewed revision. Keep unrelated job-specific fields out of the patch. Wire confirmation to the guarded endpoint in step 4 before shipping shared-write changes.

## 4. Commit shared changes atomically

**API shape.** Add a job-scoped POST action under /jobs/:id/resume in server/api/routes/cowork.ts and a typed wrapper in client/api/cowork.ts. Proposed input is a discriminated union for promoting reviewed fields, creating a library item, or creating and including it. Carry an operation ID, base resume revision, and the reviewed target/preconditions for that operation. Return the resolved library row, authoritative resume revision/document and whether the row was created, reused or updated. Use existing API envelopes, request IDs, route permissions, scoped job lookup and sanitized errors.

**Persistence.** Both candidate-library.ts and repositories/job-resumes.ts already use database transactions. Extract synchronous transaction-taking internals while retaining existing public wrappers. Run scope checks, compare reviewed fields and revision, deduplicate or patch the library row, propagate through existing link rules and save the active resume in one outer transaction. Keep current-job propagation single-owner via the existing skip-job mechanism. Preserve uploaded-PDF supersession behavior. For create-and-include use the actual deduplicated row when applying inclusion. Share the pure inclusion logic across client and server. A library-only operation checks the reviewed resume revision without manufacturing a document edit.

**Retries.** Record a minimal successful operation receipt in the same transaction, unique within private scope and job. Include an input fingerprint and result identifiers/revision. A repeated identical request returns the committed outcome and current scoped state. Reject operation-ID reuse with different input. Scope every lookup, including receipt replay, by the authenticated private scope. On stale data return 409 CONFLICT, retain the draft and reopen review against refreshed values. Log identifiers and outcomes only.

**Client integration.** Replace the shared-write branches in components/cowork/acceptSuggestions.ts with one commit call per explicitly reviewed shared action. Keep ordinary resume edits on the current save path. Serialize confirmation with autosave, prevent duplicate submits, and reconcile returned state without overwriting edits made during the request. Retire the partial-save warning after every combined-write entry point uses the atomic action.

## 5. Verification and release

- Extend candidate-library, job-resume and cowork route tests for two-workspace isolation, concurrent revision conflicts, stale library values, propagation preserving local overrides, deduplication, rollback after a forced resume failure, and replay after a lost response.
- Extend acceptSuggestions and ResumeCoworkPage tests for conflict recovery, dirty drafts, keyboard focus restoration and definitive saved destinations. Verify the base-resume editor and ordinary Ghostwriter chat retain their existing behavior.
- Update current user-facing feature docs for source selection, local application, shared promotion and recovery. Run targeted tests first, then vp check, npm run check:types:shared, the orchestrator type check, client build and full test:run.
- Release steps 1–2 independently. Release steps 3–4 together after rollback, replay and cross-workspace tests pass. In a walkthrough, ask users to identify the source and predict which records will change before each confirmation.
