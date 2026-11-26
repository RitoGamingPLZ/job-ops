import {
  bamboohrUrlToCompanyLabel,
  bamboohrUrlToSourceKey,
  getCompanyInfo,
  getJobDetails,
  getJobsFromCareersList,
  parseBamboohrUrl,
} from "@career-boards/bamboohr";
import { upstreamError } from "@infra/errors";
import { detectLogoMimeType } from "@infra/image-mime";
import type { ManualJobDraft, WatchlistSelectedSource } from "@shared/types";
import { z } from "zod";
import type { WatchlistCatalogSourceAdapter } from "./types";

const BAMBOOHR_LOGO_MAX_BYTES = 1_000_000;
const BAMBOOHR_WATCHLIST_MAX_JOBS = 60;

const bamboohrSourceSchema = z.object({
  label: z.string().trim().min(1).max(200),
  bamboohrUrl: z.string().trim().url().max(2000),
});

export const bamboohrWatchlistAdapter: WatchlistCatalogSourceAdapter = {
  sourceType: "bamboohr",
  descriptor: {
    sourceType: "bamboohr",
    label: "BambooHR",
    catalogLabel: "BambooHR company",
    customSourceOptionLabel: "Choose your own BambooHR URL",
    customSourceSearchText: "custom bamboohr url",
    customSourceInputLabel: "Custom BambooHR URL",
    customSourcePlaceholder: "https://company.bamboohr.com/careers",
    customSourceHelpText: "Use the public BambooHR careers URL, not an individual job posting URL.",
    emptyCatalogText: "No BambooHR companies found.",
    fetchingLabel: "Fetching from BambooHR...",
    invalidUrlMessage: "Invalid BambooHR URL",
    supportsCustomSource: true,
    supportsBranding: true,
  },
  parseCatalogSources(entries) {
    return z
      .array(bamboohrSourceSchema)
      .parse(entries)
      .map((entry) => {
        const parsed = parseBamboohrUrl(entry.bamboohrUrl);
        return {
          id: buildSourceId(parsed.canonicalCareersUrl),
          label: entry.label,
          sourceType: "bamboohr",
          careersUrl: parsed.canonicalCareersUrl,
          cxsJobsUrl: null,
        };
      });
  },
  hydrateSelectedSource(source) {
    const parsed = parseBamboohrUrl(source.careersUrl);
    return {
      ...source,
      label: getHydratedBamboohrLabel(source),
      careersUrl: parsed.canonicalCareersUrl,
      cxsJobsUrl: null,
    };
  },
  normalizeCustomSelection(input) {
    const parsed = parseBamboohrUrl(input.careersUrl);
    const canonicalCareersUrl = parsed.canonicalCareersUrl;
    const trimmedLabel = input.label?.trim();
    const label =
      trimmedLabel && trimmedLabel !== input.careersUrl.trim()
        ? trimmedLabel
        : bamboohrUrlToCompanyLabel(canonicalCareersUrl);

    return {
      label,
      careersUrl: canonicalCareersUrl,
    };
  },
  async fetchJobs(input) {
    const response = await getJobsFromCareersList({
      careersUrl: input.source.careersUrl,
      signal: input.signal,
    });
    const source = bamboohrUrlToSourceKey(input.source.careersUrl);
    const jobs = await Promise.all(
      response.jobs.map(async (job) => {
        const details = await getJobDetails({
          jobUrl: job.jobUrl,
          signal: input.signal,
        });

        return {
          jobRef: details.job.jobUrl,
          source,
          sourceJobId: job.externalId,
          sourceType: input.source.sourceType,
          title: details.job.title,
          employer: input.source.label,
          jobUrl: details.job.jobUrl,
          applicationLink: details.job.jobUrl,
          location: details.job.locationText ?? job.locationText ?? null,
          postedAt: details.job.postedOn ?? null,
        };
      }),
    );
    const sortedJobs = jobs
      .sort((left, right) => comparePostedAtDesc(left.postedAt, right.postedAt))
      .slice(0, BAMBOOHR_WATCHLIST_MAX_JOBS);

    return {
      total: response.total,
      fetched: sortedJobs.length,
      jobs: sortedJobs,
    };
  },
  async fetchJobDetails(input) {
    const details = await getJobDetails({
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
    const details = await getJobDetails({
      jobUrl: input.jobRef,
      signal: input.signal,
    });
    const source = bamboohrUrlToSourceKey(input.source.careersUrl);
    const draft = buildManualDraft(input.source, source, details.job);

    return {
      draft,
      source: draft.source ?? null,
      sourceHost: getSourceHost(input.source.careersUrl) ?? getSourceHost(input.jobRef),
    };
  },
  async fetchBranding(input) {
    const companyInfo = await getCompanyInfo({
      careersUrl: input.source.careersUrl,
      signal: input.signal,
    });
    const logoUrl = companyInfo.company.logoUrl;
    if (!logoUrl) {
      throw upstreamError("BambooHR company info did not include a logo URL", {
        careersUrl: input.source.careersUrl,
      });
    }

    const response = await fetch(logoUrl, {
      method: "GET",
      redirect: "follow",
      signal: input.signal,
    });

    if (!response.ok) {
      throw upstreamError(`Failed to fetch BambooHR logo with HTTP ${response.status}.`, {
        url: logoUrl,
        status: response.status,
      });
    }

    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > BAMBOOHR_LOGO_MAX_BYTES) {
      throw upstreamError("BambooHR company logo exceeded size limit", {
        url: logoUrl,
        contentLength,
        maxBytes: BAMBOOHR_LOGO_MAX_BYTES,
      });
    }

    const contentType = response.headers.get("content-type");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > BAMBOOHR_LOGO_MAX_BYTES) {
      throw upstreamError("BambooHR company logo exceeded size limit", {
        url: logoUrl,
        contentLength: bytes.byteLength,
        maxBytes: BAMBOOHR_LOGO_MAX_BYTES,
      });
    }
    const mimeType = detectLogoMimeType(bytes, contentType);
    if (!mimeType) {
      throw upstreamError("BambooHR logo response was not an image.", {
        url: logoUrl,
        contentType: contentType?.trim() || null,
      });
    }

    return {
      careersUrl: parseBamboohrUrl(input.source.careersUrl).canonicalCareersUrl,
      logoUrl,
      mimeType,
      imageDataUrl: `data:${mimeType};base64,${bytes.toString("base64")}`,
    };
  },
};

function buildSourceId(careersUrl: string): string {
  return `bamboohr:${careersUrl}`;
}

function getHydratedBamboohrLabel(source: {
  sourceType: string;
  label: string;
  careersUrl: string;
}): string {
  if (
    source.sourceType === "bamboohr" &&
    (!source.label.trim() || source.label.trim() === source.careersUrl.trim())
  ) {
    return bamboohrUrlToCompanyLabel(source.careersUrl);
  }

  return source.label;
}

function buildManualDraft(
  selectedSource: WatchlistSelectedSource,
  source: string,
  details: {
    externalId: string;
    title: string;
    jobUrl: string;
    locationText?: string;
    jobDescriptionText: string;
    employmentStatus?: string;
  },
): ManualJobDraft {
  return {
    source,
    sourceJobId: details.externalId,
    title: details.title,
    employer: selectedSource.label,
    jobUrl: details.jobUrl,
    applicationLink: details.jobUrl,
    location: details.locationText,
    jobDescription: details.jobDescriptionText,
    jobType: details.employmentStatus,
  };
}

function getSourceHost(value: string): string | null {
  try {
    return new URL(value).hostname || null;
  } catch {
    return null;
  }
}

function comparePostedAtDesc(left: string | null, right: string | null): number {
  const leftTime = left ? Date.parse(left) : Number.NaN;
  const rightTime = right ? Date.parse(right) : Number.NaN;
  const leftValid = Number.isFinite(leftTime);
  const rightValid = Number.isFinite(rightTime);

  if (leftValid && rightValid) return rightTime - leftTime;
  if (leftValid) return -1;
  if (rightValid) return 1;
  return 0;
}
