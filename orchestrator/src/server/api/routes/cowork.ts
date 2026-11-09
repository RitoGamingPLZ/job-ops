import { AppError, badRequest, notFound } from "@infra/errors";
import { asyncRoute, ok } from "@infra/http";
import * as bulletsRepo from "@server/repositories/experience-bullets";
import * as resumesRepo from "@server/repositories/job-resumes";
import { getJobById } from "@server/repositories/jobs";
import { loadBaseResumeSource } from "@server/services/pdf";
import { prepareTailoredResumeForPdf } from "@server/services/rxresume";
import { safeParseV5ResumeData } from "@server/services/rxresume/schema/v5";
import { bulletsFromHtml } from "@shared/resume-bullets";
import type {
  ExperienceBulletInput,
  JobResumeState,
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
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
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
async function baseDocument() {
  const { data } = await loadBaseResumeSource({ renderer: "typst" });
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
  asyncRoute(async (_req, res) => {
    const document = await baseDocument();
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
    ok(res, await bulletsRepo.importExperienceBullets(inputs));
  }),
);
for (const action of ["extract", "rank"]) {
  coworkRouter.post(
    `/experience-bullets/${action}`,
    asyncRoute(async () => {
      throw new AppError({
        status: 501,
        code: "SERVICE_UNAVAILABLE",
        message: "Co-work AI is not implemented yet",
      });
    }),
  );
}
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
    const saved = await resumesRepo.getJobResume(job.id);
    if (saved) return ok(res, saved);
    const prepared = await prepareTailoredResumeForPdf({
      resumeData: await baseDocument(),
      tailoredContent: {
        summary: job.tailoredSummary,
        headline: job.tailoredHeadline,
        skills: job.tailoredSkills,
      },
      jobDescription: job.jobDescription ?? "",
      selectedProjectIds: job.selectedProjectIds,
    });
    const state: JobResumeState = {
      document: prepared.data as ReactiveResumeV5Document,
      revision: 0,
      exists: false,
      updatedAt: null,
    };
    ok(res, state);
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
coworkRouter.get(
  "/resumes",
  asyncRoute(async (_req, res) => {
    ok(res, { resumes: await resumesRepo.listResumes() });
  }),
);
