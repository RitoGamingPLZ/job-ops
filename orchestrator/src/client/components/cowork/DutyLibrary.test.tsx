import type { ExperienceBullet } from "@shared/types";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DutyLibrary } from "./DutyLibrary";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@client/api/cowork", () => ({
  listExperienceBullets: mocks.list,
  createExperienceBullet: mocks.create,
  deleteExperienceBullet: mocks.remove,
}));
const bullet: ExperienceBullet = {
  id: "one",
  text: "Built tools",
  company: "Company",
  role: "Engineer",
  tags: ["Tools"],
  startDate: null,
  endDate: null,
  source: "manual",
  sourceExperienceId: null,
  createdAt: "2026-11-08",
  updatedAt: "2026-11-08",
};
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue({ bullets: [bullet] });
  mocks.create.mockResolvedValue(bullet);
  mocks.remove.mockResolvedValue(undefined);
});
describe("duty library review regressions", () => {
  it("preserves multi-word tags until blur, omitting empty tags", async () => {
    render(
      <MemoryRouter>
        <DutyLibrary />
      </MemoryRouter>,
    );
    await screen.findByText("Built tools");
    fireEvent.click(screen.getByText("Add duty"));
    fireEvent.change(screen.getByLabelText("Duty"), {
      target: { value: "New duty" },
    });
    const tags = screen.getByLabelText("Tags (comma separated)");
    fireEvent.change(tags, { target: { value: "Machine " } });
    expect(tags).toHaveValue("Machine ");
    fireEvent.change(tags, {
      target: { value: "Machine Learning, Developer Tools, ," },
    });
    fireEvent.blur(tags);
    fireEvent.click(screen.getByText("Save duty"));
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: ["Machine Learning", "Developer Tools"],
        }),
      ),
    );
  });
  it("requires confirmation to delete a duty and supports cancel", async () => {
    render(
      <MemoryRouter>
        <DutyLibrary />
      </MemoryRouter>,
    );
    await screen.findByText("Built tools");
    fireEvent.click(screen.getByText("Delete"));
    expect(screen.getByRole("alertdialog")).toBeVisible();
    expect(mocks.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Cancel"));
    expect(mocks.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Delete"));
    fireEvent.click(screen.getByText("Delete duty"));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith("one"));
  });
});
