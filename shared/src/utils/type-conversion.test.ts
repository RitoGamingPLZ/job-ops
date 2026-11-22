import { describe, expect, it } from "vitest";
import { toIntegerOrFallback } from "./type-conversion";

describe("toIntegerOrFallback", () => {
  it.each([
    [undefined, 50],
    [Number.NaN, 50],
    [Number.POSITIVE_INFINITY, 50],
    [-5, 1],
    [0, 1],
    [0.5, 1],
    [7.9, 7],
    ["12", 12],
    ["12junk", 12],
    ["1e3", 1],
    ["0x10", 1],
    [" 8", 8],
    ["-3", 1],
    ["junk", 50],
    ["", 50],
  ] as const)("parses %o to %o by default", (value, expected) => {
    expect(toIntegerOrFallback(value, 50)).toBe(expected);
  });

  it("returns non-finite or negative fallbacks unchanged", () => {
    expect(toIntegerOrFallback(undefined, -2)).toBe(-2);
    expect(toIntegerOrFallback("x", Number.NaN)).toBeNaN();
    expect(toIntegerOrFallback(0.4, 0.4)).toBe(1);
  });

  it("clamps to a custom minimum", () => {
    expect(toIntegerOrFallback(-1, 9, { min: 0 })).toBe(0);
    expect(toIntegerOrFallback(0.9, 9, { min: 0 })).toBe(0);
    expect(toIntegerOrFallback("3", 9, { min: 0 })).toBe(3);
  });

  it("rejects strings when parseStrings is false", () => {
    expect(toIntegerOrFallback("12", 25, { parseStrings: false })).toBe(25);
    expect(toIntegerOrFallback(-4, 25, { parseStrings: false })).toBe(1);
    expect(toIntegerOrFallback(30.7, 25, { parseStrings: false })).toBe(30);
  });
});
