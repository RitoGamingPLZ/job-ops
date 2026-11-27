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
  const url = new URL(careersUrl);
  const company = url.pathname.match(
    /^\/([a-zA-Z0-9_-]+)(?:\/[a-zA-Z0-9-]+(?:\/apply)?)?\/?$/,
  )?.[1];
  if (
    url.protocol !== "https:" ||
    !["jobs.lever.co", "jobs.eu.lever.co"].includes(url.host) ||
    url.username ||
    url.password ||
    !company
  ) {
    throw badRequest("Use an HTTPS jobs.lever.co company URL.");
  }
  const host = url.hostname === "jobs.eu.lever.co" ? "api.eu.lever.co" : "api.lever.co";
  const response = await fetch(`https://${host}/v0/postings/${company}?mode=json`, {
    redirect: "manual",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(25_000)])
      : AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw upstreamError(`Lever facets returned HTTP ${response.status}.`);
  let data: unknown;
  try {
    data = await response.json();
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"))
      throw error;
    throw upstreamError("Lever facets returned invalid JSON.");
  }
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
