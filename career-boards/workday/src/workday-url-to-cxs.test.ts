import { describe, expect, it } from "vitest";
import {
  isWorkdayUrl,
  parseWorkdayJobUrl,
  parseWorkdayUrl,
  WorkdayUrlParseError,
  workdayUrlToCxsJobsUrl,
} from "./workday-url-to-cxs";

describe("workday-url-to-cxs", () => {
  it("parses legacy myworkdayjobs URLs with optional locale", () => {
    const parsed = parseWorkdayUrl("https://autodesk.wd1.myworkdayjobs.com/en-US/Ext");
    expect(parsed).toMatchObject({
      kind: "legacy-myworkdayjobs",
      tenant: "autodesk",
      site: "Ext",
      shard: "wd1",
      locale: "en-US",
      cxsJobsUrl: "https://autodesk.wd1.myworkdayjobs.com/wday/cxs/autodesk/Ext/jobs",
      canonicalCareersUrl: "https://autodesk.wd1.myworkdayjobs.com/en-US/Ext",
    });
    expect(workdayUrlToCxsJobsUrl("https://autodesk.wd1.myworkdayjobs.com/Ext")).toBe(
      "https://autodesk.wd1.myworkdayjobs.com/wday/cxs/autodesk/Ext/jobs",
    );
  });

  it("parses myworkdaysite recruiting URLs and direct CXS URLs", () => {
    const recruiting = parseWorkdayUrl("https://wd5.myworkdaysite.com/recruiting/workday/Workday");
    expect(recruiting).toMatchObject({
      kind: "myworkdaysite-recruiting",
      tenant: "workday",
      site: "Workday",
      shard: "wd5",
      cxsJobsUrl: "https://wd5.myworkdaysite.com/wday/cxs/workday/Workday/jobs",
      canonicalCareersUrl: "https://wd5.myworkdaysite.com/recruiting/workday/Workday",
    });

    const directCxs = parseWorkdayUrl("https://pg.wd5.myworkdayjobs.com/wday/cxs/pg/1000/jobs");
    expect(directCxs).toMatchObject({
      kind: "cxs-jobs-endpoint",
      tenant: "pg",
      site: "1000",
      canonicalCareersUrl: "https://pg.wd5.myworkdayjobs.com/1000",
    });
  });

  it("parses job detail URLs and rejects invalid URLs", () => {
    const job = parseWorkdayJobUrl("https://pg.wd5.myworkdayjobs.com/en-US/1000/job/Engineer_R123");
    expect(job).toMatchObject({
      externalPath: "/job/Engineer_R123",
      cxsJobUrl: "https://pg.wd5.myworkdayjobs.com/wday/cxs/pg/1000/job/Engineer_R123",
      canonicalJobUrl: "https://pg.wd5.myworkdayjobs.com/en-US/1000/job/Engineer_R123",
    });

    expect(isWorkdayUrl("https://example.com/careers")).toBe(false);
    expect(() => parseWorkdayUrl("")).toThrow(WorkdayUrlParseError);
    expect(() => parseWorkdayUrl("https://autodesk.wd1.myworkdayjobs.com/")).toThrow(
      /MISSING_SITE|careers site slug/i,
    );
  });
});
