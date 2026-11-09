import { describe, expect, it } from "vitest";
import { bulletsFromHtml, bulletsToHtml } from "./resume-bullets";

describe("resume bullets", () => {
  it("extracts list items, strips formatting, and decodes entities", () => {
    expect(
      bulletsFromHtml(
        "<p>Intro</p><ul><li>Built <b>APIs</b> &amp; tools</li><li>&#x1f680; &#39;ship&#39; &lt;fast&gt;</li><li> </li></ul>",
      ),
    ).toEqual(["Built APIs & tools", "🚀 'ship' <fast>"]);
  });
  it("falls back to newline, paragraphs and line breaks", () => {
    expect(bulletsFromHtml("<p>One</p><p>Two<br>Three</p>\nFour")).toEqual([
      "One",
      "Two",
      "Three",
      "Four",
    ]);
    expect(bulletsFromHtml("")).toEqual([]);
  });
  it("escapes untrusted text and round trips without double decoding", () => {
    const bullets = ["<script>\"x\"</script> & 'y'", "literal &lt;tag&gt;"];
    const html = bulletsToHtml(bullets);
    expect(html).not.toContain("<script>");
    expect(bulletsFromHtml(html)).toEqual(bullets);
    expect(bulletsToHtml([])).toBe("");
  });
});
