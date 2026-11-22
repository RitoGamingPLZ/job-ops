import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { badRequest, upstreamError } from "@infra/errors";
import catalog from "@server/config/career-boards-oracle.json";
import { convert } from "html-to-text";
import { z } from "zod";
import type { WatchlistCatalogSourceAdapter } from "./types";

const catalogSchema = z.object({
  label: z.string().trim().min(1).max(200),
  careersUrl: z.string().trim().url().max(2000),
  siteNumber: z
    .string()
    .regex(/^CX_\d+$/)
    .optional(),
});
const filterKeys = [
  "keyword",
  "locationId",
  "location",
  "radius",
  "radiusUnit",
  "selectedCategoriesFacet",
  "selectedLocationsFacet",
  "selectedPostingDatesFacet",
  "selectedWorkplaceTypesFacet",
  "selectedTitlesFacet",
] as const;
const jobSchema = z.object({
  Id: z.union([z.string().regex(/^\d+$/), z.number().int().positive()]).transform(String),
  Title: z.string().min(1),
  PrimaryLocation: z.string().nullish(),
  PostedDate: z.string().nullish(),
  ExternalPostedStartDate: z.string().nullish(),
  secondaryLocations: z.array(z.object({ Name: z.string() })).nullish(),
  JobSchedule: z.string().nullish(),
  ExternalDescriptionStr: z.string().nullish(),
  ExternalResponsibilitiesStr: z.string().nullish(),
  ExternalQualificationsStr: z.string().nullish(),
});
type Job = z.infer<typeof jobSchema>;

function board(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw badRequest("Invalid Oracle careers URL.");
  }
  const authority = value.trim().match(/^https:\/\/([^/?#]+)/i)?.[1];
  const path = url.pathname.match(
    /^\/hcmUI\/CandidateExperience\/([a-zA-Z-]+)\/sites\/([a-zA-Z0-9_-]+)\/jobs\/?$/,
  );
  if (
    !authority ||
    authority.includes(":") ||
    authority.includes("@") ||
    url.protocol !== "https:" ||
    !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+oraclecloud\.com$/.test(url.hostname) ||
    url.username ||
    url.password ||
    !path
  ) {
    throw badRequest("Use an HTTPS Oracle Cloud Candidate Experience jobs URL.");
  }
  const canonical = new URL(url.pathname.replace(/\/$/, ""), url.origin);
  for (const key of filterKeys) {
    const value = url.searchParams.get(key)?.trim();
    if (value) {
      if (
        value.length > 1000 ||
        [...value].some((char) => char.charCodeAt(0) < 32 || char === '"' || char === "\\")
      )
        throw badRequest("Invalid Oracle search filter.");
      if (key !== "keyword" && key !== "location" && !/^[a-zA-Z0-9_.;-]+$/.test(value))
        throw badRequest("Invalid Oracle search filter.");
      canonical.searchParams.set(key, value);
    }
  }
  canonical.searchParams.sort();
  const key = `${url.hostname}:${path[2]}`;
  const rawId = `oracle:${key}${canonical.search}`;
  const id =
    rawId.length <= 120 ? rawId : `oracle:${createHash("sha256").update(rawId).digest("hex")}`;
  return {
    url: canonical,
    site: path[2],
    key,
    id,
    basePath: canonical.pathname.replace(/\/jobs$/, ""),
  };
}
type Board = ReturnType<typeof board>;
function budget(signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(25_000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
async function request(url: URL, signal: AbortSignal, json = true): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    const response = await fetch(url.toString(), {
      signal,
      redirect: "error",
      headers: {
        accept: json ? "application/json" : "text/html",
        "user-agent": "job-ops-watchlist/0.1",
      },
    });
    if (response.status === 429 && attempt < 3) {
      const retry = Number(response.headers.get("retry-after"));
      await response.body?.cancel();
      await delay(
        retry > 0 ? Math.min(8000, retry * 1000) : [1000, 3000, 8000][attempt],
        undefined,
        { signal },
      );
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw upstreamError(`Oracle returned HTTP ${response.status}.`);
    }
    try {
      return json ? await response.json() : await response.text();
    } catch {
      signal.throwIfAborted();
      throw upstreamError("Oracle returned an invalid response.");
    }
  }
}
async function siteNumber(b: Board, signal: AbortSignal) {
  const known = catalog.find((entry) => {
    const parsed = board(entry.careersUrl);
    return parsed.key === b.key;
  });
  if (known) return known.siteNumber;
  const html = await request(new URL(b.url.pathname, b.url.origin), signal, false);
  const number = String(html).match(/data-sitenumber\s*=\s*["'](CX_\d+)["']/i)?.[1];
  if (!number) throw upstreamError("Oracle careers site number is unavailable.");
  return number;
}
function api(b: Board, resource: string, finder: string, expand: string) {
  const url = new URL(`/hcmRestApi/resources/latest/${resource}`, b.url.origin);
  url.searchParams.set("onlyData", "true");
  url.searchParams.set("expand", expand);
  // Encode once: facet semicolons become %3B on the wire. Double encoding
  // leaves literal "%3B" in Oracle's selected facet IDs and yields no results.
  // Text values are quoted in the finder so spaces and commas stay in the value.
  url.searchParams.set("finder", finder);
  return url;
}
function jobUrl(b: Board, id: string) {
  return b.url.hostname === "iaziqy.fa.ocs.oraclecloud.com" && b.site === "UberCareers"
    ? `https://jobs.uber.com/en/jobs/${id}/`
    : `${b.url.origin}${b.basePath}/job/${id}`;
}
function location(job: Job) {
  return (
    [
      ...new Set(
        [job.PrimaryLocation, ...(job.secondaryLocations ?? []).map((x) => x.Name)].filter(Boolean),
      ),
    ].join("; ") || null
  );
}
async function details(careersUrl: string, jobRef: string, signal?: AbortSignal) {
  if (!/^\d+$/.test(jobRef)) throw badRequest("Invalid Oracle job reference.");
  const b = board(careersUrl);
  const activeSignal = budget(signal);
  const site = await siteNumber(b, activeSignal);
  const payload = await request(
    api(b, "recruitingCEJobRequisitionDetails", `ById;Id="${jobRef}",siteNumber=${site}`, "all"),
    activeSignal,
  );
  const parsed = z.object({ items: z.array(jobSchema) }).safeParse(payload);
  const job = parsed.success ? parsed.data.items[0] : undefined;
  if (!job || job.Id !== jobRef) throw upstreamError("Oracle returned invalid job details.");
  const descriptionHtml = [
    job.ExternalDescriptionStr,
    job.ExternalResponsibilitiesStr,
    job.ExternalQualificationsStr,
  ]
    .filter(Boolean)
    .join("\n");
  if (!descriptionHtml.trim()) throw upstreamError("Oracle job description is unavailable.");
  return { b, job, descriptionHtml };
}

export const oracleWatchlistAdapter: WatchlistCatalogSourceAdapter = {
  sourceType: "oracle",
  descriptor: {
    sourceType: "oracle",
    label: "Oracle Recruiting Cloud",
    catalogLabel: "Oracle company",
    customSourceOptionLabel: "Choose your own Oracle company",
    customSourceSearchText: "custom oracle recruiting cloud url",
    customSourceInputLabel: "Oracle careers jobs URL",
    customSourcePlaceholder:
      "https://company.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs",
    customSourceHelpText:
      "Paste an Oracle Candidate Experience jobs URL. Keyword, location and facet filters are preserved. Fetches up to 60 jobs, newest first.",
    emptyCatalogText: "No Oracle companies found.",
    fetchingLabel: "Fetching from Oracle...",
    invalidUrlMessage: "Use an Oracle Cloud Candidate Experience jobs URL.",
    supportsCustomSource: true,
    supportsBranding: false,
  },
  catalogSchema,
  parseCatalogSources(entries) {
    return entries.flatMap((entry) => {
      const parsed = catalogSchema.safeParse(entry);
      if (!parsed.success) return [];
      try {
        const b = board(parsed.data.careersUrl);
        return [
          {
            id: b.id,
            label: parsed.data.label,
            careersUrl: b.url.toString(),
            sourceType: "oracle",
            cxsJobsUrl: null,
          },
        ];
      } catch {
        return [];
      }
    });
  },
  hydrateSelectedSource(source) {
    const b = board(source.careersUrl);
    return {
      ...source,
      label: source.label.trim() || b.site,
      careersUrl: b.url.toString(),
      cxsJobsUrl: null,
    };
  },
  normalizeCustomSelection(input) {
    const b = board(input.careersUrl);
    return {
      label:
        input.label?.trim() && input.label.trim() !== input.careersUrl.trim()
          ? input.label.trim()
          : b.site,
      careersUrl: b.url.toString(),
    };
  },
  async fetchJobs({ source, signal }) {
    const b = board(source.careersUrl);
    const activeSignal = budget(signal);
    const site = await siteNumber(b, activeSignal);
    const jobs = new Map<string, Job>();
    let total = 0;
    for (let offset = 0; jobs.size < 60; offset += 25) {
      let finder = `findReqs;siteNumber=${site},limit=25,offset=${offset},sortBy=POSTING_DATES_DESC`;
      for (const [key, value] of b.url.searchParams)
        finder += `,${key}=${key === "keyword" || key === "location" ? `"${value}"` : value}`;
      const payload = await request(
        api(b, "recruitingCEJobRequisitions", finder, "requisitionList.secondaryLocations"),
        activeSignal,
      );
      const parsed = z
        .object({
          items: z.array(
            z.object({
              TotalJobsCount: z.number().int().nonnegative(),
              requisitionList: z.array(jobSchema),
            }),
          ),
        })
        .safeParse(payload);
      const page = parsed.success ? parsed.data.items[0] : undefined;
      if (!page) throw upstreamError("Oracle returned invalid job listings.");
      total = page.TotalJobsCount;
      const previousSize = jobs.size;
      for (const job of page.requisitionList) {
        if (jobs.size >= 60) break;
        jobs.set(job.Id, job);
      }
      if (offset + 25 >= total || jobs.size === previousSize || !page.requisitionList.length) break;
    }
    const mapped = [...jobs.values()].map((job) => ({
      jobRef: job.Id,
      source: `oracle:${b.key}`,
      sourceJobId: job.Id,
      sourceType: "oracle",
      title: job.Title,
      employer: source.label,
      jobUrl: jobUrl(b, job.Id),
      applicationLink: jobUrl(b, job.Id),
      location: location(job),
      postedAt: job.PostedDate ?? null,
    }));
    return { total, fetched: mapped.length, jobs: mapped };
  },
  async fetchJobDetails(input) {
    const { b, job, descriptionHtml } = await details(
      input.source.careersUrl,
      input.jobRef,
      input.signal,
    );
    return { jobRef: job.Id, jobUrl: jobUrl(b, job.Id), descriptionHtml };
  },
  async prepareImportDraft(input) {
    const { b, job, descriptionHtml } = await details(
      input.source.careersUrl,
      input.jobRef,
      input.signal,
    );
    const source = `oracle:${b.key}`;
    return {
      source,
      sourceHost: b.url.hostname,
      draft: {
        source,
        sourceJobId: job.Id,
        title: job.Title,
        employer: input.source.label,
        jobUrl: jobUrl(b, job.Id),
        applicationLink: jobUrl(b, job.Id),
        location: location(job) ?? undefined,
        jobType: job.JobSchedule ?? undefined,
        jobDescription: convert(descriptionHtml, { wordwrap: false }),
      },
    };
  },
};
