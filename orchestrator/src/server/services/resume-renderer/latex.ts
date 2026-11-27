import { copyFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { logger } from "@infra/logger";
import type { PdfPaperSize } from "@shared/types";
import { resolveRendererAssetPath, runResumeCompiler, withRenderTempDir } from "./compiler";
import {
  formatCustomFieldLines,
  formatInterestLines,
  formatLanguageLines,
  type LineSectionFormat,
  renderInlineHtml,
  renderOrderedSections,
  resolveSectionTitles,
} from "./markup";
import { summarizeResumeDocumentForLog } from "./log";
import { materializeResumePicture } from "./picture";
import type {
  LatexResumeContactItem,
  LatexResumeDocument,
  LatexResumeEntry,
  LatexResumeProfileItem,
  ResumeRenderer,
} from "./types";

const TEMPLATE_PATH = resolveRendererAssetPath("templates/jake-resume.tex");
const TECTONIC_TIMEOUT_MS = 120_000;
const OUTPUT_FILENAME = "resume.pdf";
const LATEX_PAPER_OPTIONS: Record<PdfPaperSize, string> = {
  auto: "letterpaper",
  a4: "a4paper",
  letter: "letterpaper",
};

function escapeRawLatex(value: string): string {
  return value
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([#$%&_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

function escapeLatexText(value: string): string {
  return renderInlineHtml(value, {
    escape: escapeRawLatex,
    bold: "\\textbf{",
    italic: "\\textit{",
    close: "}",
  });
}

function escapeLatexUrl(value: string): string {
  return escapeRawLatex(value.trim());
}

function escapeForCommand(value: string): string {
  return escapeLatexText(value).replace(/\|/g, "{\\textbar}");
}

function renderLink(label: string, url?: string | null): string {
  if (!url) return escapeForCommand(label);
  return `\\href{${escapeLatexUrl(url)}}{\\underline{${escapeForCommand(label)}}}`;
}

function getIconForKindOrNetwork(kindOrNetwork: string, text?: string): string {
  let lower = kindOrNetwork.toLowerCase().trim();
  if (!lower && text) {
    if (text.includes("@")) {
      lower = "email";
    } else if (/^[+\d\s()-]+$/.test(text)) {
      lower = "phone";
    } else {
      lower = "website";
    }
  }

  switch (lower) {
    case "phone":
      return "\\faPhone";
    case "email":
    case "mail":
      return "\\faEnvelope";
    case "website":
    case "web":
    case "globe":
      return "\\faGlobe";
    case "linkedin":
      return "\\faLinkedin";
    case "github":
      return "\\faGithub";
    case "twitter":
    case "x":
      return "\\faXTwitter";
    case "facebook":
      return "\\faFacebook";
    case "instagram":
      return "\\faInstagram";
    case "youtube":
      return "\\faYoutube";
    case "medium":
      return "\\faMedium";
    case "dev":
    case "dev.to":
      return "\\faDev";
    case "stackoverflow":
    case "stack-overflow":
      return "\\faStackOverflow";
    case "gitlab":
      return "\\faGitlab";
    case "dribbble":
      return "\\faDribbble";
    case "behance":
      return "\\faBehance";
    case "discord":
      return "\\faDiscord";
    case "reddit":
      return "\\faReddit";
    case "twitch":
      return "\\faTwitch";
    case "tiktok":
      return "\\faTiktok";
    case "skype":
      return "\\faSkype";
    case "whatsapp":
      return "\\faWhatsapp";
    case "telegram":
      return "\\faTelegram";
    case "pinterest":
      return "\\faPinterest";
    default:
      return "\\faLink";
  }
}

function cleanUrlForDisplay(url: string): string {
  return url
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/, "");
}

function renderHeaderItems(
  contactItems: LatexResumeContactItem[],
  profileItems: LatexResumeProfileItem[],
): string {
  const renderedItems: string[] = [];

  for (const item of contactItems) {
    const icon = getIconForKindOrNetwork(item.kind || "", item.text);
    const linkStr = renderLink(item.text, item.url);
    renderedItems.push(`${icon}~${linkStr}`);
  }

  for (const item of profileItems) {
    const displayUrl = item.url ? cleanUrlForDisplay(item.url) : item.username || item.network;
    const icon = getIconForKindOrNetwork(item.network);
    const linkStr = renderLink(displayUrl, item.url);
    renderedItems.push(`${icon}~${linkStr}`);
  }

  const N = renderedItems.length;
  if (N === 0) return "";

  if (N <= 3) {
    return renderedItems.join(" \\quad ");
  }

  const numRows = Math.ceil(N / 3);
  const rows: string[][] = [];
  const baseSize = Math.floor(N / numRows);
  const remainder = N % numRows;

  let currentIndex = 0;
  for (let r = 0; r < numRows; r++) {
    const size = r < remainder ? baseSize + 1 : baseSize;
    rows.push(renderedItems.slice(currentIndex, currentIndex + size));
    currentIndex += size;
  }

  return rows.map((row) => row.join(" \\quad ")).join(" \\\\[4pt]\n    ");
}

function renderBullets(items: string[]): string {
  if (items.length === 0) return "";
  return [
    "      \\resumeItemListStart",
    ...items.map((item) => `        \\resumeItem{${escapeForCommand(item)}}`),
    "      \\resumeItemListEnd",
  ].join("\n");
}

function renderSubheadingEntry(entry: LatexResumeEntry): string {
  const title = renderLink(entry.title, entry.url);
  const subtitle = entry.subtitle ? escapeForCommand(entry.subtitle) : "";
  const secondaryTitle = entry.secondaryTitle ? escapeForCommand(entry.secondaryTitle) : "";
  const secondarySubtitle = entry.secondarySubtitle
    ? escapeForCommand(entry.secondarySubtitle)
    : "";
  const date = entry.date ? escapeForCommand(entry.date) : "";

  const lines = [
    "    \\resumeSubheading",
    `      {${title}}{${date}}`,
    `      {${subtitle || secondaryTitle}}{${secondarySubtitle || ""}}`,
  ];

  const bullets = renderBullets(entry.bullets);
  if (bullets) lines.push(bullets);
  return lines.join("\n");
}

function renderProjectEntry(entry: LatexResumeEntry): string {
  const title = renderLink(entry.title, entry.url);
  const subtitle = entry.subtitle ? ` $|$ \\emph{${escapeForCommand(entry.subtitle)}}` : "";
  const date = entry.date ? escapeForCommand(entry.date) : "";
  const lines = [
    "      \\resumeProjectHeading",
    `          {\\textbf{${title}}${subtitle}}{${date}}`,
  ];
  const bullets = renderBullets(entry.bullets);
  if (bullets) lines.push(bullets);
  return lines.join("\n");
}

function renderSummarySection(document: LatexResumeDocument): string {
  if (!document.summary) return "";
  const titles = resolveSectionTitles(document);
  return [
    `\\section{${escapeForCommand(titles.summary)}}`,
    " \\begin{itemize}[leftmargin=0.15in, label={}]",
    `    \\small{\\item{${escapeForCommand(document.summary)}}}`,
    " \\end{itemize}",
    "",
  ].join("\n");
}

function renderEntrySection(args: {
  title: string;
  entries: LatexResumeEntry[];
  kind: "subheading" | "project";
}): string {
  if (args.entries.length === 0) return "";
  const body = args.entries
    .map((entry) =>
      args.kind === "project" ? renderProjectEntry(entry) : renderSubheadingEntry(entry),
    )
    .join("\n\n");
  return [
    `\\section{${escapeForCommand(args.title)}}`,
    "  \\resumeSubHeadingListStart",
    body,
    "  \\resumeSubHeadingListEnd",
    "",
  ].join("\n");
}

function renderSkillsSection(document: LatexResumeDocument): string {
  if (document.skillGroups.length === 0) return "";
  const titles = resolveSectionTitles(document);
  const items = document.skillGroups
    .map((group) => {
      const keywords = group.keywords.map((keyword) => escapeForCommand(keyword));
      const keywordsText = keywords.join(", ");
      return `     \\textbf{${escapeForCommand(group.name)}}{: ${keywordsText}} \\\\`;
    })
    .join("\n");
  return [
    `\\section{${escapeForCommand(titles.skills)}}`,
    " \\begin{itemize}[leftmargin=0.15in, label={}]",
    "    \\small{\\item{",
    items,
    "    }}",
    " \\end{itemize}",
    "",
  ].join("\n");
}

function renderLineSection(title: string, lines: string[]): string {
  if (lines.length === 0) return "";
  return [
    `\\section{${escapeForCommand(title)}}`,
    " \\begin{itemize}[leftmargin=0.15in, label={}]",
    ...lines.map((line) => `    \\small{\\item{${line}}}`),
    " \\end{itemize}",
    "",
  ].join("\n");
}

const LATEX_LINE_FORMAT: LineSectionFormat = {
  escape: escapeForCommand,
  bold: (label) => `\\textbf{${escapeForCommand(label)}}`,
  boldPair: (label, value) => `\\textbf{${escapeForCommand(label)}}{: ${value}}`,
  link: renderLink,
};

function renderCustomFieldsSection(document: LatexResumeDocument): string {
  if (document.customFieldItems.length === 0) return "";
  const titles = resolveSectionTitles(document);
  return renderLineSection(
    titles.customFields,
    formatCustomFieldLines(document.customFieldItems, LATEX_LINE_FORMAT),
  );
}

function renderLanguagesSection(document: LatexResumeDocument): string {
  if (document.languages.length === 0) return "";
  const titles = resolveSectionTitles(document);
  return renderLineSection(
    titles.languages,
    formatLanguageLines(document.languages, LATEX_LINE_FORMAT),
  );
}

function renderInterestsSection(document: LatexResumeDocument): string {
  if (document.interests.length === 0) return "";
  const titles = resolveSectionTitles(document);
  return renderLineSection(
    titles.interests,
    formatInterestLines(document.interests, LATEX_LINE_FORMAT),
  );
}

function renderPictureBlock(document: LatexResumeDocument): string {
  const picture = document.picture;
  if (!picture?.renderPath || picture.hidden) return "";

  const width = Math.max(48, Math.min(picture.size, 144));
  const height = Math.max(48, Math.round(width / Math.max(picture.aspectRatio, 0.5)));
  const angle = picture.rotation ? `,angle=${Math.round(picture.rotation)}` : "";

  return [
    `    \\includegraphics[width=${width}pt,height=${height}pt,keepaspectratio${angle}]{\\detokenize{${picture.renderPath}}} \\\\`,
    "    \\vspace{4pt}",
  ].join("\n");
}

function renderLocationBlock(document: LatexResumeDocument): string {
  if (!document.location) return "";
  return `\\begin{center}\\small ${escapeForCommand(document.location)}\\end{center}\n`;
}

export function buildLatexDocument(
  document: LatexResumeDocument,
  template: string,
  paperSize: PdfPaperSize = "auto",
): string {
  const titles = resolveSectionTitles(document);
  const headlineBlock = document.headline
    ? `    \\small ${escapeForCommand(document.headline)} \\\\ \\vspace{1pt}\n`
    : "";
  const hasHeaderItems = document.contactItems.length > 0 || document.profileItems.length > 0;
  const contactBlock = hasHeaderItems
    ? `    \\vspace{5pt} \\small ${renderHeaderItems(document.contactItems, document.profileItems)}\n`
    : "";
  const body = [
    renderSummarySection(document),
    renderCustomFieldsSection(document),
    ...renderOrderedSections(document, titles, {
      entry: renderEntrySection,
      profiles: () => "",
      skills: () => renderSkillsSection(document),
      languages: () => renderLanguagesSection(document),
      interests: () => renderInterestsSection(document),
    }),
  ]
    .filter(Boolean)
    .join("\n");

  return template
    .replace("__PAPER_SIZE__", LATEX_PAPER_OPTIONS[paperSize])
    .replace("__PICTURE_BLOCK__", renderPictureBlock(document))
    .replace("__NAME__", escapeForCommand(document.name))
    .replace("__HEADLINE_BLOCK__", headlineBlock)
    .replace("__CONTACT_BLOCK__", contactBlock)
    .replace("__LOCATION_BLOCK__", renderLocationBlock(document))
    .replace("__BODY__", body);
}

async function runTectonic(args: { cwd: string; texPath: string; jobId: string }): Promise<void> {
  const binary = process.env.TECTONIC_BIN?.trim() || "tectonic";

  await runResumeCompiler({
    binary,
    argv: ["--outdir", args.cwd, args.texPath],
    cwd: args.cwd,
    timeoutMs: TECTONIC_TIMEOUT_MS,
    jobId: args.jobId,
    label: "Tectonic",
    missingBinaryMessage:
      "Tectonic binary not found. Install tectonic or set TECTONIC_BIN to the executable path.",
    warningMessage: "LaTeX resume compile failed",
    ellipsis: "…",
  });
}

const latexResumeRenderer: ResumeRenderer = {
  async render({ document, outputPath, jobId, resolvedPicture, paperSize = "auto" }) {
    await withRenderTempDir(
      { renderer: "LaTeX", jobId, prefix: `job-ops-resume-render-${jobId}-` },
      async (tempDir) => {
        const texPath = join(tempDir, "resume.tex");
        const compiledPdfPath = join(tempDir, OUTPUT_FILENAME);

        try {
          const template = await readLatexTemplate();
          const renderableDocument = await materializeResumePicture(
            document,
            tempDir,
            resolvedPicture,
          );
          const latex = buildLatexDocument(renderableDocument, template, paperSize);

          await writeFile(texPath, latex, "utf8");
          await runTectonic({ cwd: tempDir, texPath, jobId });
          await copyFile(compiledPdfPath, outputPath);

          logger.info("Rendered LaTeX resume PDF", {
            jobId,
            outputPath,
          });
        } catch (error) {
          logger.error("Failed to render LaTeX resume PDF", {
            jobId,
            outputPath,
            error,
            document: summarizeResumeDocumentForLog(document),
          });
          throw error;
        }
      },
    );
  },
};

export async function renderLatexPdf(args: Parameters<ResumeRenderer["render"]>[0]): Promise<void> {
  await latexResumeRenderer.render(args);
}

export function getLatexTemplatePath(): string {
  return TEMPLATE_PATH;
}

export async function readLatexTemplate(): Promise<string> {
  return await readFile(TEMPLATE_PATH, "utf8");
}
