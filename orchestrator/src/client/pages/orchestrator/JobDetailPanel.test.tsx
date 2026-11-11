import * as api from "@client/api";
import { renderWithQueryClient } from "@client/test/renderWithQueryClient";
import { createJob } from "@shared/testing/factories.js";
import type { AppSettings, Job } from "@shared/types.js";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JobDetailPanel } from "./JobDetailPanel";

const LocationWatcher = () => {
  const location = useLocation();
  return (
    <div data-testid="location">{location.pathname + location.search}</div>
  );
};

const render = (ui: Parameters<typeof renderWithQueryClient>[0]) =>
  renderWithQueryClient(
    <MemoryRouter>
      <LocationWatcher />
      {ui}
    </MemoryRouter>,
  );

const mockSettings = {
  settings: null as AppSettings | null,
  error: null,
  isLoading: false,
  showSponsorInfo: true,
  renderMarkdownInJobDescriptions: true,
  refreshSettings: vi.fn(),
};

vi.mock("@/components/ui/dropdown-menu", () => {
  return {
    DropdownMenu: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
    DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
      <div role="menu">{children}</div>
    ),
    DropdownMenuItem: ({
      children,
      onSelect,
      ...props
    }: {
      children: React.ReactNode;
      onSelect?: () => void;
    }) => (
      <button
        type="button"
        role="menuitem"
        onClick={() => onSelect?.()}
        {...props}
      >
        {children}
      </button>
    ),
    DropdownMenuSeparator: () => <hr />,
  };
});

vi.mock("@client/components", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@client/components")>();
  return {
    ...actual,
    JobHeader: ({ job, jobCTA }: { job: Job; jobCTA?: React.ReactNode }) => (
      <div data-testid="job-header">
        <span>{job.title}</span>
        <span>{job.employer}</span>
        {jobCTA}
      </div>
    ),
    JobBriefPane: () => <div data-testid="job-brief-pane" />,
  };
});

vi.mock("@client/hooks/useSettings", () => ({
  useSettings: () => mockSettings,
}));

vi.mock("@client/components/JobDetailsEditDrawer", () => ({
  JobDetailsEditDrawer: ({
    open,
    onOpenChange,
    onJobUpdated,
    job,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onJobUpdated: () => Promise<void>;
    job: Job | null;
  }) =>
    open ? (
      <div data-testid="job-details-edit-drawer">
        <div>{job?.id}</div>
        <button
          type="button"
          onClick={() => {
            void onJobUpdated();
            onOpenChange(false);
          }}
        >
          Save details
        </button>
      </div>
    ) : null,
}));

vi.mock("@/lib/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils")>();
  return {
    ...actual,
    copyTextToClipboard: vi.fn().mockResolvedValue(undefined),
    formatJobForWebhook: vi.fn(() => "payload"),
  };
});

vi.mock("@client/api", () => ({
  updateJob: vi.fn(),
  processJob: vi.fn(),
  generateJobPdf: vi.fn(),
  markAsApplied: vi.fn(),
  skipJob: vi.fn(),
  targetJob: vi.fn(),
  untargetJob: vi.fn(),
  getProfile: vi.fn().mockResolvedValue({}),
  getResumeProjectsCatalog: vi.fn().mockResolvedValue([]),
}));

vi.mock("@client/lib/private-pdf", () => ({
  downloadJobPdf: vi.fn().mockResolvedValue(undefined),
  openJobPdf: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
  },
}));

type JobDetailPanelTestProps = Omit<
  React.ComponentProps<typeof JobDetailPanel>,
  "selectedJobListItem" | "selectedJobLoadState" | "onRetrySelectedJob"
> &
  Partial<
    Pick<
      React.ComponentProps<typeof JobDetailPanel>,
      "selectedJobListItem" | "selectedJobLoadState" | "onRetrySelectedJob"
    >
  >;

const renderJobDetailPanel = async (props: JobDetailPanelTestProps) => {
  const rendered = render(
    <JobDetailPanel
      selectedJobListItem={props.selectedJob}
      selectedJobLoadState="idle"
      onRetrySelectedJob={vi.fn()}
      {...props}
    />,
  );
  await act(async () => {
    await Promise.resolve();
  });
  return rendered;
};

describe("JobDetailPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettings.settings = null;
    mockSettings.renderMarkdownInJobDescriptions = true;
    vi.mocked(api.getProfile).mockResolvedValue({});
    vi.mocked(api.getResumeProjectsCatalog).mockResolvedValue([]);
  });

  it("offers one editor link and no tailoring tab for a targeted job", async () => {
    await renderJobDetailPanel({
      activeTab: "all",
      activeJobs: [],
      selectedJob: createJob({ status: "ready", readyAt: "2026-11-08" }),
      onSelectJobId: vi.fn(),
      onJobUpdated: vi.fn(),
    });
    expect(screen.getAllByRole("link", { name: "Open resume" })).toHaveLength(
      1,
    );
    expect(screen.getByRole("link", { name: "Open resume" })).toHaveAttribute(
      "href",
      "/resumes/job-1",
    );
    expect(screen.queryByRole("tab", { name: /tailoring/i })).toBeNull();
    expect(document.querySelector('a[href*="inspector=tailoring"]')).toBeNull();
  });

  it("shows the selected job summary and safe links while full details load", async () => {
    const summary = createJob({
      id: "job-2",
      title: "Platform Engineer",
      employer: "Example Ltd",
      status: "discovered",
      applicationLink: "https://example.com/apply/job-2",
    });

    await renderJobDetailPanel({
      activeTab: "discovered",
      activeJobs: [summary],
      selectedJob: null,
      selectedJobListItem: summary,
      selectedJobLoadState: "loading",
      onSelectJobId: vi.fn(),
      onJobUpdated: vi.fn().mockResolvedValue(undefined),
    });

    expect(screen.getByText("Platform Engineer")).toBeInTheDocument();
    expect(screen.getByText("Example Ltd")).toBeInTheDocument();
    expect(screen.getByTestId("job-detail-skeleton")).toBeInTheDocument();
    expect(screen.getByText("Loading full job details…")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /open job listing/i }),
    ).toHaveAttribute("href", "https://example.com/apply/job-2");
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByText("Start Tailoring")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /more actions/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps the summary and offers retry when detail loading fails", async () => {
    const onRetrySelectedJob = vi.fn();
    const summary = createJob({
      id: "job-2",
      title: "Platform Engineer",
      employer: "Example Ltd",
      status: "discovered",
    });

    await renderJobDetailPanel({
      activeTab: "discovered",
      activeJobs: [summary],
      selectedJob: null,
      selectedJobListItem: summary,
      selectedJobLoadState: "error",
      onSelectJobId: vi.fn(),
      onJobUpdated: vi.fn().mockResolvedValue(undefined),
      onRetrySelectedJob,
    });

    expect(screen.getByText("Platform Engineer")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Couldn't load job details",
    );
    expect(screen.queryByTestId("job-detail-skeleton")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetrySelectedJob).toHaveBeenCalledTimes(1);
  });

  it("renders discovered jobs in the unified inspector", async () => {
    const job = createJob({
      id: "job-99",
      status: "discovered",
      readyAt: null,
    });

    await renderJobDetailPanel({
      activeTab: "discovered",
      activeJobs: [job],
      selectedJob: job,
      onSelectJobId: vi.fn(),
      onJobUpdated: vi.fn().mockResolvedValue(undefined),
    });

    expect(
      screen.getByRole("button", { name: /^Target$/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: /tailoring/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Base description extracted from the job listing, editable if something looks off. Used by the Ghostwriter and for fit assessment.",
      ),
    ).toBeInTheDocument();
  });

  it.each([
    "discovered",
    "ready",
    "processing",
  ] as const)("targets a %s job without tailoring it", async (status) => {
    const job = createJob({ status, readyAt: null });
    const updated = { ...job, readyAt: "2026-11-08T12:00:00Z" };
    vi.mocked(api.targetJob).mockResolvedValue(updated);
    const onJobUpdated = vi.fn().mockResolvedValue(undefined);
    await renderJobDetailPanel({
      activeTab: "all",
      activeJobs: [job],
      selectedJob: job,
      onSelectJobId: vi.fn(),
      onJobUpdated,
    });
    fireEvent.click(screen.getByRole("button", { name: /^Target$/ }));
    await waitFor(() => expect(api.targetJob).toHaveBeenCalledWith(job.id));
    expect(onJobUpdated).toHaveBeenCalledWith(updated);
    expect(api.processJob).not.toHaveBeenCalled();
    expect(api.generateJobPdf).not.toHaveBeenCalled();
  });

  it("untargets a job with the same primary button", async () => {
    const job = createJob({
      status: "discovered",
      readyAt: "2026-11-08T12:00:00Z",
    });
    vi.mocked(api.untargetJob).mockResolvedValue({ ...job, readyAt: null });
    await renderJobDetailPanel({
      activeTab: "all",
      activeJobs: [job],
      selectedJob: job,
      onSelectJobId: vi.fn(),
      onJobUpdated: vi.fn().mockResolvedValue(undefined),
    });
    fireEvent.click(screen.getByRole("button", { name: "Targeted ✓" }));
    await waitFor(() => expect(api.untargetJob).toHaveBeenCalledWith(job.id));
  });

  it("does not allow untargeting while processing", async () => {
    const job = createJob({
      status: "processing",
      readyAt: "2026-11-08T12:00:00Z",
    });
    await renderJobDetailPanel({
      activeTab: "all",
      activeJobs: [job],
      selectedJob: job,
      onSelectJobId: vi.fn(),
      onJobUpdated: vi.fn().mockResolvedValue(undefined),
    });
    expect(
      screen.getAllByRole("button", { name: "Preparing resume…" })[0],
    ).toBeDisabled();
  });

  it("keeps only the information actions and hides the application workflow", async () => {
    const job = createJob({
      status: "ready",
      readyAt: "2026-11-08T12:00:00Z",
      pdfPath: "resume.pdf",
    });
    await renderJobDetailPanel({
      activeTab: "all",
      activeJobs: [job],
      selectedJob: job,
      onSelectJobId: vi.fn(),
      onJobUpdated: vi.fn().mockResolvedValue(undefined),
    });
    expect(
      screen.queryByRole("tab", { name: /apply/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /ask ghostwriter/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual(["Edit details", "Copy job info"]);
  });

  it.each([
    ["processing", "2026-11-08", "Preparing resume…"],
    ["discovered", null, "Target"],
    ["discovered", "2026-11-08", "Prepare resume"],
  ] as const)("offers no editor or preview for a %s job (readyAt %s)", async (status, readyAt, label) => {
    vi.mocked(api.processJob).mockResolvedValue(createJob());
    const job = createJob({ status, readyAt });
    await renderJobDetailPanel({
      activeTab: "all",
      activeJobs: [job],
      selectedJob: job,
      onSelectJobId: vi.fn(),
      onJobUpdated: vi.fn().mockResolvedValue(undefined),
    });
    expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open resume" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Preview PDF" })).toBeNull();
    if (label === "Prepare resume") {
      fireEvent.click(screen.getByRole("button", { name: label }));
      await waitFor(() => expect(api.processJob).toHaveBeenCalledWith(job.id));
    }
  });

  it("offers Open resume and Preview PDF for an applied job", async () => {
    await renderJobDetailPanel({
      activeTab: "all",
      activeJobs: [],
      selectedJob: createJob({ status: "applied", readyAt: null }),
      onSelectJobId: vi.fn(),
      onJobUpdated: vi.fn().mockResolvedValue(undefined),
    });
    expect(
      screen.getByRole("link", { name: "Open resume" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview PDF" })).toBeEnabled();
  });

  it("shows an empty state when no job is selected", async () => {
    await renderJobDetailPanel({
      activeTab: "all",
      activeJobs: [],
      selectedJob: null,
      onSelectJobId: vi.fn(),
      onJobUpdated: vi.fn().mockResolvedValue(undefined),
    });

    expect(screen.getByText("No job selected")).toBeInTheDocument();
  });

  it("renders a stripped description preview for html content", async () => {
    await renderJobDetailPanel({
      activeTab: "all",
      activeJobs: [],
      selectedJob: createJob({
        status: "applied",
        jobDescription: "<p>Hello <strong>world</strong></p>",
      }),
      onSelectJobId: vi.fn(),
      onJobUpdated: vi.fn().mockResolvedValue(undefined),
    });

    expect(
      screen.getByText(
        (_, node) =>
          node?.tagName === "P" && node.textContent === "Hello world",
      ),
    ).toBeInTheDocument();
  });

  it("renders markdown in the brief job description when enabled", async () => {
    await renderJobDetailPanel({
      activeTab: "all",
      activeJobs: [],
      selectedJob: createJob({
        status: "applied",
        jobDescription: "# Responsibilities\n\n- Build APIs",
      }),
      onSelectJobId: vi.fn(),
      onJobUpdated: vi.fn().mockResolvedValue(undefined),
    });

    expect(
      screen.getByRole("heading", { name: "Responsibilities" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("# Responsibilities")).not.toBeInTheDocument();
  });

  it("shows a view job link in the job description actions", async () => {
    await renderJobDetailPanel({
      activeTab: "all",
      activeJobs: [],
      selectedJob: createJob({
        status: "applied",
        jobUrl: "https://example.com/jobs/source-listing",
        applicationLink: "https://example.com/apply/company",
      }),
      onSelectJobId: vi.fn(),
      onJobUpdated: vi.fn().mockResolvedValue(undefined),
    });

    const viewJobLink = screen.getByRole("link", { name: /view job/i });

    expect(viewJobLink).toHaveAttribute(
      "href",
      "https://example.com/jobs/source-listing",
    );
    expect(viewJobLink).toHaveAttribute("target", "_blank");
    expect(viewJobLink).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders raw markdown in the brief job description when disabled", async () => {
    mockSettings.renderMarkdownInJobDescriptions = false;

    const rendered = await renderJobDetailPanel({
      activeTab: "all",
      activeJobs: [],
      selectedJob: createJob({
        status: "applied",
        jobDescription: "# Responsibilities\n\n- Build APIs",
      }),
      onSelectJobId: vi.fn(),
      onJobUpdated: vi.fn().mockResolvedValue(undefined),
    });

    const rawDescription = rendered.container.querySelector(
      "div.whitespace-pre-wrap",
    );
    expect(rawDescription?.textContent).toBe(
      "# Responsibilities\n\n- Build APIs",
    );
    expect(
      screen.queryByRole("heading", { name: "Responsibilities" }),
    ).not.toBeInTheDocument();
  });

  it("saves an edited description", async () => {
    const onJobUpdated = vi.fn().mockResolvedValue(undefined);
    vi.mocked(api.updateJob).mockResolvedValue(undefined as any);

    await renderJobDetailPanel({
      activeTab: "all",
      activeJobs: [],
      selectedJob: createJob({ status: "applied", jobDescription: "Original" }),
      onSelectJobId: vi.fn(),
      onJobUpdated,
    });

    fireEvent.click(await screen.findByRole("button", { name: /^edit$/i }));

    fireEvent.change(screen.getByPlaceholderText("Enter job description..."), {
      target: { value: "Updated description" },
    });

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(api.updateJob).toHaveBeenCalledWith("job-1", {
        jobDescription: "Updated description",
      }),
    );
    expect(onJobUpdated).toHaveBeenCalled();
  });

  it("opens edit details drawer from menu and saves", async () => {
    const onJobUpdated = vi.fn().mockResolvedValue(undefined);

    await renderJobDetailPanel({
      activeTab: "all",
      activeJobs: [],
      selectedJob: createJob({ jobDescription: "Original" }),
      onSelectJobId: vi.fn(),
      onJobUpdated,
    });

    fireEvent.click(screen.getByRole("menuitem", { name: /edit details/i }));
    expect(
      await screen.findByTestId("job-details-edit-drawer"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /save details/i }));

    await waitFor(() => expect(onJobUpdated).toHaveBeenCalled());
    expect(
      screen.queryByTestId("job-details-edit-drawer"),
    ).not.toBeInTheDocument();
  });
});
