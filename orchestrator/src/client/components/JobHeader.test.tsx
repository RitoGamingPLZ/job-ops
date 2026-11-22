import { createJob } from "@shared/testing/factories.js";
import type { JobListItem } from "@shared/types.js";
import { fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSettings } from "../hooks/useSettings";
import { JobHeader } from "./JobHeader";

// Mock useSettings
vi.mock("../hooks/useSettings", () => ({
  useSettings: vi.fn(),
}));

// Mock api
vi.mock("../api", () => ({
  checkSponsor: vi.fn(),
}));

// Mock Tooltip components to simplify testing
vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip-content">{children}</div>
  ),
}));

const mockJob = createJob({
  id: "job-1",
  title: "Software Engineer",
  employer: "Tech Corp",
  location: "London",
  salary: "£60,000",
  deadline: "2025-12-31",
  status: "discovered",
  source: "linkedin",
  suitabilityScore: 85,
  suitabilityReason: "Strong match",
});

describe("JobHeader", () => {
  const renderWithRouter = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

  beforeEach(() => {
    vi.clearAllMocks();
    (useSettings as any).mockReturnValue({
      showSponsorInfo: true,
    });
  });

  it("renders basic job information", () => {
    renderWithRouter(<JobHeader job={mockJob} />);
    expect(screen.getByText("Software Engineer")).toBeInTheDocument();
    expect(screen.getByText("Tech Corp")).toBeInTheDocument();
    expect(screen.getByText("London")).toBeInTheDocument();
    expect(screen.getByText("£60,000")).toBeInTheDocument();
  });

  it("renders lightweight list data without full-detail indicators", () => {
    const { isRemote: _isRemote, suitabilityReason: _suitabilityReason, ...summary } = mockJob;

    renderWithRouter(<JobHeader job={summary as JobListItem} />);

    expect(screen.getByText("Software Engineer")).toBeInTheDocument();
    expect(screen.getByText("Tech Corp")).toBeInTheDocument();
  });

  it("links the title to the job page", () => {
    renderWithRouter(<JobHeader job={mockJob} />);

    expect(screen.getByRole("link", { name: "Software Engineer" })).toHaveAttribute(
      "href",
      "/job/job-1",
    );
  });

  it("shows a previously applied status indicator with match details", () => {
    const jobWithAppliedDuplicate = {
      ...mockJob,
      appliedDuplicateMatch: {
        jobId: "job-2",
        title: "Software Engineer",
        employer: "Tech Corp",
        appliedAt: "2026-04-01T10:00:00.000Z",
        score: 97,
        titleScore: 98,
        employerScore: 96,
      },
    };

    renderWithRouter(<JobHeader job={jobWithAppliedDuplicate} />);

    expect(screen.getByText("Previously Applied")).toBeInTheDocument();
    expect(screen.getByText("Applied 1 Apr 2026 · 97% match")).toBeInTheDocument();
  });

  it("shows posting age when the source provides a posting date", () => {
    renderWithRouter(<JobHeader job={{ ...mockJob, datePosted: "1 hour ago" }} />);

    expect(screen.getByText("Posted 1 hour ago")).toBeInTheDocument();
    expect(screen.getByText("Source reported: 1 hour ago")).toBeInTheDocument();
  });

  it("shows contextual tooltips for discovered and suitability score", () => {
    const jobWithTooltips = {
      ...mockJob,
      suitabilityScore: 45,
      suitabilityReason: null,
    };

    renderWithRouter(<JobHeader job={jobWithTooltips} />);

    expect(
      screen.getByText("Found by the pipeline. Target it to prepare its resume."),
    ).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Suitability score 45" })).toBeInTheDocument();
  });

  it("shows interactive suitability button when suitabilityReason is present", () => {
    renderWithRouter(<JobHeader job={mockJob} />);
    expect(screen.getByRole("button", { name: "View fit assessment" })).toBeInTheDocument();
  });

  it("shows discovered jobs without scores as awaiting AI scoring", () => {
    renderWithRouter(
      <JobHeader
        job={{
          ...mockJob,
          suitabilityScore: null,
          suitabilityReason: null,
        }}
      />,
    );

    expect(
      screen.getByRole("img", { name: "Waiting for AI scoring to finish." }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("img", {
        name: "AI misconfiguration or service error. Please check your settings and AI service status.",
      }),
    ).not.toBeInTheDocument();
  });

  it("shows a tooltip for ready jobs", () => {
    const readyJob = {
      ...mockJob,
      status: "ready" as const,
    };

    renderWithRouter(<JobHeader job={readyJob} />);

    expect(screen.getByText("Resume prepared and ready to apply.")).toBeInTheDocument();
  });

  it("hides sponsor info when showSponsorInfo is false", () => {
    (useSettings as any).mockReturnValue({
      showSponsorInfo: false,
    });

    const jobWithSponsor = { ...mockJob, sponsorMatchScore: 98 };
    renderWithRouter(<JobHeader job={jobWithSponsor} />);

    expect(screen.queryByText("Confirmed Sponsor")).not.toBeInTheDocument();
    expect(screen.queryByText("Check Sponsorship Status")).not.toBeInTheDocument();
  });

  it("hides the view button when already on a job page", () => {
    render(
      <MemoryRouter initialEntries={["/job/job-1"]}>
        <JobHeader job={mockJob} />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("link", { name: /view/i })).not.toBeInTheDocument();
  });

  it("renders View job link next to the score when jobUrl is present off the job page", () => {
    render(
      <MemoryRouter initialEntries={["/jobs/discovered/job-1"]}>
        <JobHeader
          job={{
            ...mockJob,
            jobUrl: "https://example.com/jobs/123",
          }}
        />
      </MemoryRouter>,
    );

    const viewJobLink = screen.getByRole("link", { name: /view job/i });
    expect(viewJobLink).toHaveAttribute("href", "https://example.com/jobs/123");
    expect(viewJobLink).toHaveAttribute("target", "_blank");
    expect(viewJobLink).toHaveAttribute("rel", "noopener noreferrer");

    const scoreRing = screen.getByRole("button", {
      name: "View fit assessment",
    });
    expect(viewJobLink.parentElement).toContainElement(scoreRing);
  });

  it("does not render View job link when jobUrl is empty", () => {
    render(
      <MemoryRouter initialEntries={["/jobs/discovered/job-1"]}>
        <JobHeader
          job={{
            ...mockJob,
            jobUrl: "",
          }}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("link", { name: /view job/i })).not.toBeInTheDocument();
  });

  it("renders 'Check salary on Levels.fyi' when salary is missing off the job page", () => {
    const postSpy = vi.spyOn(window, "postMessage").mockImplementation(() => {});
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);

    render(
      <MemoryRouter initialEntries={["/jobs/discovered/job-1"]}>
        <JobHeader
          job={{
            ...mockJob,
            salary: null,
          }}
        />
      </MemoryRouter>,
    );

    const lookupButton = screen.getByRole("button", {
      name: /check salary on levels\.fyi/i,
    });
    fireEvent.click(lookupButton);

    expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "JOBOPS_LEVELS_LOOKUP_START",
        jobId: "job-1",
      }),
      window.location.origin,
    );
    expect(openSpy).toHaveBeenCalledWith(
      "https://www.levels.fyi/companies/tech/salaries/software-engineer",
      "jobops-levels-fyi",
      "popup,width=1020,height=760",
    );

    postSpy.mockRestore();
    openSpy.mockRestore();
  });

  it("hides 'Check salary on Levels.fyi' when salary is present", () => {
    renderWithRouter(<JobHeader job={mockJob} />);

    expect(
      screen.queryByRole("button", { name: /check salary on levels\.fyi/i }),
    ).not.toBeInTheDocument();
  });
});
