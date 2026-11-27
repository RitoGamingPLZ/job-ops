import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { extractExtraFields } from "./fields";
import {
  collapseText,
  deadlineDate,
  formatEmploymentType,
  formatSalary,
  jobLocation,
} from "./normalize";
import type { DetailFields } from "./types";

function run(html: string, fields: DetailFields, posting: Record<string, unknown> | null = null) {
  const dom = new JSDOM(html);
  try {
    return extractExtraFields({ document: dom.window.document, posting, fields });
  } finally {
    dom.window.close();
  }
}

describe("normalize helpers", () => {
  it("formats a single salary, a range and a pay interval", () => {
    expect(
      formatSalary({
        currency: "usd",
        value: { minValue: 100000, maxValue: "150,000", unitText: "YEAR" },
      }),
    ).toBe("USD 100,000–150,000 per year");
    expect(formatSalary({ currency: "CAD", value: 42.5 })).toBe("CAD 42.5");
    expect(formatSalary({ value: { value: 80000 } })).toBe("80,000");
  });

  it.each([
    ["no amount", { currency: "USD", value: {} }],
    ["negative", { currency: "USD", value: -5 }],
    ["text", { currency: "USD", value: "competitive" }],
    [
      "two currencies",
      [
        { currency: "USD", value: 1 },
        { currency: "EUR", value: 1 },
      ],
    ],
  ])("never invents a salary for %s", (_name, raw) => {
    expect(formatSalary(raw)).toBeNull();
  });

  it("keeps one salary when a list repeats the same amount", () => {
    expect(
      formatSalary([
        { currency: "USD", value: 5 },
        { currency: "USD", value: 5 },
      ]),
    ).toBe("USD 5");
  });

  it("keeps date-only deadlines date-only and rejects unparseable ones", () => {
    expect(deadlineDate("2026-12-31")).toBe("2026-12-31");
    expect(deadlineDate("2026-12-31T10:00:00Z")).toBe("2026-12-31T10:00:00.000Z");
    expect(deadlineDate("sometime soon")).toBeNull();
  });

  it("maps employment types and ignores OTHER", () => {
    expect(formatEmploymentType(["FULL_TIME", "contract"])).toBe("Full-time, contract");
    expect(formatEmploymentType("PART TIME")).toBe("Part-time");
    expect(formatEmploymentType("OTHER")).toBeNull();
    expect(formatEmploymentType(undefined)).toBeNull();
  });

  it("treats blank and overlong text as absent", () => {
    expect(collapseText("  a \n b ")).toBe("a b");
    expect(collapseText("   ")).toBeNull();
    expect(collapseText("x".repeat(201))).toBeNull();
    expect(collapseText(3)).toBeNull();
  });

  it("joins distinct job locations", () => {
    expect(
      jobLocation([
        { address: { addressLocality: "Toronto", addressRegion: "ON", addressCountry: "CA" } },
        { name: "Remote" },
        "Remote",
      ]),
    ).toBe("Toronto, ON, CA; Remote");
  });
});

describe("extractExtraFields", () => {
  it("reads JobPosting properties only for the matching field", () => {
    const posting = {
      baseSalary: {
        currency: "USD",
        value: { minValue: 90000, maxValue: 120000, unitText: "YEAR" },
      },
      validThrough: "2026-12-01",
      employmentType: "FULL_TIME",
    };
    expect(
      run(
        "<html></html>",
        {
          salary: { kind: "jobPosting", property: "baseSalary" },
          deadline: { kind: "jobPosting", property: "validThrough" },
          jobType: { kind: "jobPosting", property: "employmentType" },
          // A rule for the wrong property must not leak another field's value.
          jobLevel: { kind: "jobPosting", property: "employmentType" },
        },
        posting,
      ),
    ).toEqual({
      salary: "USD 90,000–120,000 per year",
      deadline: "2026-12-01",
      jobType: "Full-time",
      jobLevel: null,
    });
  });

  it("returns nothing for a JobPosting rule when the page has no structured posting", () => {
    expect(
      run("<html></html>", { salary: { kind: "jobPosting", property: "baseSalary" } }),
    ).toEqual({ salary: null });
  });

  it("reads selector text and attributes, and drops values that are not salaries or dates", () => {
    const html = `<main>
      <span class="pay">  $120k – $150k </span>
      <span class="level">Senior</span>
      <time class="close" datetime="2026-11-30">Closes soon</time>
    </main>`;
    expect(
      run(html, {
        salary: { kind: "selector", selector: ".pay" },
        jobLevel: { kind: "selector", selector: ".level" },
        deadline: { kind: "selector", selector: ".close", attribute: "datetime" },
        jobType: { kind: "selector", selector: ".missing" },
      }),
    ).toEqual({
      salary: "$120k – $150k",
      jobLevel: "Senior",
      deadline: "2026-11-30",
      jobType: null,
    });
    expect(
      run(`<p class="pay">Competitive</p><p class="close">Apply soon</p>`, {
        salary: { kind: "selector", selector: ".pay" },
        deadline: { kind: "selector", selector: ".close" },
      }),
    ).toEqual({ salary: null, deadline: null });
  });

  it("survives an invalid selector without failing the posting", () => {
    expect(run("<p></p>", { salary: { kind: "selector", selector: "[[" } })).toEqual({
      salary: null,
    });
  });

  it.each([
    ["dt/dd", "<dl><dt>Job type:</dt><dd>Contract</dd></dl>"],
    ["sibling spans", "<div><span>Job type</span><span>Contract</span></div>"],
    ["inline label", "<ul><li><b>Job type:</b> Contract</li></ul>"],
  ])("finds a labelled value in a %s layout", (_name, html) => {
    expect(
      run(`<section class="meta">${html}</section>`, {
        jobType: { kind: "label", container: ".meta", label: "Job Type" },
      }),
    ).toEqual({ jobType: "Contract" });
  });

  it("leaves a label blank when two different values follow it", () => {
    expect(
      run(
        `<section class="meta"><dl><dt>Level</dt><dd>Senior</dd><dt>Level</dt><dd>Junior</dd></dl></section>`,
        { jobLevel: { kind: "label", container: ".meta", label: "Level" } },
      ),
    ).toEqual({ jobLevel: null });
  });

  it("does nothing without rules", () => {
    expect(run("<p>$100</p>", {})).toEqual({});
  });
});

describe("a pay of zero is not a salary", () => {
  it.each([
    ["zero", { currency: "USD", value: 0 }],
    ["zero range", { currency: "USD", value: { minValue: 0, maxValue: 0, unitText: "YEAR" } }],
    ["blank string", { currency: "USD", value: "" }],
    ["whitespace", { currency: "USD", value: { minValue: " ", maxValue: " " } }],
  ])("yields nothing for %s", (_name, raw) => {
    expect(formatSalary(raw)).toBeNull();
  });
});
