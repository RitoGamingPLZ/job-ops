import type { CoworkChatContext, ExperienceBullet } from "@shared/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildDefaultReactiveResumeDocument } from "./rxresume/document";

const { callJson, list, reserve, update } = vi.hoisted(() => ({
  callJson: vi.fn(),
  list: vi.fn(),
  reserve: vi.fn(),
  update: vi.fn(),
}));
vi.mock("./hosted-usage", () => ({ withHostedUsageReservation: reserve }));
vi.mock("./modelSelection", () => ({
  createConfiguredLlmService: vi.fn(async () => ({ callJson })),
  resolveLlmModel: vi.fn(async () => "mock-model"),
}));
vi.mock("@server/repositories/experience-bullets", () => ({
  listExperienceBullets: list,
  updateExperienceBullet: update,
}));

import {
  buildCoworkPrompt,
  COWORK_RESPONSE_SCHEMA,
  coworkChatContextSchema,
  extractExperienceBullets,
  filterCoworkSuggestions,
  labelExperienceBullets,
  rankExperienceBullets,
} from "./cowork-ai";

function context(): CoworkChatContext {
  const document =
    buildDefaultReactiveResumeDocument() as CoworkChatContext["document"];
  document.sections.experience.items = [
    {
      id: "exp",
      company: "Acme",
      position: "Dev",
      description: "<ul><li>Built APIs</li></ul>",
      hidden: false,
      location: "",
      period: "",
      website: { url: "", label: "" },
      roles: [],
    },
  ];
  return { document, referencedBulletIds: ["own"] };
}
const bullet = (id: string, text = "Built tools"): ExperienceBullet => ({
  id,
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
beforeEach(() => {
  vi.clearAllMocks();
  reserve.mockImplementation(async (_args, work) => (await work()).result);
  list.mockResolvedValue([bullet("own")]);
});
describe("cowork AI", () => {
  it("extracts unsaved validated drafts, strips injected provenance", async () => {
    callJson.mockResolvedValue({
      success: true,
      data: {
        drafts: [
          { text: "Built APIs", source: "resume", sourceExperienceId: "fake" },
        ],
      },
    });
    expect(await extractExperienceBullets("Built APIs")).toEqual([
      { text: "Built APIs", source: "ai_extract" },
    ]);
    expect(callJson.mock.calls[0][0].jsonSchema.name).toBe(
      "experience_extract",
    );
    callJson.mockResolvedValue({
      success: true,
      data: { drafts: [{ text: "" }] },
    });
    expect(await extractExperienceBullets("input")).toEqual([]);
  });
  it("ranks only scoped IDs, removes duplicates and invalid scores", async () => {
    list.mockResolvedValue([bullet("own"), bullet("second")]);
    callJson.mockResolvedValue({
      success: true,
      data: {
        ranked: [
          { bulletId: "own", score: 30, reason: "ok" },
          { bulletId: "foreign", score: 100, reason: "bad" },
          { bulletId: "second", score: 90, reason: "best" },
          { bulletId: "own", score: 80, reason: "duplicate" },
          { bulletId: "second", score: 999, reason: "bad" },
        ],
      },
    });
    expect(
      (await rankExperienceBullets("tools")).map((b) => b.bulletId),
    ).toEqual(["second", "own"]);
  });
  it("does not call the LLM for an empty library", async () => {
    list.mockResolvedValue([]);
    expect(await rankExperienceBullets("job")).toEqual([]);
    expect(callJson).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
  });
  it("indexes HTML bullets and caps library by overlap while retaining references", () => {
    const library = [
      bullet("own"),
      ...Array.from({ length: 80 }, (_, i) => bullet(`b${i}`, "Python")),
    ];
    const prompt = buildCoworkPrompt(context(), "Python", library);
    const data = JSON.parse(prompt.slice(prompt.indexOf("\n") + 1));
    expect(data.library).toHaveLength(80);
    expect(data.library[0].id).toBe("b0");
    expect(data.referencedBullets[0].id).toBe("own");
    expect(data.resume.experience[0].bullets).toEqual([
      { index: 0, text: "Built APIs" },
    ]);
    expect(data.resume.basics).toBeUndefined();
  });
  it("filters invalid operations and assigns fresh IDs", () => {
    const valid = {
      id: "injected",
      op: "replace_bullet",
      experienceId: "exp",
      bulletIndex: 0,
      previousText: "Built APIs",
      text: "Built robust APIs",
      reason: "clarity",
      sourceBulletIds: ["own", "foreign"],
    };
    const suggestions = filterCoworkSuggestions(
      [
        valid,
        { ...valid, experienceId: "foreign" },
        { ...valid, text: undefined },
        { ...valid, bulletIndex: 4, previousText: "Not in document" },
        { op: "set_skills", reason: "missing" },
        { op: "replace_summary", reason: "missing" },
      ],
      context(),
      [bullet("own")],
    );
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].id).not.toBe("injected");
    expect(suggestions[0].sourceBulletIds).toEqual(["own"]);
  });
  it("uses plain summary/headline context and anchors previousText to the current document", () => {
    const cowork = context();
    cowork.document.summary.content = "<p>Built <strong>tools</strong></p>";
    cowork.document.basics.headline = "<b>Engineer</b>";
    const prompt = buildCoworkPrompt(cowork, "Job", []);
    const data = JSON.parse(prompt.slice(prompt.indexOf("\n") + 1));
    expect(data.resume.summary).toBe("Built tools");
    expect(data.resume.headline).toBe("Engineer");
    const suggestions = filterCoworkSuggestions(
      [
        {
          op: "replace_summary",
          text: "<p>Built robust tools</p>",
          previousText: "<p>wrong</p>",
          reason: "Clarity",
        },
        {
          op: "replace_headline",
          text: "<b>Senior Engineer</b>",
          reason: "Focus",
        },
      ],
      cowork,
      [],
    );
    expect(suggestions[0]).toMatchObject({
      previousText: "Built tools",
      text: "Built robust tools",
    });
    expect(suggestions[1]).toMatchObject({
      previousText: "Engineer",
      text: "Senior Engineer",
    });
  });
  it("reserves tailoring usage for extract/rank and propagates quota rejection", async () => {
    callJson.mockResolvedValue({
      success: true,
      data: { drafts: [], ranked: [] },
    });
    await extractExperienceBullets("text");
    await rankExperienceBullets("job");
    expect(reserve).toHaveBeenCalledTimes(2);
    expect(reserve).toHaveBeenNthCalledWith(
      1,
      { action: "tailoring" },
      expect.any(Function),
    );
    expect(reserve).toHaveBeenNthCalledWith(
      2,
      { action: "tailoring" },
      expect.any(Function),
    );
    callJson.mockClear();
    reserve.mockRejectedValueOnce(new Error("quota exceeded"));
    await expect(extractExperienceBullets("text")).rejects.toThrow(
      "quota exceeded",
    );
    reserve.mockRejectedValueOnce(new Error("quota exceeded"));
    await expect(rankExperienceBullets("job")).rejects.toThrow(
      "quota exceeded",
    );
    expect(callJson).not.toHaveBeenCalled();
  });
  it("uses strict schemas throughout and accepts nullable optional fields", async () => {
    const assertStrict = (node: any) => {
      if (node.type === "object") {
        expect(node.additionalProperties).toBe(false);
        expect([...node.required].sort()).toEqual(
          Object.keys(node.properties).sort(),
        );
      }
      for (const child of Object.values(node.properties ?? {}))
        assertStrict(child);
      if (node.items) assertStrict(node.items);
    };
    assertStrict(COWORK_RESPONSE_SCHEMA.schema);
    callJson.mockResolvedValue({
      success: true,
      data: {
        drafts: [
          {
            text: "Valid",
            company: null,
            role: null,
            startDate: null,
            endDate: null,
            tags: null,
          },
        ],
        ranked: [],
      },
    });
    expect(await extractExperienceBullets("text")).toEqual([
      { text: "Valid", source: "ai_extract" },
    ]);
    await rankExperienceBullets("job");
    for (const [input] of callJson.mock.calls)
      assertStrict(input.jsonSchema.schema);
    expect(
      filterCoworkSuggestions(
        [
          {
            op: "replace_summary",
            text: "Better",
            experienceId: null,
            bulletIndex: null,
            previousText: null,
            skills: null,
            sourceBulletIds: null,
            reason: "Clarity",
          },
        ],
        context(),
        [],
      ),
    ).toHaveLength(1);
  });
  it("anchors replace/delete by normalized text first, then valid index", () => {
    const cowork = context();
    cowork.document.sections.experience.items[0].description =
      "<ul><li>Built APIs</li><li>Built CI</li></ul>";
    const base = {
      op: "replace_bullet",
      experienceId: "exp",
      bulletIndex: 1,
      text: "Better",
      reason: "Clarity",
    };
    const result = filterCoworkSuggestions(
      [
        { ...base, previousText: "  BUILT   APIs " },
        { ...base, previousText: "Hallucination" },
        { ...base, op: "delete_bullet", previousText: null },
        { ...base, bulletIndex: 5, previousText: "missing" },
        { ...base, bulletIndex: 5, previousText: "Built APIs" },
      ],
      cowork,
      [],
    );
    expect(
      result.map(({ bulletIndex, previousText }) => ({
        bulletIndex,
        previousText,
      })),
    ).toEqual([
      { bulletIndex: 0, previousText: "Built APIs" },
      { bulletIndex: 1, previousText: "Built CI" },
      { bulletIndex: 1, previousText: "Built CI" },
      { bulletIndex: 0, previousText: "Built APIs" },
    ]);
  });
  it("prefilters rank to the top 200 by keyword overlap and caps the JD", async () => {
    list.mockResolvedValue([
      ...Array.from({ length: 205 }, (_, i) => bullet(`b${i}`, "unrelated")),
      bullet("match", "Python"),
    ]);
    callJson.mockResolvedValue({
      success: true,
      data: {
        ranked: [{ bulletId: "b204", score: 100, reason: "not supplied" }],
      },
    });
    expect(await rankExperienceBullets(`Python ${"x".repeat(21000)}`)).toEqual(
      [],
    );
    const data = JSON.parse(callJson.mock.calls[0][0].messages[1].content);
    expect(data.jobDescription).toHaveLength(20000);
    expect(data.bullets).toHaveLength(200);
    expect(data.bullets[0].id).toBe("match");
    expect(data.bullets.some((item: any) => item.id === "b204")).toBe(false);
  });
  it("keeps valid extraction items, validates each cap and limits input drafts to 200", async () => {
    callJson.mockResolvedValue({
      success: true,
      data: {
        drafts: [
          { text: "Good" },
          { text: "x".repeat(10001) },
          { text: "Bad tag", tags: ["x".repeat(101)] },
          ...Array.from({ length: 197 }, () => ({ text: "Valid" })),
          { text: "Beyond cap" },
        ],
      },
    });
    const drafts = await extractExperienceBullets("text");
    expect(drafts).toHaveLength(198);
    expect(drafts[0].text).toBe("Good");
    expect(drafts.some((item) => item.text === "Beyond cap")).toBe(false);
    callJson.mockResolvedValue({ success: true, data: { drafts: "invalid" } });
    await expect(extractExperienceBullets("text")).rejects.toThrow(
      "Unable to extract",
    );
  });
  it("validates document shape, reference count and byte cap", () => {
    expect(coworkChatContextSchema.safeParse(context()).success).toBe(true);
    expect(
      coworkChatContextSchema.safeParse({
        document: {},
        referencedBulletIds: [],
      }).success,
    ).toBe(false);
    const huge = context();
    huge.document.basics.headline = "x".repeat(250001);
    expect(coworkChatContextSchema.safeParse(huge).success).toBe(false);
  });
});

describe("experience labeling", () => {
  it("filters to scoped IDs, merges existing tags, trims, dedupes and caps tags", async () => {
    const own = { ...bullet("own"), tags: [" TypeScript ", "React"] };
    list.mockResolvedValue([own]);
    update.mockImplementation(async (_id, input) => ({ ...own, ...input }));
    callJson.mockResolvedValue({
      success: true,
      data: {
        labels: [
          { bulletId: "foreign", tags: ["Secret"] },
          {
            bulletId: "own",
            tags: [
              "typescript",
              " React  ",
              "",
              ...Array.from({ length: 20 }, (_, i) => `Skill${i}`),
            ],
          },
          { bulletId: "own", tags: ["Duplicate"] },
        ],
      },
    });
    const result = await labelExperienceBullets(["own", "foreign"]);
    expect(result.labeled).toBe(1);
    expect(result.bullets[0].tags).toHaveLength(12);
    expect(result.bullets[0].tags.slice(0, 3)).toEqual([
      "TypeScript",
      "React",
      "Skill0",
    ]);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0]).toBe("own");
    expect(callJson.mock.calls[0][0].messages[1].content).not.toContain(
      "foreign",
    );
    const root = callJson.mock.calls[0][0].jsonSchema.schema;
    expect(root.required).toEqual(["labels"]);
    expect(root.additionalProperties).toBe(false);
    expect(root.properties.labels.items.required).toEqual(["bulletId", "tags"]);
    expect(root.properties.labels.items.additionalProperties).toBe(false);
  });
  it("defaults to untagged only and skips explicit empty/foreign IDs without usage", async () => {
    list.mockResolvedValue([{ ...bullet("tagged"), tags: ["Existing"] }]);
    expect(await labelExperienceBullets()).toEqual({
      bullets: [],
      labeled: 0,
      remaining: 0,
    });
    expect(await labelExperienceBullets([])).toEqual({
      bullets: [],
      labeled: 0,
      remaining: 0,
    });
    expect(await labelExperienceBullets(["foreign"])).toEqual({
      bullets: [],
      labeled: 0,
      remaining: 0,
    });
    expect(reserve).not.toHaveBeenCalled();
  });
  it("batches at 40 with bounded text and reserves each call", async () => {
    list.mockResolvedValue(
      Array.from({ length: 81 }, (_, i) => bullet(`b${i}`, "x".repeat(10000))),
    );
    callJson.mockResolvedValue({ success: true, data: { labels: [] } });
    await labelExperienceBullets();
    expect(reserve).toHaveBeenCalledTimes(3);
    expect(
      callJson.mock.calls.map(
        ([input]) => JSON.parse(input.messages[1].content).bullets.length,
      ),
    ).toEqual([40, 40, 1]);
    expect(callJson.mock.calls[0][0].messages[1].content.length).toBeLessThan(
      55000,
    );
  });
  it.each([
    false,
    true,
  ])("caps calls at five batches and reports remaining (explicit=%s)", async (explicit) => {
    const library = Array.from({ length: 205 }, (_, i) => bullet(`b${i}`));
    list.mockResolvedValue(library);
    update.mockImplementation(async (id, input) => {
      const current = library.find((item) => item.id === id);
      if (!current) throw new Error("Unexpected bullet ID");
      Object.assign(current, input);
      return current;
    });
    callJson.mockImplementation(async (input) => ({
      success: true,
      data: {
        labels: JSON.parse(input.messages[1].content).bullets.map(
          (item: { id: string }) => ({ bulletId: item.id, tags: ["APIs"] }),
        ),
      },
    }));
    const result = await labelExperienceBullets(
      explicit ? library.map((item) => item.id) : undefined,
    );
    expect(callJson).toHaveBeenCalledTimes(5);
    expect(reserve).toHaveBeenCalledTimes(5);
    expect(result).toMatchObject({ labeled: 200, remaining: 5 });
    expect(result.bullets).toHaveLength(200);
  });
  it("sanitizes oversized model output without discarding valid labels", async () => {
    list.mockResolvedValue([bullet("own"), bullet("second")]);
    update.mockImplementation(async (id, input) => ({
      ...bullet(id),
      ...input,
    }));
    callJson.mockResolvedValue({
      success: true,
      data: {
        labels: [
          {
            bulletId: "own",
            tags: [
              "x".repeat(101),
              ...Array.from({ length: 110 }, (_, i) => `Skill${i}`),
            ],
          },
          { bulletId: "second", tags: ["Valid"] },
          ...Array.from({ length: 39 }, () => ({
            bulletId: "own",
            tags: ["Ignored"],
          })),
        ],
      },
    });
    const result = await labelExperienceBullets(["own", "second"]);
    expect(result).toMatchObject({ labeled: 2, remaining: 0 });
    expect(result.bullets[0].tags).toEqual(
      Array.from({ length: 12 }, (_, i) => `Skill${i}`),
    );
    expect(result.bullets[1].tags).toEqual(["Valid"]);
  });
  it("counts unlabeled omissions and empty tags as remaining", async () => {
    list.mockResolvedValue([bullet("own"), bullet("second")]);
    update.mockImplementation(async (id, input) => ({
      ...bullet(id),
      ...input,
    }));
    callJson.mockResolvedValue({
      success: true,
      data: { labels: [{ bulletId: "own", tags: [] }] },
    });
    expect(await labelExperienceBullets()).toMatchObject({
      labeled: 1,
      remaining: 2,
    });
    expect(await labelExperienceBullets(["own", "second"])).toMatchObject({
      labeled: 1,
      remaining: 1,
    });
  });
  it("rejects invalid upstream output and propagates quota failures", async () => {
    callJson.mockResolvedValue({
      success: false,
      error: "raw upstream secret",
    });
    await expect(labelExperienceBullets()).rejects.toThrow(
      "Unable to label experience bullets",
    );
    reserve.mockRejectedValueOnce(new Error("quota exceeded"));
    await expect(labelExperienceBullets()).rejects.toThrow("quota exceeded");
  });
});
