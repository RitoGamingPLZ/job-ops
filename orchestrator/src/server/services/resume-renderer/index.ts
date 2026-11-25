import type { PdfPaperSize, PdfRenderer, TypstTheme } from "@shared/types";
import { buildResumeRenderDocument } from "./document";
import { renderLatexPdf } from "./latex";
import type { NormalizeResumeJsonOptions, ResumePictureContent } from "./types";
import { renderTypstPdf } from "./typst";

export { buildResumeRenderDocument } from "./document";
export { getLatexTemplatePath, getTectonicBinary, readLatexTemplate } from "./latex";
export type * from "./types";
export { getTypstBinary, getTypstTemplatePath, readTypstTemplate } from "./typst";

export async function renderResumePdf(args: {
  resumeJson: Record<string, unknown>;
  resolvedPicture?: ResumePictureContent | null;
  outputPath: string;
  jobId: string;
  language?: NormalizeResumeJsonOptions["language"];
  renderer?: PdfRenderer;
  typstTheme?: TypstTheme;
  paperSize?: PdfPaperSize;
}): Promise<void> {
  const document = buildResumeRenderDocument(args.resumeJson, {
    language: args.language,
  });
  if (args.renderer === "typst") {
    await renderTypstPdf({
      document,
      resolvedPicture: args.resolvedPicture,
      outputPath: args.outputPath,
      jobId: args.jobId,
      typstTheme: args.typstTheme,
      paperSize: args.paperSize,
    });
    return;
  }

  await renderLatexPdf({
    document,
    resolvedPicture: args.resolvedPicture,
    outputPath: args.outputPath,
    jobId: args.jobId,
    paperSize: args.paperSize,
  });
}
