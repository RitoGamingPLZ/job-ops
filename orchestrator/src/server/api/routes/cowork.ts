import { badRequest, notFound } from "@infra/errors";
import { asyncRoute, ok } from "@infra/http";
import { logger } from "@infra/logger";
import { resolveRequestOrigin } from "@infra/request-origin";
import * as bulletsRepo from "@server/repositories/experience-bullets";
import * as resumesRepo from "@server/repositories/job-resumes";
import { getJobById } from "@server/repositories/jobs";
import {
  coworkChatContextSchema,
  extractExperienceBullets,
  labelExperienceBullets,
  rankExperienceBullets,
} from "@server/services/cowork-ai";
import { screenResume } from "@server/services/cowork-screening";
import { ensureJobResume } from "@server/services/job-resume";
import { loadBaseResumeSource, resolvePdfRenderer } from "@server/services/pdf";
import { safeParseV5ResumeData } from "@server/services/rxresume/schema/v5";
import { bulletsFromHtml } from "@shared/resume-bullets";
import type {
  ExperienceBulletInput,
  ReactiveResumeV5Document,
} from "@shared/types";
import { Router } from "express";
import { z } from "zod";

export const coworkRouter = Router();
export const experienceBulletInputSchema = z
  .object({
    text: z.string().trim().min(1).max(10000),
    company: z.string().trim().max(500).nullable().optional(),
    role: z.string().trim().max(500).nullable().optional(),
    startDate: z.string().trim().max(200).nullable().optional(),
    endDate: z.string().trim().max(200).nullable().optional(),
    tags: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
    source: z.enum(["resume", "manual", "ai_extract"]).optional(),
    sourceExperienceId: z.string().max(200).nullable().optional(),
  })
  .strict();
function parse<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  input: unknown,
): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    throw badRequest("Invalid co-work payload", parsed.error.flatten());
  return parsed.data;
}
async function requireJob(id: string) {
  const job = await getJobById(id);
  if (!job) throw notFound("Job not found");
  return job;
}
async function baseDocument(requestOrigin: string | null) {
  const { data } = await loadBaseResumeSource({
    renderer: await resolvePdfRenderer(),
    requestOrigin,
  });
  return data as ReactiveResumeV5Document;
}
function splitPeriod(period: string): [string | null, string | null] {
  const parts = period.trim().split(/\s+[–—−-]\s+|\s*[–—−]\s*/);
  return [
    parts[0]?.trim() || null,
    parts.length > 1 ? parts.slice(1).join(" – ").trim() || null : null,
  ];
}
coworkRouter.get(
  "/experience-bullets",
  asyncRoute(async (_req, res) => {
    ok(res, { bullets: await bulletsRepo.listExperienceBullets() });
  }),
);
coworkRouter.post(
  "/experience-bullets",
  asyncRoute(async (req, res) => {
    ok(
      res,
      {
        bullet: await bulletsRepo.createExperienceBullet(
          parse(experienceBulletInputSchema, req.body),
        ),
      },
      201,
    );
  }),
);
coworkRouter.post(
  "/experience-bullets/import-resume",
  asyncRoute(async (req, res) => {
    const document = await baseDocument(resolveRequestOrigin(req));
    const inputs: ExperienceBulletInput[] =
      document.sections.experience.items.flatMap((item) => {
        const [startDate, endDate] = splitPeriod(item.period);
        return bulletsFromHtml(item.description).map((text) => ({
          text,
          company: item.company || null,
          role: item.position || null,
          startDate,
          endDate,
          source: "resume",
          sourceExperienceId: item.id,
        }));
      });
    const imported = await bulletsRepo.importExperienceBullets(inputs);
    let labeled = 0;
    try {
      labeled = (
        await labelExperienceBullets(
          imported.bullets.map((bullet) => bullet.id),
        )
      ).labeled;
    } catch {
      logger.warn("Resume import auto-label failed", {
        requestId: res.getHeader("x-request-id"),
        created: imported.created,
      });
    }
    const ids = new Set(imported.bullets.map((bullet) => bullet.id));
    const bullets = (await bulletsRepo.listExperienceBullets()).filter(
      (bullet) => ids.has(bullet.id),
    );
    labeled = Math.max(
      labeled,
      bullets.filter((bullet) => bullet.tags.length > 0).length,
    );
    ok(res, { ...imported, bullets, labeled });
  }),
);
coworkRouter.post(
  "/experience-bullets/label",
  asyncRoute(async (req, res) => {
    const { ids } = parse(
      z
        .object({
          ids: z.array(z.string().trim().min(1).max(200)).max(200).optional(),
        })
        .strict(),
      req.body ?? {},
    );
    ok(res, await labelExperienceBullets(ids));
  }),
);
coworkRouter.post(
  "/experience-bullets/extract",
  asyncRoute(async (req, res) => {
    const { text } = parse(
      z.object({ text: z.string().trim().min(1).max(50000) }).strict(),
      req.body,
    );
    ok(res, { drafts: await extractExperienceBullets(text) });
  }),
);
coworkRouter.post(
  "/experience-bullets/rank",
  asyncRoute(async (req, res) => {
    const { jobId } = parse(
      z.object({ jobId: z.string().trim().min(1).max(200) }).strict(),
      req.body,
    );
    const job = await requireJob(jobId);
    ok(res, { ranked: await rankExperienceBullets(job.jobDescription ?? "") });
  }),
);
coworkRouter.patch(
  "/experience-bullets/:id",
  asyncRoute(async (req, res) => {
    const input = parse(
      experienceBulletInputSchema
        .partial()
        .refine((value) => Object.keys(value).length > 0),
      req.body,
    );
    const bullet = await bulletsRepo.updateExperienceBullet(
      String(req.params.id),
      input,
    );
    if (!bullet) throw notFound("Bullet not found");
    ok(res, { bullet });
  }),
);
coworkRouter.delete(
  "/experience-bullets/:id",
  asyncRoute(async (req, res) => {
    if (!(await bulletsRepo.deleteExperienceBullet(String(req.params.id))))
      throw notFound("Bullet not found");
    ok(res, { deleted: true });
  }),
);
coworkRouter.get(
  "/jobs/:id/resume",
  asyncRoute(async (req, res) => {
    const job = await requireJob(String(req.params.id));
    ok(res, await ensureJobResume(job.id));
  }),
);
coworkRouter.put(
  "/jobs/:id/resume",
  asyncRoute(async (req, res) => {
    const job = await requireJob(String(req.params.id));
    const input = parse(
      z
        .object({
          baseRevision: z
            .number()
            .int()
            .min(0)
            .max(Number.MAX_SAFE_INTEGER - 1),
          document: z.unknown(),
        })
        .strict(),
      req.body,
    );
    const document = safeParseV5ResumeData(input.document);
    if (!document.success)
      throw badRequest("Invalid resume document", document.error.flatten());
    ok(
      res,
      await resumesRepo.saveJobResume(
        job.id,
        input.baseRevision,
        document.data as ReactiveResumeV5Document,
      ),
    );
  }),
);
coworkRouter.delete(
  "/jobs/:id/resume",
  asyncRoute(async (req, res) => {
    const job = await requireJob(String(req.params.id));
    await resumesRepo.deleteJobResume(job.id);
    ok(res, { deleted: true });
  }),
);
coworkRouter.post(
  "/jobs/:id/resume/screening",
  asyncRoute(async (req, res) => {
    const job = await requireJob(String(req.params.id));
    const { document } = parse(
      z.object({ document: coworkChatContextSchema.shape.document }).strict(),
      req.body,
    );
    ok(res, await screenResume(job, document));
  }),
);
coworkRouter.get(
  "/resumes",
  asyncRoute(async (_req, res) => {
    ok(res, { resumes: await resumesRepo.listResumes() });
  }),
);
