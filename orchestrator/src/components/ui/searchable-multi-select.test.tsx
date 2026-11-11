import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SearchableMultiSelect } from "./searchable-multi-select";

afterEach(cleanup);
it("unticks chips without deleting library options, filters, creates and deletes", () => {
  const change = vi.fn();
  const create = vi.fn();
  const remove = vi.fn();
  render(
    <SearchableMultiSelect
      options={["Rust", "TypeScript"]}
      value={["Rust"]}
      onValueChange={change}
      onCreate={create}
      onDelete={remove}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Untick Rust" }));
  expect(change).toHaveBeenCalledWith([]);
  expect(remove).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Create / delete keywords" }),
  );
  const input = screen.getByRole("textbox", {
    name: "Search or create Keywords",
  });
  fireEvent.change(input, { target: { value: "type" } });
  expect(
    screen.queryByRole("button", { name: "Delete keyword Rust" }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("checkbox", { name: "TypeScript" }));
  expect(change).toHaveBeenCalledWith(["Rust", "TypeScript"]);
  fireEvent.click(
    screen.getByRole("button", { name: "Delete keyword TypeScript" }),
  );
  expect(remove).toHaveBeenCalledWith("TypeScript");
  fireEvent.change(input, { target: { value: "  Go  " } });
  fireEvent.click(screen.getByRole("button", { name: "Create 'Go'" }));
  expect(create).toHaveBeenCalledWith("Go");
  fireEvent.change(input, { target: { value: "RUST" } });
  expect(screen.queryByRole("button", { name: "Create 'RUST'" })).toBeNull();
});
it("allows library keyword management without resume selection", () => {
  render(
    <SearchableMultiSelect
      options={["Rust"]}
      value={["Rust"]}
      onValueChange={vi.fn()}
      onCreate={vi.fn()}
      onDelete={vi.fn()}
      selectionEnabled={false}
    />,
  );
  expect(screen.queryByRole("button", { name: "Untick Rust" })).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Create / delete keywords" }),
  );
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Delete keyword Rust" }),
  ).toBeEnabled();
});
