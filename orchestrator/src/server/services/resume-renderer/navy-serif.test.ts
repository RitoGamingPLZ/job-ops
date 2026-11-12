import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sectionOrder } from "@client/components/cowork/resumeReorder";
import {
  NAVY_SERIF_CSS_VARS,
  NAVY_SERIF_STYLE,
} from "@shared/resume-style/navy-serif";
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
import datesSample from "./typst-themes/navy-serif/dates-sample.json";
import sidebarSample from "./typst-themes/navy-serif/sidebar-sample.json";
import wrapSample from "./typst-themes/navy-serif/wrap-sample.json";

const input = {
  basics: {
    name: "Morgan Example",
    headline: "Senior Platform Engineer",
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
          issuer: "Example Org",
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
      items: [
        {
          title: "Example Award",
          awarder: "Example Committee",
          date: "2024",
          description: "Delivery excellence.",
        },
      ],
    },
  },
};

const document = normalizeResumeJsonToLatexDocument(input);
const available =
  spawnSync(getTypstBinary(), ["--version"], { stdio: "ignore" }).status === 0;

describe("Navy Serif", () => {
  it("shares readable body and margin tokens while keeping heading sizes", async () => {
    expect(NAVY_SERIF_STYLE.margin).toEqual({ x: 15, y: 15 });
    expect(NAVY_SERIF_CSS_VARS["--rs-body"]).toBe("10.5pt");
    expect(NAVY_SERIF_CSS_VARS["--rs-margin-x"]).toBe("15mm");
    expect(NAVY_SERIF_STYLE.size).toMatchObject({
      body: 10.5,
      section: 14,
      position: 12,
      entry: 11,
    });
    const theme = await readTypstTheme("navy-serif");
    // Entry dates must stay on the company's text line: no grid/table/place/columns.
    expect(theme.template).not.toMatch(
      /\b(grid|table|place|columns)\s*\(|h\(1fr\)/,
    );
    expect(theme.template).toContain('box(width: 1fr, repeat(" "))');
  });

  it("retains all main pages before all sidebar pages, deduplicating like the editor", () => {
    const layout = {
      sidebarWidth: 30,
      pages: [
        {
          fullWidth: false,
          main: ["experience"],
          sidebar: ["skills", "experience"],
        },
        {
          fullWidth: false,
          main: ["education", "summary", "projects"],
          sidebar: ["certifications", "awards"],
        },
      ],
    };
    const doc = normalizeResumeJsonToLatexDocument({
      ...input,
      metadata: { layout },
    });
    expect([
      ...(doc.navyLayout?.main ?? []),
      ...(doc.navyLayout?.sidebar ?? []),
    ]).toEqual(sectionOrder(layout));
  });

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
          const markers = items.filter((item) => item.str === "•");
          expect(markers).toHaveLength(3);
          // Experience retains hanging bullets; skills and awards have no markers.
          for (const index of [0]) {
            const bodyBaseline = (marker: (typeof items)[number]) =>
              items
                .slice(items.indexOf(marker) + 1)
                .find((item) => item.str.trim() && item.str !== "•")
                ?.transform[5] ?? Number.NaN;
            const start = bodyBaseline(markers[index]);
            const next = bodyBaseline(markers[index + 1]);
            const baselines = [
              ...new Set(
                items
                  .filter(
                    (item) =>
                      item.str.trim() &&
                      item.str !== "•" &&
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
          expect(lines.filter((item) => item.str === "•")).toHaveLength(
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
    "right-aligns dates on the company's text line, even when it wraps",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "navy-dates-test-"));
      try {
        const path = join(dir, "dates.pdf");
        await renderTypstPdf({
          document: normalizeResumeJsonToLatexDocument(datesSample),
          typstTheme: "navy-serif",
          outputPath: path,
          jobId: "fake-dates-test",
        });
        const pdf = await getDocument({
          data: new Uint8Array(await readFile(path)),
          useSystemFonts: true,
        }).promise;
        try {
          const page = await pdf.getPage(1);
          const items = (await page.getTextContent()).items.filter(
            (item) => "str" in item,
          );
          const find = (s: string) => items.find((i) => i.str.includes(s));
          for (const [left, date] of [
            ["Example Systems - Remote", "2023 – Present"],
            ["Example Region, Example Country", "2019 – 2023"],
            ["Example Startup - Example Town", "2017 – 2019"],
            ["Example University", "2013 – 2017"],
          ]) {
            expect(find(date)?.transform[5]).toBeCloseTo(
              find(left)?.transform[5] ?? 0,
              0,
            );
            expect(find(date)?.transform[4]).toBeGreaterThan(400);
          }
        } finally {
          await pdf.destroy();
        }
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(!available)(
    "moves a role that does not fit to the next page instead of splitting it",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "navy-keep-test-"));
      try {
        const path = join(dir, "keep.pdf");
        const bullets = (n: number) =>
          `<ul>${Array.from({ length: 5 }, (_, i) => `<li>Role ${n} duty ${i} with enough words to fill a line.</li>`).join("")}</ul>`;
        await renderTypstPdf({
          document: normalizeResumeJsonToLatexDocument({
            basics: { name: "Morgan Example" },
            sections: {
              experience: {
                items: Array.from({ length: 9 }, (_, n) => ({
                  company: `Company ${n}`,
                  position: `Position ${n}`,
                  date: "2020",
                  description: bullets(n),
                })),
              },
            },
          }),
          typstTheme: "navy-serif",
          outputPath: path,
          jobId: "fake-keep-test",
        });
        const pdf = await getDocument({
          data: new Uint8Array(await readFile(path)),
          useSystemFonts: true,
        }).promise;
        try {
          expect(pdf.numPages).toBeGreaterThan(1);
          const pageOf = new Map<string, number>();
          for (let number = 1; number <= pdf.numPages; number++) {
            const page = await pdf.getPage(number);
            for (const item of (await page.getTextContent()).items)
              if ("str" in item) pageOf.set(item.str, number);
          }
          const find = (text: string) =>
            [...pageOf].find(([str]) => str.includes(text))?.[1];
          for (let n = 0; n < 9; n++)
            expect(find(`Role ${n} duty 4`)).toBe(find(`Position ${n}`));
        } finally {
          await pdf.destroy();
        }
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );

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
          // Dates share the company line, so layout-based ATS parsers keep them together.
          "Example Systems - Remote 2023 – Present",
          "Example Project 2025",
          "Built reliable systems & APIs.",
          "Reduced latency.",
          // Awards print like the editor: title, then the description.
          "Example Award: Delivery excellence.",
        ])
          expect(result.text).toContain(text);
        const company = result.items.find((i) =>
          i.str.includes("Example Systems - Remote"),
        );
        const date = result.items.find((i) => i.str.includes("2023 – Present"));
        // Dates are right-aligned yet on the company's baseline.
        expect(date?.transform[5]).toBeCloseTo(company?.transform[5] ?? 0, 0);
        expect(date?.transform[4]).toBeGreaterThan(300);
        const headings = [
          "Skills",
          "Certifications",
          "Experience",
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
        expect(result.text).toContain(
          "Example Certificate A - Example Org - 2025",
        );
        expect(result.text).toContain("BSc in Computing");
        const sidebarDoc = normalizeResumeJsonToLatexDocument(sidebarSample);
        expect(sidebarDoc.navyLayout).toEqual({
          sidebar: ["skills", "certifications"],
          main: ["summary", "experience", "projects", "education", "awards"],
          sidebarWidth: 30,
        });
        const sidebar = await render(sidebarDoc, "sidebar");
        const skill = sidebar.items.find((i) => i.str.startsWith("Platform:"));
        const tools = sidebar.items.find((i) => i.str.includes("TypeScript"));
        const summary = sidebar.items.find((i) => i.str === "Summary");
        expect(skill?.transform[4]).toBeCloseTo((15 * 72) / 25.4, 0);
        // "Platform: TypeScript, …" starts on one line.
        expect(tools?.transform[5]).toBeCloseTo(skill?.transform[5] ?? 0, 0);
        expect(summary?.transform[4]).toBeCloseTo(skill?.transform[4] ?? 0, 0);
        expect(sidebar.text).toContain(
          "Bachelor of Engineering in Computer Engineering",
        );
        expect(sidebar.items.filter((i) => i.str === "•")).toHaveLength(4);
        const sidebarHeading = sidebar.items.find((i) => i.str === "Skills");
        expect(sidebarHeading?.transform[5]).toBeLessThan(
          summary?.transform[5] ?? 0,
        );
        const expectedHeadings = sectionOrder({
          ...sidebarSample.metadata.layout,
          pages: sidebarSample.metadata.layout.pages.map((page) => ({
            ...page,
            fullWidth: false,
          })),
        })
          .filter((key) =>
            [
              "summary",
              "experience",
              "education",
              "awards",
              "skills",
              "certifications",
            ].includes(key),
          )
          .map((key) => key[0].toUpperCase() + key.slice(1));
        expect(
          sidebar.items
            .filter((item) => expectedHeadings.includes(item.str))
            .map((item) => item.str),
        ).toEqual(expectedHeadings);
        const name = result.items.find((i) => i.str === "MORGAN EXAMPLE");
        const headline = result.items.find(
          (i) => i.str === "Senior Platform Engineer",
        );
        const contact = result.items.find((i) => i.str.includes("Email:"));
        expect(name?.transform[5]).toBeGreaterThan(headline?.transform[5] ?? 0);
        expect(headline?.transform[5]).toBeGreaterThan(
          contact?.transform[5] ?? 0,
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
          custom.text.indexOf("Experience"),
        );
        expect(custom.text.indexOf("Experience")).toBeLessThan(
          custom.text.indexOf("Skills"),
        );
        expect(custom.text).not.toContain("Example Project");
        const sparse = await render(
          {
            ...document,
            certifications: [
              { title: "Title only", bullets: [] },
              { title: "Issuer only", subtitle: "Example Org", bullets: [] },
              { title: "Date only", date: "2025", bullets: [] },
            ],
            awards: [
              { title: "Bare award", bullets: [] },
              {
                title: "Awarder only",
                subtitle: "Example Committee",
                bullets: [],
              },
              { title: "Dated award", date: "2024", bullets: [] },
              { title: "Described award", bullets: ["Great delivery."] },
            ],
          },
          "sparse",
        );
        for (const line of [
          "Title only",
          "Issuer only - Example Org",
          "Date only - 2025",
          "Bare award",
          "Awarder only",
          "Dated award",
          "Described award: Great delivery.",
        ]) {
          expect(
            sparse.items.some((item) => item.str === line) ||
              sparse.text.includes(line),
          ).toBe(true);
        }
        expect(sparse.text).not.toMatch(
          /Title only -|Bare award[:,-]|Example Committee|Dated award,| - ,|, :/,
        );
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    30000,
  );
});
