import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { addTags, TagInput } from "./tag-input";

describe("TagInput", () => {
  it("adds deduplicated values, removes chips, and backspaces the last one", () => {
    const onChange = vi.fn();
    render(<TagInput value={["Tools"]} onChange={onChange} />);
    const input = screen.getByLabelText("Add tag");
    fireEvent.change(input, { target: { value: "React, tools, react" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith(["Tools", "React"]);
    expect(input).toHaveValue("");
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Remove tag Tools" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
  it("adds a picked suggestion at once and hides chosen ones", () => {
    const onChange = vi.fn();
    const { container } = render(
      <TagInput
        value={["Go"]}
        options={["Go", "Rust"]}
        noun="skill"
        onChange={onChange}
      />,
    );
    expect(
      Array.from(container.querySelectorAll("option"), (o) => o.value),
    ).toEqual(["Rust"]);
    fireEvent.change(screen.getByLabelText("Add skill"), {
      target: { value: "Rust" },
    });
    expect(onChange).toHaveBeenCalledWith(["Go", "Rust"]);
  });
  it("keeps the original list when nothing new is added", () => {
    const tags = ["A"];
    expect(addTags(tags, " a , ")).toBe(tags);
  });
});
