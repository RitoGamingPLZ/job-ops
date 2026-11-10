import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderWithQueryClient } from "../test/renderWithQueryClient";
import { ResumesPage } from "./ResumesPage";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  job: vi.fn(),
  generate: vi.fn(),
  open: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/client/api", () => ({
  getJob: mocks.job,
  generateJobPdf: mocks.generate,
}));
vi.mock("@client/api/cowork", () => ({ listResumes: mocks.list }));
vi.mock("@/client/lib/private-pdf", () => ({ openJobPdf: mocks.open }));
vi.mock("@/client/components/cowork/DutyLibrary", () => ({
  coworkError: mocks.error,
  DutyLibrary: () => null,
}));
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);
function mount() {
  return renderWithQueryClient(
    <MemoryRouter>
      <ResumesPage />
    </MemoryRouter>,
  );
}
it("distinguishes a load error from an empty list and retries", async () => {
  mocks.list
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValueOnce({ resumes: [] });
  mount();
  expect(await screen.findByText("Could not load resumes")).toBeVisible();
  expect(screen.queryByText(/No resumes yet/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("Retry"));
  expect(await screen.findByText(/No resumes yet/)).toBeVisible();
  expect(mocks.list).toHaveBeenCalledTimes(2);
});
it("opens a ready PDF from its link", async () => {
  mocks.list.mockResolvedValue({
    resumes: [
      {
        jobId: "job",
        title: "Engineer",
        employer: "Example",
        updatedAt: "2026-01-01",
        hasPdf: true,
        status: "ready",
        readyAt: "2026-01-01",
      },
    ],
  });
  mocks.open.mockResolvedValue(undefined);
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Preview PDF" }));
  expect(screen.getByRole("link", { name: "Engineer" })).toHaveAttribute(
    "href",
    "/resumes/job",
  );
  expect(document.querySelector('a[href*="inspector=tailoring"]')).toBeNull();
  await waitFor(() =>
    expect(mocks.open).toHaveBeenCalledWith("job", expect.any(Function)),
  );
});

it.each([
  "missing",
  "stale",
  "current",
  "uploaded",
])("checks %s PDF freshness before previewing", async (pdfFreshness) => {
  mocks.list.mockResolvedValue({
    resumes: [
      {
        jobId: "job",
        title: "Engineer",
        employer: "Example",
        updatedAt: "2026-01-01",
        hasPdf: pdfFreshness !== "missing",
        status: "ready",
        readyAt: "2026-01-01",
      },
    ],
  });
  mocks.job.mockResolvedValue({
    status: "ready",
    pdfPath: pdfFreshness === "missing" ? null : "resume.pdf",
    pdfFreshness,
  });
  mocks.generate.mockResolvedValue(undefined);
  mocks.open.mockImplementation(async (_id, beforeFetch) => {
    await beforeFetch();
  });
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Preview PDF" }));
  await waitFor(() => expect(mocks.job).toHaveBeenCalledWith("job"));
  if (["missing", "stale"].includes(pdfFreshness))
    await waitFor(() => expect(mocks.generate).toHaveBeenCalledWith("job"));
  else expect(mocks.generate).not.toHaveBeenCalled();
});

it("refuses to preview a resume that is still being prepared", async () => {
  mocks.list.mockResolvedValue({
    resumes: [
      {
        jobId: "job",
        title: "Engineer",
        employer: "Example",
        updatedAt: "2026-01-01",
        hasPdf: false,
        status: "processing",
        readyAt: "2026-01-01",
      },
    ],
  });
  mocks.job.mockResolvedValue({
    status: "processing",
    pdfFreshness: "missing",
  });
  mocks.open.mockImplementation(async (_id, beforeFetch) => beforeFetch());
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Preview PDF" }));
  await waitFor(() => expect(mocks.error).toHaveBeenCalled());
  expect(mocks.generate).not.toHaveBeenCalled();
});

it.each([
  "processing",
  "discovered",
])("does not link a %s resume to the editor", async (status) => {
  mocks.list.mockResolvedValue({
    resumes: [
      {
        jobId: "job",
        title: "Engineer",
        employer: "Example",
        updatedAt: "2026-01-01",
        hasPdf: false,
        status,
        readyAt: "2026-01-01",
      },
    ],
  });
  mount();
  expect(await screen.findByText("Engineer")).toBeVisible();
  expect(screen.queryByRole("link", { name: "Engineer" })).toBeNull();
});
