import { describe, expect, it } from "vitest";
import { getJobDetailsFromCxs } from "./get-job-details-from-cxs";
import { WorkdayCxsFetchError } from "./get-jobs-from-cxs";

describe("getJobDetailsFromCxs", () => {
  it("normalizes Workday detail payloads and renders list HTML without trailing gaps", async () => {
    const result = await getJobDetailsFromCxs({
      jobUrl: "https://acme.wd5.myworkdayjobs.com/en-US/Ext/job/Engineer_R123",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            hiringOrganization: { name: "Acme Corp" },
            jobPostingInfo: {
              jobReqId: "R123",
              title: "Staff Engineer",
              location: "Remote - US",
              additionalLocations: ["Austin, TX", ""],
              postedOn: "Posted Yesterday",
              timeType: "Full time",
              jobDescription: "<p>Build systems.</p><ul><li>Ship code</li></ul>",
            },
          }),
          { status: 200 },
        ),
    });

    expect(result.job).toMatchObject({
      source: "workday",
      externalId: "R123",
      title: "Staff Engineer",
      company: "Acme Corp",
      locationText: "Remote - US",
      additionalLocations: ["Austin, TX"],
      postedOn: "Posted Yesterday",
      timeType: "Full time",
      jobUrl: "https://acme.wd5.myworkdayjobs.com/en-US/Ext/job/Engineer_R123",
      cxsJobUrl: "https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/Ext/job/Engineer_R123",
    });
    expect(result.job.jobDescriptionText).toContain("Build systems.");
    expect(result.job.jobDescriptionText).toContain("Ship code");
  });

  it("throws WorkdayCxsFetchError on HTTP errors and missing jobPostingInfo", async () => {
    await expect(
      getJobDetailsFromCxs({
        jobUrl: "https://acme.wd5.myworkdayjobs.com/en-US/Ext/job/Engineer_R123",
        fetchImpl: async () => new Response("server down", { status: 503 }),
      }),
    ).rejects.toMatchObject({
      name: "WorkdayCxsFetchError",
      status: 503,
      message: "Workday CXS job detail request failed with HTTP 503.",
    });

    await expect(
      getJobDetailsFromCxs({
        jobUrl: "https://acme.wd5.myworkdayjobs.com/en-US/Ext/job/Engineer_R123",
        fetchImpl: async () => new Response(JSON.stringify({}), { status: 200 }),
      }),
    ).rejects.toBeInstanceOf(WorkdayCxsFetchError);
  });
});
