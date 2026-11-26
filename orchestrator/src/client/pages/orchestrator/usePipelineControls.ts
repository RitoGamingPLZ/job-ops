import * as api from "@client/api";
import type { ManualImportResult } from "@client/components/ManualImportFlow";
import { useSettings } from "@client/hooks/useSettings";
import {
  type AppSettings,
  type JobSource,
  type LocationInputMode,
  type LocationProximity,
} from "@shared/types.js";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { showErrorToast } from "@/client/lib/error-toast";
import { trackProductEvent } from "@/lib/analytics";
import type { AutomaticRunValues } from "./automatic-run";
import { prepareAutomaticSearch } from "./prepareAutomaticSearch";

type UsePipelineControlsArgs = {
  isPipelineRunning: boolean;
  setIsPipelineRunning: (value: boolean) => void;
  pipelineTerminalEvent: { status: string; errorMessage: string | null } | null;
  pipelineSources: JobSource[];
  watchlistSelectedSourceIds?: string[];
  loadJobs: () => Promise<void>;
  navigateWithContext: (newTab: string, newJobId?: string | null, isReplace?: boolean) => void;
};

export type UsePipelineControlsResult = {
  isRunModeModalOpen: boolean;
  setIsRunModeModalOpen: (open: boolean) => void;
  isCancelling: boolean;
  openSearch: () => void;
  handleCancelPipeline: () => Promise<void>;
  handleSaveAndRunAutomatic: (values: AutomaticRunValues) => Promise<void>;
  handleManualImported: (result: ManualImportResult) => Promise<void>;
  refreshSettings: () => Promise<AppSettings | null>;
};

export function usePipelineControls(args: UsePipelineControlsArgs): UsePipelineControlsResult {
  const {
    isPipelineRunning,
    setIsPipelineRunning,
    pipelineTerminalEvent,
    pipelineSources,
    watchlistSelectedSourceIds,
    loadJobs,
    navigateWithContext,
  } = args;

  const [isRunModeModalOpen, setIsRunModeModalOpen] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  const { refreshSettings } = useSettings();

  useEffect(() => {
    if (!pipelineTerminalEvent) return;
    setIsPipelineRunning(false);
    setIsCancelling(false);

    if (pipelineTerminalEvent.status === "cancelled") {
      trackProductEvent("jobs_pipeline_run_finished", {
        status: "cancelled",
        had_error_message: false,
      });
      toast.message("Search cancelled");
      return;
    }

    if (pipelineTerminalEvent.status === "failed") {
      trackProductEvent("jobs_pipeline_run_finished", {
        status: "failed",
        had_error_message: Boolean(pipelineTerminalEvent.errorMessage),
      });
      toast.error(pipelineTerminalEvent.errorMessage || "Search failed");
      return;
    }

    trackProductEvent("jobs_pipeline_run_finished", {
      status: "completed",
      had_error_message: false,
    });
    toast.success("Search completed");
  }, [pipelineTerminalEvent, setIsPipelineRunning]);

  const openSearch = useCallback(() => setIsRunModeModalOpen(true), []);

  const startPipelineRun = useCallback(
    async (config: {
      topN: number;
      minSuitabilityScore: number;
      sources: JobSource[];
      runBudget: number;
      searchTerms: string[];
      scoringInstructions: string;
      country: string;
      cityLocations: string[];
      locationMode: LocationInputMode;
      proximity: LocationProximity | null;
      workplaceTypes: Array<"remote" | "hybrid" | "onsite">;
      searchScope: AutomaticRunValues["searchScope"];
      matchStrictness: AutomaticRunValues["matchStrictness"];
      watchlistSelectedSourceIds?: string[];
    }) => {
      try {
        setIsPipelineRunning(true);
        setIsCancelling(false);
        await api.runPipeline({
          topN: config.topN,
          minSuitabilityScore: config.minSuitabilityScore,
          sources: config.sources,
          runBudget: config.runBudget,
          searchTerms: config.searchTerms,
          scoringInstructions: config.scoringInstructions,
          country: config.country,
          cityLocations: config.cityLocations,
          proximity: config.locationMode === "radius" ? config.proximity : null,
          workplaceTypes: config.workplaceTypes,
          searchScope: config.searchScope,
          matchStrictness: config.matchStrictness,
          watchlistSelectedSourceIds: config.watchlistSelectedSourceIds,
        });
        toast.message("Search started", {
          description: `Sources: ${config.sources.join(", ")}. This may take a few minutes.`,
        });
      } catch (error) {
        setIsPipelineRunning(false);
        setIsCancelling(false);
        showErrorToast(error, "Failed to start search");
      }
    },
    [setIsPipelineRunning],
  );

  const handleCancelPipeline = useCallback(async () => {
    if (isCancelling || !isPipelineRunning) return;

    try {
      setIsCancelling(true);
      trackProductEvent("jobs_pipeline_run_cancel_requested", {
        was_running: isPipelineRunning,
      });
      const result = await api.cancelPipeline();
      toast.message(result.message);
    } catch (error) {
      setIsCancelling(false);
      showErrorToast(error, "Failed to cancel search");
    }
  }, [isCancelling, isPipelineRunning]);

  const handleSaveAndRunAutomatic = useCallback(
    async (values: AutomaticRunValues) => {
      try {
        const request = await prepareAutomaticSearch({
          values,
          pipelineSources,
          watchlistSelectedSourceIds,
          refreshSettings,
        });
        if (!request) return;
        await startPipelineRun(request);
        setIsRunModeModalOpen(false);
      } catch (error) {
        showErrorToast(error, "Failed to start search");
      }
    },
    [pipelineSources, refreshSettings, startPipelineRun, watchlistSelectedSourceIds],
  );

  const handleManualImported = useCallback(
    async (imported: ManualImportResult) => {
      trackProductEvent("jobs_manual_import_completed", {
        manual_import_source: imported.source,
        manual_import_source_host: imported.sourceHost ?? undefined,
      });
      await loadJobs();
      navigateWithContext("ready", imported.jobId);
    },
    [loadJobs, navigateWithContext],
  );

  return {
    isRunModeModalOpen,
    setIsRunModeModalOpen,
    isCancelling,
    openSearch,
    handleCancelPipeline,
    handleSaveAndRunAutomatic,
    handleManualImported,
    refreshSettings,
  };
}
