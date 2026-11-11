import { describe, expect, it } from "vitest";
import { escapeHtml, escapeHtmlText } from "./html";

describe("HTML escaping", () => {
  it("preserves apostrophes in provider descriptions while escaping markup", () => {
    expect(escapeHtml(`R&D <role> "engineer's"`)).toBe(
      `R&amp;D &lt;role&gt; &quot;engineer's&quot;`,
    );
  });

  it("also escapes apostrophes for Apple descriptions and resume text", () => {
    expect(escapeHtmlText(`R&D <role> "engineer's"`)).toBe(
      "R&amp;D &lt;role&gt; &quot;engineer&#39;s&quot;",
    );
  });
});
