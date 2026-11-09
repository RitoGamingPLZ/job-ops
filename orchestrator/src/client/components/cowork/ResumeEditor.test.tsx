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
