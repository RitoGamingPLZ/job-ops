import { describe, expect, it } from "vitest";
import {
  detectWatchlistSourceTypeForUrl,
  getWatchlistBaseUrlKey,
  stripUrlQueryAndHash,
} from "./detect";

describe("detectWatchlistSourceTypeForUrl", () => {
  it.each([
    ["https://adobe.wd5.myworkdayjobs.com/external_experienced", "workday"],
    ["https://wd5.myworkdaysite.com/recruiting/acme/Careers", "workday"],
    ["https://ashteadtechnology.bamboohr.com/careers/134/detail", "bamboohr"],
    ["https://job-boards.greenhouse.io/stripe", "greenhouse"],
    ["https://boards.greenhouse.io/embed/job_board?for=riotgames", "greenhouse"],
    ["https://jobs.lever.co/spotify?team=Engineering", "lever"],
    ["https://jobs.eu.lever.co/example", "lever"],
    ["https://jobs.ashbyhq.com/openai", "ashby"],
    ["https://jobs.smartrecruiters.com/ServiceNow", "smartrecruiters"],
    [
      "https://fa-exxx-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs",
      "oracle",
    ],
    ["https://www.amazon.jobs/en/search?base_query=engineer", "amazon"],
    ["https://jobs.apple.com/en-us/search?team=SFTWR", "apple"],
    ["https://www.google.com/about/careers/applications/jobs/results/?q=backend", "google"],
    ["https://apply.careers.microsoft.com/careers?query=engineer", "eightfold"],
    ["https://explore.jobs.netflix.net/careers", "eightfold"],
    ["https://www.okta.com/company/careers/", "careers_site"],
    ["https://careers.acme.com/jobs?team=platform", "careers_site"],
    ["http://job-boards.greenhouse.io/stripe", "careers_site"],
    ["https://user:pass@jobs.lever.co/spotify", "careers_site"],
    ["not-a-url", "careers_site"],
  ])("detects %s as %s", (url, expected) => {
    expect(detectWatchlistSourceTypeForUrl(url)).toBe(expected);
  });

  it("normalizes base URL keys without query strings or trailing slashes", () => {
    expect(getWatchlistBaseUrlKey("https://WWW.Okta.com/company/careers/?team=Eng#top")).toBe(
      "https://www.okta.com/company/careers",
    );
    expect(getWatchlistBaseUrlKey("https://jobs.example.com/")).toBe("https://jobs.example.com/");
    expect(stripUrlQueryAndHash("https://jobs.lever.co/spotify?team=Eng#top")).toBe(
      "https://jobs.lever.co/spotify",
    );
  });
});
