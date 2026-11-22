import { describe, expect, it } from "vitest";
import { isHttpUrl } from "./url";

describe("isHttpUrl", () => {
  it.each(["http://example.com", "https://example.com/path?q=1"])("accepts %s", (value) =>
    expect(isHttpUrl(value)).toBe(true),
  );
  it.each(["/relative", "invalid", "javascript:alert(1)", "ftp://example.com"])(
    "rejects %s",
    (value) => expect(isHttpUrl(value)).toBe(false),
  );
});
