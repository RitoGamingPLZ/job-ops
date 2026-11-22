import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SalaryFilter, ScoreFilter } from "../constants";
import { SalaryFilterPill } from "./SalaryFilterPill";
import { ScoreFilterPill } from "./ScoreFilterPill";

const openPill = (name: RegExp) => fireEvent.click(screen.getByRole("button", { name }));

const renderScore = (scoreFilter: ScoreFilter) => {
  const onScoreFilterChange = vi.fn();
  render(
    <ScoreFilterPill
      scoreFilter={scoreFilter}
      onScoreFilterChange={onScoreFilterChange}
      scoreActive={false}
      scoreSummary={null}
    />,
  );
  openPill(/^score/i);
  return onScoreFilterChange;
};

const renderSalary = (salaryFilter: SalaryFilter) => {
  const onSalaryFilterChange = vi.fn();
  render(
    <SalaryFilterPill
      salaryFilter={salaryFilter}
      onSalaryFilterChange={onSalaryFilterChange}
      salaryActive={false}
      salarySummary={null}
    />,
  );
  openPill(/^salary/i);
  return onSalaryFilterChange;
};

describe("numeric filter inputs", () => {
  it("renders score inputs only in has mode with score attributes", () => {
    renderScore({ mode: "has", min: 40, max: null });
    const min = screen.getByLabelText("Minimum");
    const max = screen.getByLabelText("Maximum");
    expect(min).toHaveAttribute("id", "score-min-filter");
    expect(min).toHaveValue("40");
    expect(min).toHaveAttribute("inputmode", "numeric");
    expect(min).toHaveAttribute("min", "0");
    expect(min).toHaveAttribute("max", "100");
    expect(min).toHaveAttribute("placeholder", "e.g. 60");
    expect(max).toHaveAttribute("id", "score-max-filter");
    expect(max).toHaveValue("");
    expect(max).toHaveAttribute("placeholder", "e.g. 90");
  });

  it("hides score inputs outside has mode", () => {
    renderScore({ mode: "any", min: null, max: null });
    expect(screen.queryByLabelText("Minimum")).not.toBeInTheDocument();
  });

  it.each([
    ["", null],
    ["abc", null],
    ["0", 0],
    ["-5", 0],
    ["150", 100],
    ["12.7", 12],
    [" 12x ", 12],
  ])("normalizes score input %j to %j", (raw, expected) => {
    const onChange = renderScore({ mode: "has", min: 50, max: 70 });
    fireEvent.change(screen.getByLabelText("Minimum"), {
      target: { value: raw },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      mode: "has",
      min: expected,
      max: 70,
    });
    fireEvent.change(screen.getByLabelText("Maximum"), {
      target: { value: raw },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      mode: "has",
      min: 50,
      max: expected,
    });
  });

  it("renders salary inputs per mode without min/max attributes", () => {
    renderSalary({ mode: "at_least", min: 60000, max: null });
    const min = screen.getByLabelText("Minimum");
    expect(min).toHaveAttribute("id", "salary-min-filter");
    expect(min).toHaveValue("60000");
    expect(min).toHaveAttribute("inputmode", "numeric");
    expect(min).not.toHaveAttribute("min");
    expect(min).not.toHaveAttribute("max");
    expect(min).toHaveAttribute("placeholder", "e.g. 60000");
    expect(screen.queryByLabelText("Maximum")).not.toBeInTheDocument();
  });

  it("renders only the salary maximum in at_most mode", () => {
    renderSalary({ mode: "at_most", min: null, max: 100 });
    const max = screen.getByLabelText("Maximum");
    expect(max).toHaveAttribute("id", "salary-max-filter");
    expect(max).toHaveAttribute("placeholder", "e.g. 100000");
    expect(screen.queryByLabelText("Minimum")).not.toBeInTheDocument();
  });

  it.each([
    ["", null],
    ["abc", null],
    ["0", null],
    ["-5", null],
    ["150", 150],
    ["12.7", 12],
    [" 12x ", 12],
  ])("normalizes salary input %j to %j", (raw, expected) => {
    const onChange = renderSalary({ mode: "between", min: 5, max: 9 });
    fireEvent.change(screen.getByLabelText("Minimum"), {
      target: { value: raw },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      mode: "between",
      min: expected,
      max: 9,
    });
    fireEvent.change(screen.getByLabelText("Maximum"), {
      target: { value: raw },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      mode: "between",
      min: 5,
      max: expected,
    });
  });
});
