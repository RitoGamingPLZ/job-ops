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
3. When it is ready, click **Open resume** on the card or job page to edit the resume in the editor, or **Preview PDF** to render the editor resume as a PDF. If preparation failed, the card says **Resume not prepared yet**; click **Prepare resume** to try again. The job stays in Targeted until you mark it Applied.
4. Apply through the employer's application link, then mark the job **Applied**. Dragging a Targeted card to Applied records that transition; it does not submit an application.
5. Log events or move cards as the process progresses: **Recruiter Screen → Technical Interview → Behaviour Question → Team Match → Offer**. Use the stages that match the employer's process.
6. Log **Reject** for a rejection. A withdrawal also appears in Reject, with a **withdrawn** note.

Technical Interview is one column. Each `technical_interview` event counts as another round, so log another technical interview to record round 2 or later. Older Assessment and Final Round events appear in this same column, but do not increase the technical round count.

:::tip Celebration Effect
When you successfully move a job listing to the **Offer** stage (either by dragging a card to the **Offer** column or by logging an **Offer** stage event), a congratulatory celebration with confetti and floating balloons will trigger on the screen to celebrate your achievement!
:::

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

### Drag-and-drop move failed

- Network/API error can roll back optimistic UI movement.
- Retry move and check server logs for validation errors.

## Related pages

- [Overview](/docs/next/features/overview)
- [Orchestrator](/docs/next/features/orchestrator)
- [Post-Application Tracking](/docs/next/features/post-application-tracking)
