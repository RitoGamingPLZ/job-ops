import type { ExtractorSourceId } from "../extractors";
import type { LocationEvidence, LocationMatchResult } from "./location";
import type { WatchlistScanOutcome } from "./watchlist-scan";

export type { LocationEvidenceQuality } from "./location";
export type { WatchlistScanOutcome } from "./watchlist-scan";

export type JobLocationEvidence = LocationEvidence;

export type JobStatus =
  | "discovered" // Crawled but not processed
  | "processing" // Currently generating resume
  | "ready" // PDF generated, waiting for user to apply
  | "applied" // Application sent
  | "in_progress" // In process beyond initial application
  | "skipped" // User skipped this job
  | "expired"; // Deadline passed

export const APPLICATION_STAGES = [
  "applied",
  "recruiter_screen",
  "assessment",
  "hiring_manager_screen",
  "technical_interview",
  "behavioural",
  "onsite",
  "offer",
  "closed",
] as const;

export type ApplicationStage = (typeof APPLICATION_STAGES)[number];

export const STAGE_LABELS: Record<ApplicationStage, string> = {
  applied: "Applied",
  recruiter_screen: "Recruiter Screen",
  assessment: "Assessment",
  hiring_manager_screen: "Team Match",
  technical_interview: "Technical Interview",
  onsite: "Final Round",
  offer: "Offer",
  behavioural: "Behaviour Question",
  closed: "Reject",
};

export const BOARD_COLUMNS = [
  "targeted",
  "applied",
  "recruiter_screen",
  "technical_interview",
  "behavioural",
  "hiring_manager_screen",
  "offer",
  "closed",
] as const;

export type BoardColumn = (typeof BOARD_COLUMNS)[number];

export const BOARD_COLUMN_LABELS: Record<BoardColumn, string> = {
  targeted: "Targeted",
  applied: STAGE_LABELS.applied,
  recruiter_screen: STAGE_LABELS.recruiter_screen,
  technical_interview: STAGE_LABELS.technical_interview,
  behavioural: STAGE_LABELS.behavioural,
  hiring_manager_screen: STAGE_LABELS.hiring_manager_screen,
  offer: STAGE_LABELS.offer,
  closed: STAGE_LABELS.closed,
};

export function boardColumnForStage(s: ApplicationStage): BoardColumn {
  return s === "assessment" || s === "onsite" ? "technical_interview" : s;
}

export function technicalRound(
  events: (Pick<StageEvent, "toStage"> & Partial<Pick<StageEvent, "metadata">>)[],
): number {
  return events.filter(
    (event) =>
      boardColumnForStage(event.toStage) === "technical_interview" &&
      event.metadata?.eventType !== "note",
  ).length;
}

export function isTargeted(j: Pick<JobListItem, "status" | "readyAt">): boolean {
  return (
    j.readyAt != null &&
    (j.status === "discovered" || j.status === "processing" || j.status === "ready")
  );
}

export type StageTransitionTarget = ApplicationStage | "no_change";

export const APPLICATION_OUTCOMES = [
  "offer_accepted",
  "offer_declined",
  "rejected",
  "withdrawn",
  "no_response",
  "ghosted",
] as const;

export type JobOutcome = (typeof APPLICATION_OUTCOMES)[number];

export interface StageEventMetadata {
  note?: string | null;
  actor?: "system" | "user";
  groupId?: string | null;
  groupLabel?: string | null;
  eventLabel?: string | null;
  externalUrl?: string | null;
  reasonCode?: string | null;
  eventType?: "interview_log" | "status_update" | "note" | null;
}

export interface StageEvent {
  id: string;
  applicationId: string;
  title: string;
  groupId: string | null;
  fromStage: ApplicationStage | null;
  toStage: ApplicationStage;
  occurredAt: number;
  metadata: StageEventMetadata | null;
  outcome: JobOutcome | null;
}

export interface JobNote {
  id: string;
  jobId: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface JobDocument {
  id: string;
  jobId: string;
  fileName: string;
  mediaType: string | null;
  byteSize: number;
  createdAt: string;
  updatedAt: string;
}

export type JobSource = ExtractorSourceId | (string & {});

export type JobPdfSource = "generated" | "uploaded";
export type JobPdfFreshness = "missing" | "uploaded" | "current" | "stale" | "regenerating";

export interface AppliedDuplicateMatch {
  jobId: string;
  title: string;
  employer: string;
  appliedAt: string;
  score: number;
  titleScore: number;
  employerScore: number;
}

export interface JobBrief {
  role_summary: string;
  they_want: string[];
  specifics: string[];
  company_offers: string[];
  practical_details: string[];
  missing_or_unclear: string[];
  repeated_signals: string[];
}

export interface Job {
  id: string;

  // Source / provenance
  source: JobSource;
  sourceJobId: string | null; // External ID (if provided)
  jobUrlDirect: string | null; // Source-provided direct URL (if provided)
  datePosted: string | null; // Source-provided posting date (if provided)

  // From crawler (normalized)
  title: string;
  employer: string;
  employerUrl: string | null;
  jobUrl: string; // Job listing URL
  applicationLink: string | null; // Actual application URL
  disciplines: string | null;
  deadline: string | null;
  salary: string | null;
  location: string | null;
  locationEvidence: JobLocationEvidence | null;
  locationMatch?: LocationMatchResult | null;
  degreeRequired: string | null;
  starting: string | null;
  jobDescription: string | null;

  // Orchestrator enrichments
  status: JobStatus;
  outcome: JobOutcome | null;
  closedAt: number | null;
  generationError: string | null; // Last resume-generation failure message; cleared on the next successful run
  suitabilityScore: number | null; // 0-100 AI-generated score
  suitabilityReason: string | null; // AI explanation
  jobBrief: string | null; // Generated JD brief (JSON)
  tailoredSummary: string | null; // Generated resume summary
  tailoredHeadline: string | null; // Generated resume headline
  tailoredSkills: string | null; // Generated resume skills (JSON)
  selectedProjectIds: string | null; // Comma-separated IDs of selected projects
  pdfPath: string | null; // Path to generated PDF
  pdfSource: JobPdfSource | null; // Whether PDF was system-generated or user-uploaded
  pdfRegenerating: boolean; // Whether a PDF generation/regeneration is currently in progress for this job
  pdfFreshness: JobPdfFreshness; // Derived freshness state for the current PDF artifact
  pdfFingerprint: string | null; // Stable hash of inputs that produced the current generated PDF
  pdfGeneratedAt: string | null; // Timestamp of the latest generated/uploaded PDF artifact
  appliedDuplicateMatch?: AppliedDuplicateMatch | null; // Included on detail responses and may be omitted on list responses

  // JobSpy fields (nullable for non-JobSpy sources)
  jobType: string | null;
  salarySource: string | null;
  salaryInterval: string | null;
  salaryMinAmount: number | null;
  salaryMaxAmount: number | null;
  salaryCurrency: string | null;
  isRemote: boolean | null;
  jobLevel: string | null;
  jobFunction: string | null;
  listingType: string | null;
  emails: string | null;
  companyIndustry: string | null;
  companyLogo: string | null;
  companyUrlDirect: string | null;
  companyAddresses: string | null;
  companyNumEmployees: string | null;
  companyRevenue: string | null;
  companyDescription: string | null;
  skills: string | null;
  experienceRange: string | null;
  companyRating: number | null;
  companyReviewsCount: number | null;
  vacancyCount: number | null;
  workFromHomeType: string | null;

  // Timestamps
  discoveredAt: string;
  processedAt: string | null;
  readyAt: string | null;
  appliedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type JobListItem = Pick<
  Job,
  | "id"
  | "source"
  | "sourceJobId"
  | "title"
  | "employer"
  | "jobUrl"
  | "applicationLink"
  | "datePosted"
  | "deadline"
  | "salary"
  | "location"
  | "status"
  | "outcome"
  | "closedAt"
  | "generationError"
  | "suitabilityScore"
  | "appliedDuplicateMatch"
  | "jobType"
  | "jobFunction"
  | "pdfRegenerating"
  | "pdfFreshness"
  | "salaryMinAmount"
  | "salaryMaxAmount"
  | "salaryCurrency"
  | "discoveredAt"
  | "readyAt"
  | "appliedAt"
  | "updatedAt"
>;

export interface CreateJobInput {
  source: JobSource;
  title: string;
  employer: string;
  employerUrl?: string;
  jobUrl: string;
  applicationLink?: string;
  disciplines?: string;
  deadline?: string;
  salary?: string;
  location?: string;
  locationEvidence?: JobLocationEvidence;
  degreeRequired?: string;
  starting?: string;
  jobDescription?: string;

  // JobSpy fields (optional)
  sourceJobId?: string;
  jobUrlDirect?: string;
  datePosted?: string;
  jobType?: string;
  salarySource?: string;
  salaryInterval?: string;
  salaryMinAmount?: number;
  salaryMaxAmount?: number;
  salaryCurrency?: string;
  isRemote?: boolean;
  jobLevel?: string;
  jobFunction?: string;
  listingType?: string;
  emails?: string;
  companyIndustry?: string;
  companyLogo?: string;
  companyUrlDirect?: string;
  companyAddresses?: string;
  companyNumEmployees?: string;
  companyRevenue?: string;
  companyDescription?: string;
  skills?: string;
  experienceRange?: string;
  companyRating?: number;
  companyReviewsCount?: number;
  vacancyCount?: number;
  workFromHomeType?: string;
}

export interface ManualJobDraft {
  source?: JobSource;
  sourceJobId?: string;
  title?: string;
  employer?: string;
  jobUrl?: string;
  applicationLink?: string;
  location?: string;
  salary?: string;
  deadline?: string;
  jobDescription?: string;
  jobType?: string;
  jobLevel?: string;
  jobFunction?: string;
  disciplines?: string;
  degreeRequired?: string;
  starting?: string;
}

export interface ManualJobInferenceResponse {
  job: ManualJobDraft;
  warning?: string | null;
}

export interface ManualJobFetchResponse {
  content: string;
  url: string;
}

export interface WatchlistJobState {
  source: JobSource;
  sourceJobId: string;
  state: "ignored" | "moved_to_workspace";
  createdAt: string;
  updatedAt: string;
}

export interface WatchlistJobStatesResponse {
  states: WatchlistJobState[];
}

export interface WatchlistCheck {
  source: JobSource;
  sourceJobIds: string[];
}

export interface WatchlistCheckInput {
  checks: WatchlistCheck[];
}

export interface WatchlistCheckJobDelta {
  source: JobSource;
  sourceJobId: string;
  isNewSinceLastCheck: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface WatchlistCheckResponse {
  previousLastCheckedAt: string | null;
  checkedAt: string;
  jobs: WatchlistCheckJobDelta[];
}

export type WatchedSourceType = "workday" | (string & {});

/**
 * Ratings for a company on a 0-10 scale: work-life balance and pay relative to its industry.
 * `null` means that dimension has not been rated.
 */
export interface WatchlistCompanyRating {
  wlb: number | null;
  salary: number | null;
  /** Where the rating came from, such as "editorial" or "manual". */
  source: string;
  ratedAt: string;
}

export interface WatchlistSource {
  id: string;
  label: string;
  careersUrl: string;
  cxsJobsUrl: string | null;
  sourceType: WatchedSourceType;
  /** Optional user-provided description explaining what roles this board covers. */
  description?: string | null;
  /** Cached public filter suggestion URL generated from a previous scan, when available. */
  suggestedFilterUrl?: string | null;
  /** Short rationale accompanying `suggestedFilterUrl`, when available. */
  suggestedFilterRationale?: string | null;
  /** True when this entry came from the shared database registry rather than bundled config. */
  isShared?: boolean;
  /** Present when the company has an editorial rating. */
  rating?: WatchlistCompanyRating;
}

/** A predefined bundle of catalog sources the user can add to their watchlist in one click. */
export interface WatchlistSourceGroup {
  id: string;
  label: string;
  description: string;
  /** Catalog source ids, already resolved against the live catalog. */
  sourceIds: string[];
}

export const MAX_WATCHLIST_SOURCES = 50;
/** Watchlist sources one search run reads per user; the saved-source limit is higher, the extras wait. */
export const MAX_WATCHLIST_SOURCES_PER_SEARCH = 40;

export interface WatchlistSelectedSource {
  id: string;
  catalogSourceId: string | null;
  label: string;
  careersUrl: string;
  cxsJobsUrl: string | null;
  description?: string | null;
  sourceType: WatchedSourceType;
  isCustom: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface WatchlistSuggestedFilterPlan {
  suggestedUrl: string;
  params: Array<{ key: string; values: string[] }>;
  rationale: string;
  totals: { filtered: number; unfiltered: number };
  sampleTitles: string[];
  reused?: boolean;
}

/**
 * What a filter means on any board, whatever that board calls its parameter (`q`, `query`,
 * `fwp_search`; `loc`, `offices`; `commitment`, `timeType`). Lets the suggester, the filter panel
 * and the user's own search terms line up across boards. Order is the panel's display order.
 */
export const WATCHLIST_CONTROL_ROLES = [
  "keyword",
  "location",
  "workplace",
  "employmentType",
  "department",
  "level",
] as const;
export type WatchlistControlRole = (typeof WATCHLIST_CONTROL_ROLES)[number];
export const WATCHLIST_CONTROL_ROLE_LABELS: Record<WatchlistControlRole, string> = {
  keyword: "Keyword",
  location: "Location",
  workplace: "Workplace",
  employmentType: "Job type",
  department: "Team",
  level: "Level",
};

/** One verified search control of a custom careers site, learned from its public listing. */
export interface WatchlistSearchControl {
  key: string;
  label?: string;
  role?: WatchlistControlRole;
  input: { kind: "text" } | { kind: "choice"; options: Array<{ value: string; label?: string }> };
  /** Whether several choices may be selected at once. */
  multiple: boolean;
}

export type WatchlistSearchControlsResponse =
  | {
      status: "ready";
      controls: WatchlistSearchControl[];
      /** What the source URL already carries, per control key. */
      values: Record<string, string[]>;
    }
  // `learning`: a scan is running. `rescan`: no verified controls yet (see `lastScan` for why a
  // scan did not finish). `none`: the site was scanned and has no static search controls to verify.
  | { status: "learning" | "rescan" | "none" | "unsupported"; lastScan?: WatchlistScanOutcome };

export interface WatchlistSourceScanInput {
  careersUrl: string;
  name?: string | null;
  description?: string | null;
  sourceType?: WatchedSourceType | null;
  forceRefresh?: boolean;
}

export interface WatchlistSourceScanResponse {
  source: WatchlistSource;
  reusedSource: boolean;
  reusedScrapingPlan: boolean;
  reusedFilterPlan: boolean;
  scrapingStatus: "native_adapter" | "ready" | "learning" | "unavailable";
  filterPlan: WatchlistSuggestedFilterPlan | null;
  filterNote: string | null;
}

export interface WatchlistSourcesResponse {
  catalogSources: WatchlistSource[];
  groups?: WatchlistSourceGroup[];
  selectedSources: WatchlistSelectedSource[];
  availableSourceTypes: WatchlistSourceTypeDescriptor[];
}

export interface WatchlistSourceTypeDescriptor {
  sourceType: WatchedSourceType;
  label: string;
  catalogLabel: string;
  customSourceOptionLabel: string;
  customSourceSearchText: string;
  customSourceInputLabel: string;
  customSourcePlaceholder: string;
  customSourceHelpText: string;
  emptyCatalogText: string;
  fetchingLabel: string;
  invalidUrlMessage: string;
  supportsCustomSource: boolean;
  supportsBranding: boolean;
}

export type WatchlistRowState = "new" | "ignored" | "moved_to_workspace";

export interface WatchlistWorkspaceJobReference {
  id: string;
  status: JobStatus;
}

export interface WatchlistJobResult {
  jobRef: string;
  source: JobSource;
  sourceJobId: string;
  sourceType: WatchedSourceType;
  title: string;
  employer: string;
  jobUrl: string;
  applicationLink: string | null;
  location: string | null;
  postedAt: string | null;
  rowState: WatchlistRowState;
  isNewSinceLastCheck: boolean;
  workspaceJob: WatchlistWorkspaceJobReference | null;
}

export type WatchlistSourceResult =
  | {
      status: "success";
      source: WatchlistSelectedSource;
      jobs: WatchlistJobResult[];
      total: number;
      fetched: number;
    }
  | {
      status: "error";
      source: WatchlistSelectedSource;
      error: string;
      pending?: boolean;
    };

export interface WatchlistResultsResponse {
  checkedAt: string | null;
  previousLastCheckedAt: string | null;
  sources: WatchlistSourceResult[];
  pendingSourceIds?: string[];
}

export interface WatchlistImportDraftInput {
  selectedSourceId: string;
  jobRef: string;
}

export interface WatchlistImportDraftResponse {
  draft: ManualJobDraft;
  source: string | null;
  sourceHost: string | null;
  sourceType: WatchedSourceType;
  catalogSourceId: string | null;
  careersUrl: string;
}

export interface WatchlistJobDetailsInput {
  selectedSourceId: string;
  jobRef: string;
}

export interface WatchlistJobDetailsResponse {
  jobRef: string;
  jobUrl: string;
  descriptionHtml: string;
}

export interface WatchlistSourceBrandingInput {
  selectedSourceId?: string | null;
  sourceType: WatchedSourceType;
  careersUrl: string;
}

export interface WatchlistSourceBrandingResponse {
  careersUrl: string;
  logoUrl: string;
  mimeType: string;
  imageDataUrl: string;
}

export interface UpdateWatchlistSelectionsInput {
  selections: Array<{
    catalogSourceId?: string | null;
    sourceType: WatchedSourceType;
    label?: string | null;
    careersUrl: string;
    description?: string | null;
  }>;
}

export interface UpdateJobInput {
  title?: string;
  employer?: string;
  jobUrl?: string;
  applicationLink?: string | null;
  disciplines?: string | null;
  location?: string | null;
  salary?: string | null;
  deadline?: string | null;
  degreeRequired?: string | null;
  starting?: string | null;
  jobType?: string | null;
  salarySource?: string | null;
  salaryInterval?: string | null;
  salaryMinAmount?: number | null;
  salaryMaxAmount?: number | null;
  salaryCurrency?: string | null;
  isRemote?: boolean | null;
  jobLevel?: string | null;
  jobFunction?: string | null;
  companyIndustry?: string | null;
  skills?: string | null;
  experienceRange?: string | null;
  vacancyCount?: number | null;
  workFromHomeType?: string | null;
  status?: JobStatus;
  outcome?: JobOutcome | null;
  closedAt?: number | null;
  jobDescription?: string | null;
  locationEvidence?: JobLocationEvidence | null;
  generationError?: string | null;
  suitabilityScore?: number | null;
  suitabilityReason?: string;
  jobBrief?: string | null;
  tailoredSummary?: string;
  tailoredHeadline?: string;
  tailoredSkills?: string;
  selectedProjectIds?: string;
  pdfPath?: string;
  pdfSource?: JobPdfSource | null;
  pdfRegenerating?: boolean;
  pdfFingerprint?: string | null;
  pdfGeneratedAt?: string | null;
  readyAt?: string | null;
  appliedAt?: string;
}

export interface CreateJobNoteInput {
  title: string;
  content: string;
}

export interface UpdateJobNoteInput {
  title: string;
  content: string;
}
