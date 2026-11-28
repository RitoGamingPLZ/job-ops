/**
 * How long a queued careers crawl may keep loading new pages before it returns what it has. Every
 * hop of the queued path derives its limit from this one number, so raising it cannot be cut short
 * further along: the container route accepts it, aborts a little after it, and the Worker waits for
 * it plus a cold start. The synchronous, in-request crawl keeps its own shorter budget because it
 * holds an HTTP request open.
 *
 * Import-free on purpose: the Cloudflare Worker imports it.
 */
export const CAREERS_CRAWL_BUDGET_MS = 60_000;

/** The container route aborts a crawl this long after its budget, once in-flight pages settle. */
export const CAREERS_CRAWL_ABORT_GRACE_MS = 6_000;

/** The Worker's wait for one crawl: the budget plus the time a cold container may need to start. */
export const CAREERS_CRAWL_CALL_TIMEOUT_MS = CAREERS_CRAWL_BUDGET_MS + 60_000;
