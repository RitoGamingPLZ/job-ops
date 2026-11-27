import { existsSync, readFileSync } from "node:fs";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "@infra/logger";
import { NAVY_SERIF_STYLE } from "@shared/resume-style/navy-serif";
import { type PdfPaperSize, TYPST_THEME_VALUES, type TypstTheme } from "@shared/types";
import { asRecord } from "@shared/utils/type-conversion";
import { runResumeCompiler, withRenderTempDir } from "./compiler";
import {
  formatLanguageDetails,
  renderInlineHtml,
  renderOrderedSections,
  resolveSectionTitles,
} from "./markup";
import { summarizeResumeDocumentForLog } from "./log";
import { materializeResumePicture } from "./picture";
import type {
  LatexResumeContactItem,
  LatexResumeCustomFieldItem,
  LatexResumeDocument,
  LatexResumeEntry,
  LatexResumeInterestItem,
  LatexResumeLanguageItem,
  ResumeRenderer,
} from "./types";

const TYPST_TIMEOUT_MS = 120_000;
const OUTPUT_FILENAME = "resume.pdf";
const RESUME_DATA_FILENAME = "resume-data.json";
const THEME_MANIFEST_FILENAME = "theme.json";
const TYPST_PAPER_NAMES: Record<PdfPaperSize, string> = {
  auto: "a4",
  a4: "a4",
  letter: "us-letter",
};

const REQUIRED_NATIVE_TOKEN_KEYS = [
  "pageMargin",
  "bodySize",
  "parLeading",
  "sectionTop",
  "sectionBottom",
  "sectionSize",
  "lineWidth",
  "nameSize",
  "headlineSize",
  "contactSize",
  "entryMetaSize",
  "accent",
] as const;

export type TypstThemeTokens = Record<(typeof REQUIRED_NATIVE_TOKEN_KEYS)[number], string>;

export interface TypstThemeManifest {
  id: TypstTheme;
  label: string;
  description: string;
  kind: "native" | "adapted";
  entrypoint: string;
  tokens?: TypstThemeTokens;
}

function resolveThemesRoot(): string {
  const candidates: string[] = [];
  try {
    if (import.meta.url.startsWith("file:")) {
      const moduleDir = dirname(fileURLToPath(import.meta.url));
      candidates.push(
        join(moduleDir, "typst-themes"),
        join(moduleDir, "../../src/server/services/resume-renderer/typst-themes"),
      );
    }
  } catch {
    // Fall through to cwd-based resolution below.
  }

  const cwd = process.cwd();
  candidates.push(
    join(cwd, "src/server/services/resume-renderer/typst-themes"),
    join(cwd, "orchestrator/src/server/services/resume-renderer/typst-themes"),
  );

  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[candidates.length - 1];
}

const THEMES_ROOT = resolveThemesRoot();

function assertSupportedTheme(theme: TypstTheme): void {
  if (!TYPST_THEME_VALUES.includes(theme)) {
    throw new Error(`Unsupported Typst theme: ${theme}`);
  }
}

function assertSafeThemePath(value: string, field: string): void {
  if (!value.trim()) {
    throw new Error(`Typst theme ${field} is required`);
  }
  const normalized = normalize(value);
  if (
    normalized.startsWith("..") ||
    normalized.includes("/../") ||
    normalized.includes("\\..\\") ||
    normalized.startsWith("/") ||
    /^[a-zA-Z]:/.test(normalized)
  ) {
    throw new Error(`Typst theme ${field} must stay inside its theme directory`);
  }
}

function parseThemeTokens(theme: TypstTheme, value: unknown): TypstThemeTokens {
  const tokenRecord = asRecord(value);
  if (!tokenRecord) {
    throw new Error(`Typst theme ${theme} requires a tokens object`);
  }

  const tokens: Partial<TypstThemeTokens> = {};
  for (const key of REQUIRED_NATIVE_TOKEN_KEYS) {
    const token = tokenRecord[key];
    if (typeof token !== "string" || token.trim().length === 0) {
      throw new Error(`Typst theme ${theme} is missing tokens.${key}`);
    }
    tokens[key] = token;
  }

  return tokens as TypstThemeTokens;
}

function parseThemeManifest(theme: TypstTheme, value: unknown): TypstThemeManifest {
  const manifest = asRecord(value);
  if (!manifest) {
    throw new Error(`Typst theme ${theme} manifest must be an object`);
  }
  if (manifest.id !== theme) {
    throw new Error(`Typst theme ${theme} manifest id must match the folder`);
  }
  if (typeof manifest.label !== "string" || manifest.label.trim().length === 0) {
    throw new Error(`Typst theme ${theme} manifest requires a label`);
  }
  if (typeof manifest.description !== "string" || manifest.description.trim().length === 0) {
    throw new Error(`Typst theme ${theme} manifest requires a description`);
  }
  if (manifest.kind !== "native" && manifest.kind !== "adapted") {
    throw new Error(`Typst theme ${theme} manifest kind must be "native" or "adapted"`);
  }
  if (typeof manifest.entrypoint !== "string") {
    throw new Error(`Typst theme ${theme} manifest requires an entrypoint`);
  }
  assertSafeThemePath(manifest.entrypoint, "entrypoint");

  return {
    id: theme,
    label: manifest.label,
    description: manifest.description,
    kind: manifest.kind,
    entrypoint: manifest.entrypoint,
    tokens: manifest.kind === "native" ? parseThemeTokens(theme, manifest.tokens) : undefined,
  };
}

function getTypstThemeDir(theme: TypstTheme): string {
  assertSupportedTheme(theme);
  return join(THEMES_ROOT, theme);
}

function getTypstThemeManifestPath(theme: TypstTheme): string {
  return join(getTypstThemeDir(theme), THEME_MANIFEST_FILENAME);
}

export function getTypstTemplatePath(theme: TypstTheme = "classic"): string {
  const raw = readFileSync(getTypstThemeManifestPath(theme), "utf8");
  const manifest = parseThemeManifest(theme, JSON.parse(raw));
  return join(getTypstThemeDir(theme), manifest.entrypoint);
}

function escapeRawTypst(value: string): string {
  return value.replace(/([\\#*$@_[\]{}<>`])/g, "\\$1");
}

function escapeTypstText(value: string): string {
  return renderInlineHtml(value, {
    escape: escapeRawTypst,
    bold: "#strong[",
    italic: "#emph[",
    close: "]",
  });
}

function escapeTypstUrl(value: string): string {
  return JSON.stringify(value.trim());
}

function renderLink(label: string, url?: string | null): string {
  const renderedLabel = escapeTypstText(label);
  if (!url) return renderedLabel;
  return `#link(${escapeTypstUrl(url)})[${renderedLabel}]`;
}

function renderContactItems(items: LatexResumeContactItem[]): string {
  return items.map((item) => renderLink(item.text, item.url)).join(" #h(4pt) | #h(4pt) ");
}

function renderBullets(items: string[]): string {
  if (items.length === 0) return "";
  return items.map((item) => `- ${escapeTypstText(item)}`).join("\n");
}

function renderEntryHeader(entry: LatexResumeEntry, metaSize: string): string {
  const title = renderLink(entry.title, entry.url);
  const date = entry.date ? `#text(size: ${metaSize})[${escapeTypstText(entry.date)}]` : "[]";
  return `#grid(columns: (1fr, auto), column-gutter: 1em, [*${title}*], [${date}])`;
}

function renderSubheadingEntry(entry: LatexResumeEntry, metaSize: string): string {
  const subtitle = entry.subtitle ? escapeTypstText(entry.subtitle) : "";
  const secondaryTitle = entry.secondaryTitle ? escapeTypstText(entry.secondaryTitle) : "";
  const secondarySubtitle = entry.secondarySubtitle ? escapeTypstText(entry.secondarySubtitle) : "";
  const subline = [subtitle || secondaryTitle, secondarySubtitle].filter(Boolean).join(" / ");
  const bullets = renderBullets(entry.bullets);

  return [renderEntryHeader(entry, metaSize), subline ? `#emph[${subline}]` : "", bullets]
    .filter(Boolean)
    .join("\n");
}

function renderProjectEntry(entry: LatexResumeEntry, metaSize: string): string {
  const title = renderLink(entry.title, entry.url);
  const subtitle = entry.subtitle ? ` #emph[${escapeTypstText(entry.subtitle)}]` : "";
  const date = entry.date ? `#text(size: ${metaSize})[${escapeTypstText(entry.date)}]` : "[]";
  const bullets = renderBullets(entry.bullets);
  return [
    `#grid(columns: (1fr, auto), column-gutter: 1em, [*${title}*${subtitle}], [${date}])`,
    bullets,
  ]
    .filter(Boolean)
    .join("\n");
}

function renderSummarySection(document: LatexResumeDocument): string {
  if (!document.summary) return "";
  const titles = resolveSectionTitles(document);
  return [`= ${escapeTypstText(titles.summary)}`, escapeTypstText(document.summary)].join("\n\n");
}

function renderEntrySection(args: {
  title: string;
  entries: LatexResumeEntry[];
  kind: "subheading" | "project";
  metaSize: string;
}): string {
  if (args.entries.length === 0) return "";
  const body = args.entries
    .map((entry) =>
      args.kind === "project"
        ? renderProjectEntry(entry, args.metaSize)
        : renderSubheadingEntry(entry, args.metaSize),
    )
    .join("\n\n");
  return [`= ${escapeTypstText(args.title)}`, body].join("\n\n");
}

function renderSkillsSection(document: LatexResumeDocument): string {
  if (document.skillGroups.length === 0) return "";
  const titles = resolveSectionTitles(document);
  const items = document.skillGroups
    .map((group) => {
      const keywords = group.keywords.map((keyword) => escapeTypstText(keyword));
      return `*${escapeTypstText(group.name)}:* ${keywords.join(", ")}`;
    })
    .join(" \\\n");
  return [`= ${escapeTypstText(titles.skills)}`, items].join("\n\n");
}

function renderLineSection(title: string, lines: string[]): string {
  if (lines.length === 0) return "";
  return [`= ${escapeTypstText(title)}`, ...lines.map((line) => `- ${line}`)].join("\n");
}

function renderProfilesSection(document: LatexResumeDocument): string {
  if (document.profileItems.length === 0) return "";
  const titles = resolveSectionTitles(document);
  const lines = document.profileItems.map((item) => {
    const label = escapeTypstText(item.network);
    const value = renderLink(item.label || item.username || item.url || item.network, item.url);
    return `*${label}:* ${value}`;
  });
  return renderLineSection(titles.profiles, lines);
}

function renderCustomFieldsSection(document: LatexResumeDocument): string {
  if (document.customFieldItems.length === 0) return "";
  const titles = resolveSectionTitles(document);
  const lines = document.customFieldItems.map((item: LatexResumeCustomFieldItem) => {
    const value = item.url ? renderLink(item.text, item.url) : escapeTypstText(item.text);
    if (!item.title) return value;
    if (item.title === item.text) {
      return `*${escapeTypstText(item.title)}*`;
    }
    return `*${escapeTypstText(item.title)}:* ${value}`;
  });
  return renderLineSection(titles.customFields, lines);
}

function renderLanguagesSection(document: LatexResumeDocument): string {
  if (document.languages.length === 0) return "";
  const titles = resolveSectionTitles(document);
  const lines = document.languages.map((item: LatexResumeLanguageItem) => {
    const detail = formatLanguageDetails(item).map(escapeTypstText).join(" | ");
    return detail
      ? `*${escapeTypstText(item.language)}:* ${detail}`
      : `*${escapeTypstText(item.language)}*`;
  });
  return renderLineSection(titles.languages, lines);
}

function renderInterestsSection(document: LatexResumeDocument): string {
  if (document.interests.length === 0) return "";
  const titles = resolveSectionTitles(document);
  const lines = document.interests.map((item: LatexResumeInterestItem) => {
    const keywords = item.keywords.map((keyword) => escapeTypstText(keyword));
    return keywords.length > 0
      ? `*${escapeTypstText(item.name)}:* ${keywords.join(", ")}`
      : `*${escapeTypstText(item.name)}*`;
  });
  return renderLineSection(titles.interests, lines);
}

function renderPictureBlock(document: LatexResumeDocument): string {
  const picture = document.picture;
  if (!picture?.renderPath || picture.hidden) return "";

  const width = Math.max(48, Math.min(picture.size, 144));
  const image = `#image(${escapeTypstUrl(picture.renderPath)}, width: ${width}pt)`;
  const renderedImage = picture.rotation
    ? `#rotate(angle: ${Math.round(picture.rotation)}deg, reflow: true)[${image}]`
    : image;

  return `${renderedImage} \\\n  #v(4pt)\n`;
}

function renderLocationBlock(document: LatexResumeDocument): string {
  if (!document.location) return "";
  return `  #text(size: 9pt)[${escapeTypstText(document.location)}] \\\n`;
}

export async function readTypstThemeManifest(
  theme: TypstTheme = "classic",
): Promise<TypstThemeManifest> {
  const raw = await readFile(getTypstThemeManifestPath(theme), "utf8");
  return parseThemeManifest(theme, JSON.parse(raw));
}

export async function readTypstTheme(theme: TypstTheme = "classic"): Promise<{
  manifest: TypstThemeManifest;
  template: string;
  tokens?: TypstThemeTokens;
}> {
  const manifest = await readTypstThemeManifest(theme);
  const templatePath = join(getTypstThemeDir(theme), manifest.entrypoint);
  const template = await readFile(templatePath, "utf8");
  return { manifest, template, tokens: manifest.tokens };
}

async function loadTemplate(theme: TypstTheme): Promise<{
  manifest: TypstThemeManifest;
  template: string;
  tokens?: TypstThemeTokens;
}> {
  const { manifest, template, tokens } = await readTypstTheme(theme);
  return { manifest, template, tokens };
}

function replaceSharedTypstPlaceholders(template: string, paperSize: PdfPaperSize): string {
  return template
    .replaceAll("__RESUME_DATA_PATH__", JSON.stringify(RESUME_DATA_FILENAME))
    .replaceAll("__PAGE_PAPER__", JSON.stringify(TYPST_PAPER_NAMES[paperSize]));
}

// Navy Serif reads its typography from the same tokens as the co-work editor.
const NAVY_STYLE_TYPST = (() => {
  const s = NAVY_SERIF_STYLE;
  return `(${[
    `font: (${s.fontFamily.map((f) => JSON.stringify(f)).join(", ")})`,
    `lineHeight: ${s.lineHeight}`,
    ...Object.entries(s.color).map(([k, v]) => `${k}: rgb("${v}")`),
    ...Object.entries({ ...s.size, ...s.space }).map(([k, v]) => `${k}: ${v}pt`),
    `strongWeight: ${s.strongWeight}`,
    `entryWeight: ${s.entryWeight}`,
    `entryStyle: "${s.entryStyle}"`,
    `markerIndent: ${s.indent.marker}mm`,
    `textIndent: ${s.indent.text}mm`,
    `marginX: ${s.margin.x}mm`,
    `marginY: ${s.margin.y}mm`,
  ].join(", ")})`;
})();

function buildAdaptedTypstDocument(template: string, paperSize: PdfPaperSize): string {
  return replaceSharedTypstPlaceholders(template, paperSize).replaceAll(
    "__NAVY_STYLE__",
    NAVY_STYLE_TYPST,
  );
}

export function buildTypstDocument(
  document: LatexResumeDocument,
  template: string,
  tokens: TypstThemeTokens,
  paperSize: PdfPaperSize = "auto",
): string {
  const titles = resolveSectionTitles(document);
  const pictureBlock = renderPictureBlock(document);
  const headlineBlock = document.headline
    ? `  #text(size: ${tokens.headlineSize})[${escapeTypstText(document.headline)}] \\\n`
    : "";
  const locationBlock = renderLocationBlock(document);
  const contactBlock =
    document.contactItems.length > 0
      ? `  #text(size: ${tokens.contactSize})[${renderContactItems(document.contactItems)}]\n`
      : "";
  const body = [
    renderSummarySection(document),
    renderCustomFieldsSection(document),
    ...renderOrderedSections(document, titles, {
      entry: (args) => renderEntrySection({ ...args, metaSize: tokens.entryMetaSize }),
      profiles: () => renderProfilesSection(document),
      skills: () => renderSkillsSection(document),
      languages: () => renderLanguagesSection(document),
      interests: () => renderInterestsSection(document),
    }),
  ]
    .filter(Boolean)
    .join("\n\n");

  return replaceSharedTypstPlaceholders(template, paperSize)
    .replace("__PAGE_MARGIN__", tokens.pageMargin)
    .replace("__BODY_SIZE__", tokens.bodySize)
    .replace("__PAR_LEADING__", tokens.parLeading)
    .replace("__SECTION_TOP__", tokens.sectionTop)
    .replace("__SECTION_SIZE__", tokens.sectionSize)
    .replace("__ACCENT__", tokens.accent)
    .replace("__LINE_WIDTH__", tokens.lineWidth)
    .replace("__SECTION_BOTTOM__", tokens.sectionBottom)
    .replace("__NAME_SIZE__", tokens.nameSize)
    .replace("__PICTURE_BLOCK__", pictureBlock)
    .replace("__NAME__", escapeTypstText(document.name))
    .replace("__HEADLINE_BLOCK__", headlineBlock)
    .replace("__LOCATION_BLOCK__", locationBlock)
    .replace("__CONTACT_BLOCK__", contactBlock)
    .replace("__BODY__", body);
}

async function runTypst(args: {
  cwd: string;
  typPath: string;
  outputPath: string;
  jobId: string;
}): Promise<void> {
  const binary = process.env.TYPST_BIN?.trim() || "typst";

  await runResumeCompiler({
    binary,
    argv: ["compile", args.typPath, args.outputPath],
    cwd: args.cwd,
    timeoutMs: TYPST_TIMEOUT_MS,
    jobId: args.jobId,
    label: "Typst",
    missingBinaryMessage:
      "Typst binary not found. Install typst or set TYPST_BIN to the executable path.",
    warningMessage: "Typst resume compile failed",
    ellipsis: "...",
  });
}

export function convertDocFieldsToTypst(doc: LatexResumeDocument): LatexResumeDocument {
  const convertBullets = (bullets: string[]) => bullets.map((bullet) => escapeTypstText(bullet));

  const convertEntry = (entry: LatexResumeEntry): LatexResumeEntry => ({
    ...entry,
    ...(entry.intro
      ? {
          intro: entry.intro
            .split("\n\n")
            .map((paragraph) => paragraph.split("\n").map(escapeTypstText).join("#linebreak()"))
            .join("\n\n"),
        }
      : {}),
    ...(entry.listBullets ? { listBullets: convertBullets(entry.listBullets) } : {}),
    bullets: convertBullets(entry.bullets),
  });

  return {
    ...doc,
    summary: doc.summary ? escapeTypstText(doc.summary) : null,
    experience: doc.experience.map(convertEntry),
    education: doc.education.map(convertEntry),
    projects: doc.projects.map(convertEntry),
    awards: doc.awards.map(convertEntry),
    certifications: doc.certifications.map(convertEntry),
    publications: doc.publications.map(convertEntry),
    volunteer: doc.volunteer.map(convertEntry),
    references: doc.references.map(convertEntry),
  };
}

const typstResumeRenderer: ResumeRenderer = {
  async render({
    document,
    outputPath,
    jobId,
    resolvedPicture,
    typstTheme = "classic",
    paperSize = "auto",
  }) {
    await withRenderTempDir(
      { renderer: "Typst", jobId, prefix: "job-ops-resume-render-" },
      async (tempDir) => {
        const typPath = join(tempDir, "resume.typ");
        const resumeDataPath = join(tempDir, RESUME_DATA_FILENAME);
        const compiledPdfPath = join(tempDir, OUTPUT_FILENAME);

        try {
          const { manifest, template, tokens } = await loadTemplate(typstTheme);
          const renderableDocument = await materializeResumePicture(
            document,
            tempDir,
            resolvedPicture,
          );
          let typst: string;
          let resumeDataDoc: LatexResumeDocument;

          if (manifest.kind === "native") {
            if (!tokens) {
              throw new Error(`Typst theme ${typstTheme} is missing native tokens.`);
            }
            typst = buildTypstDocument(renderableDocument, template, tokens, paperSize);
            resumeDataDoc = renderableDocument;
          } else {
            typst = buildAdaptedTypstDocument(template, paperSize);
            resumeDataDoc = convertDocFieldsToTypst(renderableDocument);
          }

          await writeFile(resumeDataPath, JSON.stringify(resumeDataDoc), "utf8");
          await writeFile(typPath, typst, "utf8");
          await runTypst({
            cwd: tempDir,
            typPath,
            outputPath: compiledPdfPath,
            jobId,
          });
          await copyFile(compiledPdfPath, outputPath);

          logger.info("Rendered Typst resume PDF", {
            jobId,
            outputPath,
            typstTheme,
          });
        } catch (error) {
          logger.error("Failed to render Typst resume PDF", {
            jobId,
            outputPath,
            typstTheme,
            error,
            document: summarizeResumeDocumentForLog(document),
          });
          throw error;
        }
      },
    );
  },
};

export async function renderTypstPdf(args: Parameters<ResumeRenderer["render"]>[0]): Promise<void> {
  await typstResumeRenderer.render(args);
}

export async function readTypstTemplate(theme: TypstTheme = "classic"): Promise<string> {
  return (await readTypstTheme(theme)).template;
}
