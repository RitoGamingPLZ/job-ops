import type { CoworkChatContext, ExperienceBullet } from "@shared/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildDefaultReactiveResumeDocument } from "./rxresume/document";

const { callJson, list } = vi.hoisted(() => ({
  callJson: vi.fn(),
  list: vi.fn(),
}));
vi.mock("./modelSelection", () => ({
  createConfiguredLlmService: vi.fn(async () => ({ callJson })),
  resolveLlmModel: vi.fn(async () => "mock-model"),
}));
vi.mock("@server/repositories/experience-bullets", () => ({
  listExperienceBullets: list,
}));

import {
  buildCoworkPrompt,
  coworkChatContextSchema,
  extractExperienceBullets,
  filterCoworkSuggestions,
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
    await expect(extractExperienceBullets("input")).rejects.toThrow(
      "Unable to extract",
    );
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
        { ...valid, previousText: undefined },
        { ...valid, bulletIndex: 4 },
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
