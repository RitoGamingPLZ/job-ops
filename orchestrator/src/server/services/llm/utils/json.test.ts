import { afterEach, describe, expect, it, vi } from "vitest";
import { parseJsonContent } from "./json";

describe("parseJsonContent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses clean JSON", () => {
    const result = parseJsonContent<{ foo: string }>('{"foo": "bar"}');
    expect(result.foo).toBe("bar");
  });

  it("handles markdown code fences", () => {
    const result = parseJsonContent<{ foo: string }>('```json\n{"foo": "bar"}\n```');
    expect(result.foo).toBe("bar");
  });

  it("handles json without language specifier", () => {
    const result = parseJsonContent<{ foo: string }>('```\n{"foo": "bar"}\n```');
    expect(result.foo).toBe("bar");
  });

  it("extracts JSON from surrounding text", () => {
    const result = parseJsonContent<{ foo: string }>(
      'Here is the result: {"foo": "bar"} as requested.',
    );
    expect(result.foo).toBe("bar");
  });

  it("throws on completely invalid content", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => parseJsonContent("not json at all")).toThrow();
  });
});
