import { bamboohrUrlToCompanyLabel, parseBamboohrUrl } from "@career-boards/bamboohr";
import {
  parseWorkdayUrl,
  workdayUrlToCompanyLabel,
  workdayUrlToSourceKey,
} from "@career-boards/workday";
import { matchJobLocationIntent } from "@shared/job-matching.js";
import type { LocationIntent } from "@shared/location-intelligence.js";
import { normalizeCountryKey } from "@shared/location-support.js";
import type {
  JobListItem,
  WatchedSourceType,
  WatchlistJobResult,
  WatchlistSource,
  WatchlistSourceTypeDescriptor,
} from "@shared/types.js";
import { computeJobMatchScore } from "../orchestrator/JobCommandBar.utils";
import type { RankedWatchlistJob, SourceSelectionDraft } from "./types";

export const CUSTOM_SOURCE_VALUE = "__custom__";

let sourceDraftSequence = 0;

export function getDefaultCustomWatchlistSourceType(
  sourceTypes: ReadonlyArray<
    Pick<WatchlistSourceTypeDescriptor, "sourceType" | "supportsCustomSource">
  >,
): WatchedSourceType {
  if (sourceTypes.some((type) => type.sourceType === "careers_site" && type.supportsCustomSource)) {
    return "careers_site";
  }
  const firstCustom = sourceTypes.find((type) => type.supportsCustomSource);
  return firstCustom?.sourceType ?? sourceTypes[0]?.sourceType ?? "careers_site";
}

export function createSourceDraft(
  overrides?: Partial<Omit<SourceSelectionDraft, "id">>,
): SourceSelectionDraft {
  sourceDraftSequence += 1;
  return {
    id: `draft-${sourceDraftSequence}`,
    isCustom: false,
    sourceType: "workday",
    catalogSourceId: null,
    customUrl: "",
    customLabel: "",
    description: "",
    ...overrides,
  };
}

export function getWatchlistBaseUrlMatchKey(careersUrl: string): string {
  const trimmed = careersUrl.trim();
  if (!trimmed) return "";

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${host}${pathname}`.toLowerCase();
  } catch {
    return trimmed
      .toLowerCase()
      .replace(/^https?:\/\/(www\.)?/, "")
      .replace(/[?#].*$/, "")
      .replace(/\/+$/, "");
  }
}

function getEmployerFromCareersUrl(careersUrl: string): string {
  try {
    const host = new URL(careersUrl).hostname;
    const [tenant] = host.split(".");
    return tenant || host;
  } catch {
    return "Careers";
  }
}

export function getNormalizedWatchlistCareersUrl(
  sourceType: WatchedSourceType,
  careersUrl: string,
): string {
  const trimmed = careersUrl.trim();
  if (!trimmed) return "";

  try {
    if (sourceType === "bamboohr") {
      return parseBamboohrUrl(trimmed).canonicalCareersUrl;
    }
    if (sourceType === "workday") {
      return parseWorkdayUrl(trimmed).canonicalCareersUrl;
    }
  } catch {
    return trimmed;
  }

  return trimmed;
}

function getCompanyKey(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function getCareersUrlKey(sourceType: WatchedSourceType, careersUrl: string): string {
  return getNormalizedWatchlistCareersUrl(sourceType, careersUrl)
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
}

/**
 * Ids of catalog sources the draft list already covers. A source counts as covered when
 * it is the same catalog entry, points at the same careers URL (so a custom URL matches
 * its catalog twin), or belongs to the same company on another adapter, such as Stripe on
 * both Greenhouse and its own careers site.
 */
export function getCoveredCatalogSourceIds(
  drafts: ReadonlyArray<Pick<SourceSelectionDraft, "catalogSourceId" | "sourceType" | "customUrl">>,
  catalogSources: ReadonlyArray<WatchlistSource>,
): Set<string> {
  const urlKeyToCompany = new Map<string, string>();
  const companyById = new Map<string, string>();
  for (const source of catalogSources) {
    const company = getCompanyKey(source.label);
    companyById.set(source.id, company);
    urlKeyToCompany.set(getCareersUrlKey(source.sourceType, source.careersUrl), company);
  }

  const coveredCompanies = new Set<string>();
  const coveredUrls = new Set<string>();
  const coveredIds = new Set<string>();
  for (const draft of drafts) {
    if (draft.catalogSourceId !== null) {
      coveredIds.add(draft.catalogSourceId);
      const company = companyById.get(draft.catalogSourceId);
      if (company) coveredCompanies.add(company);
      continue;
    }
    const urlKey = getCareersUrlKey(draft.sourceType, draft.customUrl);
    if (!urlKey) continue;
    coveredUrls.add(urlKey);
    const company = urlKeyToCompany.get(urlKey);
    if (company) coveredCompanies.add(company);
  }

  const covered = new Set<string>(coveredIds);
  for (const source of catalogSources) {
    if (
      coveredCompanies.has(companyById.get(source.id) ?? "") ||
      coveredUrls.has(getCareersUrlKey(source.sourceType, source.careersUrl))
    ) {
      covered.add(source.id);
    }
  }
  return covered;
}

export function getWatchlistSelectionIdentityKey(selection: {
  catalogSourceId: string | null;
  sourceType: WatchedSourceType;
  careersUrl: string;
}): string {
  return JSON.stringify({
    catalogSourceId: selection.catalogSourceId,
    sourceType: selection.sourceType,
    careersUrl: getNormalizedWatchlistCareersUrl(selection.sourceType, selection.careersUrl),
  });
}

export function getWatchlistPreviewLabel(
  sourceType: WatchedSourceType,
  careersUrl: string,
): string {
  const normalizedCareersUrl = getNormalizedWatchlistCareersUrl(sourceType, careersUrl);
  if (!normalizedCareersUrl) return "Custom source";

  try {
    if (sourceType === "bamboohr") {
      return bamboohrUrlToCompanyLabel(normalizedCareersUrl);
    }
    if (sourceType === "workday") {
      return workdayUrlToCompanyLabel(normalizedCareersUrl);
    }
  } catch {
    return formatFallbackEmployerLabel(normalizedCareersUrl);
  }

  return formatFallbackEmployerLabel(normalizedCareersUrl);
}

function toJobListItem(job: WatchlistJobResult): JobListItem {
  const now = new Date().toISOString();

  return {
    id: `${job.source}:${job.sourceJobId}`,
    source: "manual",
    sourceJobId: null,
    title: job.title,
    employer: job.employer,
    jobUrl: job.jobUrl,
    applicationLink: job.applicationLink,
    datePosted: job.postedAt,
    deadline: null,
    salary: null,
    location: job.location,
    status: "discovered",
    outcome: null,
    closedAt: null,
    generationError: null,
    suitabilityScore: null,
    appliedDuplicateMatch: null,
    jobType: null,
    jobFunction: null,
    pdfRegenerating: false,
    pdfFreshness: "missing",
    salaryMinAmount: null,
    salaryMaxAmount: null,
    salaryCurrency: null,
    discoveredAt: now,
    readyAt: null,
    appliedAt: null,
    updatedAt: now,
  };
}

function getPipelineSearchMatch(
  job: JobListItem,
  searchTerms: string[],
): { score: number; term: string | null } {
  let best = { score: 0, term: null as string | null };

  for (const term of searchTerms) {
    const normalizedTerm = term.trim().toLowerCase();
    if (!normalizedTerm) continue;

    const score = computeJobMatchScore(job, normalizedTerm);
    if (score > best.score) {
      best = { score, term };
    }
  }

  return best;
}

export function normalizeUiCountryKey(value: string): string {
  const normalized = normalizeCountryKey(value);
  if (normalized === "usa/ca") return "united states";
  return normalized;
}

export function getWatchlistSourceKey(value: string): string {
  try {
    return workdayUrlToSourceKey(value);
  } catch {
    return "workday:unknown:unknown";
  }
}

function formatFallbackEmployerLabel(careersUrl: string): string {
  const employer = getEmployerFromCareersUrl(careersUrl).trim();
  if (!employer) return "Custom source";
  return employer.length <= 3
    ? employer.toUpperCase()
    : employer.replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatWatchlistCheckTimestamp(value: string | null): string | null {
  if (!value) return null;

  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export function getWorkspaceJobPath(job: { id: string; status: string }): string {
  const tab =
    job.status === "discovered"
      ? "discovered"
      : job.status === "applied" || job.status === "in_progress"
        ? "applied"
        : "ready";
  return `/jobs/${tab}/${job.id}`;
}

export function rankWatchlistJobs(
  jobs: WatchlistJobResult[],
  searchTerms: string[],
  locationIntent: LocationIntent,
): RankedWatchlistJob[] {
  const hasSelectedLocation = Boolean(locationIntent.selectedCountry);

  return jobs
    .map((watchlistJob, index) => {
      const job = toJobListItem(watchlistJob);
      const match = getPipelineSearchMatch(job, searchTerms);
      const locationMatch = hasSelectedLocation
        ? matchJobLocationIntent(
            {
              location: job.location,
              locationEvidence: null,
              isRemote: /(?:^|\b)remote(?:\b|$)/i.test(job.location ?? ""),
            },
            locationIntent,
          )
        : { matched: false, priority: 0 as const };

      return {
        watchlistJob,
        job,
        matchScore: match.score,
        matchedSearchTerm: match.term,
        locationPriority: locationMatch.priority,
        locationMatched: locationMatch.matched,
        rowState: watchlistJob.rowState,
        index,
      };
    })
    .sort((left, right) => {
      if (left.matchScore !== right.matchScore) {
        return right.matchScore - left.matchScore;
      }
      if (left.locationPriority !== right.locationPriority) {
        return right.locationPriority - left.locationPriority;
      }
      if (left.locationMatched !== right.locationMatched) {
        return left.locationMatched ? -1 : 1;
      }
      return left.index - right.index;
    });
}
