import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { CommaListInput } from "./CommaListInput";

afterEach(cleanup);
it("commits pending text on unmount using the latest callback", () => {
  const oldCommit = vi.fn();
  const latestCommit = vi.fn();
  const view = render(
    <StrictMode>
      <CommaListInput aria-label="Skills" value={["TypeScript"]} onCommit={oldCommit} />
    </StrictMode>,
  );
  expect(oldCommit).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Skills"), {
    target: { value: "Machine Learning, TypeScript, ," },
  });
  view.rerender(
    <StrictMode>
      <CommaListInput aria-label="Skills" value={["TypeScript"]} onCommit={latestCommit} />
    </StrictMode>,
  );
  expect(oldCommit).not.toHaveBeenCalled();
  view.unmount();
  expect(latestCommit).toHaveBeenCalledExactlyOnceWith(["Machine Learning", "TypeScript"]);
});
it("does not repeat an already committed draft on unmount", () => {
  const onCommit = vi.fn();
  const view = render(<CommaListInput aria-label="Skills" value={[]} onCommit={onCommit} />);
  fireEvent.change(screen.getByLabelText("Skills"), {
    target: { value: "A, B" },
  });
  fireEvent.blur(screen.getByLabelText("Skills"));
  view.unmount();
  expect(onCommit).toHaveBeenCalledExactlyOnceWith(["A", "B"]);
});
it("forwards title and data-library-changed in multiline mode", () => {
  render(
    <CommaListInput
      multiline
      aria-label="Skills"
      title="library: TypeScript, Go"
      data-library-changed=""
      value={["Go"]}
      onCommit={vi.fn()}
    />,
  );
  const field = screen.getByLabelText("Skills");
  expect(field).toHaveAttribute("title", "library: TypeScript, Go");
  expect(field).toHaveAttribute("data-library-changed", "");
});
