import {
  getJobDetailsFromCxs,
  getJobsFromCxs,
  type NormalizedWorkdayJob,
  parseWorkdayUrl,
  workdayUrlToCompanyLabel,
  workdayUrlToCxsJobsUrl,
  workdayUrlToSourceKey,
} from "@career-boards/workday";
import { upstreamError } from "@infra/errors";
import { detectLogoMimeType } from "@infra/image-mime";
import type { ManualJobDraft, WatchlistSelectedSource } from "@shared/types";
import { z } from "zod";
import type { WatchlistCatalogSourceAdapter } from "./types";

const MAX_JOBS = 60;
const workdaySourceSchema = z.object({
  id: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(200),
  workdayUrl: z.string().trim().url().max(2000),
});

const WORKDAY_LOGO_MAX_BYTES = 1_000_000;

export const workdayWatchlistAdapter: WatchlistCatalogSourceAdapter = {
  sourceType: "workday",
  descriptor: {
    sourceType: "workday",
    label: "Workday",
    catalogLabel: "Workday company",
    customSourceOptionLabel: "Choose your own Workday URL",
    customSourceSearchText: "custom workday url",
    customSourceInputLabel: "Custom Workday URL",
    customSourcePlaceholder: "https://company.wd1.myworkdayjobs.com/...",
    customSourceHelpText:
      "Use the public Workday careers URL, not an individual job posting URL.",
    emptyCatalogText: "No Workday companies found.",
    fetchingLabel: "Fetching from Workday...",
    invalidUrlMessage: "Invalid Workday URL",
    supportsCustomSource: true,
    supportsBranding: true,
  },
  catalogSchema: workdaySourceSchema,
  parseCatalogSources(entries) {
    return z
      .array(workdaySourceSchema)
      .parse(entries)
      .map((entry) => ({
        id: entry.id,
        label: entry.label,
        sourceType: "workday",
        careersUrl: entry.workdayUrl,
        cxsJobsUrl: workdayUrlToCxsJobsUrl(entry.workdayUrl),
      }));
  },
  hydrateSelectedSource(source) {
    return {
      ...source,
      label: getHydratedWorkdayLabel(source),
      cxsJobsUrl: workdayUrlToCxsJobsUrl(source.careersUrl),
    };
  },
  normalizeCustomSelection(input) {
    const canonicalCareersUrl = parseWorkdayUrl(
      input.careersUrl,
    ).canonicalCareersUrl;
    const trimmedLabel = input.label?.trim();
    const label =
      trimmedLabel &&
      trimmedLabel !== input.careersUrl.trim() &&
      trimmedLabel !== canonicalCareersUrl
        ? trimmedLabel
        : workdayUrlToCompanyLabel(canonicalCareersUrl);
    return {
      label,
      careersUrl: canonicalCareersUrl,
    };
  },
  async fetchJobs(input) {
    const cxsJobsUrl = workdayUrlToCxsJobsUrl(input.source.careersUrl);
    const response = await getJobsFromCxs({
      cxsJobsUrl,
      careersUrl: input.source.careersUrl,
      company: input.source.label,
      maxJobs: MAX_JOBS,
      signal: input.signal,
    });
    const source = workdayUrlToSourceKey(cxsJobsUrl);

    return {
      total: response.total,
      fetched: response.fetched,
      jobs: response.jobs.map((job) =>
        normalizeWorkdayJob(input.source, source, job),
      ),
    };
  },
  async fetchJobDetails(input) {
    const details = await getJobDetailsFromCxs({
      jobUrl: input.jobRef,
      signal: input.signal,
    });
    return {
      jobRef: input.jobRef,
      jobUrl: details.job.jobUrl,
      descriptionHtml: details.job.jobDescriptionHtml,
    };
  },
  async prepareImportDraft(input) {
    const details = await getJobDetailsFromCxs({
      jobUrl: input.jobRef,
      signal: input.signal,
    });
    const source = workdayUrlToSourceKey(
      input.source.cxsJobsUrl ?? input.source.careersUrl,
    );
    const draft = buildManualDraftFromWorkdayDetails(
      input.source,
      source,
      details.job,
    );
    return {
      draft,
      source: draft.source ?? null,
      sourceHost:
        getSourceHost(input.source.careersUrl) ?? getSourceHost(input.jobRef),
    };
  },
  async fetchBranding(input) {
    const parsedUrl = parseWorkdayUrl(input.source.careersUrl);
    const logoUrl = `${parsedUrl.canonicalCareersUrl}/assets/logo`;
    const response = await fetch(logoUrl, {
      method: "GET",
      redirect: "follow",
      signal: input.signal,
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch Workday logo with HTTP ${response.status}.`,
      );
    }

    const contentLength = Number(response.headers.get("content-length"));
    if (
      Number.isFinite(contentLength) &&
      contentLength > WORKDAY_LOGO_MAX_BYTES
    ) {
      throw upstreamError("Workday company logo exceeded size limit", {
        url: logoUrl,
        contentLength,
        maxBytes: WORKDAY_LOGO_MAX_BYTES,
      });
    }

    const contentType = response.headers.get("content-type");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > WORKDAY_LOGO_MAX_BYTES) {
      throw upstreamError("Workday company logo exceeded size limit", {
        url: logoUrl,
        contentLength: bytes.byteLength,
        maxBytes: WORKDAY_LOGO_MAX_BYTES,
      });
    }
    const mimeType = detectLogoMimeType(bytes, contentType);
    if (!mimeType) {
      throw upstreamError("Workday logo response was not an image.", {
        url: logoUrl,
        contentType: contentType?.trim() || null,
      });
    }

    return {
      careersUrl: input.source.careersUrl,
      logoUrl,
      mimeType,
      imageDataUrl: `data:${mimeType};base64,${bytes.toString("base64")}`,
    };
  },
};

function getHydratedWorkdayLabel(source: {
  sourceType: string;
  label: string;
  careersUrl: string;
}): string {
  if (
    source.sourceType === "workday" &&
    (!source.label.trim() || source.label.trim() === source.careersUrl.trim())
  ) {
    return workdayUrlToCompanyLabel(source.careersUrl);
  }

  return source.label;
}

function normalizeWorkdayJob(
  selectedSource: WatchlistSelectedSource,
  source: string,
  job: NormalizedWorkdayJob,
) {
  return {
    jobRef: job.jobUrl,
    source,
    sourceJobId: job.externalId,
    sourceType: selectedSource.sourceType,
    title: job.title,
    employer: job.company ?? selectedSource.label,
    jobUrl: job.jobUrl,
    applicationLink: job.jobUrl,
    location: job.locationText ?? null,
    postedAt: job.postedOn ?? null,
  };
}

function buildManualDraftFromWorkdayDetails(
  selectedSource: WatchlistSelectedSource,
  source: string,
  details: {
    externalId: string;
    title: string;
    company?: string;
    locationText?: string;
    jobDescriptionText: string;
    jobUrl: string;
    timeType?: string;
  },
): ManualJobDraft {
  return {
    source,
    sourceJobId: details.externalId,
    title: details.title,
    employer: details.company ?? selectedSource.label,
    jobUrl: details.jobUrl,
    applicationLink: details.jobUrl,
    location: details.locationText,
    jobDescription: details.jobDescriptionText,
    jobType: details.timeType,
  };
}

function getSourceHost(value: string): string | null {
  try {
    return new URL(value).hostname || null;
  } catch {
    return null;
  }
}
