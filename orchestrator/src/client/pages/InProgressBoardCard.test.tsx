import type { JobListItem } from "@shared/types.js";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { InProgressBoardCard } from "./InProgressBoardCard";

const JOB_PAGE_LINK_STATE = { jobPageBackTo: "/applications/in-progress" };

const makeJob = (overrides: Partial<JobListItem> = {}): JobListItem => ({
  id: "job-1",
  source: "manual",
  sourceJobId: null,
  title: "Backend Engineer",
  employer: "Acme",
  jobUrl: "https://example.com/jobs/1",
  applicationLink: null,
  datePosted: null,
  deadline: null,
  salary: null,
  location: "London, UK",
  status: "ready",
  outcome: null,
  closedAt: null,
  generationError: null,
  suitabilityScore: 82,
  appliedDuplicateMatch: null,
  jobType: null,
  jobFunction: null,
  pdfRegenerating: false,
  pdfFreshness: "missing",
  salaryMinAmount: null,
  salaryMaxAmount: null,
  salaryCurrency: null,
  discoveredAt: "2026-01-01T00:00:00.000Z",
  readyAt: "2026-01-02T00:00:00.000Z",
  appliedAt: null,
  updatedAt: "2026-05-20T00:00:00.000Z",
  ...overrides,
});

function renderCard(job: JobListItem) {
  return render(
    <MemoryRouter>
      <InProgressBoardCard
        job={job}
        stage="recruiter_screen"
        latestEventAt={null}
        jobPageLinkState={JOB_PAGE_LINK_STATE}
        isMoving={false}
        onDragStart={() => {}}
        onDragEnd={() => {}}
        onLogEvent={() => {}}
      />
    </MemoryRouter>,
  );
}

describe("InProgressBoardCard resume status indicator", () => {
  it("shows a ready indicator once the resume is available", () => {
    const { container } = renderCard(makeJob({ status: "ready" }));
    const dot = screen.getByRole("img", { name: "Resume ready" });
    expect(dot).toBeInTheDocument();
    expect(dot).toHaveAttribute("tabindex", "0");
    expect(container.querySelector('button[class*="bg-transparent"]')).toBeNull();
  });

  it("shows a preparing indicator while the job is processing", () => {
    const { container } = renderCard(makeJob({ status: "processing" }));
    expect(container.querySelector('[aria-label="Preparing resume"]')).toBeInTheDocument();
  });

  it("shows a failure indicator when generation failed", () => {
    const { container } = renderCard(
      makeJob({
        status: "discovered",
        generationError: "LLM API key not configured",
      }),
    );
    expect(container.querySelector('[aria-label="Resume generation failed"]')).toBeInTheDocument();
  });

  it("shows a neutral indicator when not yet prepared and no error", () => {
    const { container } = renderCard(makeJob({ status: "discovered", generationError: null }));
    expect(container.querySelector('[aria-label="Resume not prepared yet"]')).toBeInTheDocument();
  });
});
