import { describe, expect, it } from "vitest";
import {
  CAREERS_CRAWL_ABORT_GRACE_MS,
  CAREERS_CRAWL_BUDGET_MS,
  CAREERS_CRAWL_CALL_TIMEOUT_MS,
} from "./crawl-budget";

// Raising the budget in one hop and not the next silently cuts crawls short, so pin how the hops
// relate rather than their absolute values.
describe("careers crawl budget", () => {
  it("lets in-flight pages settle after the budget before the container aborts", () => {
    // runRecipe lets a page that is already loading finish for 3 s after its budget.
    expect(CAREERS_CRAWL_ABORT_GRACE_MS).toBeGreaterThan(3_000);
  });

  it("makes the Worker wait for the budget, the abort grace and a cold container start", () => {
    expect(CAREERS_CRAWL_CALL_TIMEOUT_MS).toBeGreaterThanOrEqual(
      CAREERS_CRAWL_BUDGET_MS + CAREERS_CRAWL_ABORT_GRACE_MS + 30_000,
    );
  });

  it("stays under the five-minute task lease of the scrape coordinator", () => {
    expect(CAREERS_CRAWL_CALL_TIMEOUT_MS).toBeLessThan(5 * 60_000);
  });
});
