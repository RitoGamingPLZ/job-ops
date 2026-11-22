import { fireEvent, render, screen } from "@testing-library/react";
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
});
