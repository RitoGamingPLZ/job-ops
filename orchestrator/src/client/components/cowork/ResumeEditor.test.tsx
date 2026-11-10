import type { ReactiveResumeV5Document, ResumeSuggestion } from "@shared/types";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResumeEditor } from "./ResumeEditor";

vi.mock("@/client/components/design-resume/RichTextEditor", () => ({
  RichTextEditor: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (value: string) => void;
  }) => (
    <textarea
      aria-label="Summary content"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));
afterEach(cleanup);
const fixture = () =>
  ({
    basics: { headline: "Engineer" },
    summary: { content: "Summary" },
    sections: {
      experience: {
        items: [
          {
            id: "one",
            company: "Company",
            hidden: false,
            description: "<ul><li>A</li><li>B</li><li>C</li></ul>",
          },
        ],
      },
      skills: {
        items: [{ id: "skill", name: "Skills", keywords: ["TypeScript"] }],
      },
      projects: { items: [] },
    },
  }) as unknown as ReactiveResumeV5Document;
const suggestions: ResumeSuggestion[] = [
  {
    id: "insert",
    op: "insert_bullet",
    experienceId: "one",
    bulletIndex: 0,
    text: "X",
    reason: "Insert",
  },
  {
    id: "delete",
    op: "delete_bullet",
    experienceId: "one",
    bulletIndex: 2,
    reason: "Delete",
  },
];
function Workspace() {
  const [document, setDocument] = useState(fixture);
  const [items, setItems] = useState(suggestions);
  return (
    <ResumeEditor
      document={document}
      onChange={setDocument}
      suggestions={items}
      onDismiss={(ids) =>
        setItems((current) => current.filter((s) => !ids.includes(s.id)))
      }
    />
  );
}
describe("resume editor review regressions", () => {
  it("accepts all against the original bullet positions", () => {
    render(<Workspace />);
    fireEvent.click(screen.getByRole("button", { name: "Accept all" }));
    expect(screen.getByLabelText("Company bullet 1")).toHaveValue("X");
    expect(screen.getByLabelText("Company bullet 2")).toHaveValue("A");
    expect(screen.getByLabelText("Company bullet 3")).toHaveValue("B");
    expect(screen.queryByLabelText("Company bullet 4")).toBeNull();
  });
  it("marks an index-only suggestion stale after a sequential accept", () => {
    render(<Workspace />);
    fireEvent.click(screen.getAllByRole("button", { name: "Accept" })[0]);
    expect(screen.getByText(/Not applicable/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Accept" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Accept all" }));
    expect(screen.getByLabelText("Company bullet 4")).toHaveValue("C");
  });
  it("marks index-only targets stale after manual edits but still matches previousText", () => {
    const onChange = vi.fn();
    const document = fixture();
    const items: ResumeSuggestion[] = [
      ...suggestions,
      {
        id: "text",
        op: "replace_bullet",
        experienceId: "one",
        bulletIndex: 2,
        previousText: "C",
        text: "Improved",
        reason: "Text match",
      },
    ];
    const view = render(
      <ResumeEditor
        document={document}
        onChange={onChange}
        suggestions={items}
        onDismiss={vi.fn()}
      />,
    );
    const next = fixture();
    next.sections.experience.items[0].description =
      "<ul><li>Changed</li><li>B</li><li>C</li></ul>";
    view.rerender(
      <ResumeEditor
        document={next}
        onChange={onChange}
        suggestions={items}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getAllByText(/Not applicable/)).toHaveLength(2);
    expect(
      screen
        .getAllByRole("button", { name: "Accept" })
        .filter((button) => !button.hasAttribute("disabled")),
    ).toHaveLength(1);
  });
  it("preserves multi-word skill drafts until blur and drops empty keywords", () => {
    render(<Workspace />);
    const input = screen.getByLabelText("Skill 1 keywords");
    fireEvent.change(input, { target: { value: "Machine " } });
    expect(input).toHaveValue("Machine ");
    fireEvent.change(input, {
      target: { value: "Machine Learning, TypeScript, ," },
    });
    fireEvent.blur(input);
    expect(input).toHaveValue("Machine Learning, TypeScript");
  });
  it("commits the current skill keyword draft on Enter without blur", () => {
    const onChange = vi.fn();
    render(
      <ResumeEditor
        document={fixture()}
        onChange={onChange}
        suggestions={[]}
        onDismiss={vi.fn()}
      />,
    );
    const input = screen.getByLabelText("Skill 1 keywords");
    fireEvent.change(input, {
      target: { value: "Machine Learning, TypeScript, ," },
    });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        sections: expect.objectContaining({
          skills: expect.objectContaining({
            items: [
              expect.objectContaining({
                keywords: ["Machine Learning", "TypeScript"],
              }),
            ],
          }),
        }),
      }),
    );
  });
});

describe("document drag interactions", () => {
  const transfer = (type: string, value: unknown) => ({
    types: [type],
    getData: (requested: string) =>
      requested === type ? JSON.stringify(value) : "",
    dropEffect: "none",
  });
  function Editor() {
    const [document, setDocument] = useState(() => {
      const next = fixture();
      next.sections.experience.items.push({
        ...next.sections.experience.items[0],
        id: "two",
        company: "Other",
        description: "<ul><li>D</li></ul>",
      });
      next.sections.skills.items.push({
        ...next.sections.skills.items[0],
        id: "second-skill",
        name: "Other skills",
        keywords: ["React"],
      });
      return next;
    });
    return (
      <ResumeEditor
        document={document}
        onChange={setDocument}
        suggestions={[]}
        onDismiss={vi.fn()}
      />
    );
  }
  it("moves a resume bullet into a gap in another experience", () => {
    render(<Editor />);
    const dataTransfer = transfer("application/x-jobops-resume-bullet", {
      experienceId: "one",
      index: 1,
    });
    const gap = screen.getAllByTitle("Insert before bullet 1")[0];
    // There are two first-bullet gaps; choose the second experience.
    const destination = screen.getAllByTitle("Insert before bullet 1")[1];
    fireEvent.dragOver(destination, { dataTransfer });
    expect(destination).toHaveAttribute("data-active", "true");
    fireEvent.drop(destination, { dataTransfer });
    expect(screen.getByLabelText("Company bullet 2")).toHaveValue("C");
    expect(screen.getByLabelText("Other bullet 1")).toHaveValue("B");
    expect(gap).toHaveAttribute("data-active", "false");
  });
  it("keeps library replacement and insertion separate from resume moves", () => {
    render(<Editor />);
    const dataTransfer = transfer("application/x-jobops-bullet", {
      id: "library",
      text: "Library duty",
    });
    fireEvent.drop(screen.getByLabelText("Company bullet 1"), {
      dataTransfer,
    });
    expect(screen.getByLabelText("Company bullet 1")).toHaveValue(
      "Library duty",
    );
    fireEvent.drop(screen.getAllByTitle("Insert before bullet 1")[1], {
      dataTransfer,
    });
    expect(screen.getByLabelText("Other bullet 1")).toHaveValue("Library duty");
    expect(screen.getByLabelText("Other bullet 2")).toHaveValue("D");
  });
  it("reorders experience entries and skill lines using their own drag types", () => {
    render(<Editor />);
    fireEvent.drop(screen.getByLabelText("Move experience to position 1"), {
      dataTransfer: transfer("application/x-jobops-resume-experience", "two"),
    });
    expect(screen.getAllByRole("heading", { level: 3 })[0]).toHaveTextContent(
      "Other",
    );
    fireEvent.drop(screen.getByLabelText("Move skills to position 1"), {
      dataTransfer: transfer(
        "application/x-jobops-resume-skill",
        "second-skill",
      ),
    });
    expect(screen.getByLabelText("Skill 1 name")).toHaveValue("Other skills");
    fireEvent.click(screen.getByLabelText("Move skill 1 down"));
    expect(screen.getByLabelText("Skill 1 name")).toHaveValue("Skills");
  });
});

describe("navy serif document content", () => {
  function fullFixture() {
    const next = fixture();
    next.basics.name = "Morgan Example";
    next.sections.education = {
      title: "Education",
      columns: 1,
      hidden: false,
      items: [
        {
          id: "school",
          hidden: false,
          school: "Example University",
          degree: "BSc",
          area: "Computing",
          period: "2018 – 2022",
          grade: "",
          location: "",
          description: "",
          website: { url: "", label: "" },
        },
      ],
    };
    next.sections.certifications = {
      title: "Certifications",
      columns: 2,
      hidden: false,
      items: [
        {
          id: "cert",
          hidden: false,
          title: "Example Certificate",
          issuer: "Example Institute",
          date: "2024",
          description: "",
          website: { url: "https://example.com/cert", label: "Certificate" },
        },
      ],
    };
    next.sections.awards = {
      title: "Awards",
      columns: 1,
      hidden: false,
      items: [
        {
          id: "award",
          hidden: false,
          title: "Example Prize",
          awarder: "Example Group",
          date: "2023",
          description: "<p>For useful work</p>",
          website: { url: "", label: "" },
        },
      ],
    };
    next.sections.experience.items[0].description =
      '<p class="original">Led a team &amp; shipped.</p>\n<p>See <a href="https://example.com">work</a>.</p>\n<ul><li>A</li><li>B</li><li>C</li></ul>';
    return next;
  }
  function mount(initial = fullFixture(), items: ResumeSuggestion[] = []) {
    const onChange = vi.fn();
    function Editor() {
      const [document, setDocument] = useState(initial);
      return (
        <ResumeEditor
          document={document}
          onChange={(next) => {
            onChange(next);
            setDocument(next);
          }}
          suggestions={items}
          onDismiss={vi.fn()}
        />
      );
    }
    render(<Editor />);
    return onChange;
  }
  it("uses default section order and keeps the intro outside the bullet list", () => {
    mount();
    expect(
      screen.getAllByRole("heading", { level: 2 }).map((e) => e.textContent),
    ).toEqual([
      "Summary",
      "Skills",
      "Certifications",
      "Experiences",
      "Education",
      "Awards",
    ]);
    expect(screen.getByLabelText("Company intro")).toHaveValue(
      "Led a team & shipped.\nSee work .",
    );
    expect(screen.getByLabelText("Company bullet 1")).toHaveValue("A");
  });
  it("follows metadata order and omits hidden sections and items", () => {
    const next = fullFixture();
    next.metadata = {
      layout: {
        pages: [
          {
            main: ["education", "awards", "experience"],
            sidebar: ["certifications", "skills"],
          },
        ],
      },
    } as ReactiveResumeV5Document["metadata"];
    next.sections.certifications.hidden = true;
    next.sections.skills.items[0].hidden = true;
    mount(next);
    expect(
      screen.getAllByRole("heading", { level: 2 }).map((e) => e.textContent),
    ).toEqual(["Summary", "Education", "Awards", "Experiences"]);
    expect(screen.queryByLabelText("Certifications 1 title")).toBeNull();
    expect(screen.queryByLabelText("Skill 1 name")).toBeNull();
  });
  it("shows one column (main then sidebar) and reorders sections into pages[0].main", () => {
    const next = fullFixture();
    next.metadata = {
      layout: {
        sidebarWidth: 30,
        pages: [
          {
            fullWidth: false,
            main: ["profiles", "experience", "education", "awards"],
            sidebar: ["skills", "certifications"],
          },
        ],
      },
    } as unknown as ReactiveResumeV5Document["metadata"];
    const onChange = mount(next);
    expect(window.document.querySelector(".resume-sidebar")).toBeNull();
    expect(screen.queryByLabelText(/to sidebar|to main/)).toBeNull();
    expect(
      screen.getAllByRole("heading", { level: 2 }).map((e) => e.textContent),
    ).toEqual([
      "Summary",
      "Experiences",
      "Education",
      "Awards",
      "Skills",
      "Certifications",
    ]);
    fireEvent.click(screen.getByLabelText("Move section Certifications up"));
    let page = onChange.mock.lastCall?.[0].metadata.layout.pages[0];
    expect(page.sidebar).toEqual([]);
    expect(page.main.indexOf("certifications")).toBe(
      page.main.indexOf("skills") - 1,
    );
    expect(page.main).toContain("profiles");
    fireEvent.drop(screen.getByLabelText("Move section before Experiences"), {
      dataTransfer: {
        types: ["application/x-jobops-resume-section"],
        getData: (type: string) =>
          type === "application/x-jobops-resume-section"
            ? JSON.stringify("skills")
            : "",
      },
    });
    page = onChange.mock.lastCall?.[0].metadata.layout.pages[0];
    expect(page.main.indexOf("skills")).toBe(
      page.main.indexOf("experience") - 1,
    );
    expect(
      screen.getAllByRole("heading", { level: 2 }).map((e) => e.textContent),
    ).toEqual([
      "Summary",
      "Skills",
      "Experiences",
      "Education",
      "Awards",
      "Certifications",
    ]);
  });
  it("keeps keyboard focus on section Move buttons after reordering", () => {
    mount();
    const names = screen
      .getAllByRole("heading", { level: 2 })
      .map((e) => e.textContent);
    fireEvent.click(screen.getByLabelText(`Move section ${names[0]} down`));
    expect(
      screen.getByLabelText(`Move section ${names[0]} down`),
    ).toHaveFocus();
    // Moving to the top disables Up, so focus falls to the same section's Down.
    fireEvent.click(screen.getByLabelText(`Move section ${names[0]} up`));
    expect(screen.getByLabelText(`Move section ${names[0]} up`)).toBeDisabled();
    expect(
      screen.getByLabelText(`Move section ${names[0]} down`),
    ).toHaveFocus();
  });
  it("re-runs pagination while typing in local-draft inputs and on focus", () => {
    mount();
    const rects = vi.spyOn(Element.prototype, "getBoundingClientRect");
    const input = screen.getByLabelText("Skill 1 keywords");
    fireEvent.input(input, { target: { value: "Longer keyword text" } });
    expect(rects).toHaveBeenCalled();
    rects.mockClear();
    fireEvent.focus(input);
    expect(rects).toHaveBeenCalled();
    rects.mockRestore();
  });
  it("offers Ask AI focus refs and applies replace_field inline", () => {
    const onAskAi = vi.fn();
    const onChange = vi.fn();
    const suggestion: ResumeSuggestion = {
      id: "field",
      op: "replace_field",
      field: { section: "education", itemId: "school", name: "school" },
      previousText: "Example University",
      text: "Better University",
      reason: "Focus",
    };
    render(
      <ResumeEditor
        document={fullFixture()}
        onChange={onChange}
        suggestions={[suggestion]}
        onDismiss={vi.fn()}
        onAskAi={onAskAi}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Ask AI about Company › bullet 2" }),
    );
    fireEvent.keyDown(
      screen.getByRole("button", {
        name: "Ask AI about Education › Example University",
      }),
      { key: "Enter" },
    );
    expect(onAskAi.mock.calls.map(([ref]) => ref)).toEqual([
      {
        kind: "bullet",
        section: "experience",
        itemId: "one",
        bulletIndex: 1,
        label: "Company › bullet 2",
      },
      {
        kind: "item",
        section: "education",
        itemId: "school",
        label: "Education › Example University",
      },
    ]);
    const row = screen
      .getByLabelText("Education 1 school")
      .closest(".resume-simple-item") as HTMLElement;
    expect(row).toHaveTextContent("Better University");
    fireEvent.click(within(row).getByRole("button", { name: "Accept" }));
    expect(onChange.mock.lastCall?.[0].sections.education.items[0].school).toBe(
      "Better University",
    );
  });
  it("shows education as one degree-in-area phrase with separate fields", () => {
    const next = fullFixture();
    const onChange = mount(next);
    const item = screen
      .getByLabelText("Education 1 area")
      .closest(".resume-simple-item");
    expect(item).toHaveAttribute("data-area-shown", "true");
    expect(item).toHaveTextContent("in");
    fireEvent.change(screen.getByLabelText("Education 1 degree"), {
      target: { value: "BSc Computing" },
    });
    expect(item).toHaveAttribute("data-area-shown", "false");
    fireEvent.change(screen.getByLabelText("Education 1 area"), {
      target: { value: "Maths" },
    });
    expect(
      onChange.mock.lastCall?.[0].sections.education.items[0],
    ).toMatchObject({ degree: "BSc Computing", area: "Maths" });
    expect(item).toHaveAttribute("data-area-shown", "true");
  });
  it("keeps unrelated HTML byte-identical and preserves prose when editing a bullet", () => {
    const original = fullFixture();
    const onChange = mount(original);
    fireEvent.change(screen.getByLabelText("Education 1 degree"), {
      target: { value: "MSc" },
    });
    expect(
      onChange.mock.lastCall?.[0].sections.experience.items[0].description,
    ).toBe(original.sections.experience.items[0].description);
    fireEvent.change(screen.getByLabelText("Company bullet 1"), {
      target: { value: "A & improved" },
    });
    expect(
      onChange.mock.lastCall?.[0].sections.experience.items[0].description,
    ).toBe(
      '<p class="original">Led a team &amp; shipped.</p>\n<p>See <a href="https://example.com">work</a>.</p>\n<ul><li>A &amp; improved</li><li>B</li><li>C</li></ul>',
    );
  });
  it("preserves intro paragraphs for accepted suggestions and cross-experience moves", () => {
    const original = fullFixture();
    original.sections.experience.items.push({
      ...original.sections.experience.items[0],
      id: "two",
      company: "Other",
      description: "<p>Other intro.</p><ul><li>D</li></ul>",
    });
    const onChange = mount(original, [
      {
        id: "replace",
        op: "replace_bullet",
        experienceId: "one",
        bulletIndex: 0,
        text: "Improved",
        reason: "Useful detail",
      },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(
      onChange.mock.lastCall?.[0].sections.experience.items[0].description,
    ).toContain('<p class="original">Led a team &amp; shipped.</p>');
    expect(
      onChange.mock.lastCall?.[0].sections.experience.items[1].description,
    ).toBe(original.sections.experience.items[1].description);
    fireEvent.drop(screen.getAllByTitle("Insert before bullet 1")[1], {
      dataTransfer: {
        types: ["application/x-jobops-resume-bullet"],
        getData: () => JSON.stringify({ experienceId: "one", index: 1 }),
      },
    });
    const descriptions =
      onChange.mock.lastCall?.[0].sections.experience.items.map(
        (e: { description: string }) => e.description,
      );
    expect(descriptions).toEqual([
      '<p class="original">Led a team &amp; shipped.</p>\n<p>See <a href="https://example.com">work</a>.</p>\n<ul><li>Improved</li><li>C</li></ul>',
      "<p>Other intro.</p><ul><li>B</li><li>D</li></ul>",
    ]);
  });
  it("retains an intro when the last bullet is deleted, and can edit the intro", () => {
    const original = fullFixture();
    original.sections.experience.items[0].description =
      "<p>Original intro.</p><ul><li>Only duty</li></ul>";
    const onChange = mount(original);
    fireEvent.click(screen.getByRole("button", { name: "Delete bullet 1" }));
    expect(
      onChange.mock.lastCall?.[0].sections.experience.items[0].description,
    ).toBe("<p>Original intro.</p>");
    fireEvent.change(screen.getByLabelText("Company intro"), {
      target: { value: "Updated & useful" },
    });
    expect(
      onChange.mock.lastCall?.[0].sections.experience.items[0].description,
    ).toBe("<p>Updated &amp; useful</p>");
    expect(screen.queryByLabelText("Company bullet 1")).toBeNull();
  });
  it("links certification titles and exposes a margin control for inline editing", () => {
    const onChange = mount();
    expect(
      screen.getByRole("link", { name: "Example Certificate" }),
    ).toHaveAttribute("href", "https://example.com/cert");
    fireEvent.click(
      screen.getByRole("button", { name: "Edit Certifications 1 title" }),
    );
    expect(screen.getByLabelText("Certifications 1 title")).toHaveFocus();
    fireEvent.change(screen.getByLabelText("Certifications 1 title"), {
      target: { value: "Updated certificate" },
    });
    expect(
      onChange.mock.lastCall?.[0].sections.certifications.items[0].title,
    ).toBe("Updated certificate");
  });
  it("treats prose-only descriptions as intros and keeps them after adding a duty", () => {
    const original = fullFixture();
    original.sections.experience.items[0].description =
      "<p>Intro without bullets.</p>";
    const onChange = mount(original);
    expect(screen.queryByLabelText("Company bullet 1")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add bullet" }));
    expect(
      onChange.mock.lastCall?.[0].sections.experience.items[0].description,
    ).toBe("<p>Intro without bullets.</p><ul><li>New bullet</li></ul>");
  });
  it("adds, edits and deletes education, certifications and awards", () => {
    const onChange = mount();
    for (const [label, key, field] of [
      ["Education", "education", "school"],
      ["Certifications", "certifications", "title"],
      ["Awards", "awards", "title"],
    ]) {
      fireEvent.click(screen.getByRole("button", { name: `+ ${label}` }));
      fireEvent.change(screen.getByLabelText(`${label} 2 ${field}`), {
        target: { value: "New example" },
      });
      expect(onChange.mock.lastCall?.[0].sections[key].items[1][field]).toBe(
        "New example",
      );
      fireEvent.click(
        screen.getByRole("button", { name: `Delete ${label} 2` }),
      );
      expect(onChange.mock.lastCall?.[0].sections[key].items).toHaveLength(1);
    }
  });
  it("offers controls for empty summary and headline", () => {
    const original = fullFixture();
    original.summary.content = "<p> </p>";
    original.basics.headline = "";
    mount(original);
    expect(screen.queryByRole("heading", { name: "Summary" })).toBeNull();
    expect(screen.queryByLabelText("Headline")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "+ Headline" }));
    const headline = screen.getByLabelText("Headline");
    fireEvent.change(headline, { target: { value: "Engineer" } });
    fireEvent.change(headline, { target: { value: "" } });
    expect(screen.getByLabelText("Headline")).toBe(headline);
    fireEvent.click(screen.getByRole("button", { name: "+ Summary" }));
    expect(screen.getByRole("heading", { name: "Summary" })).toBeVisible();
    const summary = screen.getByLabelText("Summary content");
    fireEvent.change(summary, { target: { value: "New summary" } });
    fireEvent.change(summary, { target: { value: "" } });
    expect(screen.getByLabelText("Summary content")).toBe(summary);
  });
  it.each([
    "replace",
    "insert",
    "move",
  ])("keeps original intro HTML on library drop or reorder: %s", (mode) => {
    const original = fullFixture();
    const onChange = mount(original);
    const intro =
      original.sections.experience.items[0].description.split("<ul>")[0];
    const dataTransfer =
      mode === "move"
        ? {
            types: ["application/x-jobops-resume-bullet"],
            getData: () => JSON.stringify({ experienceId: "one", index: 2 }),
          }
        : {
            types: ["application/x-jobops-bullet"],
            getData: () =>
              JSON.stringify({ id: "library", text: "Library duty" }),
          };
    fireEvent.drop(
      mode === "replace"
        ? screen.getByLabelText("Company bullet 1")
        : screen.getByTitle("Insert before bullet 1"),
      { dataTransfer },
    );
    expect(
      onChange.mock.lastCall?.[0].sections.experience.items[0].description.split(
        "<ul>",
      )[0],
    ).toBe(intro);
  });
  it("shows hidden-target suggestions so Accept all has no unseen edits", () => {
    const original = fullFixture();
    original.summary.hidden = true;
    original.sections.skills.hidden = true;
    original.sections.experience.hidden = true;
    const onChange = mount(original, [
      {
        id: "summary",
        op: "replace_summary",
        text: "Updated summary",
        reason: "Summary reason",
      },
      {
        id: "skills",
        op: "set_skills",
        skills: [{ name: "Updated skills", keywords: [] }],
        reason: "Skills reason",
      },
      {
        id: "bullet",
        op: "replace_bullet",
        experienceId: "one",
        bulletIndex: 0,
        text: "Updated duty",
        reason: "Duty reason",
      },
    ]);
    expect(screen.getAllByRole("button", { name: "Accept" })).toHaveLength(3);
    expect(screen.getByText("3 suggestions")).toBeVisible();
    for (const reason of ["Summary reason", "Skills reason", "Duty reason"])
      expect(screen.getByText(reason)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Accept all" }));
    expect(onChange.mock.lastCall?.[0].summary.content).toBe("Updated summary");
    expect(onChange.mock.lastCall?.[0].sections.skills.items[0].name).toBe(
      "Updated skills",
    );
    expect(
      onChange.mock.lastCall?.[0].sections.experience.items[0].description,
    ).toContain("Updated duty");
  });
  it("labels hidden projects so they can be re-included", () => {
    const original = fullFixture();
    original.sections.projects.items = [
      { id: "project", hidden: true, name: "Named project" },
    ] as ReactiveResumeV5Document["sections"]["projects"]["items"];
    mount(original);
    expect(screen.getByText("Named project")).toBeVisible();
    expect(
      screen.getByLabelText("Include project Named project"),
    ).not.toBeChecked();
    fireEvent.click(screen.getByLabelText("Include project Named project"));
    expect(
      screen.getByRole("heading", { name: "Named project" }),
    ).toBeVisible();
  });
  it("keeps trailing prose after the list during a manual bullet edit", () => {
    const original = fullFixture();
    original.sections.experience.items[0].description +=
      '<p>After <a href="https://example.com">list</a></p>';
    const onChange = mount(original);
    fireEvent.change(screen.getByLabelText("Company bullet 1"), {
      target: { value: "Edited" },
    });
    expect(
      onChange.mock.lastCall?.[0].sections.experience.items[0].description,
    ).toBe(
      original.sections.experience.items[0].description.replace(
        "<li>A</li>",
        "<li>Edited</li>",
      ),
    );
  });
});
