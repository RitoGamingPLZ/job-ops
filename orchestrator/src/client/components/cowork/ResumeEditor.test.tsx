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
    fireEvent.click(screen.getAllByRole("button", { name: /^Accept:/ })[0]);
    expect(screen.getByText(/Not applicable/)).toBeVisible();
    expect(screen.getByRole("button", { name: /^Accept:/ })).toBeDisabled();
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
        .getAllByRole("button", { name: /^Accept:/ })
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
    expect(screen.getAllByPlaceholderText("Company")[0]).toHaveValue("Other");
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
      "Experience",
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
    ).toEqual(["Summary", "Education", "Awards", "Experience"]);
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
      "Experience",
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
    fireEvent.drop(screen.getByLabelText("Move section before Experience"), {
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
      "Experience",
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
  it("keeps focus on a bullet's Move button after moving it down", () => {
    mount();
    fireEvent.click(screen.getByLabelText("Move bullet 1 down"));
    expect(screen.getByLabelText("Move bullet 2 down")).toHaveFocus();
    expect(screen.getByLabelText("Company bullet 2")).toHaveValue("A");
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
    // Ask AI stays in the Tab order (heading drag sources use tabIndex -1).
    for (const ask of screen.getAllByRole("button", { name: /^Ask AI about/ }))
      expect(ask).toHaveAttribute("tabindex", "0");
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
    fireEvent.click(within(row).getByRole("button", { name: /^Accept:/ }));
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
    fireEvent.click(screen.getByRole("button", { name: /^Accept:/ }));
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
    const bullet = screen.getByLabelText("Company bullet 1");
    expect(bullet).toHaveValue("");
    expect(bullet).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(bullet, { target: { value: "Useful duty" } });
    expect(
      onChange.mock.lastCall?.[0].sections.experience.items[0].description,
    ).toBe("<p>Intro without bullets.</p><ul><li>Useful duty</li></ul>");
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
    expect(screen.getAllByRole("button", { name: /^Accept:/ })).toHaveLength(3);
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
  it("edits experience headers, adds a focused empty experience and deletes it", () => {
    const onChange = mount();
    for (const [label, field, value] of [
      ["position", "position", "Senior Engineer"],
      ["location", "location", "Remote"],
      ["dates", "period", "Jan 2023 – Present"],
      ["company", "company", "Example Systems"],
    ]) {
      fireEvent.change(screen.getByLabelText(`Company ${label}`), {
        target: { value },
      });
      expect(
        onChange.mock.lastCall?.[0].sections.experience.items[0][field],
      ).toBe(value);
    }
    fireEvent.click(screen.getByRole("button", { name: "Add experience" }));
    expect(window.document.activeElement).toHaveAttribute(
      "data-experience-position",
    );
    expect(window.document.activeElement).toHaveValue("");
    expect(screen.getAllByPlaceholderText("Jan 2023 – Present")).toHaveLength(
      2,
    );
    const added = onChange.mock.lastCall?.[0].sections.experience.items[1];
    expect(added).toMatchObject({
      position: "",
      company: "",
      location: "",
      period: "",
      description: "",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Delete experience new experience" }),
    );
    expect(onChange.mock.lastCall?.[0].sections.experience.items).toHaveLength(
      1,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Delete experience Example Systems" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add experience" }));
    expect(onChange.mock.lastCall?.[0].sections.experience.items).toHaveLength(
      1,
    );
  });
  it("starts inserted bullets empty and focused, removes empty drafts on blur", () => {
    const onChange = mount();
    fireEvent.click(
      screen.getByRole("button", { name: "Insert before bullet 2" }),
    );
    const draft = screen.getByLabelText("Company bullet 2");
    expect(draft).toHaveValue("");
    expect(draft).toHaveFocus();
    fireEvent.blur(draft);
    expect(screen.getByLabelText("Company bullet 2")).toHaveValue("B");
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Insert before bullet 2" }),
    );
    fireEvent.change(screen.getByLabelText("Company bullet 2"), {
      target: { value: "New achievement" },
    });
    expect(screen.getByLabelText("Company bullet 2")).toHaveFocus();
    expect(screen.getByLabelText("Company bullet 3")).toHaveValue("B");
    expect(
      onChange.mock.lastCall?.[0].sections.experience.items[0].description,
    ).toContain("<li>A</li><li>New achievement</li><li>B</li>");
    fireEvent.change(screen.getByLabelText("Company bullet 2"), {
      target: { value: " " },
    });
    fireEvent.blur(screen.getByLabelText("Company bullet 2"));
    expect(screen.getByLabelText("Company bullet 2")).toHaveValue("B");
  });
  it("removing an empty bullet on blur does not redirect the next click to another bullet", () => {
    const description = () =>
      onChange.mock.lastCall?.[0].sections.experience.items[0].description;
    const onChange = mount();
    // Empty inserted row before A; the mousedown on B's × blurs it first.
    fireEvent.click(
      screen.getByRole("button", { name: "Insert before bullet 1" }),
    );
    const deleteB = screen.getByRole("button", { name: "Delete bullet 3" });
    fireEvent.blur(screen.getByLabelText("Company bullet 1"));
    fireEvent.click(deleteB);
    expect(description()).toContain("<ul><li>A</li><li>C</li></ul>");
    // A cleared existing bullet is removed on blur before C's × is clicked.
    fireEvent.change(screen.getByLabelText("Company bullet 1"), {
      target: { value: "" },
    });
    const deleteC = screen.getByRole("button", { name: "Delete bullet 2" });
    fireEvent.blur(screen.getByLabelText("Company bullet 1"));
    fireEvent.click(deleteC);
    expect(description()).not.toContain("<li>");
  });
  it("describes suggestions and gives review buttons contextual accessible names", () => {
    mount(fullFixture(), [
      {
        id: "rewrite",
        op: "replace_bullet",
        experienceId: "one",
        bulletIndex: 0,
        text: "Improved",
        reason: "Detail",
      },
      {
        id: "add",
        op: "insert_bullet",
        experienceId: "one",
        bulletIndex: 1,
        text: "Added",
        reason: "Detail",
      },
      {
        id: "remove",
        op: "delete_bullet",
        experienceId: "one",
        bulletIndex: 2,
        reason: "Detail",
      },
      {
        id: "summary",
        op: "replace_summary",
        text: "New summary",
        reason: "Detail",
      },
      {
        id: "headline",
        op: "replace_headline",
        text: "New headline",
        reason: "Detail",
      },
      { id: "skills", op: "set_skills", skills: [], reason: "Detail" },
      {
        id: "field",
        op: "replace_field",
        field: { section: "education", itemId: "school", name: "school" },
        text: "New school",
        reason: "Detail",
      },
    ]);
    for (const label of [
      "Rewrite bullet",
      "Add bullet",
      "Remove bullet",
      "Change summary",
      "Change headline",
      "Update skills",
      "Change school",
    ]) {
      expect(
        screen.getByRole("button", { name: `Accept: ${label}` }),
      ).toBeVisible();
      expect(
        screen.getByRole("button", { name: `Reject: ${label}` }),
      ).toBeVisible();
    }
  });
  it("reorders simple items and uses human placeholders", () => {
    const onChange = mount();
    for (const [label, kind, field, placeholder] of [
      ["Education", "education", "school", "School"],
      ["Certifications", "certifications", "title", "Certification"],
      ["Awards", "awards", "title", "Award"],
    ]) {
      expect(screen.getByLabelText(`${label} 1 ${field}`)).toHaveAttribute(
        "placeholder",
        placeholder,
      );
      fireEvent.click(screen.getByRole("button", { name: `+ ${label}` }));
      const id = onChange.mock.lastCall?.[0].sections[kind].items[1].id;
      fireEvent.click(
        screen.getByRole("button", { name: `Move ${label} 2 up` }),
      );
      expect(onChange.mock.lastCall?.[0].sections[kind].items[0].id).toBe(id);
      fireEvent.click(
        screen.getByRole("button", { name: `Move ${label} 1 down` }),
      );
      expect(onChange.mock.lastCall?.[0].sections[kind].items[1].id).toBe(id);
    }
  });
  it("does not restore a deleted skill when its pending keywords commit on unmount", () => {
    const onChange = mount();
    fireEvent.change(screen.getByLabelText("Skill 1 keywords"), {
      target: { value: "Pending keywords" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Delete skill Skills" }),
    );
    expect(onChange.mock.lastCall?.[0].sections.skills.items).toHaveLength(0);
    expect(screen.queryByLabelText("Skill 1 keywords")).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);
  });
  it("labels icon controls and retains a 24px target after paper scaling", () => {
    mount();
    const paper = window.document.querySelector<HTMLElement>(".resume-paper");
    const scale = Number(paper?.style.transform.match(/[\d.]+/)?.[0]);
    const size = Number.parseFloat(
      paper?.style.getPropertyValue("--resume-control-size") ?? "0",
    );
    expect(size * scale).toBeGreaterThanOrEqual(24);
    for (const control of window.document.querySelectorAll<HTMLElement>(
      ".resume-tools button, .resume-tools [role=button]",
    )) {
      expect(control).toHaveAttribute("title");
      expect(control).toHaveAttribute("aria-label");
    }
    expect(
      screen.getByText(
        "Click a line to show its tools. Drag ⠿ to reorder or drop it into the chat.",
      ),
    ).toBeVisible();
  });
  it("keeps floating line tools after their line in keyboard order", () => {
    mount();
    const follows = (line: Element, tools: Element | null | undefined) =>
      Boolean(
        tools &&
          line.compareDocumentPosition(tools) &
            Node.DOCUMENT_POSITION_FOLLOWING,
      );
    const bullet = screen.getByLabelText("Company bullet 1");
    const bulletTools = bullet
      .closest(".resume-bullet")
      ?.querySelector(".resume-tools");
    expect(follows(bullet, bulletTools)).toBe(true);
    const heading = screen.getByRole("heading", { name: "Experience" });
    expect(heading.nextElementSibling).toHaveClass("resume-tools");
    const entry = window.document.querySelector(".resume-experience");
    const entryTools = entry?.querySelector(":scope > .resume-tools");
    expect(entryTools?.previousElementSibling).toHaveClass(
      "resume-experience-heading",
    );
    expect(
      within(entryTools as HTMLElement).getByRole("button", {
        name: "Add bullet",
      }),
    ).toBeInTheDocument();
    // Dates are right-aligned by CSS, not joined with a " | " separator.
    expect(
      entry?.querySelector(".resume-experience-heading")?.textContent,
    ).not.toContain("|");
  });
});

// Step A implements these pure helpers in parallel. Exercise the editor against
// their fixed contract without depending on its placeholder bodies.
vi.mock("@shared/resume-links", async () => {
  const { splitDescription, joinDescription } = await import(
    "@shared/resume-bullets"
  );
  const getItemLines = (item: Record<string, unknown>) =>
    splitDescription(String(item.description ?? "")).bullets.map(
      (text, index) => ({
        text,
        ref:
          (item.bulletRefs as (string | null)[] | undefined)?.[index] ?? null,
      }),
    );
  const setItemLines = (
    item: Record<string, unknown>,
    lines: { text: string; ref: string | null }[],
  ) => ({
    ...item,
    description: joinDescription(
      splitDescription(String(item.description ?? "")).introHtml,
      lines.map((line) => line.text),
      String(item.description ?? ""),
    ),
    bulletRefs: lines.map((line) => line.ref),
  });
  return {
    getItemLines: vi.fn(getItemLines),
    setItemLines: vi.fn(setItemLines),
    isOnResume: (doc: ReactiveResumeV5Document, id: string) =>
      Object.values(
        doc.sections as unknown as Record<
          string,
          { items: Record<string, unknown>[] }
        >,
      ).some(
        (section) =>
          "items" in section &&
          section.items.some(
            (item) =>
              item.libraryId === id ||
              getItemLines(item).some((line) => line.ref === id),
          ),
      ),
    sameLineText: (a: string, b: string) =>
      a.trim().replace(/\s+/g, " ") === b.trim().replace(/\s+/g, " "),
    removeFromResume: vi.fn((doc: ReactiveResumeV5Document, id: string) => {
      const next = structuredClone(doc);
      for (const section of Object.values(
        next.sections as unknown as Record<
          string,
          { items: Record<string, unknown>[] }
        >,
      )) {
        section.items = section.items.filter((item) => item.libraryId !== id);
        for (const item of section.items) {
          if (Array.isArray(item.bulletRefs) && item.bulletRefs.includes(id))
            Object.assign(
              item,
              setItemLines(
                item,
                getItemLines(item).filter((line) => line.ref !== id),
              ),
            );
        }
      }
      return next;
    }),
    resetLine: vi.fn(
      (
        doc: ReactiveResumeV5Document,
        id: string,
        index: number,
        library: { id: string; text: string }[],
      ) => {
        const next = structuredClone(doc);
        for (const section of Object.values(
          next.sections as unknown as Record<
            string,
            { items: Record<string, unknown>[] }
          >,
        )) {
          const item = section.items.find((item) => item.id === id);
          if (!item) continue;
          const lines = getItemLines(item);
          const original = library.find(
            (entry) => entry.id === lines[index]?.ref,
          );
          if (original) {
            lines[index].text = original.text;
            Object.assign(item, setItemLines(item, lines));
          }
        }
        return next;
      },
    ),
  };
});

describe("candidate library links", () => {
  const library = [
    { id: "role", text: "Engineer", kind: "role" },
    { id: "dropped", text: "Dropped library duty", kind: "bullet" },
    { id: "duty-a", text: "Original duty", kind: "bullet" },
    { id: "duty-b", text: "B", kind: "bullet" },
  ] as import("@shared/types").ExperienceBullet[];
  function LinkedEditor({ onChange = vi.fn(), save = vi.fn() }) {
    const [document, setDocument] = useState(() => {
      const doc = fixture();
      Object.assign(doc.sections.experience.items[0], {
        libraryId: "role",
        position: "Engineer",
        bulletRefs: ["duty-a", "duty-b", null],
        description:
          "<p>Intro</p><ul><li>Reworded duty</li><li>B</li><li>C</li></ul>",
      });
      return doc;
    });
    return (
      <ResumeEditor
        document={document}
        library={library}
        onSaveLineToLibrary={save}
        suggestions={[]}
        onDismiss={vi.fn()}
        onChange={(next) => {
          setDocument(next);
          onChange(next);
        }}
      />
    );
  }

  it("ignores duplicate library drops and leaves wrong-kind drops unlinked", () => {
    const onChange = vi.fn();
    render(<LinkedEditor onChange={onChange} />);
    const drop = (id: string) =>
      fireEvent.drop(screen.getByLabelText("Company bullet 3"), {
        dataTransfer: {
          types: ["application/x-jobops-bullet"],
          getData: () => JSON.stringify({ id, text: "Dropped text" }),
        },
      });
    drop("duty-a");
    expect(onChange).not.toHaveBeenCalled();
    drop("role");
    expect(
      onChange.mock.lastCall?.[0].sections.experience.items[0].bulletRefs,
    ).toEqual(["duty-a", "duty-b", null]);
    drop("missing");
    expect(
      onChange.mock.lastCall?.[0].sections.experience.items[0].bulletRefs,
    ).toEqual(["duty-a", "duty-b", null]);
  });

  it("treats dangling item and line refs as unlinked for editing and deletion", async () => {
    const { removeFromResume } = await import("@shared/resume-links");
    vi.mocked(removeFromResume).mockClear();
    const document = fixture();
    document.sections.experience.items[0].libraryId = "deleted-role";
    document.sections.experience.items[0].bulletRefs = [
      "deleted-duty",
      "deleted-duty",
      null,
    ];
    const onChange = vi.fn();
    render(
      <ResumeEditor
        document={document}
        library={library}
        onChange={onChange}
        suggestions={[]}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Company company")).not.toHaveAttribute(
      "readonly",
    );
    expect(
      screen.getByLabelText("Company bullet 1").closest("li"),
    ).not.toHaveClass("bg-amber-100/70");
    expect(
      screen.queryByRole("button", { name: "Reset to library text" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Delete bullet 1" }));
    expect(removeFromResume).not.toHaveBeenCalled();
    expect(
      onChange.mock.lastCall?.[0].sections.experience.items[0].bulletRefs,
    ).toEqual(["deleted-duty", null]);
  });

  it("renders experience rows exclusively from getItemLines", async () => {
    const { getItemLines } = await import("@shared/resume-links");
    const implementation = vi.mocked(getItemLines).getMockImplementation();
    vi.mocked(getItemLines).mockReturnValue([{ text: "Only line", ref: null }]);
    try {
      render(<LinkedEditor />);
      expect(screen.getByLabelText("Company bullet 1")).toHaveValue(
        "Only line",
      );
      expect(screen.queryByLabelText("Company bullet 2")).toBeNull();
    } finally {
      if (implementation)
        vi.mocked(getItemLines).mockImplementation(implementation);
    }
  });

  it("replaces the edited item when setItemLines omits refs", async () => {
    const { setItemLines } = await import("@shared/resume-links");
    const onChange = vi.fn();
    render(<LinkedEditor onChange={onChange} />);
    vi.mocked(setItemLines).mockImplementationOnce((item) => {
      const { bulletRefs: _refs, ...rest } = item;
      return { ...rest, description: "" };
    });
    fireEvent.change(screen.getByLabelText("Company bullet 1"), {
      target: { value: "Edit" },
    });
    expect(
      onChange.mock.lastCall?.[0].sections.experience.items[0],
    ).not.toHaveProperty("bulletRefs");
  });

  it("tints reworded lines, shows the original text, resets and saves explicitly", () => {
    const save = vi.fn();
    render(<LinkedEditor save={save} />);
    const line = screen.getByLabelText("Company bullet 1").closest("li");
    expect(line).toHaveClass("bg-amber-100/70", "dark:bg-amber-500/15");
    expect(line).toHaveAttribute("title", "Original duty");
    expect(
      screen.getByLabelText("Company bullet 2").closest("li"),
    ).not.toHaveClass("bg-amber-100/70");
    fireEvent.click(screen.getByRole("button", { name: "Save to library" }));
    expect(save).toHaveBeenCalledWith("duty-a", "Reworded duty");
    fireEvent.click(
      screen.getByRole("button", { name: "Reset to library text" }),
    );
    expect(screen.getByLabelText("Company bullet 1")).toHaveValue(
      "Original duty",
    );
    expect(
      screen.queryByRole("button", { name: "Reset to library text" }),
    ).toBeNull();
  });

  it("keeps linked entry fields read-only and cancels blank rewording", () => {
    const onChange = vi.fn();
    render(<LinkedEditor onChange={onChange} />);
    for (const field of ["position", "company", "location", "dates"])
      expect(screen.getByLabelText(`Company ${field}`)).toHaveAttribute(
        "readonly",
      );
    fireEvent.change(screen.getByLabelText("Company bullet 1"), {
      target: { value: "" },
    });
    fireEvent.blur(screen.getByLabelText("Company bullet 1"));
    expect(screen.getByLabelText("Company bullet 1")).toHaveValue(
      "Reworded duty",
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it("aligns refs after manual edits, add, move, drop and linked removal", async () => {
    const { removeFromResume } = await import("@shared/resume-links");
    const onChange = vi.fn();
    render(<LinkedEditor onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Company bullet 1"), {
      target: { value: "Manual reword" },
    });
    expect(
      onChange.mock.lastCall?.[0].sections.experience.items[0].bulletRefs,
    ).toEqual(["duty-a", "duty-b", null]);
    fireEvent.click(screen.getByRole("button", { name: "Move bullet 1 down" }));
    expect(
      onChange.mock.lastCall?.[0].sections.experience.items[0].bulletRefs,
    ).toEqual(["duty-b", "duty-a", null]);
    fireEvent.click(screen.getByRole("button", { name: "Add bullet" }));
    fireEvent.change(screen.getByLabelText("Company bullet 4"), {
      target: { value: "New duty" },
    });
    expect(
      onChange.mock.lastCall?.[0].sections.experience.items[0].bulletRefs,
    ).toEqual(["duty-b", "duty-a", null, null]);
    const dataTransfer = {
      types: ["application/x-jobops-bullet"],
      getData: () =>
        JSON.stringify({ id: "dropped", text: "Dropped library duty" }),
    };
    fireEvent.drop(screen.getByLabelText("Company bullet 3"), { dataTransfer });
    expect(
      onChange.mock.lastCall?.[0].sections.experience.items[0].bulletRefs,
    ).toEqual(["duty-b", "duty-a", "dropped", null]);
    fireEvent.click(screen.getByRole("button", { name: "Delete bullet 2" }));
    expect(removeFromResume).toHaveBeenCalledWith(expect.anything(), "duty-a");
    expect(
      onChange.mock.lastCall?.[0].sections.experience.items[0].bulletRefs,
    ).toEqual(["duty-b", "dropped", null]);
    fireEvent.click(
      screen.getByRole("button", { name: "Delete experience Company" }),
    );
    expect(removeFromResume).toHaveBeenCalledWith(expect.anything(), "role");
    expect(onChange.mock.lastCall?.[0].sections.experience.items).toEqual([]);
  });

  it("keeps surviving project point nodes when a preceding point is deleted", () => {
    function ProjectEditor() {
      const [document, setDocument] = useState(() => {
        const doc = fixture();
        doc.sections.projects.items = [
          {
            id: "project",
            name: "Demo",
            period: "",
            hidden: false,
            website: { url: "", label: "" },
            description: "<ul><li>First point</li><li>Second point</li></ul>",
          },
        ];
        return doc;
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
    render(<ProjectEditor />);
    const second = screen.getByLabelText("Demo point 2");
    fireEvent.click(
      screen.getByRole("button", { name: "Delete project point 1" }),
    );
    expect(screen.getByLabelText("Demo point 1")).toBe(second);
    expect(second).toHaveValue("Second point");
  });

  it("edits, resets and unticks linked project points", () => {
    const document = fixture();
    document.sections.projects.items = [
      {
        id: "project",
        name: "Demo",
        period: "",
        website: { url: "", label: "" },
        hidden: false,
        libraryId: "library-project",
        description: "<ul><li>Reworded duty</li></ul>",
        bulletRefs: ["duty-a"],
      },
    ] as ReactiveResumeV5Document["sections"]["projects"]["items"];
    const onChange = vi.fn();
    render(
      <ResumeEditor
        document={document}
        onChange={onChange}
        library={library}
        suggestions={[]}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Demo point 1").closest("li")).toHaveAttribute(
      "title",
      "Original duty",
    );
    fireEvent.change(screen.getByLabelText("Demo point 1"), {
      target: { value: "Project reword" },
    });
    expect(
      onChange.mock.lastCall?.[0].sections.projects.items[0].bulletRefs,
    ).toEqual(["duty-a"]);
    fireEvent.click(
      screen.getByRole("button", { name: "Delete project point 1" }),
    );
    expect(
      onChange.mock.lastCall?.[0].sections.projects.items[0].bulletRefs,
    ).toEqual([]);
  });
});
