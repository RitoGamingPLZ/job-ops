import { describe, expect, it } from "vitest";
import {
  bulletsFromHtml,
  bulletsToHtml,
  htmlToPlainText,
  introTextToHtml,
  joinDescription,
  extractResumeBullets,
  splitDescription,
  stripResumeHtml,
} from "./resume-bullets";

describe("resume bullets", () => {
  it("htmlToPlainText strips tags, decodes entities and keeps line breaks", () => {
    expect(
      htmlToPlainText("<p>R&amp;D&nbsp;prize &lt;2020&gt; &#39;x&#x27;</p><p>Second<br>line</p>  "),
    ).toBe("R&D prize <2020> 'x'\nSecond\nline");
    expect(htmlToPlainText("<b>a</b>   <i>b</i>")).toBe("a b");
    expect(htmlToPlainText("")).toBe("");
  });
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

describe("description prose and bullets", () => {
  const intro =
    '<p class="original">First &amp; <a href="https://example.com">linked</a></p>\n<p><strong>Second</strong> paragraph</p>';
  it("preserves original intro HTML byte-for-byte on a bullet edit", () => {
    const parts = splitDescription(`${intro}<ul><li>Duty</li></ul>`);
    expect(parts).toEqual({ introHtml: intro, bullets: ["Duty"] });
    expect(joinDescription(parts.introHtml, ["Edited & escaped"])).toBe(
      `${intro}<ul><li>Edited &amp; escaped</li></ul>`,
    );
  });
  it("keeps prose-only descriptions entirely in introHtml", () => {
    expect(splitDescription(intro)).toEqual({ introHtml: intro, bullets: [] });
    expect(joinDescription(intro, [])).toBe(intro);
    expect(splitDescription("")).toEqual({ introHtml: "", bullets: [] });
  });
  it("extracts ordered lists and multiple lists without treating other prose as duties", () => {
    expect(splitDescription("<p>Intro</p><ol><li>A</li></ol><ul><li>B</li></ul>")).toEqual({
      introHtml: "<p>Intro</p>",
      bullets: ["A", "B"],
    });
  });
  it("escapes manual intro edits and preserves paragraph boundaries", () => {
    expect(introTextToHtml("First <script>\nSecond & text")).toBe(
      "<p>First &lt;script&gt;</p><p>Second &amp; text</p>",
    );
  });
  it("keeps prose after the list in its original position during a bullet edit", () => {
    const original = `${intro}<ul><li>Duty</li></ul>\n<p>After <b>list</b></p>`;
    const { introHtml } = splitDescription(original);
    expect(joinDescription(introHtml, ["Edited"], original)).toBe(
      `${intro}<ul><li>Edited</li></ul>\n<p>After <b>list</b></p>`,
    );
    expect(joinDescription(introHtml, [], original)).toBe(`${intro}\n<p>After <b>list</b></p>`);
  });

  it("stripResumeHtml keeps emphasis tags only when asked", () => {
    const html =
      '<p>R&amp;D <strong>lead</strong>,&nbsp;<a href="x">site</a></p><p><em>Two</em></p>';
    expect(stripResumeHtml(html)).toBe("R&D lead , site\nTwo");
    expect(stripResumeHtml(html, true)).toBe("R&D <strong>lead</strong>, site\n<em>Two</em>");
  });

  it("extractResumeBullets prefers list items, else splits lines", () => {
    expect(extractResumeBullets("<ul><li><b>A</b></li><li> </li><li>B</li></ul>")).toEqual([
      "A",
      "B",
    ]);
    expect(extractResumeBullets("<ul><li><b>A</b></li></ul>", true)).toEqual(["<b>A</b>"]);
    expect(extractResumeBullets("one<br>two\n\nthree")).toEqual(["one", "two", "three"]);
    expect(extractResumeBullets(42)).toEqual([]);
  });
});
