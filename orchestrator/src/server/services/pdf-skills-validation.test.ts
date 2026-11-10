import type { ReactiveResumeV5Document } from "@shared/types";
import { describe, expect, it, vi } from "vitest";
import { prepareTailoredResumeForPdf } from "./rxresume";
import { buildDefaultReactiveResumeDocument } from "./rxresume/document";

vi.mock("@server/repositories/settings", () => ({
  getSetting: vi.fn(async () => null),
}));

describe("initial editor document skills", () => {
  it("preserves v5 skill fields when materializing legacy tailored skills", async () => {
    const base =
      buildDefaultReactiveResumeDocument() as ReactiveResumeV5Document;
    base.sections.skills.items = [
      {
        id: "existing-skill",
        hidden: false,
        icon: "",
        name: "Languages",
        proficiency: "Advanced",
        level: 3,
        keywords: ["Java"],
      },
    ];
    const prepared = await prepareTailoredResumeForPdf({
      resumeData: base,
      tailoredContent: {
        skills: [{ name: "Languages", keywords: ["TypeScript"] }],
      },
      jobDescription: "TypeScript engineer",
    });
    expect(prepared.data).toMatchObject({
      sections: {
        skills: {
          items: [
            {
              id: "existing-skill",
              hidden: false,
              name: "Languages",
              proficiency: "Advanced",
              level: 3,
              keywords: ["TypeScript"],
            },
          ],
        },
      },
    });
    expect(base.sections.skills.items[0].keywords).toEqual(["Java"]);
  });
  it("copies valid skill structure for a newly tailored category", async () => {
    const base =
      buildDefaultReactiveResumeDocument() as ReactiveResumeV5Document;
    base.sections.skills.items = [
      {
        id: "skill-template",
        hidden: false,
        icon: "",
        name: "Languages",
        proficiency: "",
        level: 0,
        keywords: [],
      },
    ];
    const prepared = await prepareTailoredResumeForPdf({
      resumeData: base,
      tailoredContent: { skills: [{ name: "Tools", keywords: ["Git"] }] },
      jobDescription: "Engineer",
    });
    expect(prepared.data).toMatchObject({
      sections: {
        skills: {
          items: [
            {
              id: expect.any(String),
              hidden: false,
              name: "Tools",
              level: 0,
              keywords: ["Git"],
            },
          ],
        },
      },
    });
  });
});
