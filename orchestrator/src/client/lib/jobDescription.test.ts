import { describe, expect, it } from "vitest";
import { getSafeJobDescriptionHref } from "./jobDescription";

describe("getSafeJobDescriptionHref", () => {
  it.each([
    ["https://example.com/a", "https://example.com/a"],
    ["http://example.com", "http://example.com"],
    ["mailto:hr@example.com", "mailto:hr@example.com"],
    ["HTTPS://example.com", "HTTPS://example.com"],
    ["//example.com/x", "//example.com/x"],
    ["javascript:alert(1)", undefined],
    ["data:text/html,hi", undefined],
    ["/relative", undefined],
    ["#hash", undefined],
    ["http://[bad", undefined],
    ["", undefined],
    [null, undefined],
    [undefined, undefined],
  ])("%s -> %s", (href, expected) => {
    expect(getSafeJobDescriptionHref(href)).toBe(expected);
  });
});
