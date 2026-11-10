import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TYPST_THEME_LABELS, TYPST_THEME_VALUES } from "@shared/types";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { normalizeResumeJsonToLatexDocument } from "./document";
import {
  buildTypstDocument,
  convertDocFieldsToTypst,
  getTypstBinary,
  readTypstTheme,
  renderTypstPdf,
} from "./typst";
import sidebarSample from "./typst-themes/navy-serif/sidebar-sample.json";
import wrapSample from "./typst-themes/navy-serif/wrap-sample.json";

const input = {
  basics: {
    name: "Morgan Example",
    email: "morgan@example.com",
    location: "Example City",
  },
  sections: {
    profiles: {
      items: [
        { network: "Github", website: { url: "https://example.com/code" } },
      ],
    },
    skills: { items: [{ name: "Backend", keywords: ["Java", "Node.js"] }] },
    certifications: {
      items: [
        {
          title: "Example Certificate A",
          date: "2025",
          website: { url: "https://example.com/cert" },
        },
        { title: "Example Certificate B", date: "2024" },
        { title: "Example Certificate C", date: "2023" },
      ],
    },
    experience: {
      items: [
        {
          company: "Example Systems",
          position: "Platform Engineer",
          location: "Remote",
          period: "2023 – Present",
          description:
            "<p>Built <strong>reliable</strong> systems &amp; APIs.</p><ul><li>Reduced latency.</li><li>Improved uptime.</li></ul>",
        },
      ],
    },
    projects: {
      items: [
        {
          name: "Example Project",
          period: "2025",
          description: "<ul><li>Shipped tooling.</li></ul>",
        },
      ],
    },
    education: {
      items: [
        {
          school: "Example University",
          degree: "BSc",
          area: "Computing",
          period: "2022",
        },
      ],
    },
    awards: {
      items: [{ title: "Example Award", description: "Delivery excellence." }],
    },
  },
};

const document = normalizeResumeJsonToLatexDocument(input);
const available =
  spawnSync(getTypstBinary(), ["--version"], { stdio: "ignore" }).status === 0;

describe("Navy Serif", () => {
  it.skipIf(!available)(
    "keeps wrapped lines compact with 1.5pt extra between items",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "navy-wrap-test-"));
      try {
        const path = join(dir, "wrap.pdf");
        await renderTypstPdf({
          document: normalizeResumeJsonToLatexDocument(wrapSample),
          typstTheme: "navy-serif",
          outputPath: path,
          jobId: "fake-wrap-test",
        });
        const pdf = await getDocument({
          data: new Uint8Array(await readFile(path)),
          useSystemFonts: true,
        }).promise;
        try {
          expect(pdf.numPages).toBe(1);
          const page = await pdf.getPage(1);
          const content = await page.getTextContent();
          const items = content.items.filter((item) => "str" in item);
          const markers = items.filter((item) => item.str === "●");
          expect(markers).toHaveLength(3);
          // Experience retains hanging bullets; skills and awards have no markers.
          for (const index of [0]) {
            const start = markers[index].transform[5];
            const next = markers[index + 1].transform[5];
            const baselines = [
              ...new Set(
                items
                  .filter(
                    (item) =>
                      item.str.trim() &&
                      item.transform[5] <= start + 0.01 &&
                      item.transform[5] > next + 0.01,
                  )
                  .map((item) => item.transform[5]),
              ),
            ].sort((a, b) => b - a);
            expect(baselines.length).toBeGreaterThan(1);
            const leading = baselines[0] - baselines[1];
            expect(leading).toBeGreaterThan(11);
            expect(leading).toBeLessThan(13.5);
            for (let i = 1; i < baselines.length; i++) {
              expect(baselines[i - 1] - baselines[i]).toBeCloseTo(leading, 1);
            }
            expect(baselines[baselines.length - 1] - next).toBeCloseTo(
              leading + 1.5,
              1,
            );
          }
        } finally {
          await pdf.destroy();
        }
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );

  it.each([
    [10, 25],
    [90, 35],
    [undefined, 30],
  ])("clamps sidebar width %s to %s", (width, expected) => {
    const doc = normalizeResumeJsonToLatexDocument({
      ...sidebarSample,
      metadata: {
        layout: { ...sidebarSample.metadata.layout, sidebarWidth: width },
      },
    });
    expect(doc.navyLayout?.sidebarWidth).toBe(expected);
  });

  it("registers a selectable offline theme and preserves experience intros separately", () => {
    expect(TYPST_THEME_VALUES).toContain("navy-serif");
    expect(TYPST_THEME_LABELS["navy-serif"]).toBe("Navy Serif");
    expect(document.experience[0]).toMatchObject({
      intro: "Built <strong>reliable</strong> systems & APIs.",
      position: "Platform Engineer",
      location: "Remote",
      bullets: ["Reduced latency.", "Improved uptime."],
    });
    expect(document.defaultSectionOrder).toBe(true);
    const edited = normalizeResumeJsonToLatexDocument({
      ...input,
      sections: {
        ...input.sections,
        experience: {
          items: [
            {
              ...input.sections.experience.items[0],
              description:
                "<p>Built reliable systems.</p><ul><li>Edited bullet.</li></ul>",
            },
          ],
        },
      },
    });
    expect(edited.experience[0]?.intro).toBe("Built reliable systems.");
    expect(edited.experience[0]?.bullets).toEqual(["Edited bullet."]);
  });

  const descriptions = [
    {
      description: "<p>Paragraph one.</p><p>Paragraph two.</p>",
      intro: "Paragraph one.\n\nParagraph two.",
      markup: "Paragraph one.\n\nParagraph two.",
      bullets: [],
    },
    {
      description: "Line one.<br>Line two.",
      intro: "Line one.\nLine two.",
      markup: "Line one.#linebreak()Line two.",
      bullets: [],
    },
    {
      description:
        "<p>Intro text.</p><ul><li>List item.</li></ul><p>Trailing text.</p>",
      intro: "Intro text.",
      markup: "Intro text.",
      bullets: ["List item."],
    },
    {
      description: "<ul><li>List item.</li></ul>",
      intro: null,
      markup: null,
      bullets: ["List item."],
    },
  ];

  it.each(descriptions)("separates prose and list items: $description", ({
    description,
    intro,
    markup,
    bullets,
  }) => {
    const doc = normalizeResumeJsonToLatexDocument({
      sections: { experience: { items: [{ company: "Sample", description }] } },
    });
    expect(doc.experience[0]?.intro).toBe(intro);
    expect(doc.experience[0]?.listBullets).toEqual(bullets);
    expect(convertDocFieldsToTypst(doc).experience[0]?.intro).toBe(markup);
  });

  it.skipIf(!available).each(descriptions)(
    "renders description exactly once: $description",
    async ({ description, bullets }) => {
      const dir = await mkdtemp(join(tmpdir(), "navy-prose-test-"));
      try {
        const doc = normalizeResumeJsonToLatexDocument({
          basics: { name: "Example" },
          sections: {
            experience: { items: [{ company: "Sample", description }] },
          },
        });
        const path = join(dir, "resume.pdf");
        await renderTypstPdf({
          document: doc,
          typstTheme: "navy-serif",
          outputPath: path,
          jobId: "prose-test",
        });
        const pdf = await getDocument({
          data: new Uint8Array(await readFile(path)),
          useSystemFonts: true,
        }).promise;
        try {
          const page = await pdf.getPage(1);
          const content = await page.getTextContent();
          const lines = content.items.filter((item) => "str" in item);
          const text = lines.map((item) => item.str).join(" ");
          for (const phrase of [
            "Paragraph one.",
            "Paragraph two.",
            "Line one.",
            "Line two.",
            "Intro text.",
            "List item.",
          ]) {
            expect(text.split(phrase).length - 1).toBe(
              description.includes(phrase) ? 1 : 0,
            );
          }
          expect(lines.filter((item) => item.str === "●")).toHaveLength(
            bullets.length,
          );
          expect(text).not.toContain("Trailing text.");
          for (const [first, second] of [
            ["Paragraph one.", "Paragraph two."],
            ["Line one.", "Line two."],
          ]) {
            if (!description.includes(first)) continue;
            const a = lines.find((item) => item.str.includes(first));
            const b = lines.find((item) => item.str.includes(second));
            expect(a?.transform[5]).toBeGreaterThan(b?.transform[5] ?? 0);
          }
        } finally {
          await pdf.destroy();
        }
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );

  it.each([
    document,
    normalizeResumeJsonToLatexDocument(sidebarSample),
    ...descriptions.map(({ description }) =>
      normalizeResumeJsonToLatexDocument({
        ...input,
        sections: {
          ...input.sections,
          experience: {
            items: [{ ...input.sections.experience.items[0], description }],
          },
        },
      }),
    ),
  ])("leaves every existing theme's rendered input byte-identical", async (document) => {
    const { defaultSectionOrder: _, navyLayout: _layout, ...legacy } = document;
    legacy.education = document.education.map(
      ({ degree: _degree, area: _area, ...entry }) => entry,
    );
    legacy.experience = document.experience.map(
      ({
        intro: _intro,
        listBullets: _list,
        position: _position,
        location: _location,
        ...entry
      }) => entry,
    );
    for (const id of ["classic", "compact", "clean-print-cv"] as const) {
      const theme = await readTypstTheme(id);
      if (theme.tokens) {
        expect(buildTypstDocument(document, theme.template, theme.tokens)).toBe(
          buildTypstDocument(legacy, theme.template, theme.tokens),
        );
      } else {
        // The adapted theme accesses these fields only. Its template is unchanged.
        const rendered = convertDocFieldsToTypst(document);
        const before = convertDocFieldsToTypst(legacy);
        expect({
          ...rendered,
          defaultSectionOrder: undefined,
          navyLayout: undefined,
          education: rendered.education.map(
            ({ degree: _degree, area: _area, ...entry }) => entry,
          ),
          experience: rendered.experience.map(
            ({
              intro: _intro,
              listBullets: _list,
              position: _position,
              location: _location,
              ...entry
            }) => entry,
          ),
        }).toEqual(before);
        expect(theme.template).not.toMatch(
          /\.intro|\.listBullets|\.position|\.location|defaultSectionOrder/,
        );
      }
    }
  });

  it.skipIf(!available)(
    "renders intro, links, section ordering, and ATS-readable lines offline",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "navy-serif-test-"));
      try {
        const render = async (doc: typeof document, suffix: string) => {
          const path = join(dir, `${suffix}.pdf`);
          await renderTypstPdf({
            document: doc,
            typstTheme: "navy-serif",
            outputPath: path,
            jobId: "fake-navy-test",
          });
          const pdf = await getDocument({
            data: new Uint8Array(await readFile(path)),
            useSystemFonts: true,
          }).promise;
          try {
            const page = await pdf.getPage(1);
            const content = await page.getTextContent();
            const textItems = content.items.filter((item) => "str" in item);
            return {
              text: textItems
                .map((i) => i.str)
                .join(" ")
                .replace(/\s+/g, " "),
              items: textItems,
              annotations: await page.getAnnotations(),
              view: page.view,
            };
          } finally {
            await pdf.destroy();
          }
        };
        const result = await render(document, "default");
        expect(result.view.map(Math.round)).toEqual([0, 0, 595, 842]);
        for (const text of [
          "MORGAN EXAMPLE",
          "Email:",
          "example.com/code",
          "Backend: Java, Node.js",
          "Platform Engineer",
          "Example Systems - Remote",
          "Built reliable systems & APIs.",
          "Reduced latency.",
          "Example Award: Delivery excellence.",
        ])
          expect(result.text).toContain(text);
        const headings = [
          "Skills",
          "Certifications",
          "Experiences",
          "Projects",
          "Education",
          "Awards",
        ];
        expect(headings.map((h) => result.text.indexOf(h))).toEqual(
          headings.map((h) => result.text.indexOf(h)).sort((a, b) => a - b),
        );
        const a = result.items.find((i) =>
          i.str.includes("Example Certificate A"),
        );
        const b = result.items.find((i) =>
          i.str.includes("Example Certificate B"),
        );
        expect(a).toBeDefined();
        expect(b).toBeDefined();
        // One certificate per line, so ATS parsers don't merge them.
        expect(b?.transform[5]).toBeLessThan((a?.transform[5] ?? 0) - 5);
        expect(b?.transform[4]).toBeCloseTo(a?.transform[4] ?? 0, 0);
        expect(result.text).toContain("Example Certificate A - 2025");
        expect(result.text).toContain("BSc in Computing");
        const sidebarDoc = normalizeResumeJsonToLatexDocument(sidebarSample);
        expect(sidebarDoc.navyLayout).toEqual({
          sidebar: ["skills", "certifications"],
          main: ["summary", "experience", "projects", "education", "awards"],
          sidebarWidth: 30,
        });
        const sidebar = await render(sidebarDoc, "sidebar");
        const skill = sidebar.items.find((i) => i.str.startsWith("Platform"));
        const tools = sidebar.items.find((i) => i.str.includes("TypeScript"));
        const summary = sidebar.items.find((i) => i.str === "Summary");
        expect(skill?.transform[4]).toBeCloseTo((12 * 72) / 25.4, 0);
        // "Platform: TypeScript, …" starts on one line.
        expect(tools?.transform[5]).toBeCloseTo(skill?.transform[5] ?? 0, 0);
        expect(summary?.transform[4]).toBeGreaterThan(
          (skill?.transform[4] ?? 0) + 150,
        );
        expect(sidebar.text).toContain(
          "Bachelor of Engineering in Computer Engineering",
        );
        expect(sidebar.items.filter((i) => i.str === "●")).toHaveLength(4);
        const sidebarHeading = sidebar.items.find((i) => i.str === "Skills");
        expect(sidebarHeading?.transform[5]).toBeCloseTo(
          summary?.transform[5] ?? 0,
          0,
        );
        expect(result.annotations.map((a) => a.url)).toContain(
          "https://example.com/code",
        );
        expect(result.annotations.map((a) => a.url)).toContain(
          "https://example.com/cert",
        );
        const reordered = normalizeResumeJsonToLatexDocument({
          ...input,
          metadata: {
            layout: {
              pages: [{ main: ["education", "experience", "skills"] }],
            },
          },
          sections: {
            ...input.sections,
            projects: { hidden: true, items: input.sections.projects.items },
          },
        });
        const custom = await render(reordered, "custom");
        expect(custom.text.indexOf("Education")).toBeLessThan(
          custom.text.indexOf("Experiences"),
        );
        expect(custom.text.indexOf("Experiences")).toBeLessThan(
          custom.text.indexOf("Skills"),
        );
        expect(custom.text).not.toContain("Example Project");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    30000,
  );
});
