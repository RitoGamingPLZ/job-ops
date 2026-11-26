/**
 * Standalone script to run the pipeline.
 * Can be triggered by n8n or cron.
 *
 * Usage: npm run pipeline:run
 */

import "../config/env";
import { logger } from "@infra/logger";
import { closeDb } from "../db/index";
import { runPipeline } from "./orchestrator";

async function main() {
  logger.info("Job Pipeline Runner starting");

  const result = await runPipeline({
    topN: parseInt(process.env.PIPELINE_TOP_N || "10", 10),
    minSuitabilityScore: parseInt(process.env.PIPELINE_MIN_SCORE || "50", 10),
  });

  logger.info("Job Pipeline Runner finished", {
    success: result.success,
    jobsDiscovered: result.jobsDiscovered,
    jobsProcessed: result.jobsProcessed,
    ...(result.error ? { error: result.error } : {}),
  });

  closeDb();
  process.exit(result.success ? 0 : 1);
}

main().catch((error) => {
  logger.error("Job Pipeline Runner failed", { error });
  closeDb();
  process.exit(1);
});
