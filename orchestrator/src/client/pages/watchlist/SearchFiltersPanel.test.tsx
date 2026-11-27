import {
  applyWatchlistSearchFilters,
  getWatchlistSearchControls,
  rescanWatchlistSearchControls,
} from "@client/api/watchlist";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SearchFiltersPanel } from "./SearchFiltersPanel";

vi.mock("@client/api/watchlist", () => ({
  applyWatchlistSearchFilters: vi.fn(),
  getWatchlistSearchControls: vi.fn(),
  rescanWatchlistSearchControls: vi.fn(),
}));

const careersUrl = "https://careers.example.com/openings?q=nurse";
const ready = {
  status: "ready" as const,
  controls: [
    { key: "q", label: "Keyword", input: { kind: "text" as const }, multiple: false },
    {
      key: "city",
      label: "City",
      input: {
        kind: "choice" as const,
        options: [{ value: "tor", label: "Toronto" }, { value: "nyc" }],
      },
      multiple: false,
    },
  ],
  values: { q: ["nurse"] },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getWatchlistSearchControls).mockResolvedValue(ready);
});

describe("SearchFiltersPanel", () => {
  it("shows verified controls prefilled from the saved URL", async () => {
    render(<SearchFiltersPanel careersUrl={careersUrl} onUse={vi.fn()} />);
    expect(await screen.findByLabelText("Keyword")).toHaveValue("nurse");
    expect(screen.getByLabelText("City")).toHaveValue("");
    expect(screen.getByRole("option", { name: "Toronto" })).toBeInTheDocument();
    expect(getWatchlistSearchControls).toHaveBeenCalledWith({ careersUrl });
  });

  it("asks the server to build the URL when a choice changes", async () => {
    vi.mocked(applyWatchlistSearchFilters).mockResolvedValue({
      careersUrl: "https://careers.example.com/openings?city=tor&q=nurse",
    });
    const onUse = vi.fn();
    render(<SearchFiltersPanel careersUrl={careersUrl} onUse={onUse} />);
    fireEvent.change(await screen.findByLabelText("City"), { target: { value: "tor" } });
    await waitFor(() =>
      expect(onUse).toHaveBeenCalledWith("https://careers.example.com/openings?city=tor&q=nurse"),
    );
    expect(applyWatchlistSearchFilters).toHaveBeenCalledWith({
      careersUrl,
      values: { q: ["nurse"], city: ["tor"] },
    });
  });

  it("applies a typed keyword once, after typing pauses, and clears it when emptied", async () => {
    vi.mocked(applyWatchlistSearchFilters).mockImplementation(async ({ values }) => ({
      careersUrl: `https://careers.example.com/openings${values.q ? `?q=${values.q[0]}` : ""}`,
    }));
    const onUse = vi.fn();
    render(<SearchFiltersPanel careersUrl={careersUrl} onUse={onUse} />);
    const input = await screen.findByLabelText("Keyword");
    fireEvent.change(input, { target: { value: "n" } });
    fireEvent.change(input, { target: { value: "nu" } });
    fireEvent.change(input, { target: { value: "" } });
    await waitFor(() => expect(applyWatchlistSearchFilters).toHaveBeenCalledTimes(1));
    expect(applyWatchlistSearchFilters).toHaveBeenCalledWith({ careersUrl, values: {} });
    await waitFor(() => expect(onUse).toHaveBeenCalledWith("https://careers.example.com/openings"));
  });

  it("lets a multi-value text control take several entries separated by semicolons", async () => {
    vi.mocked(getWatchlistSearchControls).mockResolvedValue({
      status: "ready",
      controls: [{ key: "location", label: "Location", input: { kind: "text" }, multiple: true }],
      values: { location: ["Toronto, ON"] },
    });
    vi.mocked(applyWatchlistSearchFilters).mockResolvedValue({ careersUrl });
    render(<SearchFiltersPanel careersUrl={careersUrl} onUse={vi.fn()} />);
    const input = await screen.findByLabelText("Location");
    expect(input).toHaveValue("Toronto, ON");
    fireEvent.change(input, { target: { value: "Toronto, ON; London; " } });
    // The box keeps what was typed, including the trailing separator.
    expect(input).toHaveValue("Toronto, ON; London; ");
    await waitFor(() =>
      expect(applyWatchlistSearchFilters).toHaveBeenCalledWith({
        careersUrl,
        values: { location: ["Toronto, ON", "London"] },
      }),
    );
  });

  it("shows the server's rejection instead of changing the URL", async () => {
    vi.mocked(applyWatchlistSearchFilters).mockRejectedValue(new Error("Choose an offered value."));
    const onUse = vi.fn();
    render(<SearchFiltersPanel careersUrl={careersUrl} onUse={onUse} />);
    fireEvent.change(await screen.findByLabelText("City"), { target: { value: "nyc" } });
    expect(await screen.findByText("Choose an offered value.")).toBeInTheDocument();
    expect(onUse).not.toHaveBeenCalled();
  });

  it("offers to learn a site without search filters, then explains it is learning", async () => {
    vi.mocked(getWatchlistSearchControls).mockResolvedValue({ status: "rescan" });
    vi.mocked(rescanWatchlistSearchControls).mockResolvedValue({ status: "learning" });
    render(<SearchFiltersPanel careersUrl={careersUrl} onUse={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Find search filters" }));
    expect(await screen.findByText(/Learning this site's search filters/)).toBeInTheDocument();
    expect(rescanWatchlistSearchControls).toHaveBeenCalledWith({ careersUrl });
  });

  it.each([
    ["unsupported sites", { status: "unsupported" as const }],
    ["a failed lookup", null],
  ])("renders nothing for %s", async (_name, response) => {
    if (response) vi.mocked(getWatchlistSearchControls).mockResolvedValue(response);
    else vi.mocked(getWatchlistSearchControls).mockRejectedValue(new Error("down"));
    const { container } = render(<SearchFiltersPanel careersUrl={careersUrl} onUse={vi.fn()} />);
    await waitFor(() => expect(getWatchlistSearchControls).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("reloads controls only when the listing changes, not while the query is edited", async () => {
    const { rerender } = render(<SearchFiltersPanel careersUrl={careersUrl} onUse={vi.fn()} />);
    await screen.findByLabelText("Keyword");
    rerender(
      <SearchFiltersPanel
        careersUrl="https://careers.example.com/openings?q=nurse&city=tor"
        onUse={vi.fn()}
      />,
    );
    expect(getWatchlistSearchControls).toHaveBeenCalledTimes(1);
    rerender(<SearchFiltersPanel careersUrl="https://other.example.com/jobs" onUse={vi.fn()} />);
    await waitFor(() => expect(getWatchlistSearchControls).toHaveBeenCalledTimes(2));
  });
});
