/**
 * Shared browser resilience utilities for Playwright-based extractors.
 *
 * Use this package when your extractor navigates pages with Playwright and
 * needs to handle Cloudflare WAF challenges or persist cookies between runs.
 */

export { isChallengePage, readPageContentIfReady } from "./challenge.js";
export { type CookieJarInfo, loadCookies, readCookieJar, saveCookies } from "./cookies.js";
export { type BrowserLaunchOptions, createLaunchOptions } from "./launch.js";
export { subscribeChildProcessLines } from "./process-lines.js";
export { type SolverResult, solveChallenge } from "./solver.js";
