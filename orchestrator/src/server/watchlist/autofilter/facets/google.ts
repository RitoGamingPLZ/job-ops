import { upstreamError } from "@infra/errors";
import { callbackData, searchUrl } from "../../adapters/google";
import type { FacetDiscovery } from "../types";

// Verified 2026-11-08 against the results page's odRxNb controller bundle:
// _.hB (target_level), _.gB (employment_type), _.fB (degree). Its filter
// templates expose these nonzero options; UNSPECIFIED is not a filter choice.
const enums = {
  target_level: ["EARLY", "MID", "ADVANCED", "DIRECTOR_PLUS", "INTERN_AND_APPRENTICE"],
  employment_type: ["FULL_TIME", "PART_TIME", "TEMPORARY", "INTERN"],
  degree: ["PURSUING_DEGREE", "ASSOCIATE", "BACHELORS", "MASTERS", "DOCTORATE"],
};

export const discoverGoogleFacets: FacetDiscovery = async ({ careersUrl, signal }) => {
  const url = searchUrl(careersUrl);
  // Facets and the baseline total must describe the whole board, even when the
  // selected URL already has filters. One results request, without robots' page=.
  url.search = "";
  signal?.throwIfAborted();
  const response = await fetch(url.toString(), {
    redirect: "manual",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(25_000)])
      : AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw upstreamError(`Google facets returned HTTP ${response.status}.`);
  const data = callbackData(await response.text(), "ds:1");
  const total = Array.isArray(data) ? data[2] : undefined;
  if (!Number.isSafeInteger(total) || total < 0)
    throw upstreamError(
      "Google careers ds:1 total is invalid or missing; the page structure may have changed.",
    );
  return {
    unfilteredTotal: total,
    params: [
      { key: "q", multi: false, freeText: true },
      { key: "location", multi: true, freeText: true },
      ...Object.entries(enums).map(([key, values]) => ({
        key,
        multi: true,
        values: values.map((value) => ({ value })),
      })),
    ],
  };
};
