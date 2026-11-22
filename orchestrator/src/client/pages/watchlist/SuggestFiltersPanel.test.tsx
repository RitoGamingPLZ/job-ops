import { ApiClientError } from "@client/api/core";
import { suggestWatchlistFilters } from "@client/api/watchlist";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SuggestFiltersPanel } from "./SuggestFiltersPanel";

vi.mock("@client/api/watchlist", () => ({ suggestWatchlistFilters: vi.fn() }));

const result = {
  suggestedUrl: "https://jobs.lever.co/spotify?department=Engineering",
  params: [{ key: "department", values: ["Engineering"] }],
  rationale: "Engineering matches your search terms.",
  totals: { filtered: 12, unfiltered: 85 },
  sampleTitles: ["Software Engineer", "Backend Engineer"],
};
const props = {
  sourceType: "lever",
  careersUrl: "https://jobs.lever.co/spotify",
  label: "Spotify",
  onUse: vi.fn(),
};

beforeEach(() => vi.clearAllMocks());

describe("SuggestFiltersPanel", () => {
  it("renders the verified result and applies its URL only on Use", async () => {
    vi.mocked(suggestWatchlistFilters).mockResolvedValue(result);
    const { container } = render(<SuggestFiltersPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Suggest filters" }));
    expect(await screen.findByText("12 of 85 jobs")).toBeInTheDocument();
    expect(screen.getByText(result.suggestedUrl)).toBeInTheDocument();
    expect(screen.getByText(result.rationale)).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Sample job titles" })).toHaveTextContent(
      "Software Engineer",
    );
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent("12 of 85 jobs");
    expect(suggestWatchlistFilters).toHaveBeenCalledWith({
      sourceType: props.sourceType,
      careersUrl: props.careersUrl,
      label: props.label,
    });
    expect(props.onUse).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Use this URL" }));
    expect(props.onUse).toHaveBeenCalledWith(result.suggestedUrl);
    expect(screen.queryByText("12 of 85 jobs")).not.toBeInTheDocument();
  });

  it("dismisses without applying the suggestion", async () => {
    vi.mocked(suggestWatchlistFilters).mockResolvedValue(result);
    render(<SuggestFiltersPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Suggest filters" }));
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("12 of 85 jobs")).not.toBeInTheDocument();
    expect(props.onUse).not.toHaveBeenCalled();
  });

  it.each([
    [422, "Filter suggestions are not supported for this source type"],
    [503, "LLM API key not configured"],
  ])("shows a %i API error inline", async (status, message) => {
    vi.mocked(suggestWatchlistFilters).mockRejectedValue(new ApiClientError(message, { status }));
    render(<SuggestFiltersPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Suggest filters" }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Suggest filters" })).toBeEnabled();
  });

  it("shows a spinner and prevents repeated requests while loading", async () => {
    let resolve!: (value: typeof result) => void;
    vi.mocked(suggestWatchlistFilters).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    render(<SuggestFiltersPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Suggest filters" }));
    const button = screen.getByRole("button", { name: "Suggesting filters…" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button.querySelector(".animate-spin")).toBeInTheDocument();
    fireEvent.click(button);
    expect(suggestWatchlistFilters).toHaveBeenCalledTimes(1);
    await act(async () => resolve(result));
    expect(screen.getByRole("button", { name: "Suggest filters" })).toBeEnabled();
  });

  it("ignores an in-flight answer after the source URL changes", async () => {
    let resolve!: (value: typeof result) => void;
    vi.mocked(suggestWatchlistFilters).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { rerender } = render(<SuggestFiltersPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Suggest filters" }));
    rerender(<SuggestFiltersPanel {...props} careersUrl="https://jobs.lever.co/other" />);
    await act(async () => resolve(result));
    expect(screen.queryByRole("button", { name: "Use this URL" })).not.toBeInTheDocument();
  });

  it("disables suggestions until a URL is available", () => {
    render(<SuggestFiltersPanel {...props} careersUrl="" />);
    expect(screen.getByRole("button", { name: "Suggest filters" })).toBeDisabled();
  });
});
