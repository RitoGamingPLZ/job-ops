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

  it("scans a saved source by itself and shows a loader instead of a button", async () => {
    vi.mocked(getWatchlistSearchControls).mockResolvedValue({ status: "rescan" });
    vi.mocked(rescanWatchlistSearchControls).mockResolvedValue({ status: "learning" });
    const { container } = render(
      <SearchFiltersPanel careersUrl={careersUrl} onUse={vi.fn()} autoScan />,
    );
    expect(await screen.findByText(/Finding search filters for this site/)).toBeInTheDocument();
    await waitFor(() => expect(rescanWatchlistSearchControls).toHaveBeenCalledWith({ careersUrl }));
    expect(rescanWatchlistSearchControls).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("does not scan an unsaved URL, and says it will once saved", async () => {
    vi.mocked(getWatchlistSearchControls).mockResolvedValue({ status: "rescan" });
    render(<SearchFiltersPanel careersUrl={careersUrl} onUse={vi.fn()} />);
    expect(
      await screen.findByText("Search filters are found automatically once this source is saved."),
    ).toBeInTheDocument();
    expect(rescanWatchlistSearchControls).not.toHaveBeenCalled();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("does not repeat a scan that already finished without filters", async () => {
    vi.mocked(getWatchlistSearchControls).mockResolvedValue({
      status: "none",
      lastScan: { outcome: "none" },
    });
    render(<SearchFiltersPanel careersUrl={careersUrl} onUse={vi.fn()} autoScan />);
    await screen.findByText("No search filters were found for this site.");
    expect(rescanWatchlistSearchControls).not.toHaveBeenCalled();
  });

  it("retries once when the scanner was still starting, then leaves it to the user", async () => {
    vi.mocked(getWatchlistSearchControls).mockResolvedValue({
      status: "rescan",
      lastScan: { outcome: "unavailable", reason: "starting" },
    });
    vi.mocked(rescanWatchlistSearchControls).mockRejectedValue(new Error("still starting"));
    render(<SearchFiltersPanel careersUrl={careersUrl} onUse={vi.fn()} autoScan />);
    await waitFor(() => expect(rescanWatchlistSearchControls).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("button", { name: "Scan again" })).toBeInTheDocument();
    expect(rescanWatchlistSearchControls).toHaveBeenCalledTimes(1);
  });

  it("keeps checking while a scan runs and shows the controls once they are ready", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.mocked(getWatchlistSearchControls)
        .mockResolvedValueOnce({ status: "learning" })
        .mockResolvedValue(ready);
      render(<SearchFiltersPanel careersUrl={careersUrl} onUse={vi.fn()} autoScan />);
      expect(await screen.findByText(/Finding search filters for this site/)).toBeInTheDocument();
      await vi.advanceTimersByTimeAsync(15_000);
      expect(await screen.findByLabelText("Keyword")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("tells the card when the filter plan has an answer", async () => {
    const onPlanDone = vi.fn();
    vi.mocked(getWatchlistSearchControls).mockResolvedValue({ status: "learning" });
    const { rerender } = render(
      <SearchFiltersPanel
        careersUrl={careersUrl}
        onUse={vi.fn()}
        autoScan
        onPlanDone={onPlanDone}
      />,
    );
    await screen.findByText(/Finding search filters/);
    expect(onPlanDone).toHaveBeenLastCalledWith(false);
    vi.mocked(getWatchlistSearchControls).mockResolvedValue(ready);
    rerender(
      <SearchFiltersPanel
        careersUrl="https://other.example.com/jobs"
        onUse={vi.fn()}
        autoScan
        onPlanDone={onPlanDone}
      />,
    );
    await screen.findByLabelText("Keyword");
    expect(onPlanDone).toHaveBeenLastCalledWith(true);
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

describe("SearchFiltersPanel scan outcomes", () => {
  it("says so when a finished scan found no filters, with no button to repeat it", async () => {
    vi.mocked(getWatchlistSearchControls).mockResolvedValue({
      status: "none",
      lastScan: { outcome: "none" },
    });
    render(<SearchFiltersPanel careersUrl={careersUrl} onUse={vi.fn()} />);
    expect(
      await screen.findByText("No search filters were found for this site."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it.each([
    [{ outcome: "unavailable" as const, reason: "starting" }, /still starting/],
    [
      { outcome: "failed" as const, reason: "Recipe found no jobs" },
      /did not finish: Recipe found no jobs/,
    ],
  ])("explains an unfinished scan and keeps the button", async (lastScan, message) => {
    vi.mocked(getWatchlistSearchControls).mockResolvedValue({ status: "rescan", lastScan });
    render(<SearchFiltersPanel careersUrl={careersUrl} onUse={vi.fn()} />);
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scan again" })).toBeInTheDocument();
  });
});
