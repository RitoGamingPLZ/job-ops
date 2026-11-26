import * as api from "@client/api";
import { AppModeContext, PageHeader } from "@client/components/layout";
import { useSettings } from "@client/hooks/useSettings";
import { showErrorToast } from "@client/lib/error-toast";
import { queryKeys } from "@client/lib/queryKeys";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock } from "lucide-react";
import type React from "react";
import { useCallback, useContext, useMemo } from "react";
import { toast } from "sonner";
import type { AutomaticRunValues } from "./orchestrator/automatic-run";
import { OrchestratorSearchComposer } from "./orchestrator/OrchestratorSearchComposer";
import { prepareAutomaticSearch } from "./orchestrator/prepareAutomaticSearch";
import { usePipelineSearchPresets } from "./orchestrator/usePipelineSearchPresets";
import { usePipelineSources } from "./orchestrator/usePipelineSources";
import { useWatchlistPipelineSources } from "./orchestrator/useWatchlistPipelineSources";
import { getEnabledSources } from "./orchestrator/utils";

function describeNextRun(nextScheduledRun: string | null | undefined): string {
  if (nextScheduledRun === undefined) return "";
  if (nextScheduledRun === null) {
    return "The daily search is not scheduled right now.";
  }
  const when = new Date(nextScheduledRun).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
  return `Next daily run: ${when}.`;
}

/**
 * Where a user edits the search the daily run uses for them: sources, filters, search terms and
 * limits. Saving never starts a search; the admin's schedule does that.
 */
export const DailySearchPage: React.FC = () => {
  const { appMode, permissions } = useContext(AppModeContext);
  const { settings, refreshSettings } = useSettings();
  const enabledSources = useMemo(() => getEnabledSources(settings ?? null), [settings]);
  const { pipelineSources, setPipelineSources, toggleSource } = usePipelineSources(enabledSources);
  const {
    watchlistSources,
    selectedWatchlistSourceIds,
    setSelectedWatchlistSourceIds,
    toggleWatchlistSource,
    isLoading: isWatchlistSourcesLoading,
  } = useWatchlistPipelineSources({ enabled: appMode === "hosted" || permissions.watchlist });
  const searchPresetProps = usePipelineSearchPresets({ enabled: true });
  const statusQuery = useQuery({
    queryKey: queryKeys.pipeline.status(),
    queryFn: api.getPipelineStatus,
    refetchInterval: 60_000,
  });

  const handleSave = useCallback(
    async (values: AutomaticRunValues) => {
      try {
        const request = await prepareAutomaticSearch({
          values,
          pipelineSources,
          watchlistSelectedSourceIds: selectedWatchlistSourceIds,
          refreshSettings,
        });
        if (!request) return;
        await api.saveScheduledSearch({
          topN: request.topN,
          minSuitabilityScore: request.minSuitabilityScore,
          sources: request.sources,
          runBudget: request.runBudget,
          searchTerms: request.searchTerms,
          scoringInstructions: request.scoringInstructions,
          country: request.country,
          cityLocations: request.cityLocations,
          proximity: request.locationMode === "radius" ? request.proximity : null,
          workplaceTypes: request.workplaceTypes,
          searchScope: request.searchScope,
          matchStrictness: request.matchStrictness,
          watchlistSelectedSourceIds: request.watchlistSelectedSourceIds,
        });
        toast.success("Daily search saved", {
          description: "The next daily run will use these sources and filters.",
        });
      } catch (error) {
        showErrorToast(error, "Failed to save daily search");
      }
    },
    [pipelineSources, refreshSettings, selectedWatchlistSourceIds],
  );

  return (
    <>
      <PageHeader
        icon={CalendarClock}
        title="Daily search"
        subtitle={describeNextRun(statusQuery.data?.nextScheduledRun) || "Your daily job search"}
      />
      <main className="min-h-[calc(100dvh-6rem)]">
        <OrchestratorSearchComposer
          mode="daily"
          settings={settings ?? null}
          enabledSources={enabledSources}
          pipelineSources={pipelineSources}
          onToggleSource={toggleSource}
          onSetPipelineSources={setPipelineSources}
          watchlistSources={watchlistSources}
          selectedWatchlistSourceIds={selectedWatchlistSourceIds}
          onToggleWatchlistSource={toggleWatchlistSource}
          onSetSelectedWatchlistSourceIds={setSelectedWatchlistSourceIds}
          isWatchlistSourcesLoading={isWatchlistSourcesLoading}
          isPipelineRunning={false}
          onSaveAndRunAutomatic={handleSave}
          {...searchPresetProps}
        />
      </main>
    </>
  );
};
