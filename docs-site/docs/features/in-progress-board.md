---
id: in-progress-board
title: In Progress Board
description: Kanban board for targeted opportunities, resumes, applications, interviews, and outcomes.
sidebar_position: 3
---

## What it is

The In Progress Board tracks shortlisted opportunities from Targeted through applications, interviews, and outcomes.

![In Progress Board kanban lanes](/img/features/in-progress-board.png)

It groups jobs into lanes:

- Targeted
- Applied
- Recruiter Screen
- Technical Interview
- Behaviour Question
- Team Match
- Offer
- Reject

The **Applied** lane can be collapsed to a thin strip so it doesn't take up horizontal space, letting you focus on jobs that are actively moving through later stages. Your collapsed/expanded preference is remembered across visits.

## Why it exists

Search Jobs helps you review many opportunities. Target the ones you want to pursue, then use the board to follow up and prepare for interviews.

## How to use it

1. Open **Search Jobs**, select a job, and click **Target**.
2. Open **In Progress Board**. The job appears in **Targeted** and shows **Preparing resume…** while its resume is prepared in the background.
3. When it is ready, click **Open resume** on the card or job page to edit the resume in the editor, or **Preview PDF** to open the same resume workspace in Preview mode. Both actions carry the selected job and override your remembered editor mode. If preparation failed, the card says **Resume not prepared yet**; click **Prepare resume** to try again. The job stays in Targeted until you mark it Applied.
4. Apply through the employer's application link, then mark the job **Applied**. Dragging a Targeted card to Applied records that transition; it does not submit an application.
5. Log events or move cards as the process progresses: **Recruiter Screen → Technical Interview → Behaviour Question → Team Match → Offer**. Use the stages that match the employer's process.
6. Log **Reject** for a rejection. A withdrawal also appears in Reject, with a **withdrawn** note.

Technical Interview is one column. Each `technical_interview` event counts as another round, so log another technical interview to record round 2 or later. Older Assessment and Final Round events appear in this same column, but do not increase the technical round count.

:::tip Celebration Effect
When you successfully move a job listing to the **Offer** stage (either by dragging a card to the **Offer** column or by logging an **Offer** stage event), a congratulatory celebration with confetti and floating balloons will trigger on the screen to celebrate your achievement!
:::

Preview displays existing current or unedited uploaded PDFs directly. Missing or stale generated PDFs—and uploaded PDFs after their resume content is edited in the editor—are rendered from the saved resume without re-tailoring it. Unedited uploaded PDFs are preserved when previewed or downloaded; choose **Edit** to load an editable source separately. Wait for preparation or regeneration to finish before opening Preview. If preview fails, use its **Retry** button.

### Generate missing resumes in a batch

1. In the **Targeted** lane header, click **Generate missing resumes (N)**. The count shows jobs with a missing or out-of-date generated PDF that are available for work.
2. JobOps starts background work and shows **Generating N resumes one at a time**. Each job finishes before the next starts.
3. Review the results with **Open resume** or **Preview PDF** before applying.

The batch selects targeted jobs with no saved resume, no PDF, or a stale generated PDF. It skips uploaded PDFs and jobs already preparing a resume or rendering a PDF. If a saved resume exists, the batch renders that document and preserves your hand edits. Otherwise, it tailors a new resume from your candidate library and generates its PDF. A failed job is skipped so the remaining jobs can continue.

The button is disabled when its count is zero or its start request is pending. Only one batch can run in your workspace at a time; another click while it runs shows **Already running**. The server also checks for missing saved documents, so the number started can differ from the button's PDF-based count.

To re-tailor an existing resume, open the job page or job detail panel and use **Regenerate resume**. Confirming this replaces saved edits and any uploaded PDF; see [Orchestrator](/docs/next/features/orchestrator#regenerate-a-jobs-resume).

### Recording progress

Marking a job **Applied** puts it directly on the board in the Applied lane — there's no separate "move to in progress" step. From there, drag a card (or use the card menu's **Log event**) to record what actually happened: Recruiter Screen, Behaviour Question, Reject, or a withdrawal outcome.

Later stage changes can also happen via:

- Tracking Inbox review/automation (recommended)
- Manual stage transitions in job detail/timeline tools

### API examples

```bash
# List jobs that can include untailored targets
curl "http://localhost:3001/api/jobs?status=discovered&view=list"
```

```bash
# Move a job to technical interview
curl -X POST "http://localhost:3001/api/jobs/<jobId>/stages" \
  -H "content-type: application/json" \
  -d '{
    "toStage": "technical_interview",
    "metadata": {
      "actor": "user",
      "eventType": "status_update",
      "eventLabel": "Moved to Technical Interview"
    }
  }'
```

## Common problems

### Board is empty

- Target a job from Search Jobs first, or confirm you have applied jobs. Untargeted discovered jobs do not appear.
- Check whether the Applied lane is collapsed — expand it from the chevron in its header.

### A card appears in an unexpected lane

- Before application, targeted jobs stay in Targeted even after tailoring.
- After application, the board uses the latest stage event as source of truth.
- Check timeline events for out-of-order or mistaken transitions.

### A resume is still missing after a batch

- Wait for the current batch to finish. Jobs are processed one at a time.
- Uploaded PDFs are skipped deliberately. Use **Regenerate resume** only if you want to replace one.
- For a failed job, use **Prepare resume** to retry missing content or **Preview PDF** to retry rendering a saved resume. Check the candidate library and PDF renderer settings if it keeps failing.

### Drag-and-drop move failed

- Network/API error can roll back optimistic UI movement.
- Retry move and check server logs for validation errors.

## Related pages

- [Overview](/docs/next/features/overview)
- [Orchestrator](/docs/next/features/orchestrator)
- [Co-work resume editor and candidate library](/docs/next/features/design-resume)
- [Post-Application Tracking](/docs/next/features/post-application-tracking)
