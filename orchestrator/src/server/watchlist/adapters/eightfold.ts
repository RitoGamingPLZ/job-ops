import { setTimeout as delay } from "node:timers/promises";
import { logger } from "@infra/logger";
import type { WatchlistSelectedSource } from "@shared/types";
import { z } from "zod";
import type { WatchlistCatalogSourceAdapter } from "./types";

// Only these public boards have been verified to allow their APIs in robots.txt.
// Netflix's PCSX search returns 403 (PCSX disabled), so it uses apply/v2.
const boards = {
  "apply.careers.microsoft.com": {
    label: "Microsoft",
    slug: "microsoft",
    domain: "microsoft.com",
    api: "pcsx",
  },
  "explore.jobs.netflix.net": {
    label: "Netflix",
    slug: "netflix",
    domain: "netflix.com",
    api: "apply",
  },
} as const;
const MAX_JOBS = 60;
const LIST_RATE_LIMIT_BACKOFF_MS = [1000, 3000, 8000] as const;
const catalogSchema = z.object({
  label: z.string().trim().min(1).max(200),
  careersUrl: z.string().trim().url().max(2000),
});
const idSchema = z.union([z.string().regex(/^\d+$/), z.number().int().positive()]);
const positionSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1),
  locations: z.array(z.string()).nullish(),
  standardizedLocations: z.array(z.string()).nullish(),
  location: z.string().nullish(),
  postedTs: z.number().nullish(),
  creationTs: z.number().nullish(),
  t_create: z.number().nullish(),
  jobDescription: z.string().nullish(),
  job_description: z.string().nullish(),
});
type Position = z.infer<typeof positionSchema>;
const searchSchema = z.object({
  count: z.number().int().nonnegative(),
  positions: z.array(positionSchema),
});

// Discovery is unavailable during URL parsing. Preserve bounded capitalized
// facet names (including spaces) and legacy/PCSX filter_* keys. Transport keys
// such as domain/start/num stay server-controlled; URLs always use board.origin.
export function isEightfoldFacetKey(key: string): boolean {
  return (
    key.length <= 60 &&
    (/^[A-Z][A-Za-z0-9]*(?: [A-Za-z0-9]+)*$/.test(key) || /^filter_\w+$/.test(key))
  );
}

function parseSource(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !Object.hasOwn(boards, url.hostname) ||
    !/^\/careers(?:\/search)?\/?$/.test(url.pathname)
  ) {
    throw new Error("Use a supported Microsoft or Netflix careers search URL.");
  }
  const board = boards[url.hostname as keyof typeof boards];
  const canonical = new URL("/careers", url.origin);
  for (const [key, value] of url.searchParams) {
    if (key === "query" || key === "location" || isEightfoldFacetKey(key)) {
      canonical.searchParams.append(key, value);
    }
  }
  canonical.searchParams.sort();
  return { board, url: canonical, source: `eightfold:${board.slug}` };
}

function callSignal(signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(25_000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function responsePrefix(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let prefix = "";
  try {
    while (prefix.length < 200) {
      const { done, value } = await reader.read();
      if (done) break;
      prefix += decoder.decode(value, { stream: true });
    }
    return prefix.slice(0, 200);
  } catch {
    return "[unavailable]";
  } finally {
    await reader.cancel().catch(() => {});
  }
}

async function fetchJson(url: URL, signal: AbortSignal, kind: "list" | "detail"): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    const response = await fetch(url.toString(), {
      signal,
      redirect: "manual",
      headers: { accept: "application/json" },
    });
    if (response.status === 429) {
      logger.warn("Eightfold request rate limited", {
        host: url.hostname,
        start: url.searchParams.get("start"),
        attempt: attempt + 1,
        status: response.status,
        headers: {
          server: response.headers.get("server"),
          "x-azure-ref": response.headers.get("x-azure-ref"),
          "x-cache": response.headers.get("x-cache"),
          // Cookie values may contain session identifiers; retain names only.
          responseStateNames: response.headers
            .getSetCookie()
            .map((cookie) => cookie.split("=", 1)[0].trim()),
        },
        bodyPrefix: await responsePrefix(response),
      });
    }
    if (
      response.status === 429 &&
      attempt <
        (kind === "detail"
          ? 1
          : response.headers.has("retry-after")
            ? 2
            : LIST_RATE_LIMIT_BACKOFF_MS.length)
    ) {
      const retryAfter = response.headers.get("retry-after");
      const seconds = retryAfter === null ? Number.NaN : Number(retryAfter);
      const requestedDelay = Number.isFinite(seconds)
        ? seconds * 1000
        : Date.parse(retryAfter ?? "") - Date.now();
      if (!response.bodyUsed) await response.body?.cancel();
      await delay(
        kind === "detail"
          ? 1000
          : retryAfter === null
            ? LIST_RATE_LIMIT_BACKOFF_MS[attempt]
            : Math.min(2000, Math.max(250 * 2 ** attempt, requestedDelay || 0)),
        undefined,
        { signal },
      );
      continue;
    }
    if (!response.ok) {
      if (!response.bodyUsed) await response.body?.cancel();
      throw new Error(
        `Eightfold request failed with HTTP ${response.status} (host=${url.hostname}, start=${url.searchParams.get("start") ?? "n/a"}, attempt=${attempt + 1}).`,
      );
    }
    try {
      return await response.json();
    } catch {
      signal.throwIfAborted();
      throw new Error("Eightfold returned invalid JSON.");
    }
  }
}

function parsePayload<T>(schema: z.ZodType<T>, payload: unknown): T {
  const result = schema.safeParse(payload);
  if (!result.success) throw new Error("Eightfold returned an invalid response.");
  return result.data;
}

function unwrapPcsx(payload: unknown): unknown {
  const envelope = parsePayload(z.object({ status: z.literal(200), data: z.unknown() }), payload);
  return envelope.data;
}

function normalizeJob(context: ReturnType<typeof parseSource>, job: Position) {
  const id = String(job.id);
  const timestamp = job.postedTs ?? job.t_create ?? job.creationTs;
  const date = timestamp ? new Date(timestamp * 1000) : null;
  const jobUrl = new URL(`/careers/job/${id}`, context.url.origin).toString();
  return {
    jobRef: jobUrl,
    source: context.source,
    sourceJobId: id,
    sourceType: "eightfold",
    title: job.name,
    employer: context.board.label,
    jobUrl,
    applicationLink: jobUrl,
    location:
      job.standardizedLocations?.join("; ") || job.locations?.join("; ") || job.location || null,
    postedAt: date && Number.isFinite(date.getTime()) ? date.toISOString() : null,
  };
}

async function loadDetails(input: {
  source: WatchlistSelectedSource;
  jobRef: string;
  signal?: AbortSignal;
}) {
  const context = parseSource(input.source.careersUrl);
  const ref = new URL(input.jobRef);
  const match = /^\/careers\/job\/(\d+)\/?$/.exec(ref.pathname);
  if (
    ref.origin !== context.url.origin ||
    ref.username ||
    ref.password ||
    !match ||
    ref.search ||
    ref.hash
  ) {
    throw new Error("Eightfold job reference does not belong to this board.");
  }
  const id = match[1];
  const url = new URL(
    context.board.api === "pcsx" ? "/api/pcsx/position_details" : `/api/apply/v2/jobs/${id}`,
    context.url.origin,
  );
  url.searchParams.set("domain", context.board.domain);
  if (context.board.api === "pcsx") url.searchParams.set("position_id", id);
  const payload = await fetchJson(url, callSignal(input.signal), "detail");
  const position = parsePayload(
    positionSchema,
    context.board.api === "pcsx" ? unwrapPcsx(payload) : payload,
  );
  if (String(position.id) !== id) {
    throw new Error("Eightfold returned a different job reference.");
  }
  const descriptionHtml = position.jobDescription ?? position.job_description;
  if (!descriptionHtml?.trim()) {
    throw new Error("Eightfold job description is unavailable.");
  }
  return { context, job: normalizeJob(context, position), descriptionHtml };
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<br\s*\/?>|<\/(?:p|div|li|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(?:(\d+)|x([0-9a-f]+));/gi, (entity, decimal, hexadecimal) => {
      const codePoint = Number.parseInt(decimal ?? hexadecimal, decimal ? 10 : 16);
      return codePoint > 0 && codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff)
        ? String.fromCodePoint(codePoint)
        : entity;
    })
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}

export const eightfoldWatchlistAdapter: WatchlistCatalogSourceAdapter = {
  sourceType: "eightfold",
  descriptor: {
    sourceType: "eightfold",
    label: "Eightfold",
    catalogLabel: "Eightfold company",
    customSourceOptionLabel: "Custom Microsoft or Netflix search",
    customSourceSearchText: "custom eightfold microsoft netflix url",
    customSourceInputLabel: "Microsoft or Netflix careers search URL",
    customSourcePlaceholder: "https://apply.careers.microsoft.com/careers?query=engineer",
    customSourceHelpText:
      "Paste a Microsoft or Netflix careers search URL. Query, location, capitalized facet names (Teams, Work Type, Region), and filter_ parameters are preserved. Up to 60 newest jobs are fetched.",
    emptyCatalogText: "No Eightfold companies found.",
    fetchingLabel: "Fetching from Eightfold...",
    invalidUrlMessage: "Use a Microsoft or Netflix careers search URL.",
    supportsCustomSource: true,
    supportsBranding: false,
  },
  parseCatalogSources(entries) {
    return entries.flatMap((entry) => {
      const result = catalogSchema.safeParse(entry);
      if (!result.success) return [];
      try {
        const context = parseSource(result.data.careersUrl);
        return [
          {
            id: context.source,
            label: result.data.label,
            sourceType: "eightfold",
            careersUrl: context.url.toString(),
            cxsJobsUrl: null,
          },
        ];
      } catch {
        return [];
      }
    });
  },
  hydrateSelectedSource(source) {
    const context = parseSource(source.careersUrl);
    return {
      ...source,
      label:
        source.label.trim() && source.label !== source.careersUrl
          ? source.label
          : context.board.label,
      careersUrl: context.url.toString(),
      cxsJobsUrl: null,
    };
  },
  normalizeCustomSelection(input) {
    const context = parseSource(input.careersUrl.trim());
    const label = input.label?.trim();
    return {
      label: label && label !== input.careersUrl.trim() ? label : context.board.label,
      careersUrl: context.url.toString(),
    };
  },
  async fetchJobs(input) {
    const context = parseSource(input.source.careersUrl);
    const stopAt = Date.now() + 20_000;
    const signal = AbortSignal.any([callSignal(input.signal), AbortSignal.timeout(20_000)]);
    const positions = new Map<string, Position>();
    let start = 0;
    let total = 0;
    // PCSX returns 10 rows/page; cap page requests as well as returned jobs.
    for (let page = 0; page < Math.ceil(MAX_JOBS / 10) && Date.now() < stopAt; page++) {
      const url = new URL(
        context.board.api === "pcsx" ? "/api/pcsx/search" : "/api/apply/v2/jobs",
        context.url.origin,
      );
      url.search = context.url.search;
      url.searchParams.set("domain", context.board.domain);
      url.searchParams.set("sort_by", "timestamp");
      url.searchParams.set("start", String(start));
      if (context.board.api === "apply") {
        url.searchParams.set("num", String(MAX_JOBS));
      }
      let response: z.infer<typeof searchSchema>;
      try {
        const payload = await fetchJson(url, signal, "list");
        response = parsePayload(
          searchSchema,
          context.board.api === "pcsx" ? unwrapPcsx(payload) : payload,
        );
      } catch (error) {
        input.signal?.throwIfAborted();
        if (positions.size) {
          logger.warn("Eightfold returning partial results after list failure", {
            host: url.hostname,
            start,
            fetched: positions.size,
          });
          break;
        }
        throw error;
      }
      total = response.count;
      const previousSize = positions.size;
      for (const position of response.positions) positions.set(String(position.id), position);
      start += response.positions.length;
      if (positions.size >= MAX_JOBS || start >= total || positions.size === previousSize) break;
    }
    input.signal?.throwIfAborted();
    const jobs = [...positions.values()]
      .map((position) => normalizeJob(context, position))
      .sort(
        (left, right) =>
          (Date.parse(right.postedAt ?? "") || 0) - (Date.parse(left.postedAt ?? "") || 0),
      )
      .slice(0, MAX_JOBS);
    return { total, fetched: jobs.length, jobs };
  },
  async fetchJobDetails(input) {
    const { job, descriptionHtml } = await loadDetails(input);
    return { jobRef: job.jobRef, jobUrl: job.jobUrl, descriptionHtml };
  },
  async prepareImportDraft(input) {
    const { job, descriptionHtml, context } = await loadDetails(input);
    return {
      draft: {
        source: job.source,
        sourceJobId: job.sourceJobId,
        title: job.title,
        employer: job.employer,
        jobUrl: job.jobUrl,
        applicationLink: job.applicationLink,
        location: job.location ?? undefined,
        jobDescription: htmlToText(descriptionHtml),
      },
      source: job.source,
      sourceHost: context.url.hostname,
    };
  },
};
