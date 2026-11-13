import {
  BOARD_COLUMN_LABELS,
  BOARD_COLUMNS,
  type JobListItem,
  type StageEvent,
} from "@shared/types";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { celebrateOffer } from "@/client/lib/celebrate";
import { openJobPdf } from "@/client/lib/private-pdf";
import * as api from "../api";
import { renderWithQueryClient } from "../test/renderWithQueryClient";
import { InProgressBoardPage } from "./InProgressBoardPage";

vi.mock("@/components/ui/dropdown-menu", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/ui/dropdown-menu")>();

  return {
    ...actual,
    DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
    DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
      <>{children}</>
    ),
    DropdownMenuContent: ({ children }: { children: ReactNode }) => (
      <div role="menu">{children}</div>
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
      <button
        type="button"
        role="menuitem"
        disabled={disabled}
        onClick={onSelect}
      >
        {children}
      </button>
    ),
  };
});

const LocationWatcher = () => {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname + location.search}
    </output>
  );
};

const render = (ui: Parameters<typeof renderWithQueryClient>[0]) =>
  renderWithQueryClient(ui);

const getBoardCardRoot = (cardTitle: HTMLElement): HTMLElement => {
  const cardRoot = cardTitle.closest("div.rounded-lg");
  if (!cardRoot) {
    throw new Error("Board card root not found");
  }
  return cardRoot as HTMLElement;
};

vi.mock("../api", () => ({
  getJobs: vi.fn(),
  getJob: vi.fn(),
  processJob: vi.fn(),
  generateJobPdf: vi.fn(),
  generateMissingResumes: vi.fn(),
  untargetJob: vi.fn(),
  markAsApplied: vi.fn(),
  getJobStageEvents: vi.fn(),
  transitionJobStage: vi.fn(),
  updateJobStageEvent: vi.fn(),
  getAuthScopedStorageKey: (key: string) => key,
}));

vi.mock("@/client/lib/private-pdf", () => ({
  openJobPdf: vi.fn(
    async (_id: string, beforeFetch?: () => Promise<unknown>) => {
      await beforeFetch?.();
    },
  ),
}));

vi.mock("@/client/lib/celebrate", () => ({
  celebrateOffer: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("@client/components/LogEventModal", () => {
  const { useState } = require("react");
  return {
    LogEventModal: ({ isOpen, onLog, onClose, jobTitle, employer }: any) => {
      const [title, setTitle] = useState("Update");
      const [stage, setStage] = useState("no_change");
      return isOpen ? (
        <div data-testid="log-event-modal">
          <div>
            Record a new update or stage change for {jobTitle} at {employer}.
          </div>
          <input
            placeholder="e.g. Recruiter Screen"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <select
            data-testid="mock-stage-select"
            value={stage}
            onChange={(e) => setStage(e.target.value)}
          >
            <option value="no_change">No Change</option>
            <option value="offer">Offer</option>
          </select>
          <button
            type="button"
            onClick={() => onLog({ title, stage, date: "2026-06-12" })}
          >
            Log Event
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      ) : null;
    },
  };
});

const makeJob = (overrides: Partial<JobListItem>): JobListItem => ({
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
  location: null,
  status: "in_progress",
  outcome: null,
  closedAt: null,
  generationError: null,
  suitabilityScore: null,
  sponsorMatchScore: null,
  appliedDuplicateMatch: null,
  jobType: null,
  jobFunction: null,
  pdfRegenerating: false,
  pdfFreshness: "missing",
  salaryMinAmount: null,
  salaryMaxAmount: null,
  salaryCurrency: null,
  discoveredAt: "2026-01-01T00:00:00.000Z",
  readyAt: null,
  appliedAt: null,
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const makeEvent = (overrides: Partial<StageEvent>): StageEvent => ({
  id: "evt-1",
  applicationId: "job-1",
  title: "Recruiter Screen",
  groupId: null,
  fromStage: "applied",
  toStage: "recruiter_screen",
  occurredAt: 1_700_000_000,
  metadata: null,
  outcome: null,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();

  vi.mocked(api.getJobs).mockResolvedValue({
    jobs: [makeJob({})],
    total: 1,
    byStatus: {
      discovered: 0,
      processing: 0,
      ready: 0,
      applied: 0,
      in_progress: 1,
      skipped: 0,
      expired: 0,
    },
    revision: "r1",
  } as Awaited<ReturnType<typeof api.getJobs>>);
  vi.mocked(api.getJobStageEvents).mockResolvedValue([makeEvent({})]);
  vi.mocked(api.transitionJobStage).mockResolvedValue(
    makeEvent({ toStage: "offer", title: "Offer" }),
  );
});

describe("InProgressBoardPage", () => {
  it("loads in-progress jobs and renders cards", async () => {
    render(
      <MemoryRouter>
        <InProgressBoardPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(api.getJobs).toHaveBeenCalledWith({
        statuses: [
          "discovered",
          "processing",
          "ready",
          "applied",
          "in_progress",
        ],
        view: "list",
      });
    });

    expect(await screen.findByText("Backend Engineer")).toBeInTheDocument();
  });

  it("shows cards even when no stage events are present", async () => {
    vi.mocked(api.getJobStageEvents).mockResolvedValue([]);

    render(
      <MemoryRouter>
        <InProgressBoardPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Backend Engineer")).toBeInTheDocument();
  });

  it("keeps an applied job with no stage events in the Applied lane, not Recruiter Screen (#714)", async () => {
    vi.mocked(api.getJobs).mockResolvedValue({
      jobs: [makeJob({ status: "applied" })],
      total: 1,
      byStatus: {
        discovered: 0,
        processing: 0,
        ready: 0,
        applied: 1,
        in_progress: 0,
        skipped: 0,
        expired: 0,
      },
      revision: "r1",
    } as Awaited<ReturnType<typeof api.getJobs>>);
    vi.mocked(api.getJobStageEvents).mockResolvedValue([]);

    render(
      <MemoryRouter>
        <InProgressBoardPage />
      </MemoryRouter>,
    );

    const appliedLane = await screen.findByRole("region", {
      name: "Applied lane",
    });
    expect(
      within(appliedLane).getByText("Backend Engineer"),
    ).toBeInTheDocument();

    const recruiterScreenLane = screen.getByRole("region", {
      name: "Recruiter Screen lane",
    });
    expect(
      within(recruiterScreenLane).queryByText("Backend Engineer"),
    ).not.toBeInTheDocument();
  });

  it("collapses and expands the Applied lane, persisting the preference", async () => {
    const { unmount } = render(
      <MemoryRouter>
        <InProgressBoardPage />
      </MemoryRouter>,
    );

    await screen.findByRole("region", { name: "Applied lane" });
    fireEvent.click(
      screen.getByRole("button", { name: /collapse applied lane/i }),
    );

    const collapsedAppliedLane = screen.getByRole("region", {
      name: "Applied lane",
    });
    expect(
      within(collapsedAppliedLane).queryByText(
        "Drop a card here or log a stage.",
      ),
    ).not.toBeInTheDocument();
    unmount();

    render(
      <MemoryRouter>
        <InProgressBoardPage />
      </MemoryRouter>,
    );

    await screen.findByRole("region", { name: "Applied lane" });
    expect(
      screen.getByRole("button", { name: /expand applied lane/i }),
    ).toBeInTheDocument();
  });

  it("transitions a job stage when dropped into another lane", async () => {
    render(
      <MemoryRouter>
        <InProgressBoardPage />
      </MemoryRouter>,
    );

    const card = await screen.findByRole("link", { name: /Backend Engineer/i });
    const offerHeader = await screen.findByText("Offer");
    const offerLane = offerHeader.closest("section");

    if (!offerLane) {
      throw new Error("Offer lane section not found");
    }

    fireEvent.dragStart(card, {
      dataTransfer: {
        effectAllowed: "move",
      },
    });
    fireEvent.dragOver(offerLane);
    fireEvent.drop(offerLane);

    await waitFor(() => {
      expect(api.transitionJobStage).toHaveBeenCalledWith("job-1", {
        toStage: "offer",
        metadata: {
          actor: "user",
          eventType: "status_update",
          eventLabel: "Moved to Offer",
          reasonCode: "in_progress_board_drag",
        },
      });
    });

    expect(celebrateOffer).toHaveBeenCalled();
  });

  it("opens the log event modal from the card menu without navigating", async () => {
    render(
      <MemoryRouter>
        <InProgressBoardPage />
      </MemoryRouter>,
    );

    const cardRoot = getBoardCardRoot(
      await screen.findByText("Backend Engineer"),
    );

    fireEvent.click(
      within(cardRoot).getByRole("menuitem", { name: /log event/i }),
    );

    expect(screen.getByTestId("log-event-modal")).toBeInTheDocument();
    expect(
      screen.getByText(
        /record a new update or stage change for backend engineer at acme/i,
      ),
    ).toBeInTheDocument();
  });

  it("logs an event from the board menu", async () => {
    render(
      <MemoryRouter>
        <InProgressBoardPage />
      </MemoryRouter>,
    );

    const cardRoot = getBoardCardRoot(
      await screen.findByText("Backend Engineer"),
    );

    fireEvent.click(
      within(cardRoot).getByRole("menuitem", { name: /log event/i }),
    );

    fireEvent.change(screen.getByPlaceholderText("e.g. Recruiter Screen"), {
      target: { value: "Phone screen" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^log event$/i }));

    await waitFor(() => {
      expect(api.transitionJobStage).toHaveBeenCalledWith(
        "job-1",
        expect.objectContaining({
          metadata: expect.objectContaining({
            eventLabel: "Phone screen",
            actor: "user",
          }),
        }),
      );
    });

    expect(toast.success).toHaveBeenCalledWith("Event logged");
    expect(celebrateOffer).not.toHaveBeenCalled();
  });

  it("surfaces load errors", async () => {
    vi.mocked(api.getJobs).mockRejectedValue(new Error("Failed to load board"));

    render(
      <MemoryRouter>
        <InProgressBoardPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Failed to load board");
    });
  });

  it("triggers celebrateOffer when logging a stage event to Offer stage from board menu", async () => {
    render(
      <MemoryRouter>
        <InProgressBoardPage />
      </MemoryRouter>,
    );

    const cardRoot = getBoardCardRoot(
      await screen.findByText("Backend Engineer"),
    );

    fireEvent.click(
      within(cardRoot).getByRole("menuitem", { name: /log event/i }),
    );

    fireEvent.change(screen.getByTestId("mock-stage-select"), {
      target: { value: "offer" },
    });

    fireEvent.change(screen.getByPlaceholderText("e.g. Recruiter Screen"), {
      target: { value: "Got Offer" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^log event$/i }));

    await waitFor(() => {
      expect(api.transitionJobStage).toHaveBeenCalledWith(
        "job-1",
        expect.objectContaining({
          toStage: "offer",
        }),
      );
    });

    expect(toast.success).toHaveBeenCalledWith("Event logged");
    expect(celebrateOffer).toHaveBeenCalled();
  });
});

describe("Targeted board workflow", () => {
  const showTargeted = (status: JobListItem["status"] = "ready") => {
    vi.mocked(api.getJobs).mockResolvedValue({
      jobs: [
        makeJob({ status, readyAt: "2026-06-01T00:00:00Z" }),
        makeJob({
          id: "untargeted",
          title: "Unselected job",
          status: "discovered",
        }),
      ],
    } as Awaited<ReturnType<typeof api.getJobs>>);
    vi.mocked(api.getJobStageEvents).mockResolvedValue([]);
    render(
      <MemoryRouter>
        <LocationWatcher />
        <InProgressBoardPage />
      </MemoryRouter>,
    );
  };

  it("renders eight ordered lanes with horizontal scrolling and excludes untargeted discoveries", async () => {
    showTargeted();
    const lane = await screen.findByRole("region", { name: "Targeted lane" });
    expect(within(lane).getByText("Backend Engineer")).toBeInTheDocument();
    expect(screen.queryByText("Unselected job")).not.toBeInTheDocument();
    const lanes = screen.getAllByRole("region");
    expect(lanes.map((lane) => lane.getAttribute("aria-label"))).toEqual(
      BOARD_COLUMNS.map((column) => `${BOARD_COLUMN_LABELS[column]} lane`),
    );
    expect(lane.parentElement?.parentElement).toHaveClass("overflow-x-auto");
    expect(lanes.every((lane) => lane.classList.contains("w-[320px]"))).toBe(
      true,
    );
  });

  it("opens the selected resume in explicit edit or preview mode", async () => {
    showTargeted("ready");
    const link = await screen.findByRole("link", { name: "Open resume" });
    expect(screen.getAllByRole("link", { name: "Open resume" })).toHaveLength(
      1,
    );
    expect(link).toHaveAttribute("href", "/resumes/job-1?mode=edit");
    expect(document.querySelector('a[href*="inspector=tailoring"]')).toBeNull();
    expect(
      screen.queryByRole("button", { name: /tailor|regenerate resume/i }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Preview PDF" }));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/resumes/job-1?mode=preview",
      ),
    );
    expect(api.generateJobPdf).not.toHaveBeenCalled();
    expect(openJobPdf).not.toHaveBeenCalled();
    expect(api.processJob).not.toHaveBeenCalled();
    fireEvent.click(link);
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/resumes/job-1?mode=edit",
      ),
    );
  });

  it("carries the chosen card among multiple prepared resumes", async () => {
    vi.mocked(api.getJobs).mockResolvedValue({
      jobs: [
        makeJob({
          id: "first",
          title: "First",
          status: "ready",
          readyAt: "2026-01-01",
        }),
        makeJob({
          id: "selected",
          title: "Selected",
          status: "ready",
          readyAt: "2026-01-01",
        }),
      ],
    } as Awaited<ReturnType<typeof api.getJobs>>);
    render(
      <MemoryRouter>
        <LocationWatcher />
        <InProgressBoardPage />
      </MemoryRouter>,
    );
    const selected = getBoardCardRoot(
      await screen.findByRole("link", { name: "Selected" }),
    );
    fireEvent.click(
      within(selected).getByRole("button", { name: "Preview PDF" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/resumes/selected?mode=preview",
      ),
    );
    fireEvent.click(
      within(selected).getByRole("link", { name: "Open resume" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/resumes/selected?mode=edit",
      ),
    );
    expect(api.generateJobPdf).not.toHaveBeenCalled();
    expect(openJobPdf).not.toHaveBeenCalled();
  });

  it("shows Preparing resume… without editor or preview while processing", async () => {
    showTargeted("processing");
    expect(
      await screen.findByRole("button", { name: "Preparing resume…" }),
    ).toBeDisabled();
    expect(screen.queryByRole("link", { name: "Open resume" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Preview PDF" })).toBeNull();
  });

  it("offers Prepare resume when a targeted job has no prepared resume", async () => {
    vi.mocked(api.processJob).mockResolvedValue({} as never);
    showTargeted("discovered");
    expect(
      await screen.findByText("Resume not prepared yet"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open resume" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Preview PDF" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Prepare resume" }));
    await waitFor(() => expect(api.processJob).toHaveBeenCalledWith("job-1"));
  });

  it("untargets without changing the stage", async () => {
    showTargeted();
    fireEvent.click(await screen.findByRole("button", { name: "Untarget" }));
    await waitFor(() => expect(api.untargetJob).toHaveBeenCalledWith("job-1"));
    expect(api.transitionJobStage).not.toHaveBeenCalled();
  });

  it("marks a target applied when dragged to Applied", async () => {
    showTargeted();
    const card = await screen.findByText("Backend Engineer");
    fireEvent.dragStart(card, { dataTransfer: { effectAllowed: "move" } });
    fireEvent.drop(screen.getByRole("region", { name: "Applied lane" }));
    await waitFor(() =>
      expect(api.markAsApplied).toHaveBeenCalledWith("job-1"),
    );
    expect(api.transitionJobStage).not.toHaveBeenCalled();
  });

  it("groups legacy stages into Technical Interview and counts technical rounds", async () => {
    vi.mocked(api.getJobStageEvents).mockResolvedValue([
      makeEvent({ id: "tech-1", toStage: "technical_interview" }),
      makeEvent({ id: "tech-2", toStage: "technical_interview" }),
      makeEvent({ id: "legacy", toStage: "onsite" }),
    ]);
    render(
      <MemoryRouter>
        <InProgressBoardPage />
      </MemoryRouter>,
    );
    const lane = await screen.findByRole("region", {
      name: "Technical Interview lane",
    });
    expect(within(lane).getByText("Backend Engineer")).toBeInTheDocument();
    expect(within(lane).getByText("Round 3")).toBeInTheDocument();
  });

  it.each([
    "assessment",
    "onsite",
  ] as const)("keeps a no-change note on legacy %s and leaves the round unchanged", async (toStage) => {
    vi.mocked(api.getJobStageEvents).mockResolvedValue([
      makeEvent({ toStage }),
      makeEvent({ id: "note", toStage, metadata: { eventType: "note" } }),
    ]);
    render(
      <MemoryRouter>
        <InProgressBoardPage />
      </MemoryRouter>,
    );
    const card = getBoardCardRoot(await screen.findByText("Backend Engineer"));
    expect(within(card).getByText("Round 1")).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("menuitem", { name: /log event/i }));
    fireEvent.click(screen.getByRole("button", { name: /^log event$/i }));
    await waitFor(() =>
      expect(api.transitionJobStage).toHaveBeenCalledWith(
        "job-1",
        expect.objectContaining({
          toStage,
          metadata: expect.objectContaining({ eventType: "note" }),
        }),
      ),
    );
  });

  it.each([
    "Targeted lane",
    "Recruiter Screen lane",
  ])("refuses dragging a target into %s", async (laneName) => {
    showTargeted();
    const card = await screen.findByText("Backend Engineer");
    fireEvent.dragStart(card, { dataTransfer: { effectAllowed: "move" } });
    const lane = screen.getByRole("region", { name: laneName });
    fireEvent.dragOver(lane);
    fireEvent.drop(lane);
    expect(api.markAsApplied).not.toHaveBeenCalled();
    expect(api.transitionJobStage).not.toHaveBeenCalled();
    expect(
      within(screen.getByRole("region", { name: "Targeted lane" })).getByText(
        "Backend Engineer",
      ),
    ).toBeInTheDocument();
  });

  it("refuses dragging an application-stage card into Targeted", async () => {
    render(
      <MemoryRouter>
        <InProgressBoardPage />
      </MemoryRouter>,
    );
    const card = await screen.findByText("Backend Engineer");
    fireEvent.dragStart(card, { dataTransfer: { effectAllowed: "move" } });
    const lane = screen.getByRole("region", { name: "Targeted lane" });
    fireEvent.dragOver(lane);
    fireEvent.drop(lane);
    expect(api.markAsApplied).not.toHaveBeenCalled();
    expect(api.transitionJobStage).not.toHaveBeenCalled();
  });

  it("shows at least Round 1 during an optimistic technical interview drop", async () => {
    vi.mocked(api.transitionJobStage).mockReturnValue(new Promise(() => {}));
    render(
      <MemoryRouter>
        <InProgressBoardPage />
      </MemoryRouter>,
    );
    const card = await screen.findByText("Backend Engineer");
    fireEvent.dragStart(card, { dataTransfer: { effectAllowed: "move" } });
    fireEvent.drop(
      screen.getByRole("region", { name: "Technical Interview lane" }),
    );
    expect(await screen.findByText("Round 1")).toBeInTheDocument();
    expect(screen.queryByText("Round 0")).not.toBeInTheDocument();
  });

  it("shows withdrawn jobs in Reject", async () => {
    vi.mocked(api.getJobs).mockResolvedValue({
      jobs: [makeJob({ outcome: "withdrawn" })],
    } as Awaited<ReturnType<typeof api.getJobs>>);
    vi.mocked(api.getJobStageEvents).mockResolvedValue([
      makeEvent({ toStage: "closed", outcome: "withdrawn" }),
    ]);
    render(
      <MemoryRouter>
        <InProgressBoardPage />
      </MemoryRouter>,
    );
    const lane = await screen.findByRole("region", { name: "Reject lane" });
    expect(within(lane).getByText("withdrawn")).toBeInTheDocument();
  });
});

describe("Generate missing resumes", () => {
  const renderBatchBoard = (jobs: JobListItem[]) => {
    vi.mocked(api.getJobs).mockResolvedValue({ jobs } as Awaited<
      ReturnType<typeof api.getJobs>
    >);
    return render(
      <MemoryRouter>
        <InProgressBoardPage />
      </MemoryRouter>,
    );
  };

  it("counts only eligible targeted jobs and disables during the request", async () => {
    const targeted = { status: "ready" as const, readyAt: "2026-11-08" };
    let complete!: (result: {
      jobIds: string[];
      alreadyRunning: boolean;
    }) => void;
    vi.mocked(api.generateMissingResumes).mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const { queryClient } = renderBatchBoard([
      makeJob({ ...targeted, id: "missing" }),
      makeJob({
        ...targeted,
        id: "stale",
        pdfFreshness: "stale",
      }),
      makeJob({
        ...targeted,
        id: "current",
        pdfFreshness: "current",
      }),
      makeJob({ ...targeted, id: "uploaded", pdfFreshness: "uploaded" }),
      makeJob({ ...targeted, id: "processing", status: "processing" }),
      makeJob({ ...targeted, id: "regenerating", pdfRegenerating: true }),
      makeJob({ ...targeted, id: "untargeted", readyAt: null }),
      makeJob({ id: "applied", status: "applied" }),
    ]);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const button = await screen.findByRole("button", {
      name: "Generate/refresh resumes (2)",
    });
    fireEvent.click(button);
    await waitFor(() =>
      expect(api.generateMissingResumes).toHaveBeenCalledTimes(1),
    );
    expect(button).toBeDisabled();
    complete({ jobIds: ["missing", "stale"], alreadyRunning: false });
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Generating 2 resumes one at a time",
      ),
    );
    expect(invalidate).toHaveBeenCalled();
  });

  it("disables the button when no targeted jobs need a resume", async () => {
    renderBatchBoard([]);
    expect(
      await screen.findByRole("button", {
        name: "Generate/refresh resumes (0)",
      }),
    ).toBeDisabled();
    expect(api.generateMissingResumes).not.toHaveBeenCalled();
  });

  it("reports an already running batch", async () => {
    vi.mocked(api.generateMissingResumes).mockResolvedValue({
      jobIds: [],
      alreadyRunning: true,
    });
    renderBatchBoard([makeJob({ status: "ready", readyAt: "2026-11-08" })]);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Generate/refresh resumes (1)",
      }),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Already running"),
    );
  });
});

describe("Batch progress polling", () => {
  afterEach(() => vi.useRealTimers());

  it.each([
    "completion",
    "timeout",
  ] as const)("polls through idle gaps until %s", async (stop) => {
    vi.useFakeTimers();
    const job = makeJob({
      status: "ready",
      readyAt: "2026-11-08",
      pdfFreshness: "stale",
    });
    let currentJob = job;
    vi.mocked(api.getJobs).mockImplementation(
      async () =>
        ({ jobs: [currentJob] }) as Awaited<ReturnType<typeof api.getJobs>>,
    );
    vi.mocked(api.generateMissingResumes).mockResolvedValue({
      jobIds: [job.id],
      alreadyRunning: false,
    });
    render(
      <MemoryRouter>
        <InProgressBoardPage />
      </MemoryRouter>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Generate/refresh resumes (1)" }),
      );
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(toast.success).toHaveBeenCalledWith(
      "Generating 1 resume one at a time",
    );
    const afterStart = vi.mocked(api.getJobs).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(api.getJobs).toHaveBeenCalledTimes(afterStart + 1);
    // There are still no processing flags between jobs; the batch keeps polling.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(api.getJobs).toHaveBeenCalledTimes(afterStart + 2);
    if (stop === "completion") currentJob = { ...job, pdfFreshness: "current" };
    else vi.setSystemTime(Date.now() + 5 * 60_000);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    const afterStop = vi.mocked(api.getJobs).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(api.getJobs).toHaveBeenCalledTimes(afterStop);
  });
});

it("reports when the server no longer has missing resumes", async () => {
  vi.mocked(api.getJobs).mockResolvedValue({
    jobs: [makeJob({ status: "ready", readyAt: "2026-11-08" })],
  } as Awaited<ReturnType<typeof api.getJobs>>);
  vi.mocked(api.generateMissingResumes).mockResolvedValue({
    jobIds: [],
    alreadyRunning: false,
  });
  render(
    <MemoryRouter>
      <InProgressBoardPage />
    </MemoryRouter>,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Generate/refresh resumes (1)" }),
  );
  await waitFor(() =>
    expect(toast.info).toHaveBeenCalledWith("No resumes need generating"),
  );
});
