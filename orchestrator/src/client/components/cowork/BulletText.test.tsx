import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { BulletText } from "./BulletText";

afterEach(cleanup);
it("keeps trailing spaces while typing against normalized HTML and accepts external replacements", () => {
  function Editor() {
    const [value, setValue] = useState("Duty");
    return (
      <>
        <BulletText value={value} label="Bullet" onChange={(text) => setValue(text.trim())} />
        <button type="button" onClick={() => setValue("Library replacement")}>
          Replace
        </button>
      </>
    );
  }
  render(<Editor />);
  fireEvent.change(screen.getByLabelText("Bullet"), {
    target: { value: "Duty " },
  });
  expect(screen.getByLabelText("Bullet")).toHaveValue("Duty ");
  fireEvent.change(screen.getByLabelText("Bullet"), {
    target: { value: "Duty with detail" },
  });
  expect(screen.getByLabelText("Bullet")).toHaveValue("Duty with detail");
  fireEvent.click(screen.getByText("Replace"));
  expect(screen.getByLabelText("Bullet")).toHaveValue("Library replacement");
});

it("cancels a blank linked draft without deleting the saved text", () => {
  const onChange = vi.fn();
  render(<BulletText linked value="Library duty" label="Linked bullet" onChange={onChange} />);
  fireEvent.change(screen.getByLabelText("Linked bullet"), {
    target: { value: "  " },
  });
  fireEvent.blur(screen.getByLabelText("Linked bullet"));
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Linked bullet")).toHaveValue("Library duty");
});

it("still removes an unlinked line when its blank draft loses focus", () => {
  const onChange = vi.fn();
  render(<BulletText value="Duty" label="Bullet" onChange={onChange} />);
  fireEvent.change(screen.getByLabelText("Bullet"), { target: { value: "" } });
  fireEvent.blur(screen.getByLabelText("Bullet"));
  expect(onChange).toHaveBeenCalledWith("");
});
