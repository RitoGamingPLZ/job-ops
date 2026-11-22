import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseSearchTerms } from "job-ops-shared/utils/search-terms";
import { runAdzuna } from "./run";

const JOBOPS_PROGRESS_PREFIX = "JOBOPS_PROGRESS ";
const DEFAULT_SEARCH_TERM = "web developer";

function parsePositiveInt(input: string | undefined, fallback: number): number {
  const parsed = input ? Number.parseInt(input, 10) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

function emitProgress(payload: Record<string, unknown>): void {
  if (process.env.JOBOPS_EMIT_PROGRESS !== "1") return;
  console.log(`${JOBOPS_PROGRESS_PREFIX}${JSON.stringify(payload)}`);
}

async function run(): Promise<void> {
  const country = (process.env.ADZUNA_COUNTRY || "gb").trim().toLowerCase();
  const maxJobsPerTerm = parsePositiveInt(process.env.ADZUNA_MAX_JOBS_PER_TERM, 50);
  const resultsPerPage = Math.min(50, parsePositiveInt(process.env.ADZUNA_RESULTS_PER_PAGE, 50));
  const searchTerms = parseSearchTerms(process.env.ADZUNA_SEARCH_TERMS, DEFAULT_SEARCH_TERM);
  const outputJson =
    process.env.ADZUNA_OUTPUT_JSON || join(process.cwd(), "storage/datasets/default/jobs.json");
  const locationQuery = process.env.ADZUNA_LOCATION_QUERY?.trim() || "";

  const result = await runAdzuna({
    country,
    countryKey: country,
    maxJobsPerTerm,
    resultsPerPage,
    searchTerms,
    locations: locationQuery ? [locationQuery] : undefined,
    onProgress: (event) => {
      emitProgress({ ...event, event: event.type });
    },
  });

  if (!result.success) {
    throw new Error(result.error ?? "Adzuna extractor failed");
  }

  await mkdir(dirname(outputJson), { recursive: true });
  await writeFile(outputJson, `${JSON.stringify(result.jobs, null, 2)}\n`, "utf-8");
  console.log(`Adzuna extractor wrote ${result.jobs.length} jobs`);
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`Adzuna extractor failed: ${message}`);
  process.exitCode = 1;
});
