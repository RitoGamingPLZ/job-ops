import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ResumesPage } from "./ResumesPage";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  open: vi.fn(),
  error: vi.fn(),
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
  return render(
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
  expect(screen.queryByText(/No job resumes yet/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("Retry"));
  expect(await screen.findByText(/No job resumes yet/)).toBeVisible();
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
      },
    ],
  });
  mocks.open.mockResolvedValue(undefined);
  mount();
  fireEvent.click(await screen.findByRole("link", { name: "PDF: Ready" }));
  await waitFor(() => expect(mocks.open).toHaveBeenCalledWith("job"));
});
