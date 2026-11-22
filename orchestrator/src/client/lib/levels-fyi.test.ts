import { describe, expect, it, vi } from "vitest";
import {
  buildLevelsFyiSalaryUrl,
  inferLevelsRoleSlug,
  LEVELS_LOOKUP_START_EVENT,
  LEVELS_SALARY_RESULT_EVENT,
  openLevelsFyiLookup,
  parseLevelsSalaryMessage,
  slugifyCompanyForLevels,
} from "./levels-fyi";

describe("levels-fyi helpers", () => {
  it("slugifies company names and strips corporate suffixes", () => {
    expect(slugifyCompanyForLevels("Stripe, Inc.")).toBe("stripe");
    expect(slugifyCompanyForLevels("OpenAI LLC")).toBe("openai");
    expect(slugifyCompanyForLevels("AT&T Corp.")).toBe("at-and-t");
    expect(slugifyCompanyForLevels("Acme (UK) Limited")).toBe("acme");
  });

  it("infers role slugs from job titles", () => {
    expect(inferLevelsRoleSlug("Senior Backend Software Engineer")).toBe("software-engineer");
    expect(inferLevelsRoleSlug("Staff Machine Learning Engineer")).toBe(
      "machine-learning-engineer",
    );
    expect(inferLevelsRoleSlug("Data Scientist")).toBe("data-scientist");
    expect(inferLevelsRoleSlug("Engineering Manager, Core")).toBe("software-engineering-manager");
    expect(inferLevelsRoleSlug("Office Coordinator")).toBeNull();
  });

  it("builds Levels.fyi salary URLs for company + role or fallbacks", () => {
    expect(
      buildLevelsFyiSalaryUrl({
        employer: "Google LLC",
        title: "Senior Software Engineer",
      }),
    ).toBe("https://www.levels.fyi/companies/google/salaries/software-engineer");

    expect(
      buildLevelsFyiSalaryUrl({
        employer: "Acme Corp.",
        title: "Office Coordinator",
      }),
    ).toBe("https://www.levels.fyi/companies/acme/salaries");

    expect(
      buildLevelsFyiSalaryUrl({
        employer: "   ",
        title: "Product Manager",
      }),
    ).toBe("https://www.levels.fyi/t/product-manager");
  });

  it("posts active lookup context and opens a Levels.fyi popup window", () => {
    const postSpy = vi.spyOn(window, "postMessage").mockImplementation(() => {});
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);

    const url = openLevelsFyiLookup({
      id: "job-42",
      employer: "Stripe Inc.",
      title: "Backend Engineer",
      location: "London",
    });

    expect(url).toBe("https://www.levels.fyi/companies/stripe/salaries/software-engineer");
    expect(postSpy).toHaveBeenCalledWith(
      {
        type: LEVELS_LOOKUP_START_EVENT,
        jobId: "job-42",
        title: "Backend Engineer",
        employer: "Stripe Inc.",
        location: "London",
        url,
      },
      window.location.origin,
    );
    expect(openSpy).toHaveBeenCalledWith(url, "jobops-levels-fyi", "popup,width=1020,height=760");

    postSpy.mockRestore();
    openSpy.mockRestore();
  });

  it("parses valid salary messages and rejects malformed payloads", () => {
    expect(
      parseLevelsSalaryMessage({
        type: LEVELS_SALARY_RESULT_EVENT,
        jobId: "job-1",
        salary: "$180K - $240K",
        salaryMinAmount: 180_000,
        salaryMaxAmount: 240_000,
        salaryCurrency: "USD",
        salaryInterval: "yearly",
        salarySource: "levels.fyi",
      }),
    ).toEqual({
      jobId: "job-1",
      salary: "$180K - $240K",
      salaryMinAmount: 180_000,
      salaryMaxAmount: 240_000,
      salaryCurrency: "USD",
      salaryInterval: "yearly",
      salarySource: "levels.fyi",
      level: undefined,
    });

    expect(parseLevelsSalaryMessage(null)).toBeNull();
    expect(
      parseLevelsSalaryMessage({
        type: "OTHER_EVENT",
        jobId: "job-1",
        salary: "$100K",
      }),
    ).toBeNull();
    expect(
      parseLevelsSalaryMessage({
        type: LEVELS_SALARY_RESULT_EVENT,
        jobId: "",
        salary: "$100K",
      }),
    ).toBeNull();
    expect(
      parseLevelsSalaryMessage({
        type: LEVELS_SALARY_RESULT_EVENT,
        jobId: "job-1",
        salary: "   ",
      }),
    ).toBeNull();
  });
});
