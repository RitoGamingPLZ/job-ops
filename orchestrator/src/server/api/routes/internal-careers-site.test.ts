import type { Server } from "node:http";
import type { Recipe } from "@server/watchlist/careers-site/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startServer, stopServer } from "./test-utils";

const mocks = vi.hoisted(() => ({ run: vi.fn(), learn: vi.fn(), facets: vi.fn() }));
vi.mock("@server/watchlist/autofilter/facets/careers-site", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@server/watchlist/autofilter/facets/careers-site")>()),
  readListingFacetsLocal: mocks.facets,
}));
vi.mock("@server/watchlist/careers-site/run-recipe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@server/watchlist/careers-site/run-recipe")>()),
  runRecipe: mocks.run,
}));
vi.mock("@server/watchlist/careers-site/learn", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@server/watchlist/careers-site/learn")>()),
  learnRecipe: mocks.learn,
}));

const recipe: Recipe = {
  version: 1,
  jobUrlPattern: "/jobs/",
  listing: { kind: "sitemap", url: "https://example.com/sitemap.xml" },
  detail: { kind: "jsonld" },
};
const llm = {
  provider: "openrouter",
  model: "some/model",
  baseUrl: "https://openrouter.ai",
  apiKey: "tenant-key",
};
const job = {
  id: "1",
  url: "https://example.com/jobs/1",
  title: "Engineer",
  employer: "Example",
  location: null,
  postedAt: null,
  descriptionHtml: "<p>Hi</p>",
};

// startServer resets modules, so error classes must come from the registry the route uses.
async function loadClasses() {
  const [{ SiteBlockedError }, { RecipeLearningError }, { LlmService }] = await Promise.all([
    import("@server/watchlist/careers-site/types"),
    import("@server/watchlist/careers-site/learn"),
    import("@server/services/llm/service"),
  ]);
  return { SiteBlockedError, RecipeLearningError, LlmService };
}

describe("internal careers-site crawling", () => {
  let server: Server;
  let closeDb: () => void;
  let tempDir: string;
  let baseUrl: string;
  const headers = {
    "content-type": "application/json",
    "x-internal-sync-secret": "careers-secret",
  };
  const post = (path: string, body: unknown, requestHeaders: Record<string, string> = headers) =>
    fetch(`${baseUrl}/internal/careers-site/${path}`, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(body),
    });

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ server, closeDb, tempDir, baseUrl } = await startServer({
      env: {
        JOBOPS_TEST_AUTH_BYPASS: "0",
        INTERNAL_SYNC_SECRET: "careers-secret",
        CRON_SECRET: undefined,
      },
    }));
  });
  afterEach(async () => {
    await stopServer({ server, closeDb, tempDir });
  });

  it("requires the internal secret and rejects malformed requests", async () => {
    for (const secret of [undefined, "wrong-secret"]) {
      const response = await post(
        "run",
        {},
        {
          "content-type": "application/json",
          ...(secret ? { "x-internal-sync-secret": secret } : {}),
        },
      );
      expect(response.status).toBe(401);
    }
    expect((await post("run", {})).status).toBe(400);
    expect((await post("learn", { careersUrl: "not a url" })).status).toBe(400);
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.learn).not.toHaveBeenCalled();
  });

  it("accepts a v2 recipe with search and field rules and returns the extra job fields", async () => {
    const v2: Recipe = {
      ...recipe,
      version: 2,
      search: {
        url: "https://example.com/careers",
        params: [{ key: "q", input: { kind: "text" }, encoding: "single" }],
        pagination: { kind: "query", param: "page", start: 1, step: 1 },
        maxPages: 3,
        render: false,
      },
      detail: {
        kind: "jsonld",
        fields: { salary: { kind: "jobPosting", property: "baseSalary" } },
      },
    };
    const withFields = { ...job, salary: "USD 90,000 per year", deadline: null };
    mocks.run.mockResolvedValue([withFields]);

    const response = await post("run", {
      recipe: v2,
      sourceUrl: "https://example.com/careers?q=nurse",
      limit: 10,
      budgetMs: 20_000,
    });

    expect(await response.json()).toMatchObject({
      ok: true,
      data: { kind: "jobs", jobs: [withFields] },
    });
    expect(mocks.run).toHaveBeenCalledWith(v2, expect.anything());
    // Rejects a search that tries to smuggle in an unbounded control list.
    const tooMany = {
      ...v2,
      search: {
        ...v2.search,
        params: Array.from({ length: 13 }, (_, i) => ({ ...v2.search?.params[0], key: `k${i}` })),
      },
    };
    expect((await post("run", { recipe: tooMany, limit: 10, budgetMs: 1000 })).status).toBe(400);
  });

  it("runs a recipe and returns the crawled jobs", async () => {
    mocks.run.mockResolvedValue([job]);

    const response = await post("run", {
      recipe,
      sourceUrl: "https://example.com/careers?team=eng",
      limit: 10,
      budgetMs: 20_000,
    });

    expect(await response.json()).toMatchObject({ ok: true, data: { kind: "jobs", jobs: [job] } });
    expect(mocks.run).toHaveBeenCalledWith(
      recipe,
      expect.objectContaining({ limit: 10, sourceUrl: "https://example.com/careers?team=eng" }),
    );
  });

  it("reports a blocked site and a failed crawl without leaking details", async () => {
    const { SiteBlockedError } = await loadClasses();
    const request = { recipe, limit: 10, budgetMs: 1_000 };
    mocks.run.mockRejectedValueOnce(new SiteBlockedError("example.com", "HTTP 403"));
    expect(await (await post("run", request)).json()).toMatchObject({
      data: { kind: "blocked", reason: "HTTP 403" },
    });

    mocks.run.mockRejectedValueOnce(new Error("raw upstream body"));
    const failed = await (await post("run", request)).json();
    expect(failed.data).toEqual({ kind: "failed" });
    expect(JSON.stringify(failed)).not.toContain("raw upstream body");
  });

  it("learns with the caller's LLM connection only, never the container's credentials", async () => {
    mocks.learn.mockResolvedValue(recipe);

    const response = await post("learn", { careersUrl: "https://example.com/careers", llm });

    expect(await response.json()).toMatchObject({ data: { kind: "recipe", recipe } });
    const [url, options] = mocks.learn.mock.calls[0];
    expect(url).toBe("https://example.com/careers");
    expect(options.llm.model).toBe("some/model");
    expect(options.llm.service).toBeInstanceOf((await loadClasses()).LlmService);
  });

  it("reports learning outcomes: blocked, rejected recipe, unexpected error", async () => {
    const { SiteBlockedError, RecipeLearningError } = await loadClasses();
    const request = { careersUrl: "https://example.com/careers", llm };
    mocks.learn.mockRejectedValueOnce(new SiteBlockedError("example.com", "Cloudflare challenge"));
    expect(await (await post("learn", request)).json()).toMatchObject({
      data: { kind: "blocked", reason: "Cloudflare challenge" },
    });

    mocks.learn.mockRejectedValueOnce(new RecipeLearningError("Recipe found no jobs"));
    expect(await (await post("learn", request)).json()).toMatchObject({
      data: { kind: "failed", message: "Recipe found no jobs" },
    });

    mocks.learn.mockRejectedValueOnce(new Error("secret provider body"));
    const unexpected = await (await post("learn", request)).json();
    expect(unexpected.data.kind).toBe("failed");
    expect(JSON.stringify(unexpected)).not.toContain("secret provider body");
  });

  it("reads listing facets without the filtered-count callback and reports outcomes", async () => {
    const { SiteBlockedError } = await loadClasses();
    const { upstreamError } = await import("@infra/errors");
    const facets = {
      unfilteredTotal: 12,
      params: [{ key: "team", multi: false, values: [{ value: "engineering", count: 4 }] }],
    };
    mocks.facets.mockResolvedValueOnce({ ...facets, countFiltered: async () => 1 });
    const request = { careersUrl: "https://careers.example.com/positions/", filtered: false };
    expect(await (await post("facets", request)).json()).toMatchObject({
      ok: true,
      data: { kind: "facets", facets },
    });
    expect(mocks.facets).toHaveBeenLastCalledWith(
      { careersUrl: request.careersUrl, signal: expect.any(AbortSignal) },
      false,
    );
    mocks.facets.mockRejectedValueOnce(new SiteBlockedError("careers.example.com", "robots"));
    expect(await (await post("facets", request)).json()).toMatchObject({
      data: { kind: "blocked", reason: "robots" },
    });
    mocks.facets.mockRejectedValueOnce(upstreamError("Careers facets returned HTTP 404."));
    expect(await (await post("facets", request)).json()).toMatchObject({
      data: { kind: "failed", message: "Careers facets returned HTTP 404." },
    });
    mocks.facets.mockRejectedValueOnce(new Error("secret page body"));
    const unexpected = await (await post("facets", request)).json();
    expect(unexpected.data.kind).toBe("failed");
    expect(JSON.stringify(unexpected)).not.toContain("secret page body");
    expect((await post("facets", { careersUrl: "not a url", filtered: false })).status).toBe(400);
  });
});
