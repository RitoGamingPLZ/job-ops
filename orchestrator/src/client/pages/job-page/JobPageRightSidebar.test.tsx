import { createJob } from "@shared/testing/factories.js";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { JobPageRightSidebar } from "./JobPageRightSidebar";

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onSelect,
    disabled,
  }: {
    children: ReactNode;
    onSelect?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" disabled={disabled} onClick={() => onSelect?.()}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
}));

const noop = vi.fn();

function renderRightSidebar(overrides: Parameters<typeof createJob>[0] = {}) {
  const job = createJob({
    status: "ready",
    pdfPath: "data/pdfs/resume_job-1.pdf",
    pdfFreshness: "stale",
    ...overrides,
  });

  return render(
    <MemoryRouter>
      <JobPageRightSidebar
        job={job}
        tasks={[]}
        jobLink={job.jobUrl}
        isDiscovered={job.status === "discovered"}
        isReady={job.status === "ready"}
        isApplied={job.status === "applied"}
        isInProgress={job.status === "in_progress"}
        canLogEvents={false}
        isBusy={false}
        isUploadingPdf={false}
        pdfActionsDisabled={false}
        pdfRegeneratingReason={null}
        pdfViewLabel="Preview PDF"
        pdfDownloadLabel="Download PDF"
        onTarget={noop}
        onPrepareResume={noop}
        onMarkApplied={noop}
        onOpenLogEvent={noop}
        onViewPdf={noop}
        onDownloadPdf={noop}
        onUploadPdf={noop}
        onSkip={noop}
        onOpenEditDetails={noop}
        onViewJobDescription={noop}
        onCopyJobInfo={noop}
        onRescore={noop}
        onCheckSponsor={noop}
      />
    </MemoryRouter>,
  );
}

describe("JobPageRightSidebar actions", () => {
  it("includes the orchestrator detail menu actions on the job page", () => {
    renderRightSidebar();
    expect(screen.getAllByRole("link", { name: "Open resume" })).toHaveLength(
      1,
    );
    expect(screen.getByRole("link", { name: "Open resume" })).toHaveAttribute(
      "href",
      "/resumes/job-1",
    );
    expect(screen.queryByText(/tailoring/i)).toBeNull();

    expect(
      screen.getByRole("button", { name: /edit details/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /view job description/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /copy job info/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /recalculate match/i }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /replace pdf/i }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("button", { name: /preview pdf/i }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: /download pdf/i }),
    ).toBeInTheDocument();
  });

  it.each([
    ["processing", "2026-06-01", "Preparing resume…"],
    ["discovered", null, "Target"],
    ["discovered", "2026-06-01", "Prepare resume"],
  ] as const)("offers only %s/%s -> %s before the resume is available", (status, readyAt, label) => {
    renderRightSidebar({
      status,
      readyAt,
      pdfPath: null,
      pdfFreshness: "missing",
    });
    expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open resume" })).toBeNull();
    // only the (disabled-by-parent) dropdown item remains
    expect(
      screen.getAllByRole("button", { name: /preview pdf/i }),
    ).toHaveLength(1);
  });

  it("uses upload wording when the job has no resume PDF", () => {
    renderRightSidebar({ pdfPath: null, pdfFreshness: "missing" });

    expect(
      screen.getAllByRole("button", { name: /upload pdf/i }).length,
    ).toBeGreaterThan(0);
  });
});
