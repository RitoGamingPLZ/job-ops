import type {
  AppSettings,
  JobSource,
  WatchlistSelectedSource,
  WatchlistSource,
  WatchlistSourceGroup,
  WatchlistSourceScanInput,
  WatchlistSourceScanResponse,
} from "@shared/types";
import type React from "react";
import { AutomaticRunTab } from "./AutomaticRunTab";
import type { AutomaticRunValues } from "./automatic-run";
import type { PipelineSearchPresetComposerProps } from "./usePipelineSearchPresets";
import type { AddCustomWatchlistSourceInput } from "./useWatchlistPipelineSources";

interface OrchestratorSearchComposerProps extends PipelineSearchPresetComposerProps {
  settings: AppSettings | null;
  enabledSources: JobSource[];
  pipelineSources: JobSource[];
  canUseWatchlist?: boolean;
  watchlistSources: WatchlistSelectedSource[];
  watchlistCatalogSources?: WatchlistSource[];
  watchlistGroups?: WatchlistSourceGroup[];
  selectedWatchlistSourceIds: string[];
  isPipelineRunning: boolean;
  onToggleSource: (source: JobSource, checked: boolean) => void;
  onSetPipelineSources: (sources: JobSource[]) => void;
  onToggleWatchlistSource: (sourceId: string, checked: boolean) => void;
  onSetSelectedWatchlistSourceIds: (ids: string[]) => void;
  onApplyWatchlistGroup?: (group: WatchlistSourceGroup) => Promise<void>;
  onAddCustomWatchlistSource?: (input: AddCustomWatchlistSourceInput) => Promise<boolean>;
  onScanWatchlistSource?: (input: WatchlistSourceScanInput) => Promise<WatchlistSourceScanResponse>;
  isMutatingWatchlist?: boolean;
  isWatchlistSourcesLoading: boolean;
  onSaveAndRunAutomatic: (values: AutomaticRunValues) => Promise<void>;
  /** "daily" turns the page into the daily search editor: saving replaces running. */
  mode?: "run" | "daily";
}

export const OrchestratorSearchComposer: React.FC<OrchestratorSearchComposerProps> = ({
  settings,
  enabledSources,
  pipelineSources,
  canUseWatchlist,
  watchlistSources,
  watchlistCatalogSources,
  watchlistGroups,
  selectedWatchlistSourceIds,
  isPipelineRunning,
  onToggleSource,
  onSetPipelineSources,
  onToggleWatchlistSource,
  onSetSelectedWatchlistSourceIds,
  onApplyWatchlistGroup,
  onAddCustomWatchlistSource,
  onScanWatchlistSource,
  isMutatingWatchlist,
  isWatchlistSourcesLoading,
  onSaveAndRunAutomatic,
  mode,
  savedSearches,
  isSavedSearchesLoading,
  onCreateSavedSearch,
  onUpdateSavedSearch,
  onDeleteSavedSearch,
  onApplySavedSearch,
}) => {
  if (!settings) return null;

  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <AutomaticRunTab
        open
        settings={settings}
        enabledSources={enabledSources}
        pipelineSources={pipelineSources}
        onToggleSource={onToggleSource}
        onSetPipelineSources={onSetPipelineSources}
        canUseWatchlist={canUseWatchlist}
        watchlistSources={watchlistSources}
        watchlistCatalogSources={watchlistCatalogSources}
        watchlistGroups={watchlistGroups}
        selectedWatchlistSourceIds={selectedWatchlistSourceIds}
        onToggleWatchlistSource={onToggleWatchlistSource}
        onSetSelectedWatchlistSourceIds={onSetSelectedWatchlistSourceIds}
        onApplyWatchlistGroup={onApplyWatchlistGroup}
        onAddCustomWatchlistSource={onAddCustomWatchlistSource}
        onScanWatchlistSource={onScanWatchlistSource}
        isMutatingWatchlist={isMutatingWatchlist}
        isWatchlistSourcesLoading={isWatchlistSourcesLoading}
        isPipelineRunning={isPipelineRunning}
        onSaveAndRun={onSaveAndRunAutomatic}
        mode={mode}
        savedSearches={savedSearches}
        isSavedSearchesLoading={isSavedSearchesLoading}
        onCreateSavedSearch={onCreateSavedSearch}
        onUpdateSavedSearch={onUpdateSavedSearch}
        onDeleteSavedSearch={onDeleteSavedSearch}
        onApplySavedSearch={onApplySavedSearch}
      />
    </section>
  );
};
