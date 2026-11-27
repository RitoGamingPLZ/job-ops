import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_ENV, login, startServer, stopServer } from "./test-utils";

const nativeFetch = globalThis.fetch;

function stateUrl(baseUrl: string, source: string, sourceJobId: string): string {
  return `${baseUrl}/api/watchlist/states/${encodeURIComponent(source)}/${encodeURIComponent(sourceJobId)}`;
}

function checksUrl(baseUrl: string): string {
  return `${baseUrl}/api/watchlist/checks`;
}

function authHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

describe("Watchlist API routes", () => {
  let server: Server;
  let baseUrl: string;
  let closeDb: () => void;
  let tempDir: string;

  afterEach(async () => {
    vi.unstubAllGlobals();
    await stopServer({ server, closeDb, tempDir });
  });

  describe("durable states", () => {
    beforeEach(async () => {
      ({ server, baseUrl, closeDb, tempDir } = await startServer());
    });

    it("attaches 0-10 company ratings to catalog sources", async () => {
      const res = await fetch(`${baseUrl}/api/watchlist/sources`);
      const body = await res.json();

      const stripe = body.data.catalogSources.filter(
        (source: { label: string }) => source.label === "Stripe",
      );
      expect(stripe.length).toBeGreaterThan(1);
      for (const source of stripe) {
        expect(source.rating).toMatchObject({ wlb: 6, salary: 10, source: "editorial" });
      }
    });

    it("lets a system admin edit a rating, validates the range, and keeps the edit", async () => {
      const edit = await fetch(`${baseUrl}/api/watchlist/company-ratings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "Stripe", wlb: 7.5, salary: 9, source: "manual" }),
      });
      expect(edit.status).toBe(200);

      const tooHigh = await fetch(`${baseUrl}/api/watchlist/company-ratings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "Stripe", wlb: 11, salary: 9 }),
      });
      expect(tooHigh.status).toBe(400);

      const body = await (await fetch(`${baseUrl}/api/watchlist/sources`)).json();
      const stripe = body.data.catalogSources.find(
        (source: { label: string }) => source.label === "Stripe",
      );
      expect(stripe.rating).toMatchObject({ wlb: 7.5, salary: 9, source: "manual" });
    });

    it("loads watchlist sources from the career board catalog json", async () => {
      const res = await fetch(`${baseUrl}/api/watchlist/sources`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data.catalogSources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "bamboohr:https://ashteadtechnology.bamboohr.com/careers",
            label: "Ashtead Technology",
            sourceType: "bamboohr",
            careersUrl: "https://ashteadtechnology.bamboohr.com/careers",
            cxsJobsUrl: null,
          }),
          expect.objectContaining({
            id: "adobe-workday",
            label: "Adobe",
            sourceType: "workday",
            careersUrl: "https://adobe.wd5.myworkdayjobs.com/external_experienced",
            cxsJobsUrl:
              "https://adobe.wd5.myworkdayjobs.com/wday/cxs/adobe/external_experienced/jobs",
          }),
          expect.objectContaining({
            id: "pg-workday",
            label: "P&G",
            sourceType: "workday",
            careersUrl: "https://pg.wd5.myworkdayjobs.com/en-US/1000",
            cxsJobsUrl: "https://pg.wd5.myworkdayjobs.com/wday/cxs/pg/1000/jobs",
          }),
        ]),
      );
      expect(body.data.groups).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "big-tech",
            label: "Big tech",
            sourceIds: expect.arrayContaining(["adobe-workday"]),
          }),
        ]),
      );
      expect(body.data.selectedSources).toEqual([]);
      expect(body.data.availableSourceTypes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sourceType: "workday",
            label: "Workday",
            supportsCustomSource: true,
            supportsBranding: true,
          }),
          expect.objectContaining({
            sourceType: "bamboohr",
            label: "BambooHR",
            supportsCustomSource: true,
            supportsBranding: true,
          }),
        ]),
      );
    });

    it("stores only the user's selected watchlist sources", async () => {
      const firstRes = await fetch(`${baseUrl}/api/watchlist/sources`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selections: [
            {
              catalogSourceId: "adobe-workday",
              sourceType: "workday",
              careersUrl: "https://adobe.wd5.myworkdayjobs.com/external_experienced",
            },
            {
              sourceType: "workday",
              careersUrl: "https://example.wd1.myworkdayjobs.com/en-US/careers",
              label: "https://example.wd1.myworkdayjobs.com/en-US/careers",
            },
          ],
        }),
      });
      const firstBody = await firstRes.json();

      expect(firstRes.status).toBe(200);
      expect(firstBody.ok).toBe(true);
      expect(firstBody.data.selectedSources).toEqual([
        expect.objectContaining({
          catalogSourceId: "adobe-workday",
          label: "Adobe",
          careersUrl: "https://adobe.wd5.myworkdayjobs.com/external_experienced",
          sourceType: "workday",
          isCustom: false,
          sortOrder: 0,
        }),
        expect.objectContaining({
          catalogSourceId: null,
          label: "Example",
          careersUrl: "https://example.wd1.myworkdayjobs.com/en-US/careers",
          sourceType: "workday",
          isCustom: true,
          sortOrder: 1,
        }),
      ]);

      const secondBody = await fetch(`${baseUrl}/api/watchlist/sources`).then((res) => res.json());
      expect(secondBody.data.selectedSources).toHaveLength(2);
      expect(secondBody.data.selectedSources[1]).toEqual(
        expect.objectContaining({
          label: "Example",
          careersUrl: "https://example.wd1.myworkdayjobs.com/en-US/careers",
        }),
      );
    });

    it("accepts up to 50 watchlist sources", async () => {
      const selections = Array.from({ length: 50 }, (_, index) => ({
        sourceType: "workday",
        careersUrl: `https://company${index}.wd1.myworkdayjobs.com/External`,
      }));

      const acceptedRes = await fetch(`${baseUrl}/api/watchlist/sources`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selections }),
      });
      const acceptedBody = await acceptedRes.json();

      expect(acceptedRes.status).toBe(200);
      expect(acceptedBody.data.selectedSources).toHaveLength(50);

      const rejectedRes = await fetch(`${baseUrl}/api/watchlist/sources`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selections: [
            ...selections,
            {
              sourceType: "workday",
              careersUrl: "https://company50.wd1.myworkdayjobs.com/External",
            },
          ],
        }),
      });

      expect(rejectedRes.status).toBe(400);
    });

    it("saves a full group of sources and remembers 199 job ids in one check", async () => {
      // Hosted SQLite rejects statements that bind more than 100 parameters, so both writes
      // must be batched. Local SQLite has no such cap, so this guards the round trip.
      const selections = Array.from({ length: 30 }, (_, index) => ({
        sourceType: "workday",
        careersUrl: `https://group${index}.wd1.myworkdayjobs.com/External`,
      }));
      const saved = await fetch(`${baseUrl}/api/watchlist/sources`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selections }),
      }).then((res) => res.json());
      expect(
        saved.data.selectedSources.map((source: { sortOrder: number }) => source.sortOrder),
      ).toEqual(selections.map((_, index) => index));

      const sourceJobIds = Array.from({ length: 199 }, (_, index) => `JOB-${index}`);
      const check = (ids: string[]) =>
        fetch(checksUrl(baseUrl), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ checks: [{ source: "workday:group0", sourceJobIds: ids }] }),
        }).then((res) => res.json());

      const first = await check(sourceJobIds);
      expect(first.ok).toBe(true);
      expect(first.data.jobs).toHaveLength(199);

      const second = await check([...sourceJobIds, "JOB-NEW"]);
      expect(second.ok).toBe(true);
      const fresh = second.data.jobs.filter(
        (job: { isNewSinceLastCheck: boolean }) => job.isNewSinceLastCheck,
      );
      expect(fresh.map((job: { sourceJobId: string }) => job.sourceJobId)).toEqual(["JOB-NEW"]);
    });

    it("caps oversized source-branding responses", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]), {
            status: 200,
            headers: {
              "content-type": "image/png",
              "content-length": "1000001",
            },
          }),
        ),
      );

      const res = await nativeFetch(`${baseUrl}/api/watchlist/source-branding`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-request-id": "watchlist-branding-size-cap",
        },
        body: JSON.stringify({
          sourceType: "workday",
          careersUrl: "https://autodesk.wd1.myworkdayjobs.com/Ext",
        }),
      });
      const body = await res.json();

      expect(res.status).toBe(502);
      expect(body).toMatchObject({
        ok: false,
        error: {
          code: "UPSTREAM_ERROR",
          message: "Workday company logo exceeded size limit",
          details: {
            maxBytes: 1_000_000,
          },
        },
        meta: {
          requestId: "watchlist-branding-size-cap",
        },
      });
    });

    it("derives a custom label from Workday tenant slugs when the site slug is generic", async () => {
      const res = await fetch(`${baseUrl}/api/watchlist/sources`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selections: [
            {
              sourceType: "workday",
              careersUrl: "https://pg.wd5.myworkdayjobs.com/en-US/1000",
              label: "https://pg.wd5.myworkdayjobs.com/en-US/1000",
            },
          ],
        }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data.selectedSources).toEqual([
        expect.objectContaining({
          label: "PG",
          careersUrl: "https://pg.wd5.myworkdayjobs.com/en-US/1000",
          sourceType: "workday",
          isCustom: true,
        }),
      ]);
    });

    it("stores custom Workday URLs in canonical form", async () => {
      const res = await fetch(`${baseUrl}/api/watchlist/sources`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selections: [
            {
              sourceType: "workday",
              careersUrl: "https://pg.wd5.myworkdayjobs.com/en-us/1000/",
              label: "https://pg.wd5.myworkdayjobs.com/en-us/1000/",
            },
          ],
        }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data.selectedSources).toEqual([
        expect.objectContaining({
          label: "PG",
          careersUrl: "https://pg.wd5.myworkdayjobs.com/en-us/1000",
          sourceType: "workday",
          isCustom: true,
        }),
      ]);
    });

    it("stores custom BambooHR URLs in canonical form", async () => {
      const res = await fetch(`${baseUrl}/api/watchlist/sources`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selections: [
            {
              sourceType: "bamboohr",
              careersUrl: "https://ashteadtechnology.bamboohr.com/careers/134/detail",
              label: "https://ashteadtechnology.bamboohr.com/careers/134/detail",
            },
          ],
        }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data.selectedSources).toEqual([
        expect.objectContaining({
          label: "Ashteadtechnology",
          careersUrl: "https://ashteadtechnology.bamboohr.com/careers",
          sourceType: "bamboohr",
          cxsJobsUrl: null,
          isCustom: true,
        }),
      ]);
    });

    it("upserts ignored states and removes them on unignore", async () => {
      const source = "workday:autodesk";
      const sourceJobId = "26WD97952";

      const firstRes = await fetch(stateUrl(baseUrl, source, sourceJobId), {
        method: "PUT",
      });
      const firstBody = await firstRes.json();
      expect(firstRes.status).toBe(200);
      expect(firstBody.ok).toBe(true);
      expect(firstBody.data.state).toMatchObject({
        source,
        sourceJobId,
        state: "ignored",
      });

      const secondRes = await fetch(stateUrl(baseUrl, source, sourceJobId), {
        method: "PUT",
      });
      expect(secondRes.status).toBe(200);

      const listBody = await fetch(`${baseUrl}/api/watchlist/states`).then((res) => res.json());
      expect(listBody.ok).toBe(true);
      expect(listBody.data.states).toHaveLength(1);
      expect(listBody.data.states[0]).toMatchObject({
        source,
        sourceJobId,
        state: "ignored",
      });

      const deleteRes = await fetch(stateUrl(baseUrl, source, sourceJobId), {
        method: "DELETE",
      });
      const deleteBody = await deleteRes.json();
      expect(deleteRes.status).toBe(200);
      expect(deleteBody).toMatchObject({ ok: true, data: { cleared: true } });

      const emptyBody = await fetch(`${baseUrl}/api/watchlist/states`).then((res) => res.json());
      expect(emptyBody.data.states).toEqual([]);
    });

    it("unignores a careers-site posting under every filter of that host, and nothing else", async () => {
      const filtered = (letter: string) => `careers_site:example.com?${letter.repeat(24)}`;
      for (const source of [
        filtered("a"),
        "careers_site:example.com",
        "careers_site:other.example",
        "workday:example.com?x",
      ]) {
        await fetch(stateUrl(baseUrl, source, "job-1"), { method: "PUT" });
      }
      // Viewing the board under another filter, the user clears the ignore.
      await fetch(stateUrl(baseUrl, filtered("b"), "job-1"), { method: "DELETE" });

      const remaining = await fetch(`${baseUrl}/api/watchlist/states`)
        .then((res) => res.json())
        .then((body) => body.data.states.map((state: { source: string }) => state.source).sort());
      expect(remaining).toEqual(["careers_site:other.example", "workday:example.com?x"]);
    });

    it("records per-user watchlist checks and returns new-since-last-check deltas", async () => {
      const firstRes = await fetch(checksUrl(baseUrl), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checks: [
            {
              source: "workday:autodesk",
              sourceJobIds: ["26WD97952", "IGNORED1"],
            },
          ],
        }),
      });
      const firstBody = await firstRes.json();

      expect(firstRes.status).toBe(200);
      expect(firstBody.ok).toBe(true);
      expect(firstBody.data.previousLastCheckedAt).toBe(null);
      expect(firstBody.data.jobs).toEqual([
        expect.objectContaining({
          source: "workday:autodesk",
          sourceJobId: "26WD97952",
          isNewSinceLastCheck: false,
        }),
        expect.objectContaining({
          source: "workday:autodesk",
          sourceJobId: "IGNORED1",
          isNewSinceLastCheck: false,
        }),
      ]);

      const secondRes = await fetch(checksUrl(baseUrl), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checks: [
            {
              source: "workday:autodesk",
              sourceJobIds: ["26WD97952", "BRANDNEW2"],
            },
          ],
        }),
      });
      const secondBody = await secondRes.json();

      expect(secondRes.status).toBe(200);
      expect(secondBody.ok).toBe(true);
      expect(secondBody.data.previousLastCheckedAt).toBeTruthy();
      expect(secondBody.data.jobs).toEqual([
        expect.objectContaining({
          source: "workday:autodesk",
          sourceJobId: "26WD97952",
          isNewSinceLastCheck: false,
        }),
        expect.objectContaining({
          source: "workday:autodesk",
          sourceJobId: "BRANDNEW2",
          isNewSinceLastCheck: true,
        }),
      ]);
    });
  });

  describe("user scoping", () => {
    beforeEach(async () => {
      ({ server, baseUrl, closeDb, tempDir } = await startServer({
        env: AUTH_ENV,
      }));
    });

    it("does not let a regular user edit company ratings", async () => {
      const adminToken = await login(baseUrl, "admin", "secret");
      const createRes = await fetch(`${baseUrl}/api/workspaces/users`, {
        method: "POST",
        headers: authHeaders(adminToken),
        body: JSON.stringify({ username: "adam", displayName: "Adam", password: "adam-secret" }),
      });
      expect(createRes.status).toBe(201);

      const adamToken = await login(baseUrl, "adam", "adam-secret");
      const res = await fetch(`${baseUrl}/api/watchlist/company-ratings`, {
        method: "PUT",
        headers: authHeaders(adamToken),
        body: JSON.stringify({ label: "Stripe", wlb: 1, salary: 1 }),
      });

      expect(res.status).toBe(403);
    });

    it("returns only the active user's state rows within the same tenant", async () => {
      const adminToken = await login(baseUrl, "admin", "secret");

      const createAdamRes = await fetch(`${baseUrl}/api/workspaces/users`, {
        method: "POST",
        headers: authHeaders(adminToken),
        body: JSON.stringify({
          username: "adam",
          displayName: "Adam",
          password: "adam-secret",
        }),
      });
      expect(createAdamRes.status).toBe(201);

      const adamToken = await login(baseUrl, "adam", "adam-secret");
      const source = "workday:autodesk";
      const sourceJobId = "26WD97952";

      const ignoreRes = await fetch(stateUrl(baseUrl, source, sourceJobId), {
        method: "PUT",
        headers: authHeaders(adminToken),
      });
      expect(ignoreRes.status).toBe(200);

      const adamBody = await fetch(`${baseUrl}/api/watchlist/states`, {
        headers: { Authorization: `Bearer ${adamToken}` },
      }).then((res) => res.json());
      expect(adamBody.ok).toBe(true);
      expect(adamBody.data.states).toEqual([]);

      const adminBody = await fetch(`${baseUrl}/api/watchlist/states`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      }).then((res) => res.json());
      expect(adminBody.data.states).toHaveLength(1);
      expect(adminBody.data.states[0]).toMatchObject({
        source,
        sourceJobId,
        state: "ignored",
      });
    });

    it("tracks watchlist checks per user within the same tenant", async () => {
      const adminToken = await login(baseUrl, "admin", "secret");

      const createAdamRes = await fetch(`${baseUrl}/api/workspaces/users`, {
        method: "POST",
        headers: authHeaders(adminToken),
        body: JSON.stringify({
          username: "adam",
          displayName: "Adam",
          password: "adam-secret",
        }),
      });
      expect(createAdamRes.status).toBe(201);

      const adamToken = await login(baseUrl, "adam", "adam-secret");

      const adminFirstBody = await fetch(checksUrl(baseUrl), {
        method: "POST",
        headers: authHeaders(adminToken),
        body: JSON.stringify({
          checks: [{ source: "workday:autodesk", sourceJobIds: ["26WD97952"] }],
        }),
      }).then((res) => res.json());
      expect(adminFirstBody.data.previousLastCheckedAt).toBe(null);

      const adamFirstBody = await fetch(checksUrl(baseUrl), {
        method: "POST",
        headers: authHeaders(adamToken),
        body: JSON.stringify({
          checks: [{ source: "workday:autodesk", sourceJobIds: ["26WD97952"] }],
        }),
      }).then((res) => res.json());
      expect(adamFirstBody.data.previousLastCheckedAt).toBe(null);

      const adminSecondBody = await fetch(checksUrl(baseUrl), {
        method: "POST",
        headers: authHeaders(adminToken),
        body: JSON.stringify({
          checks: [{ source: "workday:autodesk", sourceJobIds: ["BRANDNEW2"] }],
        }),
      }).then((res) => res.json());
      expect(adminSecondBody.data.jobs).toEqual([
        expect.objectContaining({
          sourceJobId: "BRANDNEW2",
          isNewSinceLastCheck: true,
        }),
      ]);

      const adamSecondBody = await fetch(checksUrl(baseUrl), {
        method: "POST",
        headers: authHeaders(adamToken),
        body: JSON.stringify({
          checks: [{ source: "workday:autodesk", sourceJobIds: ["BRANDNEW2"] }],
        }),
      }).then((res) => res.json());
      expect(adamSecondBody.data.jobs).toEqual([
        expect.objectContaining({
          sourceJobId: "BRANDNEW2",
          isNewSinceLastCheck: true,
        }),
      ]);
    });

    it("stores custom career sources with description in shared DB and reuses source & filter plan across users", async () => {
      const adminToken = await login(baseUrl, "admin", "secret");
      const createAdamRes = await fetch(`${baseUrl}/api/workspaces/users`, {
        method: "POST",
        headers: authHeaders(adminToken),
        body: JSON.stringify({
          username: "adam",
          displayName: "Adam",
          password: "adam-secret",
        }),
      });
      expect(createAdamRes.status).toBe(201);
      const adamToken = await login(baseUrl, "adam", "adam-secret");

      const originalLlmKey = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = "test-key";

      const settingsRes = await nativeFetch(`${baseUrl}/api/settings`, {
        method: "PATCH",
        headers: authHeaders(adminToken),
        body: JSON.stringify({
          llmProvider: "openai",
          model: "gpt-5-mini",
          llmApiKey: "test-key",
        }),
      });
      expect(settingsRes.status).toBe(200);

      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.startsWith(baseUrl)) {
          return nativeFetch(input);
        }
        if (url === "https://boards-api.greenhouse.io/v1/boards/acme-test") {
          return new Response(JSON.stringify({ name: "Acme Robotics" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (
          url === "https://job-boards.greenhouse.io/v1/boards/acme-test/departments" ||
          url === "https://boards-api.greenhouse.io/v1/boards/acme-test/departments"
        ) {
          return new Response(
            JSON.stringify({
              departments: [
                { name: "Engineering", jobs: [{ id: 1 }, { id: 2 }] },
                { name: "Sales", jobs: [{ id: 3 }] },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("boards-api.greenhouse.io/v1/boards/acme-test/jobs")) {
          const jobs = [
            {
              id: 1,
              title: "Senior Backend Engineer",
              absolute_url: "https://job-boards.greenhouse.io/acme-test/jobs/1",
              location: { name: "Remote" },
              updated_at: "2026-05-01T00:00:00Z",
              metadata: [{ name: "Workplace Type", value: "Remote" }],
              departments: [{ name: "Engineering" }],
            },
            {
              id: 2,
              title: "Platform Engineer",
              absolute_url: "https://job-boards.greenhouse.io/acme-test/jobs/2",
              location: { name: "Remote" },
              updated_at: "2026-05-01T00:00:00Z",
              metadata: [{ name: "Workplace Type", value: "Remote" }],
              departments: [{ name: "Engineering" }],
            },
            {
              id: 3,
              title: "Account Executive",
              absolute_url: "https://job-boards.greenhouse.io/acme-test/jobs/3",
              location: { name: "New York" },
              updated_at: "2026-05-01T00:00:00Z",
              metadata: [{ name: "Workplace Type", value: "Hybrid" }],
              departments: [{ name: "Sales" }],
            },
          ];
          return new Response(JSON.stringify({ jobs }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("api.openai.com")) {
          return new Response(
            JSON.stringify({
              output_text: JSON.stringify({
                params: [{ key: "departments", values: ["Engineering"] }],
                rationale: "Matches engineering roles described by the user.",
              }),
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return nativeFetch(input);
      });
      vi.stubGlobal("fetch", fetchMock);

      try {
        // User 1 scans & stores a new custom career URL with name and description
        const scan1Res = await nativeFetch(`${baseUrl}/api/watchlist/sources/scan`, {
          method: "POST",
          headers: authHeaders(adminToken),
          body: JSON.stringify({
            name: "Acme Robotics",
            careersUrl: "https://job-boards.greenhouse.io/acme-test",
            description: "Backend and platform engineering roles",
          }),
        });
        const scan1Body = await scan1Res.json();
        expect(scan1Res.status).toBe(200);
        expect(scan1Body.ok).toBe(true);
        expect(scan1Body.data.reusedSource).toBe(false);
        expect(scan1Body.data.reusedFilterPlan).toBe(false);
        expect(scan1Body.data.source).toMatchObject({
          label: "Acme Robotics",
          sourceType: "greenhouse",
          careersUrl: "https://job-boards.greenhouse.io/acme-test",
          description: "Backend and platform engineering roles",
          suggestedFilterUrl: "https://job-boards.greenhouse.io/acme-test?departments=Engineering",
          isShared: true,
        });
        expect(scan1Body.data.filterPlan).toMatchObject({
          suggestedUrl: "https://job-boards.greenhouse.io/acme-test?departments=Engineering",
          totals: { filtered: 2, unfiltered: 3 },
        });

        const llmCallsAfterFirstScan = fetchMock.mock.calls.filter(([reqUrl]) =>
          String(reqUrl).includes("api.openai.com"),
        ).length;
        expect(llmCallsAfterFirstScan).toBe(1);

        // User 1 saves it to their own watchlist
        const save1Res = await nativeFetch(`${baseUrl}/api/watchlist/sources`, {
          method: "PUT",
          headers: authHeaders(adminToken),
          body: JSON.stringify({
            selections: [
              {
                sourceType: "careers_site",
                label: "Acme Robotics",
                careersUrl: "https://job-boards.greenhouse.io/acme-test?departments=Engineering",
                description: "Backend and platform engineering roles",
              },
            ],
          }),
        });
        const save1Body = await save1Res.json();
        expect(save1Res.status).toBe(200);
        expect(save1Body.data.selectedSources[0]).toMatchObject({
          label: "Acme Robotics",
          sourceType: "greenhouse",
          description: "Backend and platform engineering roles",
        });

        // User 2 checks their Watchlist: starts empty (no user leakage), but catalogSources includes the shared DB source!
        const adamSourcesRes = await nativeFetch(`${baseUrl}/api/watchlist/sources`, {
          headers: { Authorization: `Bearer ${adamToken}` },
        });
        const adamSourcesBody = await adamSourcesRes.json();
        expect(adamSourcesRes.status).toBe(200);
        expect(adamSourcesBody.data.selectedSources).toEqual([]);
        const sharedEntry = adamSourcesBody.data.catalogSources.find(
          (source: { careersUrl: string }) =>
            source.careersUrl === "https://job-boards.greenhouse.io/acme-test",
        );
        expect(sharedEntry).toMatchObject({
          label: "Acme Robotics",
          description: "Backend and platform engineering roles",
          suggestedFilterUrl: "https://job-boards.greenhouse.io/acme-test?departments=Engineering",
          isShared: true,
        });

        // User 2 scans the same URL: reuses source & filter plan from DB with ZERO new LLM calls!
        const scan2Res = await nativeFetch(`${baseUrl}/api/watchlist/sources/scan`, {
          method: "POST",
          headers: authHeaders(adamToken),
          body: JSON.stringify({
            careersUrl: "https://job-boards.greenhouse.io/acme-test",
          }),
        });
        const scan2Body = await scan2Res.json();
        expect(scan2Res.status).toBe(200);
        expect(scan2Body.data.reusedSource).toBe(true);
        expect(scan2Body.data.reusedFilterPlan).toBe(true);
        expect(scan2Body.data.filterPlan).toMatchObject({
          suggestedUrl: "https://job-boards.greenhouse.io/acme-test?departments=Engineering",
          reused: true,
        });

        const llmCallsAfterSecondScan = fetchMock.mock.calls.filter(([reqUrl]) =>
          String(reqUrl).includes("api.openai.com"),
        ).length;
        expect(llmCallsAfterSecondScan).toBe(1);
      } finally {
        if (originalLlmKey === undefined) {
          delete process.env.OPENAI_API_KEY;
        } else {
          process.env.OPENAI_API_KEY = originalLlmKey;
        }
      }
    });
  });
});
