import { createBudgetSignal, fetchWatchlist } from "@server/watchlist/adapters/http";
import { parseLeverUrl } from "@server/watchlist/adapters/lever";
import { rankFacetValues } from "./shared";
import { badRequest, upstreamError } from "@infra/errors";
import { z } from "zod";
import type { FacetDiscovery } from "../types";

const keys = ["location", "team", "department", "commitment", "workplaceType"] as const;
const text = z.unknown().transform((value) => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 120 ? trimmed : undefined;
});
const postingsSchema = z.array(
  z.object({
    id: z.string(),
    categories: z
      .object({
        location: text,
        team: text,
        department: text,
        commitment: text,
      })
      .optional(),
    workplaceType: text,
  }),
);

export const discoverLeverFacets: FacetDiscovery = async ({ careersUrl, signal }) => {
  let parsedUrl: ReturnType<typeof parseLeverUrl>;
  try {
    parsedUrl = parseLeverUrl(careersUrl);
  } catch {
    throw badRequest("Use an HTTPS jobs.lever.co company URL.");
  }
  const data = await fetchWatchlist({
    url: `${parsedUrl.apiUrl}?mode=json`,
    signal: createBudgetSignal(signal),
    maxRetries: 0,
    formatHttpError: ({ status }) => upstreamError(`Lever facets returned HTTP ${status}.`),
    formatInvalidBodyError: () => upstreamError("Lever facets returned invalid JSON."),
  });
  const parsed = postingsSchema.safeParse(data);
  if (!parsed.success) throw upstreamError("Lever facets returned invalid posting data.");
  const jobs = [...new Map(parsed.data.map((job) => [job.id, job])).values()];
  return {
    unfilteredTotal: jobs.length,
    params: keys
      .map((key) => {
        const counts = new Map<string, number>();
        for (const job of jobs) {
          const value = key === "workplaceType" ? job.workplaceType : job.categories?.[key];
          if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
        }
        return {
          key,
          multi: true,
          values: rankFacetValues(counts),
        };
      })
      .filter((param) => param.values.length > 0),
  };
};
