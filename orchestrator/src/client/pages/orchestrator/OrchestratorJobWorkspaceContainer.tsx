import { KeyboardShortcutBar } from "@client/components/KeyboardShortcutBar";
import { KeyboardShortcutDialog } from "@client/components/KeyboardShortcutDialog";
import type { Job, JobListItem, JobStatus } from "@shared/types.js";
import { isTargeted } from "@shared/types.js";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { VirtualListHandle } from "@/client/lib/virtual-list";
import { getCompaniesWithJobs } from "./companyFilter";
import type { FilterTab } from "./constants";
import { tabs } from "./constants";
import { FloatingJobActionsBar } from "./FloatingJobActionsBar";
import { OrchestratorJobsWorkspace } from "./OrchestratorJobsWorkspace";
import { OrchestratorMobileJobDrawer } from "./OrchestratorMobileJobDrawer";
import { useFilteredJobs } from "./useFilteredJobs";
import { useJobSelectionActions } from "./useJobSelectionActions";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import type { SelectedJobLoadState } from "./useOrchestratorData";
import type { useOrchestratorFilters } from "./useOrchestratorFilters";
import type { useOrchestratorNavigation } from "./useOrchestratorNavigation";
import type { useOrchestratorUiState } from "./useOrchestratorUiState";
import { useScrollToJobItem } from "./useScrollToJobItem";
import { getJobCounts, getSourcesWithJobs } from "./utils";

interface OrchestratorJobWorkspaceContainerProps {
  jobs: JobListItem[];
  selectedJob: Job | null;
  selectedJobListItem: JobListItem | null;
  selectedJobLoadState: SelectedJobLoadState;
  retrySelectedJob: () => void;
  stats: Record<JobStatus, number>;
  isLoading: boolean;
  isPipelineRunning: boolean;
  loadJobs: (job?: Job) => Promise<void>;
  setIsRefreshPaused: (paused: boolean) => void;
  filters: ReturnType<typeof useOrchestratorFilters>;
  navigation: ReturnType<typeof useOrchestratorNavigation>;
  ui: ReturnType<typeof useOrchestratorUiState>;
  onFindJobs: () => void;
}

export const OrchestratorJobWorkspaceContainer: React.FC<
  OrchestratorJobWorkspaceContainerProps
> = ({
  jobs,
  selectedJob,
  selectedJobListItem,
  selectedJobLoadState,
  retrySelectedJob,
  stats,
  isLoading,
  isPipelineRunning,
  loadJobs,
  setIsRefreshPaused,
  filters,
  navigation,
  ui,
  onFindJobs,
}) => {
  const jobListHandleRef = useRef<VirtualListHandle | null>(null);
  const searchableJobs = useMemo(
    () =>
      navigation.activeTab === "discovered"
        ? jobs.filter((job) => job.status === "discovered" && !isTargeted(job))
        : jobs,
    [jobs, navigation.activeTab],
  );
  const activeJobs = useFilteredJobs(searchableJobs, {
    activeTab: navigation.activeTab,
    dateFilter: filters.dateFilter,
    sourceFilter: filters.sourceFilter,
    companyFilter: filters.companyFilter,
    sponsorFilter: filters.sponsorFilter,
    salaryFilter: filters.salaryFilter,
    scoreFilter: filters.scoreFilter,
    postedWithinDays: filters.postedWithinDays,
    employmentTypes: filters.employmentTypes,
    location: filters.location,
    sort: filters.sort,
  });
  const counts = useMemo(
    () => ({
      ...getJobCounts(jobs),
      discovered: jobs.filter(
        (job) => job.status === "discovered" && !isTargeted(job),
      ).length,
    }),
    [jobs],
  );
  const companiesWithJobs = useMemo(() => getCompaniesWithJobs(jobs), [jobs]);
  const sourcesWithJobs = useMemo(() => getSourcesWithJobs(jobs), [jobs]);
  const handleTabChange = useCallback(
    (newTab: FilterTab) => navigation.setActiveTab(newTab, jobs),
    [jobs, navigation],
  );

  const untargetedDiscoveredJobIdRef = useRef<string | null>(null);
  const selectedTarget = selectedJob ?? selectedJobListItem;
  if (
    navigation.activeTab !== "discovered" ||
    navigation.selectedJobId !== untargetedDiscoveredJobIdRef.current
  ) {
    untargetedDiscoveredJobIdRef.current = null;
  }
  if (
    navigation.activeTab === "discovered" &&
    selectedTarget?.id === navigation.selectedJobId &&
    !isTargeted(selectedTarget)
  ) {
    untargetedDiscoveredJobIdRef.current = selectedTarget.id;
  }
  const redirectTargetedSelection =
    navigation.activeTab === "discovered" &&
    selectedTarget?.id === navigation.selectedJobId &&
    isTargeted(selectedTarget) &&
    untargetedDiscoveredJobIdRef.current !== selectedTarget.id;

  useEffect(() => {
    if (redirectTargetedSelection && selectedTarget) {
      navigation.navigateWithContext("all", selectedTarget.id, true);
    }
  }, [navigation, redirectTargetedSelection, selectedTarget]);

  const visibleSelectedJob = useMemo(() => {
    if (!selectedJob) return null;
    if (
      navigation.activeTab === "discovered" &&
      (selectedJob.status !== "discovered" || isTargeted(selectedJob))
    )
      return null;
    const tabDef = tabs.find((tab) => tab.id === navigation.activeTab);
    if (!tabDef || tabDef.statuses.length === 0) return selectedJob;
    return tabDef.statuses.includes(selectedJob.status) ? selectedJob : null;
  }, [navigation.activeTab, selectedJob]);
  const visibleSelectedJobListItem = useMemo(() => {
    if (!selectedJobListItem) return null;
    if (
      navigation.activeTab === "discovered" &&
      (selectedJobListItem.status !== "discovered" ||
        isTargeted(selectedJobListItem))
    )
      return null;
    const tabDef = tabs.find((tab) => tab.id === navigation.activeTab);
    if (!tabDef || tabDef.statuses.length === 0) return selectedJobListItem;
    return tabDef.statuses.includes(selectedJobListItem.status)
      ? selectedJobListItem
      : null;
  }, [navigation.activeTab, selectedJobListItem]);

  const {
    selectedJobIds,
    canTargetSelected,
    targetSelectedJobs,
    jobActionInFlight,
    toggleSelectJob,
    toggleSelectAll,
    clearSelection,
  } = useJobSelectionActions({
    activeJobs,
    activeTab: navigation.activeTab,
    loadJobs,
  });

  useEffect(() => {
    if (isLoading || filters.sourceFilter === "all") return;
    if (!sourcesWithJobs.includes(filters.sourceFilter)) {
      filters.setSourceFilter("all");
    }
  }, [filters, isLoading, sourcesWithJobs]);

  const handleSelectJob = useCallback(
    (id: string) => {
      navigation.handleSelectJobId(id);
      ui.openDetailDrawerForMobile();
    },
    [navigation, ui],
  );

  const { requestScrollToJob } = useScrollToJobItem({
    activeJobs,
    selectedJobId: navigation.selectedJobId,
    isDesktop: ui.isDesktop,
    onEnsureJobSelected: (id) =>
      navigation.navigateWithContext(navigation.activeTab, id, true),
    listHandleRef: jobListHandleRef,
  });

  useKeyboardShortcuts({
    isAnyModalOpen: ui.isAnyModalOpen,
    isAnyModalOpenExcludingCommandBar: ui.isAnyModalOpenExcludingCommandBar,
    isAnyModalOpenExcludingHelp: ui.isAnyModalOpenExcludingHelp,
    activeTab: navigation.activeTab,
    activeJobs,
    selectedJobId: navigation.selectedJobId,
    selectedJob: visibleSelectedJob,
    selectedJobSummary: visibleSelectedJobListItem,
    selectedJobIds,
    isDesktop: ui.isDesktop,
    handleSelectJobId: navigation.handleSelectJobId,
    requestScrollToJob,
    setActiveTab: handleTabChange,
    setIsCommandBarOpen: ui.setIsCommandBarOpen,
    setIsHelpDialogOpen: ui.setIsHelpDialogOpen,
    clearSelection,
    toggleSelectJob,
    targetSelectedJobs,
    loadJobs,
  });

  const handleCommandSelectJob = useCallback(
    (targetTab: FilterTab, id: string) => {
      requestScrollToJob(id, { ensureSelected: true });
      const job = jobs.find((item) => item.id === id);
      navigation.navigateToCommandJob(
        job && isTargeted(job) ? "all" : targetTab,
        id,
      );
      ui.openDetailDrawerForMobile();
    },
    [jobs, navigation, requestScrollToJob, ui],
  );

  useEffect(() => {
    if (isLoading || redirectTargetedSelection) return;
    if (activeJobs.length === 0) {
      if (navigation.selectedJobId) navigation.handleSelectJobId(null);
      return;
    }
    if (!navigation.selectedJobId && ui.isDesktop) {
      navigation.navigateWithContext(
        navigation.activeTab,
        activeJobs[0].id,
        true,
      );
    }
  }, [
    activeJobs,
    isLoading,
    navigation,
    redirectTargetedSelection,
    ui.isDesktop,
  ]);

  const primaryEmptyStateAction = useMemo(
    () => ({
      label: "Find jobs",
      onClick: onFindJobs,
    }),
    [onFindJobs],
  );

  const emptyStateMessage = useMemo(() => {
    if (filters.dateFilter.dimensions.length === 0) {
      return undefined;
    }

    return "No jobs match the selected date filters.";
  }, [filters.dateFilter.dimensions.length]);

  return (
    <>
      <div className={selectedJobIds.size > 0 ? "pb-24 lg:pb-0" : undefined}>
        <OrchestratorJobsWorkspace
          stats={stats}
          isPipelineRunning={isPipelineRunning}
          jobs={jobs}
          activeJobs={activeJobs}
          selectedJob={visibleSelectedJob}
          selectedJobListItem={visibleSelectedJobListItem}
          selectedJobLoadState={
            visibleSelectedJobListItem ? selectedJobLoadState : "idle"
          }
          selectedJobId={navigation.selectedJobId}
          selectedJobIds={selectedJobIds}
          activeTab={navigation.activeTab}
          counts={counts}
          isDesktop={ui.isDesktop}
          isLoading={isLoading}
          isCommandBarOpen={ui.isCommandBarOpen}
          commandBarEnabled={!ui.isAnyModalOpenExcludingCommandBar}
          companyFilter={filters.companyFilter}
          companiesWithJobs={companiesWithJobs}
          onCompanyFilterChange={filters.setCompanyFilter}
          sourceFilter={filters.sourceFilter}
          sponsorFilter={filters.sponsorFilter}
          salaryFilter={filters.salaryFilter}
          scoreFilter={filters.scoreFilter}
          postedWithinDays={filters.postedWithinDays}
          employmentTypes={filters.employmentTypes}
          locationFilter={filters.location}
          dateFilter={filters.dateFilter}
          sourcesWithJobs={sourcesWithJobs}
          sort={filters.sort}
          filteredCount={activeJobs.length}
          isFiltersOpen={ui.isFiltersOpen}
          jobListHandleRef={jobListHandleRef}
          primaryEmptyStateAction={primaryEmptyStateAction}
          secondaryEmptyStateAction={undefined}
          emptyStateMessage={emptyStateMessage}
          onCommandBarOpenChange={ui.setIsCommandBarOpen}
          onCommandSelectJob={handleCommandSelectJob}
          onTabChange={handleTabChange}
          onFiltersOpenChange={ui.setIsFiltersOpen}
          onSourceFilterChange={filters.setSourceFilter}
          onSponsorFilterChange={filters.setSponsorFilter}
          onSalaryFilterChange={filters.setSalaryFilter}
          onScoreFilterChange={filters.setScoreFilter}
          onPostedWithinChange={filters.setPostedWithinDays}
          onEmploymentTypesChange={filters.setEmploymentTypes}
          onLocationFilterChange={filters.setLocation}
          onDateFilterChange={filters.setDateFilter}
          onSortChange={filters.setSort}
          onResetFilters={filters.resetFilters}
          onSelectJob={handleSelectJob}
          onToggleSelectJob={toggleSelectJob}
          onToggleSelectAll={toggleSelectAll}
          onSelectJobId={navigation.handleSelectJobId}
          onJobUpdated={loadJobs}
          onPauseRefreshChange={setIsRefreshPaused}
          onRetrySelectedJob={retrySelectedJob}
        />
      </div>

      <FloatingJobActionsBar
        selectedCount={selectedJobIds.size}
        canTargetSelected={canTargetSelected}
        jobActionInFlight={jobActionInFlight !== null}
        onTargetSelected={() => void targetSelectedJobs()}
        onClear={clearSelection}
      />

      {!ui.isDesktop && (
        <OrchestratorMobileJobDrawer
          open={ui.isDetailDrawerOpen}
          activeTab={navigation.activeTab}
          activeJobs={activeJobs}
          selectedJob={visibleSelectedJob}
          selectedJobListItem={visibleSelectedJobListItem}
          selectedJobLoadState={
            visibleSelectedJobListItem ? selectedJobLoadState : "idle"
          }
          onOpenChange={ui.onDetailDrawerOpenChange}
          onSelectJobId={navigation.handleSelectJobId}
          onJobUpdated={loadJobs}
          onPauseRefreshChange={setIsRefreshPaused}
          onRetrySelectedJob={retrySelectedJob}
        />
      )}

      <KeyboardShortcutBar activeTab={navigation.activeTab} />
      <KeyboardShortcutDialog
        open={ui.isHelpDialogOpen}
        onOpenChange={ui.onHelpDialogOpenChange}
        activeTab={navigation.activeTab}
      />
    </>
  );
};
