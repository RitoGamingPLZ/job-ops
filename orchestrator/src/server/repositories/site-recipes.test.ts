import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Recipe } from "@server/watchlist/careers-site/types";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const recipe: Recipe = {
  version: 1,
  jobUrlPattern: "/jobs/",
  listing: { kind: "sitemap", url: "https://example.com/sitemap.xml" },
  detail: { kind: "jsonld" },
};

describe("global site recipes repository", () => {
  let tempDir: string;
  let db: Awaited<typeof import("../db/index")>["db"];
  let schema: Awaited<typeof import("../db/index")>["schema"];
  let repo: typeof import("./site-recipes");

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(join(tmpdir(), "job-ops-site-recipes-"));
    vi.stubEnv("DATA_DIR", tempDir);
    vi.stubEnv("NODE_ENV", "test");
    await import("../db/migrate");
    ({ db, schema } = await import("../db/index"));
    repo = await import("./site-recipes");
  });

  afterEach(async () => {
    const { closeDb } = await import("../db/index");
    closeDb();
    await rm(tempDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("round-trips a recipe under a normalized host with migration defaults", async () => {
    expect(await repo.getSiteRecipe("example.com")).toBeNull();
    const startedAt = new Date().toISOString();
    await repo.saveSiteRecipe(" EXAMPLE.COM ", recipe);
    const saved = await repo.getSiteRecipe("Example.Com");
    expect(saved).toEqual({
      host: "example.com",
      recipe,
      learnedAt: expect.any(String),
      lastSuccessAt: null,
      consecutiveFailures: 0,
      blockedReason: null,
    });
    expect(saved?.learnedAt.localeCompare(startedAt)).toBeGreaterThanOrEqual(0);
    const row = db.select().from(schema.siteRecipes).get();
    expect(row).toMatchObject({ tier: 0, version: 1 });
    expect(row?.createdAt).toBeTruthy();
    expect(row?.updatedAt).toBeTruthy();
  });

  it("upserts learned recipes, resets failure/block state, and preserves history", async () => {
    await repo.saveSiteRecipe("example.com", recipe);
    await repo.recordSiteRecipeRun("example.com", true);
    const original = db.select().from(schema.siteRecipes).get();
    await repo.recordSiteRecipeRun("example.com", false);
    await repo.markSiteBlocked("example.com", "HTTP 403");
    const next: Recipe = {
      ...recipe,
      listing: {
        kind: "page",
        url: "https://example.com/careers",
        render: true,
        pagination: { kind: "none" },
        maxPages: 1,
      },
    };
    await repo.saveSiteRecipe("EXAMPLE.COM", next);
    expect(await repo.getSiteRecipe("example.com")).toMatchObject({
      recipe: next,
      consecutiveFailures: 0,
      blockedReason: null,
      lastSuccessAt: original?.lastSuccessAt,
    });
    const rows = db.select().from(schema.siteRecipes).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: original?.id,
      createdAt: original?.createdAt,
      tier: 1,
    });
  });

  it("increments failures atomically and resets on success, isolating other hosts", async () => {
    await repo.saveSiteRecipe("example.com", recipe);
    await repo.saveSiteRecipe("other.example", recipe);
    expect(await repo.recordSiteRecipeRun("example.com", false)).toBe(1);
    expect(
      await Promise.all(
        Array.from({ length: 5 }, () => repo.recordSiteRecipeRun("EXAMPLE.COM", false)),
      ),
    ).toEqual([2, 3, 4, 5, 6]);
    expect(await repo.getSiteRecipe("example.com")).toMatchObject({
      consecutiveFailures: 6,
      lastSuccessAt: null,
    });
    expect(await repo.recordSiteRecipeRun("example.com", true)).toBe(0);
    const successful = await repo.getSiteRecipe("example.com");
    expect(successful?.lastSuccessAt).toEqual(expect.any(String));
    await repo.recordSiteRecipeRun("example.com", false);
    expect((await repo.getSiteRecipe("example.com"))?.lastSuccessAt).toBe(
      successful?.lastSuccessAt,
    );
    expect(await repo.getSiteRecipe("other.example")).toMatchObject({
      consecutiveFailures: 0,
      lastSuccessAt: null,
    });
  });

  it("marks an existing host blocked without changing its recipe or run state", async () => {
    await repo.saveSiteRecipe("example.com", recipe);
    await repo.recordSiteRecipeRun("example.com", false);
    await repo.markSiteBlocked("EXAMPLE.COM", "HTTP 406");
    expect(await repo.getSiteRecipe("example.com")).toMatchObject({
      recipe,
      blockedReason: "HTTP 406",
      consecutiveFailures: 1,
    });
    expect(await repo.recordSiteRecipeRun("missing.example", false)).toBe(0);
    await repo.markSiteBlocked("missing.example", "HTTP 403");
    expect(await repo.getSiteRecipe("MISSING.EXAMPLE")).toMatchObject({
      host: "missing.example",
      recipe: null,
      blockedReason: "HTTP 403",
      consecutiveFailures: 0,
      lastSuccessAt: null,
    });
    await repo.markSiteBlocked("missing.example", "HTTP 406");
    expect((await repo.getSiteRecipe("missing.example"))?.blockedReason).toBe("HTTP 406");
    await repo.saveSiteRecipe("missing.example", recipe);
    expect(await repo.getSiteRecipe("missing.example")).toMatchObject({
      recipe,
      blockedReason: null,
    });
  });

  it.each(["{broken", "null", "{}", '{"version":2}'])(
    "reads invalid stored JSON/schema as a null recipe: %s",
    async (stored) => {
      await repo.saveSiteRecipe("example.com", recipe);
      db.update(schema.siteRecipes)
        .set({ recipe: stored })
        .where(eq(schema.siteRecipes.host, "example.com"))
        .run();
      expect(await repo.getSiteRecipe("example.com")).toMatchObject({
        host: "example.com",
        recipe: null,
        consecutiveFailures: 0,
      });
    },
  );

  it("shares public recipes across tenant contexts", async () => {
    const { runWithRequestContext } = await import("@infra/request-context");
    await runWithRequestContext({ tenantId: "tenant-a", userId: "alice" }, () =>
      repo.saveSiteRecipe("example.com", recipe),
    );
    await runWithRequestContext({ tenantId: "tenant-b", userId: "bob" }, async () => {
      expect((await repo.getSiteRecipe("example.com"))?.recipe).toEqual(recipe);
      await repo.recordSiteRecipeRun("example.com", false);
    });
    await runWithRequestContext({ tenantId: "tenant-a", userId: "alice" }, async () => {
      expect((await repo.getSiteRecipe("example.com"))?.consecutiveFailures).toBe(1);
    });
  });
});
