import { saveTarget } from "@shared/resume-suggestion-schema";
import { badRequest, notFound } from "@infra/errors";
import { asyncRoute, ok } from "@infra/http";
import { logger } from "@infra/logger";
import { resolveRequestOrigin } from "@infra/request-origin";
import { requireResumes } from "../require-admin";
import * as bulletsRepo from "@server/repositories/experience-bullets";
import * as resumesRepo from "@server/repositories/job-resumes";
import { getJobById } from "@server/repositories/jobs";
import * as libraryService from "@server/services/candidate-library";
import {
  coworkChatContextSchema,
  extractExperienceBullets,
  rankExperienceBullets,
} from "@server/services/cowork-ai";
import { screenResume } from "@server/services/cowork-screening";
import { ensureJobResume } from "@server/services/job-resume";
import { loadBaseResumeSource } from "@server/services/pdf";
import { safeParseV5ResumeData } from "@server/services/resume-document/schema/v5";
import { getPrivateDataScope } from "@server/tenancy/private-scope";
import type { ResumeV5Document } from "@shared/types";
import { CANDIDATE_ITEM_KINDS } from "@shared/types";
import { Router } from "express";
import { z } from "zod";

export const coworkRouter = Router();
coworkRouter.use("/resumes", requireResumes);
coworkRouter.use("/library", requireResumes);
coworkRouter.use("/experience-bullets", requireResumes);
coworkRouter.use("/jobs/:id/resume", requireResumes);
const experienceBulletInputSchema = z
  .object({
    kind: z
      .enum(
        CANDIDATE_ITEM_KINDS as [
          (typeof CANDIDATE_ITEM_KINDS)[number],
          ...(typeof CANDIDATE_ITEM_KINDS)[number][],
        ],
      )
      .optional(),
    data: z.record(z.unknown()).nullable().optional(),
    parentId: z.string().trim().min(1).max(200).nullable().optional(),
    position: z.number().int().min(0).optional(),
    text: z.string().trim().min(1).max(10000),
    company: z.string().trim().max(500).nullable().optional(),
    role: z.string().trim().max(500).nullable().optional(),
    startDate: z.string().trim().max(200).nullable().optional(),
    endDate: z.string().trim().max(200).nullable().optional(),
    tags: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
    source: z.enum(["resume", "manual", "ai_extract", "job_resume"]).optional(),
    sourceExperienceId: z.string().max(200).nullable().optional(),
  })
  .strict();
function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw badRequest("Invalid co-work payload", parsed.error.flatten());
  return parsed.data;
}
async function requireJob(id: string) {
  const job = await getJobById(id);
  if (!job) throw notFound("Job not found");
  return job;
}
async function baseDocument() {
  const { data } = await loadBaseResumeSource();
  return data as ResumeV5Document;
}
// Retry until the base resume is imported once per private scope. Unavailable
// sources must not prevent opening the library or spam warnings on every retry.
const baseResumeFailureLoggedScopes = new Set<string>();
async function syncLibrary() {
  let base: ResumeV5Document | undefined;
  if (libraryService.candidateLibraryNeedsFirstBuild()) {
    try {
      base = await baseDocument();
    } catch (error) {
      const { scopeKey } = getPrivateDataScope();
      if (!baseResumeFailureLoggedScopes.has(scopeKey)) {
        baseResumeFailureLoggedScopes.add(scopeKey);
        logger.warn("Candidate library base resume unavailable", {
          route: "/library",
          error,
        });
      }
    }
  }
  return libraryService.syncCandidateLibrary(base);
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
        bullet: libraryService.createLibraryItem(parse(experienceBulletInputSchema, req.body)),
      },
      201,
    );
  }),
);
coworkRouter.get(
  "/library",
  asyncRoute(async (req, res) => {
    let items = await bulletsRepo.listExperienceBullets(true);
    if (libraryService.candidateLibraryNeedsFirstBuild()) {
      await syncLibrary();
      items = await bulletsRepo.listExperienceBullets(true);
    }
    ok(res, { items });
  }),
);
coworkRouter.get(
  "/library/:id/usage",
  asyncRoute(async (req, res) => {
    ok(res, libraryService.libraryItemUsage(String(req.params.id)));
  }),
);
coworkRouter.post(
  "/library/sync",
  asyncRoute(async (req, res) => {
    ok(res, await syncLibrary());
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
      experienceBulletInputSchema.partial().refine((value) => Object.keys(value).length > 0),
      req.body,
    );
    const bullet = libraryService.updateLibraryItem(
      String(req.params.id),
      input,
      parse(z.string().trim().min(1).max(200).optional(), req.query.skipJobId),
    );
    if (!bullet) throw notFound("Bullet not found");
    ok(res, { bullet });
  }),
);
coworkRouter.delete(
  "/experience-bullets/:id",
  asyncRoute(async (req, res) => {
    libraryService.deleteLibraryItem(
      String(req.params.id),
      parse(z.string().trim().min(1).max(200).optional(), req.query.skipJobId),
    );
    ok(res, { deleted: true });
  }),
);
coworkRouter.get(
  "/jobs/:id/resume",
  asyncRoute(async (req, res) => {
    const job = await requireJob(String(req.params.id));
    ok(
      res,
      await ensureJobResume(job.id, {
        requestOrigin: resolveRequestOrigin(req),
      }),
    );
  }),
);
coworkRouter.post(
  "/jobs/:id/resume/library-edit",
  asyncRoute(async (req, res) => {
    const input = parse(
      z
        .object({
          operationId: z.string().uuid(),
          baseRevision: z.number().int().nonnegative().safe(),
          document: z.unknown(),
          action: z.discriminatedUnion("kind", [
            z
              .object({
                kind: z.literal("update"),
                target: saveTarget,
                expectedUpdatedAt: z.string().min(1).max(80),
                patch: experienceBulletInputSchema
                  .pick({ text: true, data: true })
                  .partial()
                  .refine((p) => Object.keys(p).length > 0),
              })
              .strict(),
            z
              .object({
                kind: z.literal("create"),
                item: experienceBulletInputSchema,
                includeOnResume: z.boolean(),
              })
              .strict(),
          ]),
        })
        .strict(),
      req.body,
    );
    const document = safeParseV5ResumeData(input.document);
    if (!document.success) throw badRequest("Invalid resume document");
    ok(
      res,
      libraryService.commitLibraryEdit(String(req.params.id), {
        ...input,
        document: document.data as ResumeV5Document,
      }),
    );
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
    if (!document.success) throw badRequest("Invalid resume document", document.error.flatten());
    ok(
      res,
      await resumesRepo.saveJobResume(
        job.id,
        input.baseRevision,
        document.data as ResumeV5Document,
        { supersedeUploadedPdf: true },
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
