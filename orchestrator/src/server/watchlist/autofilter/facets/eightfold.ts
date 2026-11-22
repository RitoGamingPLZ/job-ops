import { badRequest, upstreamError } from "@infra/errors";
import {
  eightfoldWatchlistAdapter,
  isEightfoldFacetKey,
} from "@server/watchlist/adapters/eightfold";
import { z } from "zod";
import type { FacetDiscovery, Facets } from "../types";

const countSchema = z.number().int().nonnegative();
const responseSchema = z.object({ count: countSchema });
const recordSchema = z.record(z.string(), z.unknown());
const optionSchema = z.object({ value: z.string().trim().min(1).max(120) });
const filterSchema = z.object({
  filterName: z.string(),
  type: z.enum(["multi_select", "multi_select_suggest", "single_select"]),
  options: z.array(z.unknown()),
});

export const discoverEightfoldFacets: FacetDiscovery = async ({ careersUrl, signal }) => {
  let normalized: { careersUrl: string };
  try {
    normalized = await eightfoldWatchlistAdapter.normalizeCustomSelection({
      careersUrl,
      label: null,
    });
  } catch {
    throw badRequest("Use a supported Microsoft or Netflix careers search URL.");
  }
  signal?.throwIfAborted();
  const base = new URL(normalized.careersUrl);
  const microsoft = base.hostname === "apply.careers.microsoft.com";
  const url = new URL(microsoft ? "/api/pcsx/search" : "/api/apply/v2/jobs", base.origin);
  // Discover the unfiltered total, never forwarding user query/transport params.
  url.searchParams.set("domain", microsoft ? "microsoft.com" : "netflix.com");
  if (microsoft) url.searchParams.set("start", "0");
  else url.searchParams.set("num", "1");
  const response = await fetch(url.href, {
    redirect: "error",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(25_000)])
      : AbortSignal.timeout(25_000),
    headers: { accept: "application/json" },
  });
  // In particular, do not retry PCSX 429s during facet discovery.
  if (!response.ok) throw upstreamError(`Eightfold facets returned HTTP ${response.status}.`);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"))
      throw error;
    throw upstreamError("Eightfold facets returned invalid JSON.");
  }
  if (microsoft) {
    const envelope = z.object({ status: z.literal(200), data: z.unknown() }).safeParse(payload);
    if (!envelope.success)
      throw upstreamError("Eightfold facets returned an invalid PCSX response.");
    payload = envelope.data.data;
  }
  const parsed = responseSchema.safeParse(payload);
  const record = recordSchema.safeParse(payload);
  if (!parsed.success || !record.success)
    throw upstreamError("Eightfold facets returned invalid search data.");
  const params: Facets["params"] = [
    { key: "query", multi: false, freeText: true },
    { key: "location", multi: false, freeText: true },
  ];
  if (microsoft) {
    // PCSX puts option values under filterDef, rather than apply/v2.facets.
    const definition = recordSchema.safeParse(record.data.filterDef);
    const filters = definition.success
      ? [definition.data.smartFilters, definition.data.allFilters].flatMap((value) =>
          Array.isArray(value) ? value : [],
        )
      : [];
    for (const entry of filters) {
      const filter = filterSchema.safeParse(entry);
      if (!filter.success) continue;
      const key = `filter_${filter.data.filterName}`;
      if (!isEightfoldFacetKey(key) || params.some((p) => p.key === key)) continue;
      const values = [
        ...new Set(
          filter.data.options.flatMap((option) => {
            const parsed = optionSchema.safeParse(option);
            return parsed.success ? [parsed.data.value] : [];
          }),
        ),
      ]
        .slice(0, 60)
        .map((value) => ({ value }));
      if (values.length)
        params.push({
          key,
          multi: filter.data.type !== "single_select",
          values,
        });
    }
  } else {
    const facets = recordSchema.safeParse(record.data.facets);
    if (facets.success)
      for (const [key, raw] of Object.entries(facets.data)) {
        // locations are display suggestions; the API uses singular freeText location.
        if (!isEightfoldFacetKey(key)) continue;
        const counts = recordSchema.safeParse(raw);
        if (!counts.success) continue;
        const values = Object.entries(counts.data)
          .flatMap(([value, count]) => {
            const text = optionSchema.safeParse({ value });
            const number = countSchema.safeParse(count);
            return text.success && number.success
              ? [{ value: text.data.value, count: number.data }]
              : [];
          })
          .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
          .slice(0, 60);
        if (values.length) params.push({ key, multi: true, values });
      }
  }
  return { unfilteredTotal: parsed.data.count, params };
};
