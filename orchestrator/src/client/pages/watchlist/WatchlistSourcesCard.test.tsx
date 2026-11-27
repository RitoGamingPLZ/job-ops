import { fetchWatchlistSourceBranding } from "@client/api";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WatchlistSourceDraftCardProps } from "./types";
import { WatchlistSourcesCard } from "./WatchlistSourcesCard";

vi.mock("@client/api", () => ({
  fetchWatchlistSourceBranding: vi.fn().mockResolvedValue({ imageDataUrl: null }),
}));
vi.mock("@/components/ui/virtualized-listbox", () => ({
  useVirtualizedListbox: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 40,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        key: index,
        index,
        lane: 0,
        start: index * 40,
        end: (index + 1) * 40,
        size: 40,
      })),
    measureElement: vi.fn(),
    scrollToIndex: vi.fn(),
  }),
}));
vi.mock("./SuggestFiltersPanel", () => ({
  SuggestFiltersPanel: ({
    onUse,
    careersUrl,
    disabled,
    disabledHint,
  }: {
    onUse: (url: string) => void;
    careersUrl: string;
    disabled?: boolean;
    disabledHint?: string;
  }) => (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onUse(`${careersUrl}?team=Engineering`)}
      >
        Use this URL
      </button>
      {disabled ? <span>{disabledHint}</span> : null}
    </>
  ),
}));
vi.mock("./SearchFiltersPanel", () => ({
  SearchFiltersPanel: ({
    onUse,
    careersUrl,
    autoScan,
    onPlanDone,
  }: {
    onUse: (url: string) => void;
    careersUrl: string;
    autoScan?: boolean;
    onPlanDone?: (done: boolean) => void;
  }) => (
    <>
      <button type="button" onClick={() => onUse(`${careersUrl}?q=nurse`)}>
        Apply search filters
      </button>
      <span>{autoScan ? "auto-scan on" : "auto-scan off"}</span>
      <button type="button" onClick={() => onPlanDone?.(true)}>
        Finish scan
      </button>
    </>
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

  it("offers search filters only for custom careers sites and applies them as a custom URL", () => {
    const onUpdateDraft = vi.fn();
    const onSourceMethodSelected = vi.fn();
    const onSave = vi.fn();
    const base: WatchlistSourceDraftCardProps = {
      sourceDrafts: [],
      sourceStatusByDraftId: { "source-1": "watching", "source-2": "watching" },
      catalogSources: [],
      sourceTypes: [],
      formattedLastCheckedAt: null,
      formattedPreviousLastCheckedAt: null,
      newJobsCount: 0,
      hasUnsavedChanges: false,
      isSaving: false,
      onAddSource: vi.fn(),
      onRemoveSource: vi.fn(),
      onUpdateDraft,
      onSourceMethodSelected,
      onSourceSearchNoResults: vi.fn(),
      onSave,
    };
    const lever = {
      id: "source-2",
      sourceType: "lever",
      isCustom: true,
      catalogSourceId: null,
      customUrl: "https://jobs.lever.co/spotify",
    };
    const careers = {
      id: "source-1",
      sourceType: "careers_site",
      isCustom: true,
      catalogSourceId: null,
      customUrl: "https://careers.example.com/openings",
    };
    const { rerender } = render(<WatchlistSourcesCard {...base} sourceDrafts={[lever]} />);
    expect(screen.queryByRole("button", { name: "Apply search filters" })).not.toBeInTheDocument();
    rerender(<WatchlistSourcesCard {...base} sourceDrafts={[careers]} />);
    fireEvent.click(screen.getByRole("button", { name: "Apply search filters" }));
    expect(onUpdateDraft.mock.calls[0][1](careers)).toMatchObject({
      isCustom: true,
      catalogSourceId: null,
      customUrl: "https://careers.example.com/openings?q=nurse",
    });
    expect(onSourceMethodSelected).toHaveBeenCalledWith({
      method: "custom_url",
      sourceType: "careers_site",
      careersUrl: "https://careers.example.com/openings?q=nurse",
    });
    expect(onSave).not.toHaveBeenCalled();
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

  it("renders custom career URL input first along with name, description, and first custom option in dropdown", () => {
    const props: WatchlistSourceDraftCardProps = {
      sourceDrafts: [
        {
          id: "draft-custom-1",
          sourceType: "careers_site",
          isCustom: true,
          catalogSourceId: null,
          customUrl: "",
          customLabel: "",
          description: "",
        },
      ],
      sourceStatusByDraftId: { "draft-custom-1": "unsaved" },
      catalogSources: [
        {
          id: "shared-1",
          label: "Acme Robotics",
          sourceType: "careers_site",
          careersUrl: "https://careers.acme.com/jobs",
          cxsJobsUrl: null,
          description: "Backend roles",
        },
      ],
      sourceTypes: [
        {
          sourceType: "workday",
          label: "Workday",
          catalogLabel: "Workday company",
          customSourceOptionLabel: "Choose your own Workday URL",
          customSourceSearchText: "custom workday",
          customSourceInputLabel: "Custom Workday URL",
          customSourcePlaceholder: "https://company.wd1.myworkdayjobs.com/...",
          customSourceHelpText: "Use public Workday URL.",
          emptyCatalogText: "No Workday companies found.",
          fetchingLabel: "Fetching from Workday...",
          invalidUrlMessage: "Invalid Workday URL",
          supportsCustomSource: true,
          supportsBranding: true,
        },
        {
          sourceType: "careers_site",
          label: "Careers site",
          catalogLabel: "Company careers site",
          customSourceOptionLabel: "Custom careers site URL",
          customSourceSearchText: "custom careers site url",
          customSourceInputLabel: "Company careers URL",
          customSourcePlaceholder: "https://www.okta.com/company/careers/",
          customSourceHelpText: "Paste HTTPS URL.",
          emptyCatalogText: "No careers site sources found.",
          fetchingLabel: "Fetching from careers site...",
          invalidUrlMessage: "Invalid URL",
          supportsCustomSource: true,
          supportsBranding: false,
        },
      ],
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

    expect(screen.getByLabelText("Company careers URL 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Source name 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Source description 1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Custom careers site URL" }));
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveTextContent("Custom careers site URL");
  });

  it("shows starter group templates when watchlist drafts are empty", () => {
    const onAddGroup = vi.fn();
    const onAddSource = vi.fn();
    const props: WatchlistSourceDraftCardProps = {
      sourceDrafts: [],
      sourceStatusByDraftId: {},
      catalogSources: [],
      groups: [
        {
          id: "big-tech",
          label: "Big tech",
          description: "Large tech companies",
          sourceIds: ["a", "b"],
        },
      ],
      sourceTypes: [],
      formattedLastCheckedAt: null,
      formattedPreviousLastCheckedAt: null,
      newJobsCount: 0,
      hasUnsavedChanges: false,
      isSaving: false,
      onAddSource,
      onAddGroup,
      onRemoveSource: vi.fn(),
      onUpdateDraft: vi.fn(),
      onSourceMethodSelected: vi.fn(),
      onSourceSearchNoResults: vi.fn(),
      onSave: vi.fn(),
    };

    render(<WatchlistSourcesCard {...props} />);

    expect(screen.getByText("No watchlist sources selected yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add Big tech" }));
    expect(onAddGroup).toHaveBeenCalledWith(props.groups?.[0]);
    fireEvent.click(screen.getByRole("button", { name: "Paste career site URL" }));
    expect(onAddSource).toHaveBeenCalledTimes(1);
  });
});

describe("WatchlistSourcesCard filter plan gating", () => {
  const base = (status: "unsaved" | "watching"): WatchlistSourceDraftCardProps => ({
    sourceDrafts: [
      {
        id: "source-1",
        sourceType: "careers_site",
        isCustom: true,
        catalogSourceId: null,
        customUrl: "https://careers.example.com/openings",
      },
    ],
    sourceStatusByDraftId: { "source-1": status },
    catalogSources: [],
    sourceTypes: [],
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
  });

  it("keeps the search-preferences button off until the site's filter scan has an answer", () => {
    render(<WatchlistSourcesCard {...base("watching")} />);
    expect(screen.getByRole("button", { name: "Use this URL" })).toBeDisabled();
    expect(
      screen.getByText("Available once this site's search filters are ready."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Finish scan" }));
    expect(screen.getByRole("button", { name: "Use this URL" })).toBeEnabled();
    expect(
      screen.queryByText("Available once this site's search filters are ready."),
    ).not.toBeInTheDocument();
  });

  it("scans automatically only for a saved source", () => {
    const { unmount } = render(<WatchlistSourcesCard {...base("watching")} />);
    expect(screen.getByText("auto-scan on")).toBeInTheDocument();
    unmount();
    render(<WatchlistSourcesCard {...base("unsaved")} />);
    expect(screen.getByText("auto-scan off")).toBeInTheDocument();
  });
});
