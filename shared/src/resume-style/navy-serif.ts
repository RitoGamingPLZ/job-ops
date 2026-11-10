/**
 * Navy Serif typography, shared by the co-work editor (CSS custom properties)
 * and the Typst theme (injected as `__NAVY_STYLE__`). Sizes and spacings are
 * pt, margins and indents mm. Spacings are gaps between line boxes of height
 * `lineHeight` × font size, as in CSS; the Typst theme sets matching text edges.
 */
export const NAVY_SERIF_STYLE = {
  fontFamily: [
    "Times New Roman",
    "Liberation Serif",
    "TeX Gyre Termes",
    "Tinos",
    "Libertinus Serif",
  ],
  lineHeight: 1.2,
  color: { text: "#000000", accent: "#1f3a6e", link: "#1155cc" },
  size: {
    name: 16.5,
    contact: 10,
    headline: 10,
    section: 14,
    position: 12,
    entry: 11,
    body: 10.5,
    marker: 10,
  },
  /** Name, section heading, skill category and award title. */
  strongWeight: 700,
  /** Position, company/location, dates, project name and school. */
  entryWeight: 700,
  entryStyle: "italic",
  space: {
    nameToContact: 2,
    sectionAbove: 10,
    headingToRule: 3,
    rule: 1.2,
    ruleToBody: 4,
    itemGap: 8,
    entryToBody: 2,
    bulletGap: 1.5,
    skillGap: 4,
    lineItemGap: 2,
  },
  indent: { marker: 2, text: 7.5 },
  margin: { x: 15, y: 15 },
} as const;

const s = NAVY_SERIF_STYLE;

/** The tokens as CSS custom properties for the editor's page root. */
export const NAVY_SERIF_CSS_VARS: Record<string, string> = {
  "--rs-font": `${s.fontFamily.map((f) => `"${f}"`).join(", ")}, serif`,
  "--rs-line-height": String(s.lineHeight),
  "--rs-strong-weight": String(s.strongWeight),
  "--rs-entry-weight": String(s.entryWeight),
  "--rs-entry-style": s.entryStyle,
  ...Object.fromEntries(
    Object.entries(s.color).map(([k, v]) => [`--rs-color-${k}`, v]),
  ),
  ...Object.fromEntries(
    Object.entries({ ...s.size, ...s.space }).map(([k, v]) => [
      `--rs-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`,
      `${v}pt`,
    ]),
  ),
  "--rs-marker-indent": `${s.indent.marker}mm`,
  "--rs-text-indent": `${s.indent.text}mm`,
  "--rs-margin-x": `${s.margin.x}mm`,
  "--rs-margin-y": `${s.margin.y}mm`,
};
