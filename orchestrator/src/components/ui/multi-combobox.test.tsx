import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import {
  addMultiComboboxValues,
  MultiCombobox,
  type MultiComboboxOption,
  normalizeMultiComboboxText,
  toggleMultiComboboxValue,
} from "./multi-combobox";

const SAMPLE_OPTIONS: MultiComboboxOption[] = [
  { value: "typescript", label: "TypeScript", searchText: "ts" },
  { value: "react", label: "React" },
  { value: "react-native", label: "React Native" },
  { value: "rust", label: "Rust" },
  { value: "cobol", label: "COBOL", disabled: true },
];

function InlineHarness({
  initial = ["Tools"],
  options = SAMPLE_OPTIONS,
  allowCustomValues = true,
  onSpy,
}: {
  initial?: string[];
  options?: MultiComboboxOption[];
  allowCustomValues?: boolean;
  onSpy?: (next: string[]) => void;
}) {
  const [value, setValue] = React.useState(initial);
  return (
    <>
      <MultiCombobox
        variant="inline"
        noun="tag"
        value={value}
        options={options}
        allowCustomValues={allowCustomValues}
        onValueChange={(next) => {
          setValue(next);
          onSpy?.(next);
        }}
      />
      <output aria-label="Selected tags">{value.join("|")}</output>
    </>
  );
}

function PopoverHarness({
  initial = [],
  options = SAMPLE_OPTIONS,
  showSelectedChips = true,
  onSpy,
}: {
  initial?: string[];
  options?: MultiComboboxOption[];
  showSelectedChips?: boolean;
  onSpy?: (next: string[]) => void;
}) {
  const [value, setValue] = React.useState(initial);
  return (
    <>
      <MultiCombobox
        variant="popover"
        noun="skill"
        value={value}
        options={options}
        popoverTitle="Skills"
        clearLabel="All skills"
        showSelectedChips={showSelectedChips}
        placeholder="Select skills"
        searchPlaceholder="Search skills..."
        inputAriaLabel="Search skills"
        onValueChange={(next) => {
          setValue(next);
          onSpy?.(next);
        }}
      />
      <output aria-label="Selected skills">{value.join("|")}</output>
    </>
  );
}

describe("MultiCombobox helpers", () => {
  it("normalizes whitespace and case", () => {
    expect(normalizeMultiComboboxText("  React   Native \n")).toBe("react native");
  });

  it("adds comma-separated values, resolves canonical option values, and deduplicates", () => {
    const current = ["typescript"];
    const next = addMultiComboboxValues(
      current,
      "  React , TYPESCRIPT , Rust , COBOL , GraphQL , ",
      SAMPLE_OPTIONS,
    );
    expect(next).toEqual(["typescript", "react", "rust", "COBOL", "GraphQL"]);

    const unchanged = addMultiComboboxValues(current, "  TypeScript , ", SAMPLE_OPTIONS);
    expect(unchanged).toBe(current);
  });

  it("toggles values using normalized matching", () => {
    expect(toggleMultiComboboxValue(["React"], "  react ")).toEqual([]);
    expect(toggleMultiComboboxValue(["React"], "Rust")).toEqual(["React", "Rust"]);
    const empty = ["React"];
    expect(toggleMultiComboboxValue(empty, "   ")).toBe(empty);
  });
});

describe("MultiCombobox (inline variant)", () => {
  it("adds deduplicated comma values, removes chips, and backspaces the last chip", () => {
    const spy = vi.fn();
    render(<InlineHarness initial={["Tools"]} options={[]} onSpy={spy} />);

    const input = screen.getByRole("combobox", { name: "Add tag" });
    fireEvent.change(input, { target: { value: "React, tools, react" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(spy).toHaveBeenLastCalledWith(["Tools", "React"]);
    expect(input).toHaveValue("");

    fireEvent.blur(input);
    expect(spy).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Remove tag Tools" }));
    expect(spy).toHaveBeenLastCalledWith(["React"]);

    fireEvent.keyDown(input, { key: "Backspace" });
    expect(spy).toHaveBeenLastCalledWith([]);
  });

  it("commits custom values via comma key, custom row click, and blur without double-committing", () => {
    const spy = vi.fn();
    render(<InlineHarness initial={[]} options={SAMPLE_OPTIONS} onSpy={spy} />);

    const input = screen.getByRole("combobox", { name: "Add tag" });
    fireEvent.change(input, { target: { value: "GraphQL" } });
    fireEvent.keyDown(input, { key: "," });
    expect(spy).toHaveBeenLastCalledWith(["GraphQL"]);
    expect(input).toHaveValue("");

    fireEvent.change(input, { target: { value: "Docker" } });
    fireEvent.click(screen.getByRole("option", { name: 'Add "Docker"' }));
    expect(spy).toHaveBeenLastCalledWith(["GraphQL", "Docker"]);
    expect(input).toHaveValue("");

    fireEvent.change(input, { target: { value: "Kubernetes" } });
    fireEvent.blur(input);
    expect(spy).toHaveBeenLastCalledWith(["GraphQL", "Docker", "Kubernetes"]);
  });

  it("prioritizes exact custom value over prefix-matching suggestions on Enter", () => {
    render(
      <InlineHarness initial={[]} options={[{ value: "react-native", label: "React Native" }]} />,
    );

    const input = screen.getByRole("combobox", { name: "Add tag" });
    fireEvent.change(input, { target: { value: "React" } });
    expect(screen.getByRole("option", { name: 'Add "React"' })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "React Native" })).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByLabelText("Selected tags")).toHaveTextContent("React");
  });

  it("filters suggestions, toggles via ArrowDown/Enter and click, and skips disabled options", async () => {
    const spy = vi.fn();
    render(<InlineHarness initial={[]} options={SAMPLE_OPTIONS} onSpy={spy} />);

    const input = screen.getByRole("combobox", { name: "Add tag" });
    fireEvent.focus(input);

    const listbox = await screen.findByRole("listbox", { name: "Add tag" });
    expect(listbox).toBeInTheDocument();

    // Selecting an option keeps the dropdown open for further picks and clears the search text.
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(spy).toHaveBeenLastCalledWith(["react"]);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "React" })).toHaveAttribute("aria-selected", "true");

    // Disabled option cannot be toggled.
    fireEvent.click(screen.getByRole("option", { name: "COBOL" }));
    expect(spy).toHaveBeenCalledTimes(1);

    // Clicking an already-selected option removes it without committing partial search text on blur.
    fireEvent.change(input, { target: { value: "re" } });
    fireEvent.click(screen.getByRole("option", { name: "React" }));
    expect(spy).toHaveBeenLastCalledWith([]);
    expect(input).toHaveValue("");
  });

  it("closes the popover on Escape without bubbling to enclosing containers", async () => {
    const parentKeyDown = vi.fn();
    render(
      <div onKeyDown={parentKeyDown}>
        <InlineHarness initial={[]} />
      </div>,
    );

    const input = screen.getByRole("combobox", { name: "Add tag" });
    fireEvent.focus(input);
    expect(await screen.findByRole("listbox")).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(parentKeyDown).not.toHaveBeenCalled();
  });

  it("prevents interaction when disabled", () => {
    const onValueChange = vi.fn();
    render(
      <MultiCombobox
        variant="inline"
        noun="tag"
        value={["Tools"]}
        options={SAMPLE_OPTIONS}
        disabled
        onValueChange={onValueChange}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Add tag" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove tag Tools" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Browse tag options" })).toBeDisabled();
    expect(onValueChange).not.toHaveBeenCalled();
  });
});

describe("MultiCombobox (popover variant)", () => {
  it("opens, focuses search input, filters ignoring case/whitespace, and keeps query while toggling", async () => {
    render(<PopoverHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Select skills" }));

    const search = await screen.findByRole("combobox", { name: "Search skills" });
    await waitFor(() => expect(search).toHaveFocus());

    fireEvent.change(search, { target: { value: "  REACT  " } });
    expect(screen.getAllByRole("option")).toHaveLength(2);

    fireEvent.click(screen.getByRole("option", { name: "React" }));
    fireEvent.click(screen.getByRole("option", { name: "React Native" }));

    expect(search).toHaveValue("  REACT  ");
    expect(screen.getByLabelText("Selected skills")).toHaveTextContent("react|react-native");
    expect(screen.getByRole("option", { name: "React" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: "React Native" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // Selected chips strip removes an item, and clearLabel clears all.
    fireEvent.click(screen.getByRole("button", { name: "Remove skill React" }));
    expect(screen.getByLabelText("Selected skills")).toHaveTextContent("react-native");

    fireEvent.click(screen.getByRole("button", { name: "All skills" }));
    expect(screen.getByLabelText("Selected skills")).toBeEmptyDOMElement();

    fireEvent.change(search, { target: { value: "does-not-exist" } });
    expect(screen.getByText("No results found.")).toBeInTheDocument();
  });

  it("supports keyboard navigation and virtualized large option lists", async () => {
    const manyOptions = Array.from({ length: 120 }, (_, index) => ({
      value: `opt-${index}`,
      label: `Option ${index}`,
      meta: index + 1,
    }));

    render(<PopoverHarness options={manyOptions} />);

    fireEvent.click(screen.getByRole("button", { name: "Select skills" }));
    const search = await screen.findByRole("combobox", { name: "Search skills" });

    expect(screen.getByRole("option", { name: /Option 0/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Option 119/ })).not.toBeInTheDocument();

    fireEvent.keyDown(search, { key: "End" });
    await waitFor(() => {
      expect(screen.getByRole("option", { name: /Option 119/ })).toBeInTheDocument();
    });

    fireEvent.keyDown(search, { key: "Enter" });
    expect(screen.getByLabelText("Selected skills")).toHaveTextContent("opt-119");

    fireEvent.keyDown(search, { key: "Home" });
    await waitFor(() => {
      expect(screen.getByRole("option", { name: /Option 0/ })).toBeInTheDocument();
    });

    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(screen.getByLabelText("Selected skills")).toHaveTextContent("opt-119|opt-1");
  });
});
