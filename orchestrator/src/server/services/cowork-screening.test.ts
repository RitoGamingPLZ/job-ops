import type { ExperienceBullet, ReactiveResumeV5Document } from "@shared/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildDefaultReactiveResumeDocument } from "./rxresume/document";

const { callJson, list, reserve } = vi.hoisted(() => ({
  callJson: vi.fn(),
  list: vi.fn(),
  reserve: vi.fn(),
}));
vi.mock("./hosted-usage", () => ({ withHostedUsageReservation: reserve }));
vi.mock("./modelSelection", () => ({
  createConfiguredLlmService: vi.fn(async () => ({ callJson })),
  resolveLlmModel: vi.fn(async () => "mock-model"),
}));
vi.mock("@server/repositories/experience-bullets", () => ({
  listExperienceBullets: list,
  updateExperienceBullet: vi.fn(),
}));

import { SCREENING_RESPONSE_SCHEMA, screenResume } from "./cowork-screening";

const job = { title: "Engineer", employer: "Acme", jobDescription: "Java" };
function doc(): ReactiveResumeV5Document {
  const document =
    buildDefaultReactiveResumeDocument() as ReactiveResumeV5Document;
  document.sections.experience.items = [
    {
      id: "exp",
      company: "Citi",
      position: "Dev",
      description: "<p>Intro</p><ul><li>Built Java APIs</li></ul>",
      hidden: false,
      location: "",
      period: "2020",
      website: { url: "", label: "" },
      roles: [],
    },
    {
      id: "hidden-exp",
      company: "Secret",
      position: "Dev",
      description: "",
      hidden: true,
      location: "",
      period: "",
      website: { url: "", label: "" },
      roles: [],
    },
  ];
  return document;
}
const bullet = (id: string, text = "Built Java tools"): ExperienceBullet => ({
  id,
  kind: "bullet" as const,
  data: null,
  parentId: null,
  position: 0,
  text,
  tags: [],
  company: null,
  role: null,
  startDate: null,
  endDate: null,
  source: "manual",
  sourceExperienceId: null,
  createdAt: "",
  updatedAt: "",
});
const req = (over: Record<string, unknown> = {}) => ({
  text: "Java",
  importance: "must",
  category: "skill",
  status: "met",
  evidence: [],
  libraryBulletIds: [],
  tip: "add it",
  ...over,
});
const answer = (requirements: unknown[], score = 70) =>
  callJson.mockResolvedValue({
    success: true,
    data: { requirements, score, summary: " Good fit. " },
  });
const sent = () => JSON.parse(callJson.mock.calls[0][0].messages[1].content);

beforeEach(() => {
  vi.clearAllMocks();
  reserve.mockImplementation(async (_args, work) => (await work()).result);
  list.mockResolvedValue([bullet("own")]);
});

describe("screenResume", () => {
  it("validates requirements, orders must-haves first and clamps score", async () => {
    answer(
      [
        req({ text: "Kotlin", importance: "nice", status: "missing" }),
        req({ text: "" }),
        req({ status: "bogus" }),
        req({ text: "Java", tip: "should be cleared" }),
      ],
      140,
    );
    const report = await screenResume(job, doc());
    expect(report).toMatchObject({
      score: 100,
      summary: "Good fit.",
      jobTitle: "Engineer",
      employer: "Acme",
    });
    expect(report.requirements.map((r) => [r.text, r.tip])).toEqual([
      ["Java", ""],
      ["Kotlin", "add it"],
    ]);
    expect(new Set(report.requirements.map((r) => r.id)).size).toBe(2);
    expect(callJson.mock.calls[0][0].jsonSchema).toBe(
      SCREENING_RESPONSE_SCHEMA,
    );
  });

  it("sends visible sections with ids and indexed bullets only", async () => {
    answer([]);
    await screenResume(job, doc());
    const experience = sent().resume.sections.find(
      (s: { section: string }) => s.section === "experience",
    );
    expect(experience.items).toEqual([
      expect.objectContaining({
        id: "exp",
        name: "Citi — Dev",
        intro: "Intro",
        bullets: [{ index: 0, text: "Built Java APIs" }],
      }),
    ]);
  });

  it("keeps only library ids that were supplied, downgrading empty in_library", async () => {
    answer([
      req({
        status: "in_library",
        libraryBulletIds: ["own", "own", "foreign"],
      }),
      req({ status: "in_library", libraryBulletIds: ["foreign"] }),
    ]);
    const [a, b] = (await screenResume(job, doc())).requirements;
    expect(a).toMatchObject({
      status: "in_library",
      libraryBulletIds: ["own"],
    });
    expect(b).toMatchObject({ status: "missing", libraryBulletIds: [] });
  });

  it("rebuilds valid focus refs and nulls refs that point nowhere", async () => {
    const ev = (focus: unknown) => ({ text: "x", focus });
    const f = (
      kind: string,
      section?: string,
      itemId?: string,
      i?: number,
    ) => ({
      kind,
      section: section ?? null,
      itemId: itemId ?? null,
      bulletIndex: i ?? null,
    });
    answer([
      req({
        evidence: [
          ev(f("bullet", "experience", "exp", 0)),
          ev(f("item", "experience", "exp")),
          ev(f("summary")),
          ev(f("bullet", "experience", "exp", 1)),
          ev(f("item", "experience", "hidden-exp")),
          ev(f("headline")),
        ],
      }),
      req({
        evidence: [
          ev(f("item", "experience", "nope")),
          ev(f("skill", "experience", "exp")),
          ev(f("section", "volunteer")),
          ev({ kind: "weird" }),
          ev(null),
        ],
      }),
    ]);
    const [a, b] = (await screenResume(job, doc())).requirements;
    const focus = a.evidence.map((e) => e.focus);
    expect(focus.slice(0, 3)).toEqual([
      {
        kind: "bullet",
        section: "experience",
        itemId: "exp",
        bulletIndex: 0,
        label: "Experience › Citi — Dev › Built Java APIs",
      },
      {
        kind: "item",
        section: "experience",
        itemId: "exp",
        label: "Experience › Citi — Dev",
      },
      { kind: "summary", label: "Summary" },
    ]);
    expect(focus.slice(3)).toEqual([null, null]); // evidence capped at 5
    expect(b.evidence.map((e) => e.focus)).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it("caps requirements at 40 with must-haves kept first", async () => {
    answer([
      ...Array.from({ length: 30 }, (_, i) =>
        req({ text: `nice ${i}`, importance: "nice" }),
      ),
      ...Array.from({ length: 30 }, (_, i) => req({ text: `must ${i}` })),
    ]);
    const { requirements } = await screenResume(job, doc());
    expect(requirements).toHaveLength(40);
    expect(requirements.filter((r) => r.importance === "must")).toHaveLength(
      30,
    );
    expect(requirements[0].text).toBe("must 0");
  });

  it("limits the library to 120 bullets by keyword overlap", async () => {
    list.mockResolvedValue([
      ...Array.from({ length: 130 }, (_, i) => bullet(`b${i}`, "Cooking")),
      bullet("java", "Java services"),
    ]);
    answer([]);
    await screenResume(job, doc());
    const library = sent().library;
    expect(library).toHaveLength(120);
    expect(library[0].id).toBe("java");
  });

  it("works with an empty library", async () => {
    list.mockResolvedValue([]);
    answer([req({ status: "in_library", libraryBulletIds: ["own"] })]);
    const report = await screenResume(job, doc());
    expect(sent().library).toEqual([]);
    expect(report.requirements[0].status).toBe("missing");
  });

  it("reserves hosted usage and does not call the LLM when quota is exhausted", async () => {
    reserve.mockRejectedValueOnce(new Error("quota"));
    await expect(screenResume(job, doc())).rejects.toThrow("quota");
    expect(callJson).not.toHaveBeenCalled();
    answer([]);
    await screenResume(job, doc());
    expect(reserve).toHaveBeenLastCalledWith(
      { action: "tailoring" },
      expect.any(Function),
    );
  });

  it("raises an upstream error when the LLM fails", async () => {
    callJson.mockResolvedValue({ success: false, error: "boom" });
    await expect(screenResume(job, doc())).rejects.toThrow(
      "Unable to screen resume",
    );
  });
});
