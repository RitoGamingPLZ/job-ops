import { describe, expect, it } from "vitest";
import { getBlockedAutofetchLabel } from "./manual-job-autofetch";

describe("getBlockedAutofetchLabel", () => {
  it.each([
    ["https://linkedin.com/jobs/view/1", "LinkedIn"],
    ["https://www.linkedin.com/jobs/view/1", "LinkedIn"],
    ["https://uk.LinkedIn.com/jobs/view/1", "LinkedIn"],
    ["  https://www.linkedin.com/jobs/view/1  ", "LinkedIn"],
    ["https://notlinkedin.com/jobs", null],
    ["https://linkedin.com.example.org/jobs", null],
    ["https://indeed.com/viewjob?jk=1", "Indeed"],
    ["https://uk.indeed.com/viewjob?jk=1", "Indeed"],
    ["https://www.indeed.co.uk/viewjob?jk=1", "Indeed"],
    // Current broad substring match: kept deliberately.
    ["https://notindeed.example.org/jobs", "Indeed"],
    ["https://jobs.example.org/indeed", null],
    ["https://boards.greenhouse.io/acme/jobs/1", null],
    ["", null],
    ["   ", null],
    ["not a url", null],
    ["mailto:jobs@linkedin.com", null],
  ])("%j -> %j", (url, expected) => {
    expect(getBlockedAutofetchLabel(url)).toBe(expected);
  });
});
