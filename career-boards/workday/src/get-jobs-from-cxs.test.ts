import { describe, expect, it, vi } from "vitest";
import { getJobsFromCxs, WorkdayCxsFetchError } from "./get-jobs-from-cxs";

describe("getJobsFromCxs", () => {
  it("paginates CXS responses and respects maxJobs", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            total: 3,
            jobPostings: [
              {
                title: "Backend Engineer",
                externalPath: "/job/Backend-Engineer_R101",
                locationsText: "London, UK",
                postedOn: "Posted Today",
                bulletFields: ["R101"],
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            total: 3,
            jobPostings: [
              {
                title: "Frontend Engineer",
                externalPath: "/job/Frontend-Engineer_R102",
              },
              {
                title: "Extra Engineer",
                externalPath: "/job/Extra-Engineer_R103",
              },
            ],
          }),
          { status: 200 },
        ),
      );

    const result = await getJobsFromCxs({
      cxsJobsUrl: "https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/Ext/jobs",
      careersUrl: "https://acme.wd5.myworkdayjobs.com/en-US/Ext",
      company: "Acme",
      limit: 1,
      maxJobs: 2,
      fetchImpl: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ total: 3, fetched: 3 });
    expect(result.jobs[0]).toMatchObject({
      source: "workday",
      externalId: "R101",
      title: "Backend Engineer",
      company: "Acme",
      locationText: "London, UK",
      postedOn: "Posted Today",
      jobUrl: "https://acme.wd5.myworkdayjobs.com/en-US/Ext/job/Backend-Engineer_R101",
    });
  });

  it("throws WorkdayCxsFetchError on HTTP failures, invalid JSON, or missing fields", async () => {
    await expect(
      getJobsFromCxs({
        cxsJobsUrl: "https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/Ext/jobs",
        fetchImpl: async () => new Response("rate limited", { status: 429 }),
      }),
    ).rejects.toMatchObject({
      name: "WorkdayCxsFetchError",
      status: 429,
      responseBody: "rate limited",
    });

    await expect(
      getJobsFromCxs({
        cxsJobsUrl: "https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/Ext/jobs",
        fetchImpl: async () => new Response("not-json", { status: 200 }),
      }),
    ).rejects.toBeInstanceOf(WorkdayCxsFetchError);

    await expect(
      getJobsFromCxs({
        cxsJobsUrl: "https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/Ext/jobs",
        fetchImpl: async () =>
          new Response(JSON.stringify({ total: 1, jobPostings: [{ title: "Missing Path" }] }), {
            status: 200,
          }),
      }),
    ).rejects.toThrow("Workday job posting is missing required field: externalPath.");
  });
});
