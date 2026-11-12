import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  getRequestContext,
  runWithRequestContext,
} from "@infra/request-context";
import { getSetting } from "@server/repositories/settings";
import { splitDescription } from "@shared/resume-bullets";
import { getItemLines } from "@shared/resume-links";
import { createJob } from "@shared/testing/factories";
import type { ExperienceBullet, ReactiveResumeV5Document } from "@shared/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  generateResumeFromLibrary,
  LIBRARY_PROMPT_MAX_BYTES,
} from "./resume-from-library";
import { buildDefaultReactiveResumeDocument } from "./rxresume/document";

const mocks = vi.hoisted(() => ({ callJson: vi.fn(), usage: vi.fn() }));
vi.mock("@server/repositories/settings", () => ({
  getSetting: vi.fn(async () => null),
}));
vi.mock("./modelSelection", () => ({
  createConfiguredLlmService: async () => ({ callJson: mocks.callJson }),
  resolveLlmModel: async () => "test",
}));
vi.mock("./hosted-usage", () => ({
  withHostedUsageReservation: async (
    args: unknown,
    work: () => Promise<{ result: unknown }>,
  ) => {
    mocks.usage(args);
    return (await work()).result;
  },
}));
vi.mock("./writing-style", () => ({
  getWritingStyle: async () => ({ tone: "Direct", summaryMaxWords: 50 }),
}));
const item = (
  id: string,
  kind: ExperienceBullet["kind"],
  text: string,
  extra: Partial<ExperienceBullet> = {},
): ExperienceBullet => ({
  id,
  kind,
  text,
  data: null,
  parentId: null,
  position: 0,
  company: null,
  role: null,
  startDate: null,
  endDate: null,
  tags: [],
  source: "manual",
  sourceExperienceId: null,
  createdAt: "now",
  updatedAt: "now",
  ...extra,
});
const library = [
  item("role", "role", "Engineer", {
    data: { company: "Acme", period: "2020 – 2025", location: "London" },
  }),
  item("duty", "bullet", "Built software", { parentId: "role" }),
  item("role2", "role", "Lead", { data: { company: "Other" } }),
  item("other", "bullet", "Led a team", { parentId: "role2" }),
  item("skill", "skill", "Languages", {
    data: { keywords: ["TypeScript", "Python"] },
  }),
  item("project", "project", "Portfolio", { data: { period: "2025" } }),
  item("point", "project_point", "Built a site", { parentId: "project" }),
  item("school", "education", "BSc", {
    data: { school: "University", period: "2016 – 2020" },
  }),
  item("award", "award", "Prize"),
  item("cert", "certification", "Certificate", { data: { issuer: "Issuer" } }),
];
let base: ReactiveResumeV5Document;
let selection: {
  headline: string;
  summary: string;
  experience: {
    id: string;
    intro: string | null;
    lines: { id: string; text: string | null }[];
  }[];
  projects: {
    id: string;
    intro: string | null;
    lines: { id: string; text: string | null }[];
  }[];
  educationIds: string[];
  skills: { id: string; keywords: string[] }[];

  awardIds: string[];
  certificationIds: string[];
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSetting).mockResolvedValue(null);
  base = buildDefaultReactiveResumeDocument() as ReactiveResumeV5Document;
  base.picture.url = "data:image/png;base64,PRIVATE";
  base.basics.email = "private@example.com";
  base.sections.education.items = [
    {
      id: "base-school",
      hidden: false,
      school: "University",
      degree: "BSc",
      area: "",
      grade: "",
      description: "",
      period: "2016 – 2020",
      website: { url: "", label: "" },
      location: "",
    },
  ];
  selection = {
    headline: "Engineer",
    summary: "Builds software",
    experience: [
      { id: "role", intro: null, lines: [{ id: "duty", text: null }] },
    ],
    projects: [
      { id: "project", intro: null, lines: [{ id: "point", text: null }] },
    ],
    educationIds: ["school"],
    skills: [{ id: "skill", keywords: ["typescript", "Invented"] }],

    awardIds: ["award"],
    certificationIds: ["cert"],
  };
  mocks.callJson.mockImplementation(async () => ({
    success: true,
    data: selection,
  }));
});
describe("generateResumeFromLibrary", () => {
  it("builds linked facts and lines with one reserved LLM call, preserving the skeleton", async () => {
    const result = await generateResumeFromLibrary(base, createJob(), library);
    expect(result.basics.email).toBe(base.basics.email);
    expect(result.metadata).toEqual(base.metadata);
    expect(result.sections.experience.items[0]).toMatchObject({
      libraryId: "role",
      company: "Acme",
      position: "Engineer",
      period: "2020 – 2025",
    });
    expect(getItemLines(result.sections.experience.items[0])).toEqual([
      { text: "Built software", ref: "duty" },
    ]);
    expect(result.sections.skills.items[0]).toMatchObject({
      libraryId: "skill",
      name: "Languages",
      keywords: ["TypeScript"],
    });
    expect(getItemLines(result.sections.projects.items[0])).toEqual([
      { text: "Built a site", ref: "point" },
    ]);
    expect(result.sections.education.items[0]).toMatchObject({
      libraryId: "school",
      school: "University",
    });
    expect(result.sections.awards.items[0].libraryId).toBe("award");
    expect(result.sections.certifications.items[0].libraryId).toBe("cert");
    expect(mocks.callJson).toHaveBeenCalledOnce();
    expect(mocks.usage).toHaveBeenCalledExactlyOnceWith({
      action: "tailoring",
    });
    const prompt = mocks.callJson.mock.calls[0][0].messages[1].content;
    const totalPromptBytes = mocks.callJson.mock.calls[0][0].messages.reduce(
      (total: number, message: { content: string }) =>
        total + Buffer.byteLength(message.content),
      0,
    );
    expect(totalPromptBytes).toBeLessThan(LIBRARY_PROMPT_MAX_BYTES);
    expect(prompt).not.toContain("PRIVATE");
    expect(prompt).not.toContain("private@example.com");
    expect(prompt).toContain("Direct");
    expect(base.basics.headline).not.toBe("Engineer");
  });
  it("excludes library contacts entirely from the prompt", async () => {
    await generateResumeFromLibrary(base, createJob(), [
      ...library,
      item("email-contact", "contact", "library-private@example.com", {
        data: { type: "email", value: "library-private@example.com" },
        tags: ["private-contact-tag"],
      }),
      item("phone-contact", "contact", "+44-private-phone"),
    ]);
    const prompt = mocks.callJson.mock.calls[0][0].messages[1].content;
    expect(JSON.parse(prompt).library).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ kind: "contact" }),
      ]),
    );
    expect(prompt).not.toContain("library-private@example.com");
    expect(prompt).not.toContain("+44-private-phone");
    expect(prompt).not.toContain("private-contact-tag");
  });
  it.each([
    true,
    false,
  ])("keeps omitted nested base roles and their intros (source identity: %s)", async (sourceIdentity) => {
    base.sections.experience.items = [
      {
        id: "company",
        hidden: false,
        company: "Acme",
        position: "",
        location: "London",
        period: "2020 – 2025",
        website: { url: "", label: "" },
        description: "",
        roles: [
          {
            id: "nested-engineer",
            position: "Engineer",
            period: "2020 – 2025",
            description: "<p>Nested intro.</p><ul><li>Built software</li></ul>",
          },
        ],
      },
    ];
    selection.experience = [];
    const result = await generateResumeFromLibrary(
      base,
      createJob(),
      library
        .map((entry) =>
          entry.id === "role" && sourceIdentity
            ? {
                ...entry,
                text: "Updated engineer title",
                sourceExperienceId: "nested-engineer",
              }
            : entry,
        )
        .concat(
          item("extra", "bullet", "Extra library duty", { parentId: "role" }),
        ),
    );
    expect(result.sections.experience.items).toHaveLength(1);
    expect(result.sections.experience.items[0]).toMatchObject({
      libraryId: "role",
      company: "Acme",
      position: sourceIdentity ? "Updated engineer title" : "Engineer",
    });
    expect(
      splitDescription(result.sections.experience.items[0].description)
        .introHtml,
    ).toBe("<p>Nested intro.</p>");
    expect(getItemLines(result.sections.experience.items[0])).toEqual([
      { text: "Built software", ref: "duty" },
    ]);
  });
  it("selects duplicate-label skill groups by library id and validates their own keywords", async () => {
    selection.skills = [
      { id: "rust-skill", keywords: ["rust", "Python"] },
      { id: "skill", keywords: ["python", "Rust"] },
      { id: "rust-skill", keywords: ["Rust"] },
      { id: "role", keywords: ["Engineer"] },
      { id: "missing", keywords: ["Invented"] },
    ];
    const result = await generateResumeFromLibrary(base, createJob(), [
      ...library,
      item("rust-skill", "skill", "Languages", {
        data: { keywords: ["Rust"] },
      }),
    ]);
    expect(result.sections.skills.items).toMatchObject([
      { libraryId: "rust-skill", name: "Languages", keywords: ["Rust"] },
      { libraryId: "skill", name: "Languages", keywords: ["Python"] },
    ]);
    expect(result.sections.skills.items).toHaveLength(2);
    const schema =
      mocks.callJson.mock.calls[0][0].jsonSchema.schema.properties.skills.items;
    expect(schema.required).toEqual(["id", "keywords"]);
  });
  it("reserves up to three duties per role before filling the budget by overlap", async () => {
    const crowded = [
      ...library.filter((entry) => entry.kind !== "bullet"),
      ...Array.from({ length: 160 }, (_, index) =>
        item(
          `crowded-${index}`,
          "bullet",
          index < 4 ? "Unrelated work" : "TypeScript platform",
          { parentId: "role" },
        ),
      ),
      ...Array.from({ length: 4 }, (_, index) =>
        item(`starved-${index}`, "bullet", "Led a team", { parentId: "role2" }),
      ),
    ];
    await generateResumeFromLibrary(
      base,
      createJob({ jobDescription: "TypeScript platform" }),
      crowded,
    );
    const prompt = JSON.parse(
      mocks.callJson.mock.calls[0][0].messages[1].content,
    );
    const duties = prompt.library.filter(
      (entry: ExperienceBullet) => entry.kind === "bullet",
    );
    expect(duties).toHaveLength(150);
    expect(
      duties.filter((entry: ExperienceBullet) => entry.parentId === "role2"),
    ).toHaveLength(3);
    expect(
      duties
        .filter((entry: ExperienceBullet) => entry.parentId === "role")
        .every(
          (entry: ExperienceBullet) => entry.text === "TypeScript platform",
        ),
    ).toBe(true);
  });
  it("gives each role one duty before reserving extra duties near the budget", async () => {
    const crowded = Array.from({ length: 80 }, (_, index) => [
      item(`role-${index}`, "role", "Engineer", { data: { company: "Acme" } }),
      ...Array.from({ length: 4 }, (_, duty) =>
        item(`duty-${index}-${duty}`, "bullet", "Built software", {
          parentId: `role-${index}`,
        }),
      ),
    ]).flat();
    await generateResumeFromLibrary(base, createJob(), crowded);
    const prompt = JSON.parse(
      mocks.callJson.mock.calls[0][0].messages[1].content,
    );
    const duties = prompt.library.filter(
      (entry: ExperienceBullet) => entry.kind === "bullet",
    );
    expect(duties).toHaveLength(150);
    expect(
      new Set(duties.map((entry: ExperienceBullet) => entry.parentId)).size,
    ).toBe(80);
  });
  it("drops unknown and cross-parent ids, deduplicates picks and falls back when all submitted lines are invalid", async () => {
    selection.experience = [
      {
        id: "role",
        intro: null,
        lines: ["missing", "other", "duty", "duty"].map((id) => ({
          id,
          text: null,
        })),
      },
      { id: "role", intro: "Duplicate", lines: [] },
      { id: "missing", intro: null, lines: [] },
      { id: "award", intro: null, lines: [] },
      { id: "role2", intro: null, lines: [{ id: "duty", text: null }] },
    ];
    selection.projects = ["missing", "award", "project", "project"].map(
      (id) => ({ id, intro: null, lines: [] }),
    );
    const result = await generateResumeFromLibrary(base, createJob(), library);
    expect(
      result.sections.experience.items.map((item) => item.bulletRefs),
    ).toEqual([["duty"], ["other"]]);
    expect(result.sections.projects.items).toHaveLength(1);
  });
  it("keeps the base duty subset when all submitted lines are invalid", async () => {
    base.sections.experience.items = [
      {
        id: "base-role",
        hidden: false,
        company: "Acme",
        position: "Engineer",
        location: "London",
        period: "2020 – 2025",
        website: { url: "", label: "" },
        description: "<ul><li>Built software</li></ul>",
        roles: [],
      },
    ];
    selection.experience = [
      { id: "role", intro: null, lines: [{ id: "missing", text: null }] },
    ];
    const result = await generateResumeFromLibrary(base, createJob(), [
      ...library,
      item("extra", "bullet", "Extra library duty", { parentId: "role" }),
    ]);
    expect(getItemLines(result.sections.experience.items[0])).toEqual([
      { text: "Built software", ref: "duty" },
    ]);
  });
  it.each([
    1, 2,
  ])("enforces locked, excluded and capped projects (max %i) using base identities", async (maxProjects) => {
    base.sections.projects.items = [
      {
        id: "base-locked",
        hidden: true,
        libraryId: "project",
        name: "Old title",
        period: "old",
        description: "",
        website: { url: "", label: "" },
      },
      {
        id: "base-excluded",
        hidden: true,
        name: "Excluded",
        period: "2024",
        description: "",
        website: { url: "", label: "" },
      },
      {
        id: "base-eligible",
        hidden: true,
        name: "Eligible",
        period: "2023",
        description: "",
        website: { url: "", label: "" },
      },
    ];
    vi.mocked(getSetting).mockResolvedValue(
      JSON.stringify({
        maxProjects,
        lockedProjectIds: ["base-locked"],
        aiSelectableProjectIds: ["base-eligible"],
      }),
    );
    selection.projects = ["excluded", "eligible", "project", "eligible"].map(
      (id) => ({ id, intro: null, lines: [] }),
    );
    const result = await generateResumeFromLibrary(base, createJob(), [
      ...library,
      item("excluded", "project", "Excluded", { data: { period: "2024" } }),
      item("eligible", "project", "Eligible", { data: { period: "2023" } }),
    ]);
    expect(
      result.sections.projects.items.map((entry) => entry.libraryId),
    ).toEqual(maxProjects === 1 ? ["project"] : ["project", "eligible"]);
    const prompt = JSON.parse(
      mocks.callJson.mock.calls[0][0].messages[1].content,
    );
    expect(prompt.projectSelection).toEqual({
      lockedProjectIds: ["project"],
      aiSelectableProjectIds: ["eligible"],
      maxProjects,
    });
    expect(getSetting).toHaveBeenCalledWith("resumeProjects");
    expect(mocks.callJson).toHaveBeenCalledOnce();
  });
  it("reads project policy separately in each tenant scope during concurrent generation", async () => {
    vi.mocked(getSetting).mockImplementation(async () =>
      JSON.stringify({
        maxProjects: 1,
        lockedProjectIds:
          getRequestContext()?.tenantId === "tenant-a" ? ["project"] : [],
        aiSelectableProjectIds: [],
      }),
    );
    const [a, b] = await Promise.all([
      runWithRequestContext({ tenantId: "tenant-a", userId: "user-a" }, () =>
        generateResumeFromLibrary(base, createJob(), library),
      ),
      runWithRequestContext({ tenantId: "tenant-b", userId: "user-b" }, () =>
        generateResumeFromLibrary(base, createJob(), library),
      ),
    ]);
    expect(a.sections.projects.items.map((entry) => entry.libraryId)).toEqual([
      "project",
    ]);
    expect(b.sections.projects.items).toEqual([]);
    expect(getSetting).toHaveBeenCalledTimes(2);
    expect(mocks.callJson).toHaveBeenCalledTimes(2);
  });
  it("honors a zero project cap without overriding it with LLM picks", async () => {
    vi.mocked(getSetting).mockResolvedValue(
      JSON.stringify({
        maxProjects: 0,
        lockedProjectIds: [],
        aiSelectableProjectIds: ["project"],
      }),
    );
    const result = await generateResumeFromLibrary(base, createJob(), library);
    expect(result.sections.projects.items).toEqual([]);
  });
  it("includes visible base projects by default even when the LLM omits them", async () => {
    base.sections.projects.items = [
      {
        id: "base-project",
        hidden: false,
        name: "Portfolio",
        period: "2025",
        description: "",
        website: { url: "", label: "" },
      },
    ];
    selection.projects = [];
    const result = await generateResumeFromLibrary(base, createJob(), library);
    expect(
      result.sections.projects.items.map((entry) => entry.libraryId),
    ).toEqual(["project"]);
  });
  it.each([
    true,
    false,
  ])("uses current library education in selected order (linked base: %s)", async (linked) => {
    if (linked) base.sections.education.items[0].libraryId = "school";
    selection.educationIds = [
      "new-school",
      "school",
      "new-school",
      "role",
      "foreign",
    ];
    const result = await generateResumeFromLibrary(base, createJob(), [
      item("new-school", "education", "MSc", {
        data: { school: "New University", location: "Paris", period: "2025" },
      }),
      ...library.map((entry) =>
        entry.id === "school"
          ? {
              ...entry,
              text: "BSc (updated)",
              data: {
                school: "Updated University",
                location: "Toronto",
                period: "2017 – 2021",
              },
            }
          : entry,
      ),
    ]);
    expect(result.sections.education.items).toMatchObject([
      {
        libraryId: "new-school",
        degree: "MSc",
        school: "New University",
        location: "Paris",
        period: "2025",
      },
      {
        libraryId: "school",
        degree: "BSc (updated)",
        school: "Updated University",
        location: "Toronto",
        period: "2017 – 2021",
      },
    ]);
    expect(result.sections.education.items).toHaveLength(2);
  });
  it.each([
    true,
    false,
  ])("preserves matching base intros with linked lines (with lists: %s)", async (withLists) => {
    base.sections.experience.items = [
      {
        id: "base-role",
        hidden: false,
        company: "Acme",
        position: "Engineer",
        period: "2020 – 2025",
        location: "",
        website: { url: "", label: "" },
        roles: [],
        description: `<p>Role intro.</p>${withLists ? "<ul><li>Old duty</li></ul>" : ""}`,
      },
    ];
    base.sections.projects.items = [
      {
        id: "base-project",
        hidden: true,
        libraryId: "project",
        name: "Old project name",
        period: "old",
        website: { url: "", label: "" },
        description: `<p>A scheduling service for clinics.</p>${withLists ? "<ul><li>Old point</li></ul>" : ""}`,
      },
    ];
    const result = await generateResumeFromLibrary(base, createJob(), library);
    expect(
      splitDescription(result.sections.experience.items[0].description)
        .introHtml,
    ).toBe("<p>Role intro.</p>");
    expect(
      splitDescription(result.sections.projects.items[0].description).introHtml,
    ).toBe("<p>A scheduling service for clinics.</p>");
    expect(getItemLines(result.sections.experience.items[0])).toEqual([
      { text: "Built software", ref: "duty" },
    ]);
    expect(getItemLines(result.sections.projects.items[0])).toEqual([
      { text: "Built a site", ref: "point" },
    ]);
    expect(result.sections.projects.items[0].name).toBe("Portfolio");
  });
  it("selects education and rewrites linked lines/intros as escaped job-only text", async () => {
    selection.educationIds = [];
    selection.experience[0].intro = "Job intro <script>";
    selection.experience[0].lines[0].text = "Reworded duty <b>";
    selection.projects[0].intro = "Project & intro";
    selection.projects[0].lines = [
      { id: "point", text: "Reworded project point" },
      { id: "duty", text: "Wrong parent" },
    ];
    const result = await generateResumeFromLibrary(base, createJob(), library);
    expect(getItemLines(result.sections.experience.items[0])).toEqual([
      { text: "Reworded duty <b>", ref: "duty" },
    ]);
    expect(
      splitDescription(result.sections.experience.items[0].description)
        .introHtml,
    ).toBe("<p>Job intro &lt;script&gt;</p>");
    expect(getItemLines(result.sections.projects.items[0])).toEqual([
      { text: "Reworded project point", ref: "point" },
    ]);
    expect(result.sections.education.items).toEqual([]);
    expect(library.find((entry) => entry.id === "duty")?.text).toBe(
      "Built software",
    );
  });
  it("honors explicit empty role and project lines while omitted locked projects keep their points", async () => {
    selection.experience[0].lines = [];
    selection.projects[0].lines = [];
    let result = await generateResumeFromLibrary(base, createJob(), library);
    expect(getItemLines(result.sections.experience.items[0])).toEqual([]);
    expect(getItemLines(result.sections.projects.items[0])).toEqual([]);
    vi.mocked(getSetting).mockResolvedValue(
      JSON.stringify({
        maxProjects: 1,
        lockedProjectIds: ["project"],
        aiSelectableProjectIds: [],
      }),
    );
    selection.projects = [];
    result = await generateResumeFromLibrary(base, createJob(), library);
    expect(getItemLines(result.sections.projects.items[0])).toEqual([
      { text: "Built a site", ref: "point" },
    ]);
  });
  it.each([
    "",
    "   ",
  ])("keeps base intros for blank rewrites (%j)", async (intro) => {
    base = await generateResumeFromLibrary(base, createJob(), library);
    base.sections.experience.items[0].description = "<p>Base role intro</p>";
    base.sections.projects.items[0].description = "<p>Base project intro</p>";
    selection.experience[0].intro = intro;
    selection.projects[0].intro = intro;
    const result = await generateResumeFromLibrary(base, createJob(), library);
    expect(
      splitDescription(result.sections.experience.items[0].description)
        .introHtml,
    ).toBe("<p>Base role intro</p>");
    expect(
      splitDescription(result.sections.projects.items[0].description).introHtml,
    ).toBe("<p>Base project intro</p>");
  });
  it("retains library chronology for reordered and omitted model roles", async () => {
    base = await generateResumeFromLibrary(base, createJob(), library);
    const older = {
      id: "role2",
      intro: null,
      lines: [{ id: "other", text: "Rewritten older duty" }],
    };
    selection.experience = [older, ...selection.experience];
    let result = await generateResumeFromLibrary(base, createJob(), library);
    expect(
      result.sections.experience.items.map((item) => item.libraryId),
    ).toEqual(["role", "role2"]);
    selection.experience = [older];
    result = await generateResumeFromLibrary(base, createJob(), library);
    expect(
      result.sections.experience.items.map((item) => item.libraryId),
    ).toEqual(["role", "role2"]);
    expect(getItemLines(result.sections.experience.items[1])).toEqual([
      { text: "Rewritten older duty", ref: "other" },
    ]);
  });
  it("falls back for invalid project points without treating an explicit empty array as invalid", async () => {
    selection.projects[0].lines = [{ id: "duty", text: "Wrong parent" }];
    const result = await generateResumeFromLibrary(base, createJob(), library);
    expect(getItemLines(result.sections.projects.items[0])).toEqual([
      { text: "Built a site", ref: "point" },
    ]);
  });
  it("supplies plain-text structured facts and grounded intros without arbitrary data or URLs", async () => {
    base.sections.projects.items = [
      {
        id: "base-project",
        libraryId: "project",
        hidden: true,
        name: "Portfolio",
        period: "2025",
        description:
          "<p>Grounded intro https://intro.example me+test@private.example www.intro.example</p><ul><li>Old point</li></ul>",
        website: { url: "", label: "" },
      },
    ];
    await generateResumeFromLibrary(
      base,
      createJob(),
      library.map((entry) => ({
        ...entry,
        data: {
          ...entry.data,
          area: "Computing",
          grade: "First",
          awarder: "Society",
          description:
            '<p>Plain <a href="https://private.example">details</a> https://private.example test@private.example www.private.example</p>',
          website: { url: "https://private.example" },
          arbitrary: "PRIVATE DATA",
        },
      })),
    );
    const prompt = mocks.callJson.mock.calls[0][0].messages[1].content;
    const catalog = JSON.parse(prompt).library;
    expect(
      catalog.find((entry: ExperienceBullet) => entry.id === "project").intro,
    ).toBe("Grounded intro");
    expect(
      catalog.find((entry: ExperienceBullet) => entry.id === "school").data,
    ).toMatchObject({
      area: "Computing",
      grade: "First",
      description: "Plain details",
      school: "University",
    });
    expect(
      catalog.find((entry: ExperienceBullet) => entry.id === "award").data
        .awarder,
    ).toBe("Society");
    expect(
      catalog.find((entry: ExperienceBullet) => entry.id === "cert").data
        .issuer,
    ).toBe("Issuer");
    expect(prompt).not.toContain("https://private.example");
    expect(prompt).not.toContain("intro.example");
    expect(prompt).not.toContain("private.example");
    expect(prompt).not.toContain("PRIVATE DATA");
    expect(prompt).not.toContain("<p>");
  });
  it("preserves URLs and addresses in library line text supplied to the model", async () => {
    const text =
      "Launched www.shop.example https://shop.example with shop@example.com";
    await generateResumeFromLibrary(
      base,
      createJob(),
      library.map((entry) =>
        entry.id === "duty" ? { ...entry, text } : entry,
      ),
    );
    const prompt = JSON.parse(
      mocks.callJson.mock.calls[0][0].messages[1].content,
    );
    expect(
      prompt.library.find((entry: ExperienceBullet) => entry.id === "duty")
        .text,
    ).toBe(text);
  });
  it("never uses a duty omitted from the bounded prompt catalog", async () => {
    const crowded = [
      ...library,
      ...Array.from({ length: 160 }, (_, index) =>
        item(`extra-${index}`, "bullet", "Relevant platform", {
          parentId: "role",
        }),
      ),
    ];
    mocks.callJson.mockImplementation(async (args) => {
      const supplied = new Set(
        JSON.parse(args.messages[1].content).library.map(
          (entry: ExperienceBullet) => entry.id,
        ),
      );
      const omitted = crowded.find(
        (entry) => entry.kind === "bullet" && !supplied.has(entry.id),
      );
      expect(omitted).toBeDefined();
      return {
        success: true,
        data: {
          ...selection,
          experience: [
            {
              id: "role",
              intro: null,
              lines: [{ id: omitted?.id, text: "Injected" }],
            },
          ],
        },
      };
    });
    const result = await generateResumeFromLibrary(
      base,
      createJob({ jobDescription: "Relevant platform" }),
      crowded,
    );
    const supplied = JSON.parse(
      mocks.callJson.mock.calls[0][0].messages[1].content,
    ).library;
    expect(getItemLines(result.sections.experience.items[0])).toEqual(
      supplied
        .filter(
          (entry: ExperienceBullet) =>
            entry.kind === "bullet" && entry.parentId === "role",
        )
        .map((entry: ExperienceBullet) => ({
          text: entry.text,
          ref: entry.id,
        })),
    );
  });
  it("imports no rewritten line or duplicate on following library syncs in either tenant", async () => {
    selection.experience[0].lines[0].text = "Job-only duty rewrite";
    selection.projects[0].lines[0].text = "Job-only project rewrite";
    const generated = await generateResumeFromLibrary(
      base,
      createJob(),
      library,
    );
    const dir = await mkdtemp(join(process.cwd(), ".generation-sync-"));
    vi.resetModules();
    vi.stubEnv("DATA_DIR", dir);
    vi.stubEnv("JOBOPS_APP_MODE", "local");
    const database = await import("../db");
    try {
      await import("../db/migrate");
      const { syncCandidateLibrary } = await import("./candidate-library");
      const { runWithRequestContext: scoped } = await import(
        "@infra/request-context"
      );
      for (const tenantId of ["tenant-a", "tenant-b"]) {
        database.db
          .insert(database.schema.tenants)
          .values({ id: tenantId, name: tenantId, slug: tenantId })
          .run();
        if (tenantId === "tenant-a") {
          database.db
            .insert(database.schema.experienceBullets)
            .values(library.map((entry) => ({ ...entry, tenantId })))
            .run();
        }
        database.db
          .insert(database.schema.jobs)
          .values({
            id: tenantId,
            tenantId,
            title: "Engineer",
            employer: "Acme",
            jobUrl: "https://example.com",
            status: "ready",
          })
          .run();
        database.db
          .insert(database.schema.jobResumes)
          .values({
            jobId: tenantId,
            tenantId,
            document: generated,
            revision: 1,
          })
          .run();
        scoped({ tenantId }, () => {
          expect(syncCandidateLibrary().created).toBe(0);
          expect(syncCandidateLibrary().created).toBe(0);
        });
      }
      for (const saved of database.db
        .select()
        .from(database.schema.jobResumes)
        .all()) {
        expect(
          getItemLines(saved.document.sections.experience.items[0]),
        ).toEqual([{ text: "Job-only duty rewrite", ref: "duty" }]);
        expect(getItemLines(saved.document.sections.projects.items[0])).toEqual(
          [{ text: "Job-only project rewrite", ref: "point" }],
        );
      }
      const stored = database.db
        .select()
        .from(database.schema.experienceBullets)
        .all();
      expect(stored).toHaveLength(library.length);
      expect(stored.find((entry) => entry.id === "duty")?.text).toBe(
        "Built software",
      );
      expect(stored.find((entry) => entry.id === "point")?.text).toBe(
        "Built a site",
      );
      expect(stored.every((entry) => entry.tenantId === "tenant-a")).toBe(true);
    } finally {
      database.closeDb();
      vi.unstubAllEnvs();
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("omits deleted kinds instead of resurrecting unlinked base facts", async () => {
    const result = await generateResumeFromLibrary(
      base,
      createJob(),
      library.filter(
        (item) => !["project", "award", "certification"].includes(item.kind),
      ),
    );
    expect(result.sections.projects.items).toEqual([]);
    expect(result.sections.awards.items).toEqual([]);
    expect(result.sections.certifications.items).toEqual([]);
  });
  it.each([
    { success: false, error: "private upstream body" },
    { success: true, data: {} },
  ])("throws on failed or malformed output", async (response) => {
    mocks.callJson.mockResolvedValue(response);
    await expect(
      generateResumeFromLibrary(base, createJob(), library),
    ).rejects.toThrow(/selection/);
  });
  it("rejects excessive input before reserving or calling the LLM", async () => {
    await expect(
      generateResumeFromLibrary(base, createJob(), [
        item("huge", "role", "x".repeat(LIBRARY_PROMPT_MAX_BYTES)),
      ]),
    ).rejects.toThrow("prompt limit");
    expect(mocks.callJson).not.toHaveBeenCalled();
    expect(mocks.usage).not.toHaveBeenCalled();
  });
});
