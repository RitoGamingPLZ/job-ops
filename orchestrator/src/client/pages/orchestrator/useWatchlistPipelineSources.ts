import * as api from "@client/api";
import { showErrorToast } from "@client/lib/error-toast";
import { queryKeys } from "@client/lib/queryKeys";
import { getCoveredCatalogSourceIds } from "@client/pages/watchlist/utils";
import {
  MAX_WATCHLIST_SOURCES,
  type WatchedSourceType,
  type WatchlistSelectedSource,
  type WatchlistSource,
  type WatchlistSourceGroup,
  type WatchlistSourceScanInput,
  type WatchlistSourceScanResponse,
  type WatchlistSourceTypeDescriptor,
} from "@shared/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { getAuthScopedStorageKey } from "@/client/api/client";
import { trackProductEvent } from "@/lib/analytics";
import { PIPELINE_WATCHLIST_SOURCES_STORAGE_KEY } from "./constants";

function getWatchlistPipelineSourcesStorageKey(): string {
  return getAuthScopedStorageKey(PIPELINE_WATCHLIST_SOURCES_STORAGE_KEY);
}

type StoredSelection = {
  selectedIds: string[];
  knownIds: string[];
};

function readStoredSelection(storageKey: string): StoredSelection | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const candidate = parsed as Partial<StoredSelection>;
    const selectedIds = Array.isArray(candidate.selectedIds)
      ? candidate.selectedIds.filter((value): value is string => typeof value === "string")
      : [];
    const knownIds = Array.isArray(candidate.knownIds)
      ? candidate.knownIds.filter((value): value is string => typeof value === "string")
      : selectedIds;
    return { selectedIds, knownIds };
  } catch {
    return null;
  }
}

function writeStoredSelection(storageKey: string, selection: StoredSelection): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(selection));
  } catch {
    // Ignore localStorage errors (quota, disabled storage, etc).
  }
}

function reconcileSelection(args: {
  available: WatchlistSelectedSource[];
  stored: StoredSelection | null;
}): { selectedIds: string[]; knownIds: string[] } {
  const availableIds = args.available.map((source) => source.id);
  const availableSet = new Set(availableIds);

  if (!args.stored) {
    // First-run default: include every Watchlist source the user has saved.
    // Preserves the pre-#621 "Watchlist participates automatically" behavior.
    return { selectedIds: availableIds, knownIds: availableIds };
  }

  const previouslyKnown = new Set(args.stored.knownIds);
  // Auto-select sources that appeared since the last reconciliation — they
  // would have been included automatically before #621, so keep them in
  // unless the user later opts out.
  const newlyAddedSelected = availableIds.filter((id) => !previouslyKnown.has(id));

  const selectedIds = [
    ...args.stored.selectedIds.filter((id) => availableSet.has(id)),
    ...newlyAddedSelected,
  ];

  // De-duplicate while preserving order.
  const seen = new Set<string>();
  const deduped = selectedIds.filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  return { selectedIds: deduped, knownIds: availableIds };
}

export type AddCustomWatchlistSourceInput = {
  careersUrl: string;
  label?: string;
  description?: string;
  sourceType?: WatchedSourceType;
  catalogSourceId?: string | null;
};

export type UseWatchlistPipelineSourcesResult = {
  canUseWatchlist: boolean;
  watchlistSources: WatchlistSelectedSource[];
  watchlistCatalogSources: WatchlistSource[];
  watchlistGroups: WatchlistSourceGroup[];
  watchlistSourceTypes: WatchlistSourceTypeDescriptor[];
  selectedWatchlistSourceIds: string[];
  setSelectedWatchlistSourceIds: (ids: string[]) => void;
  toggleWatchlistSource: (sourceId: string, checked: boolean) => void;
  applyWatchlistGroup: (group: WatchlistSourceGroup) => Promise<void>;
  addCustomWatchlistSource: (input: AddCustomWatchlistSourceInput) => Promise<boolean>;
  scanCustomWatchlistSource: (
    input: WatchlistSourceScanInput,
  ) => Promise<WatchlistSourceScanResponse>;
  isMutatingWatchlist: boolean;
  isLoading: boolean;
  isError: boolean;
};

function toExistingSelections(sources: WatchlistSelectedSource[]) {
  return sources.map((source) => ({
    catalogSourceId: source.catalogSourceId,
    sourceType: source.sourceType,
    label: source.label,
    careersUrl: source.careersUrl,
    ...(source.description?.trim() ? { description: source.description.trim() } : {}),
  }));
}

export function useWatchlistPipelineSources(options?: {
  enabled?: boolean;
}): UseWatchlistPipelineSourcesResult {
  const canUseWatchlist = options?.enabled ?? true;
  const queryClient = useQueryClient();
  const storageKey = useMemo(() => getWatchlistPipelineSourcesStorageKey(), []);

  const watchlistSourcesQuery = useQuery({
    queryKey: queryKeys.watchlist.sources(),
    queryFn: api.getWatchlistSources,
    staleTime: 30_000,
    enabled: canUseWatchlist,
  });

  const watchlistSources = useMemo(
    () => watchlistSourcesQuery.data?.selectedSources ?? [],
    [watchlistSourcesQuery.data],
  );
  const watchlistCatalogSources = useMemo(
    () => watchlistSourcesQuery.data?.catalogSources ?? [],
    [watchlistSourcesQuery.data],
  );
  const watchlistGroups = useMemo(
    () => watchlistSourcesQuery.data?.groups ?? [],
    [watchlistSourcesQuery.data],
  );
  const watchlistSourceTypes = useMemo(
    () => watchlistSourcesQuery.data?.availableSourceTypes ?? [],
    [watchlistSourcesQuery.data],
  );

  const saveSourcesMutation = useMutation({
    mutationFn: (input: Parameters<typeof api.updateWatchlistSources>[0]) =>
      api.updateWatchlistSources(input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.watchlist.sources(),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.watchlist.results(),
        }),
      ]);
    },
  });

  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    const stored = readStoredSelection(storageKey);
    return stored?.selectedIds ?? [];
  });

  // Reconcile against the live list whenever it changes.
  useEffect(() => {
    if (watchlistSourcesQuery.isLoading) return;
    const stored = readStoredSelection(storageKey);
    const reconciled = reconcileSelection({
      available: watchlistSources,
      stored,
    });
    writeStoredSelection(storageKey, reconciled);
    setSelectedIds((current) => {
      if (
        current.length === reconciled.selectedIds.length &&
        current.every((id, index) => id === reconciled.selectedIds[index])
      ) {
        return current;
      }
      return reconciled.selectedIds;
    });
  }, [storageKey, watchlistSources, watchlistSourcesQuery.isLoading]);

  const persistSelection = useCallback(
    (next: string[]) => {
      const availableIds = watchlistSources.map((source) => source.id);
      writeStoredSelection(storageKey, {
        selectedIds: next,
        knownIds: availableIds,
      });
    },
    [storageKey, watchlistSources],
  );

  const setSelectedWatchlistSourceIds = useCallback(
    (ids: string[]) => {
      const availableSet = new Set(watchlistSources.map((source) => source.id));
      const seen = new Set<string>();
      const filtered = ids.filter((id) => {
        if (!availableSet.has(id)) return false;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      setSelectedIds(filtered);
      persistSelection(filtered);
    },
    [persistSelection, watchlistSources],
  );

  const toggleWatchlistSource = useCallback(
    (sourceId: string, checked: boolean) => {
      setSelectedIds((current) => {
        const availableSet = new Set(watchlistSources.map((source) => source.id));
        if (!availableSet.has(sourceId)) return current;
        const next = checked
          ? Array.from(new Set([...current, sourceId]))
          : current.filter((id) => id !== sourceId);
        persistSelection(next);
        return next;
      });
    },
    [persistSelection, watchlistSources],
  );

  const applyWatchlistGroup = useCallback(
    async (group: WatchlistSourceGroup) => {
      const currentDrafts = watchlistSources.map((source) => ({
        catalogSourceId: source.catalogSourceId,
        sourceType: source.sourceType,
        customUrl: source.isCustom ? source.careersUrl : "",
      }));
      const alreadyAdded = getCoveredCatalogSourceIds(currentDrafts, watchlistCatalogSources);
      const catalogById = new Map(watchlistCatalogSources.map((source) => [source.id, source]));
      const room = Math.max(0, MAX_WATCHLIST_SOURCES - watchlistSources.length);
      const missing = group.sourceIds.flatMap((id) => {
        const source = catalogById.get(id);
        return source && !alreadyAdded.has(id) ? [source] : [];
      });
      const toAdd = missing.slice(0, room);

      if (toAdd.length === 0) {
        toast.info(
          missing.length > 0
            ? `Your watchlist is full (${MAX_WATCHLIST_SOURCES} sources max).`
            : `Everything in ${group.label} is already in your watchlist.`,
        );
        return;
      }

      const nextSelections = [
        ...toExistingSelections(watchlistSources),
        ...toAdd.map((source) => ({
          catalogSourceId: source.id,
          sourceType: source.sourceType,
          label: source.label,
          careersUrl: source.careersUrl,
          ...(source.description?.trim() ? { description: source.description.trim() } : {}),
        })),
      ];

      try {
        await saveSourcesMutation.mutateAsync({ selections: nextSelections });
        trackProductEvent("watchlist_source_group_added", {
          group_id: group.id,
          added_count: toAdd.length,
        });
        trackProductEvent("watchlist_sources_saved", {
          source_count: nextSelections.length,
          catalog_count: nextSelections.filter((item) => item.catalogSourceId !== null).length,
          custom_count: nextSelections.filter((item) => item.catalogSourceId === null).length,
        });
        toast.success(`Added ${toAdd.length} from ${group.label} to Watchlist`);
      } catch (error) {
        showErrorToast(error, `Failed to add ${group.label} to Watchlist`);
      }
    },
    [saveSourcesMutation, watchlistCatalogSources, watchlistSources],
  );

  const addCustomWatchlistSource = useCallback(
    async (input: AddCustomWatchlistSourceInput): Promise<boolean> => {
      if (watchlistSources.length >= MAX_WATCHLIST_SOURCES) {
        toast.info(`Your watchlist is full (${MAX_WATCHLIST_SOURCES} sources max).`);
        return false;
      }

      const trimmedUrl = input.careersUrl.trim();
      const trimmedLabel = input.label?.trim() || trimmedUrl;
      const trimmedDescription = input.description?.trim() || "";
      if (!trimmedUrl) return false;

      const nextSelections = [
        ...toExistingSelections(watchlistSources),
        {
          catalogSourceId: input.catalogSourceId ?? null,
          sourceType: input.sourceType ?? "careers_site",
          label: trimmedLabel,
          careersUrl: trimmedUrl,
          ...(trimmedDescription ? { description: trimmedDescription } : {}),
        },
      ];

      try {
        await saveSourcesMutation.mutateAsync({ selections: nextSelections });
        trackProductEvent("watchlist_sources_saved", {
          source_count: nextSelections.length,
          catalog_count: nextSelections.filter((item) => item.catalogSourceId !== null).length,
          custom_count: nextSelections.filter((item) => item.catalogSourceId === null).length,
        });
        toast.success(`Added ${trimmedLabel} to Watchlist`);
        return true;
      } catch (error) {
        showErrorToast(error, "Failed to add source to Watchlist");
        return false;
      }
    },
    [saveSourcesMutation, watchlistSources],
  );

  const scanCustomWatchlistSource = useCallback(
    async (input: WatchlistSourceScanInput): Promise<WatchlistSourceScanResponse> => {
      const response = await api.scanWatchlistSource(input);
      await queryClient.invalidateQueries({ queryKey: queryKeys.watchlist.sources() });
      return response;
    },
    [queryClient],
  );

  return {
    canUseWatchlist,
    watchlistSources,
    watchlistCatalogSources,
    watchlistGroups,
    watchlistSourceTypes,
    selectedWatchlistSourceIds: selectedIds,
    setSelectedWatchlistSourceIds,
    toggleWatchlistSource,
    applyWatchlistGroup,
    addCustomWatchlistSource,
    scanCustomWatchlistSource,
    isMutatingWatchlist: saveSourcesMutation.isPending,
    isLoading: watchlistSourcesQuery.isLoading,
    isError: watchlistSourcesQuery.isError,
  };
}
