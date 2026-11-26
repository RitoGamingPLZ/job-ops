import { fetchWatchlistSourceBranding } from "@client/api";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WatchlistSourceDraftCardProps } from "./types";
import { WatchlistSourcesCard } from "./WatchlistSourcesCard";

vi.mock("@client/api", () => ({
  fetchWatchlistSourceBranding: vi.fn().mockResolvedValue({ imageDataUrl: null }),
}));
vi.mock("./SuggestFiltersPanel", () => ({
  SuggestFiltersPanel: ({
    onUse,
    careersUrl,
  }: {
    onUse: (url: string) => void;
    careersUrl: string;
  }) => (
    <button type="button" onClick={() => onUse(`${careersUrl}?team=Engineering`)}>
      Use this URL
    </button>
  ),
}));

describe("WatchlistSourcesCard filter suggestions", () => {
  it.each([false, true])("applies suggestions as a custom URL (isCustom=%s)", (isCustom) => {
    const draft = {
      id: "source-1",
      sourceType: "lever",
      isCustom,
      catalogSourceId: isCustom ? null : "lever:spotify",
      customUrl: "https://jobs.lever.co/spotify",
    };
    const onUpdateDraft = vi.fn();
    const props: WatchlistSourceDraftCardProps = {
      sourceDrafts: [draft],
      sourceStatusByDraftId: { "source-1": "watching" },
      catalogSources: [
        {
          id: "lever:spotify",
          sourceType: "lever",
          label: "Spotify",
          cxsJobsUrl: null,
          careersUrl: "https://jobs.lever.co/spotify",
        },
      ],
      sourceTypes: [],
      formattedLastCheckedAt: null,
      formattedPreviousLastCheckedAt: null,
      newJobsCount: 0,
      hasUnsavedChanges: false,
      isSaving: false,
      onAddSource: vi.fn(),
      onRemoveSource: vi.fn(),
      onUpdateDraft,
      onSourceMethodSelected: vi.fn(),
      onSourceSearchNoResults: vi.fn(),
      onSave: vi.fn(),
    };
    render(<WatchlistSourcesCard {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Use this URL" }));
    expect(onUpdateDraft).toHaveBeenCalledWith(0, expect.any(Function));
    expect(onUpdateDraft.mock.calls[0][1](draft)).toEqual({
      ...draft,
      isCustom: true,
      catalogSourceId: null,
      customUrl: "https://jobs.lever.co/spotify?team=Engineering",
    });
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it("renders compact saved source cards on a recessed tray with an inline title link", async () => {
    const props: WatchlistSourceDraftCardProps = {
      sourceDrafts: [
        {
          id: "source-1",
          sourceType: "lever",
          isCustom: false,
          catalogSourceId: "lever:spotify",
          customUrl: "",
        },
      ],
      sourceStatusByDraftId: { "source-1": "watching" },
      catalogSources: [
        {
          id: "lever:spotify",
          sourceType: "lever",
          label: "Spotify",
          cxsJobsUrl: null,
          careersUrl: "https://jobs.lever.co/spotify",
          rating: { wlb: 8, salary: 9, source: "editorial", ratedAt: "2026-11-25" },
        },
      ],
      sourceTypes: [
        {
          sourceType: "lever",
          label: "Lever",
          catalogLabel: "Lever company",
          customSourceOptionLabel: "Custom Lever URL",
          customSourceSearchText: "custom lever",
          customSourceInputLabel: "Custom Lever URL",
          customSourcePlaceholder: "https://jobs.lever.co/...",
          customSourceHelpText: "Use public Lever URL.",
          emptyCatalogText: "No Lever companies found.",
          fetchingLabel: "Fetching from Lever...",
          invalidUrlMessage: "Invalid Lever URL",
          supportsCustomSource: true,
          supportsBranding: true,
        },
      ],
      formattedLastCheckedAt: null,
      formattedPreviousLastCheckedAt: null,
      newJobsCount: 0,
      hasUnsavedChanges: false,
      isSaving: false,
      onAddSource: vi.fn(),
      onRemoveSource: vi.fn(),
      onUpdateDraft: vi.fn(),
      onSourceMethodSelected: vi.fn(),
      onSourceSearchNoResults: vi.fn(),
      onSave: vi.fn(),
    };

    render(<WatchlistSourcesCard {...props} />);

    const link = screen.getByRole("link", { name: "Spotify" });
    expect(link).toHaveAttribute("href", "https://jobs.lever.co/spotify");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.queryByRole("link", { name: /view website/i })).not.toBeInTheDocument();
    expect(screen.getByText("Lever")).toBeInTheDocument();
    expect(screen.getByText("Watching")).toBeInTheDocument();
    expect(screen.getByTitle("Work-life balance: 8 out of 10 (editorial)")).toHaveTextContent(
      "WLB8/10",
    );
    expect(screen.getByTitle("Salary: 9 out of 10 (editorial)")).toHaveTextContent("Pay9/10");

    const card = link.closest("article");
    expect(card).toHaveClass("bg-card", "border-border");
    expect(card?.parentElement?.parentElement).toHaveClass("bg-muted");
    await waitFor(() =>
      expect(fetchWatchlistSourceBranding).toHaveBeenCalledWith({
        sourceType: "lever",
        careersUrl: "https://jobs.lever.co/spotify",
      }),
    );
  });

  it("renders a compact empty draft card with selector and visible remove control", () => {
    const props: WatchlistSourceDraftCardProps = {
      sourceDrafts: [
        {
          id: "draft-1",
          sourceType: "workday",
          isCustom: false,
          catalogSourceId: null,
          customUrl: "",
        },
      ],
      sourceStatusByDraftId: { "draft-1": "unsaved" },
      catalogSources: [],
      sourceTypes: [],
      formattedLastCheckedAt: null,
      formattedPreviousLastCheckedAt: null,
      newJobsCount: 0,
      hasUnsavedChanges: true,
      isSaving: false,
      onAddSource: vi.fn(),
      onRemoveSource: vi.fn(),
      onUpdateDraft: vi.fn(),
      onSourceMethodSelected: vi.fn(),
      onSourceSearchNoResults: vi.fn(),
      onSave: vi.fn(),
    };

    render(<WatchlistSourcesCard {...props} />);

    expect(screen.getByText("New source")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose company" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove watchlist source 1" })).toHaveClass(
      "opacity-100",
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
