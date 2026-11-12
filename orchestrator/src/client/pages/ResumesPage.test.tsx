import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isNavActive, NAV_LINKS } from "../components/navigation";
import { renderWithQueryClient } from "../test/renderWithQueryClient";
import { ResumeLibraryPage, ResumesPage } from "./ResumesPage";

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
vi.mock("@/client/components/cowork/CandidateLibrary", () => ({
  CandidateLibrary: () => <div>Library content</div>,
}));
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);
function LocationWatcher() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname + location.search}
    </output>
  );
}
function mount() {
  return renderWithQueryClient(
    <MemoryRouter>
      <LocationWatcher />
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
it.each([
  "edit",
  "preview",
])("opens the selected resume in %s mode without PDF side effects", async (mode) => {
  mocks.list.mockResolvedValue({
    resumes: ["first", "selected"].map((jobId) => ({
      jobId,
      title: jobId,
      employer: "Example",
      updatedAt: "2026-01-01",
      hasPdf: true,
      status: "ready",
      readyAt: "2026-01-01",
    })),
  });
  mount();
  const link = await screen.findByRole("link", { name: "selected" });
  expect(link).toHaveAttribute("href", "/resumes/selected?mode=edit");
  if (mode === "edit") fireEvent.click(link);
  else
    fireEvent.click(
      within(link.closest("tr") as HTMLElement).getByRole("button", {
        name: "Preview PDF",
      }),
    );
  await waitFor(() =>
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/resumes/selected?mode=${mode}`,
    ),
  );
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.generate).not.toHaveBeenCalled();
  expect(mocks.job).not.toHaveBeenCalled();
});

it("disables preview while preparation is running", async () => {
  mocks.list.mockResolvedValue({
    resumes: [
      {
        jobId: "job",
        title: "Engineer",
        employer: "Example",
        updatedAt: "2026-01-01",
        status: "processing",
      },
    ],
  });
  mount();
  expect(
    await screen.findByRole("button", { name: "Preview PDF" }),
  ).toBeDisabled();
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

it("renders the resumes header with navigation and the base resume action", async () => {
  mocks.list.mockResolvedValue({ resumes: [] });
  mount();
  expect(within(screen.getByRole("banner")).getByText("Resumes")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Open navigation menu" }),
  ).toBeVisible();
  expect(
    within(screen.getByRole("banner")).queryByRole("link", {
      name: "Candidate Library",
    }),
  ).toBeNull();
  expect(await screen.findByText(/No resumes yet/)).toBeVisible();
});

it("renders the library with the standard header and navigation", () => {
  renderWithQueryClient(
    <MemoryRouter initialEntries={["/library"]}>
      <ResumeLibraryPage />
    </MemoryRouter>,
  );
  expect(
    within(screen.getByRole("banner")).getByText("Candidate Library"),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Open navigation menu" }),
  ).toBeVisible();
  expect(screen.getByRole("main")).toHaveTextContent("Library content");
});

it("navigates from the library to resumes through the navigation menu", async () => {
  mocks.list.mockResolvedValue({ resumes: [] });
  renderWithQueryClient(
    <MemoryRouter initialEntries={["/library"]}>
      <Routes>
        <Route path="/library" element={<ResumeLibraryPage />} />
        <Route path="/resumes" element={<ResumesPage />} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
  fireEvent.click(screen.getByRole("button", { name: "Resumes" }));
  expect(await screen.findByText(/No resumes yet/)).toBeVisible();
});

it("links to the base editor from the page header", async () => {
  mocks.list.mockResolvedValue({ resumes: [] });
  mount();
  expect(screen.getByRole("link", { name: "Base resume" })).toHaveAttribute(
    "href",
    "/resumes/base",
  );
  await screen.findByText(/No resumes yet/);
});

it.each([
  ["/library", "Candidate Library"],
  ["/resumes", "Resumes"],
])("activates only the matching navigation item on %s", (path, label) => {
  expect(
    NAV_LINKS.filter(({ to, activePaths }) =>
      isNavActive(path, to, activePaths),
    ).map((link) => link.label),
  ).toEqual([label]);
  const resumesIndex = NAV_LINKS.findIndex(({ to }) => to === "/resumes");
  expect(NAV_LINKS[resumesIndex + 1]).toMatchObject({
    to: "/library",
    label: "Candidate Library",
    activePaths: ["/library"],
  });
});
