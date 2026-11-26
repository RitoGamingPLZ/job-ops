import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { badRequest } from "@infra/errors";
import { asyncRoute } from "@infra/http";
import { logger } from "@infra/logger";
import { runWithRequestContext } from "@infra/request-context";
import { renderResumePdf } from "@server/services/resume-renderer";
import { v5ResumeDataSchema } from "@server/services/resume-document/schema/v5";
import {
  CHAT_STYLE_MANUAL_LANGUAGE_VALUES,
  PDF_PAPER_SIZE_VALUES,
  TYPST_THEME_VALUES,
} from "@shared/types";
import { json, Router } from "express";
import { z } from "zod";
import { verifyInternalScrapeSecret } from "./internal-auth";

const renderRequestSchema = z.object({
  resumeJson: v5ResumeDataSchema,
  jobId: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[a-zA-Z0-9_-]+$/),
  renderer: z.enum(["typst", "latex"]),
  language: z.enum(CHAT_STYLE_MANUAL_LANGUAGE_VALUES).optional(),
  paperSize: z.enum(PDF_PAPER_SIZE_VALUES),
  typstTheme: z.enum(TYPST_THEME_VALUES).optional(),
  picture: z
    .object({
      base64: z
        .string()
        .min(4)
        .max(14_000_000)
        .regex(/^[A-Za-z0-9+/]*={0,2}$/)
        .refine((value) => value.length % 4 === 0),
      mimeType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
    })
    .optional(),
});

export const internalRenderPdfRouter = Router();
internalRenderPdfRouter.post(
  "/",
  verifyInternalScrapeSecret,
  json({ limit: "15mb" }),
  asyncRoute(async (req, res) => {
    const parsed = renderRequestSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid internal PDF render request.");
    const { picture, ...args } = parsed.data;
    await runWithRequestContext({ jobId: args.jobId }, async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "jobops-internal-pdf-"));
      let bytes: Buffer;
      try {
        const outputPath = join(tempDir, "resume.pdf");
        await renderResumePdf({
          ...args,
          outputPath,
          // Explicit null prevents a lookup in the container's unrelated database.
          resolvedPicture: picture
            ? { bytes: Buffer.from(picture.base64, "base64"), mimeType: picture.mimeType }
            : null,
        });
        bytes = await readFile(outputPath);
        logger.info("Internal PDF render completed", {
          jobId: args.jobId,
          renderer: args.renderer,
        });
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
      res.setHeader("Cache-Control", "no-store");
      res.type("application/pdf").send(bytes);
    });
  }),
);

// Reaching this route means the container is up and listening; nothing else needs to run.
internalRenderPdfRouter.post("/warm", verifyInternalScrapeSecret, (_req, res) => {
  res.status(204).end();
});
