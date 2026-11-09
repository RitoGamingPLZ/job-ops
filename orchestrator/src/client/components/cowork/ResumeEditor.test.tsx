import type { ReactiveResumeV5Document, ResumeSuggestion } from "@shared/types";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResumeEditor } from "./ResumeEditor";

vi.mock("@/client/components/design-resume/RichTextEditor", () => ({
  RichTextEditor: () => <div>Summary editor</div>,
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
