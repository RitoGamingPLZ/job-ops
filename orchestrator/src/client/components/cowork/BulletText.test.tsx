import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it } from "vitest";
import { BulletText } from "./BulletText";

afterEach(cleanup);
it("keeps trailing spaces while typing against normalized HTML and accepts external replacements", () => {
  function Editor() {
    const [value, setValue] = useState("Duty");
    return (
      <>
        <BulletText
          value={value}
          label="Bullet"
          onChange={(text) => setValue(text.trim())}
        />
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
