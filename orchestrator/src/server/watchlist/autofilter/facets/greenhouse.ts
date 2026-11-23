import {
  GREENHOUSE_CANONICAL_BOARD_ORIGIN,
  GREENHOUSE_FILTER_KEYS,
  isGreenhouseHost,
  parseGreenhouseUrl,
} from "@career-boards/greenhouse";
import { badRequest, unprocessableEntity, upstreamError } from "@infra/errors";
import { z } from "zod";
import type { FacetDiscovery } from "../types";

const text = z
  .unknown()
  .transform((value) =>
    typeof value === "string" &&
    value.length <= 120 &&
    value.trim().length > 0 &&
    value === value.trim()
      ? value
      : undefined,
  );
const departmentsSchema = z.object({
  departments: z.array(z.object({ name: text, jobs: z.array(z.unknown()) })),
});
const jobsSchema = z.object({
  jobs: z.array(
    z.object({
      location: z.object({ name: text }).nullish(),
      metadata: z.array(z.object({ name: z.unknown(), value: text })).nullish(),
    }),
  ),
});

export const discoverGreenhouseFacets: FacetDiscovery = async ({ careersUrl, signal }) => {
  let source: ReturnType<typeof parseGreenhouseUrl>;
  let url: URL;
  try {
    url = new URL(careersUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.port)
      throw new Error("Invalid URL");
  } catch {
    throw badRequest("Use an HTTPS Greenhouse board URL.");
  }
  // Suggestion normalization preserves the input origin and path. Reject aliases
  // before discovery (including embeds whose `for` token may be absent).
  if (
    isGreenhouseHost(url.hostname) &&
    (url.origin !== GREENHOUSE_CANONICAL_BOARD_ORIGIN ||
      !/^\/[a-z0-9][a-z0-9_-]*$/.test(url.pathname))
  )
    throw unprocessableEntity(
      "Use https://job-boards.greenhouse.io/<board> to suggest Greenhouse filters.",
    );
  try {
    source = parseGreenhouseUrl(careersUrl);
  } catch {
    throw badRequest("Use an HTTPS Greenhouse board URL.");
  }
  signal?.throwIfAborted();
  const requestSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(25_000)])
    : AbortSignal.timeout(25_000);
  async function load(path: string): Promise<unknown> {
    const response = await fetch(`${source.boardApiUrl}/${path}`, {
      redirect: "manual",
      signal: requestSignal,
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw upstreamError(`Greenhouse facets returned HTTP ${response.status}.`);
    try {
      return await response.json();
    } catch (error) {
      if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"))
        throw error;
      throw upstreamError("Greenhouse facets returned invalid JSON.");
    }
  }
  // Public board data only; no tenant data or process-level cache.
  const [departmentsData, jobsData] = await Promise.all([load("departments"), load("jobs")]);
  const departments = departmentsSchema.safeParse(departmentsData);
  const jobs = jobsSchema.safeParse(jobsData);
  if (!departments.success || !jobs.success)
    throw upstreamError("Greenhouse facets returned invalid board data.");

  const counts = new Map<string, Map<string, number>>(
    GREENHOUSE_FILTER_KEYS.map((key) => [key, new Map<string, number>()]),
  );
  function add(key: string, value: string | undefined, count = 1) {
    const values = counts.get(key);
    if (value && values && count > 0) values.set(value, (values.get(value) ?? 0) + count);
  }
  for (const department of departments.data.departments) {
    // Commas delimit department selections in the URL parser.
    if (!department.name?.includes(","))
      add("departments", department.name, department.jobs.length);
  }
  for (const job of jobs.data.jobs) {
    add("location", job.location?.name);
    const workplaces = new Set(
      (job.metadata ?? [])
        .filter((entry) => entry.name === "Workplace Type")
        .map((entry) => entry.value),
    );
    for (const workplace of workplaces) add("workplace", workplace);
  }
  return {
    unfilteredTotal: jobs.data.jobs.length,
    params: GREENHOUSE_FILTER_KEYS.map((key) => ({
      key,
      // Normalization joins repeated query values with commas. Single picks
      // preserve the exact value through suggestFilters' normalization check.
      multi: false,
      values: [...(counts.get(key) ?? [])]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 60)
        .map(([value, count]) => ({ value, count })),
    })).filter((param) => param.values.length > 0),
  };
};
