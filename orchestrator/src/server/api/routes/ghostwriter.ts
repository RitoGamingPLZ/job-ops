import { asyncRoute, fail, ok } from "@infra/http";
import { runWithRequestContext } from "@infra/request-context";
import { badRequest } from "@server/infra/errors";
import { coworkChatContextSchema } from "@server/services/cowork-ai";
import * as ghostwriterService from "@server/services/ghostwriter";
import { type Request, Router } from "express";
import { z } from "zod";

import { respondWithGhostwriterReply } from "./ghostwriter-stream";

export const ghostwriterRouter = Router({ mergeParams: true });

const listMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).max(10000).optional(),
});

const selectedNoteIdsSchema = z.array(z.string().trim().min(1)).default([]);
const selectedEmailIdsSchema = z.array(z.string().trim().min(1)).default([]);
const selectedDocumentIdsSchema = z.array(z.string().trim().min(1)).default([]);
const selectedContextSchema = {
  selectedNoteIds: selectedNoteIdsSchema.optional(),
  selectedEmailIds: selectedEmailIdsSchema.optional(),
  selectedDocumentIds: selectedDocumentIdsSchema.optional(),
};

const updateContextSchema = z
  .object({
    ...selectedContextSchema,
  })
  .refine(
    (input) =>
      input.selectedNoteIds !== undefined ||
      input.selectedEmailIds !== undefined ||
      input.selectedDocumentIds !== undefined,
    {
      message: "At least one context selection must be provided.",
    },
  );

const imageAttachmentSchema = z
  .object({
    id: z.string().trim().max(80).optional(),
    name: z.string().trim().min(1).max(180),
    mediaType: z.enum(["image/png", "image/jpeg", "image/webp"]),
    dataUrl: z
      .string()
      .max(2_800_000)
      .regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/),
  })
  .superRefine((attachment, ctx) => {
    if (!attachment.dataUrl.startsWith(`data:${attachment.mediaType};base64,`)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dataUrl"],
        message: "Image data URL media type must match the attachment media type.",
      });
    }
  });

const imageAttachmentsSchema = z.array(imageAttachmentSchema).max(3).default([]);

const sendMessageSchema = z.object({
  content: z.string().trim().min(1).max(20000),
  ...selectedContextSchema,
  cowork: coworkChatContextSchema.optional(),
  attachments: imageAttachmentsSchema.optional(),
  stream: z.boolean().optional(),
});

const regenerateSchema = z.object({
  ...selectedContextSchema,
  cowork: coworkChatContextSchema.optional(),
  stream: z.boolean().optional(),
});

const editMessageSchema = z.object({
  content: z.string().trim().min(1).max(20000),
  ...selectedContextSchema,
  cowork: coworkChatContextSchema.optional(),
  attachments: imageAttachmentsSchema.optional(),
  stream: z.boolean().optional(),
});

/** The context a reply is generated from; identical for send, edit and regenerate requests. */
function pickReplyContext(data: z.infer<typeof regenerateSchema>) {
  return {
    selectedNoteIds: data.selectedNoteIds,
    selectedEmailIds: data.selectedEmailIds,
    selectedDocumentIds: data.selectedDocumentIds,
    cowork: data.cowork,
  };
}

function pickReplyBody(result: { userMessage: unknown; assistantMessage: unknown; runId: string }) {
  return {
    userMessage: result.userMessage,
    assistantMessage: result.assistantMessage,
    runId: result.runId,
  };
}

function getJobId(req: Request): string {
  const jobId = req.params.id;
  if (!jobId) {
    throw badRequest("Missing job id");
  }
  return jobId;
}

ghostwriterRouter.get(
  "/messages",
  asyncRoute(async (req, res) => {
    const jobId = getJobId(req);
    const parsed = listMessagesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return fail(res, badRequest(parsed.error.message, parsed.error.flatten()));
    }

    await runWithRequestContext({ jobId }, async () => {
      const result = await ghostwriterService.listMessagesForJob({
        jobId,
        limit: parsed.data.limit,
        offset: parsed.data.offset,
      });
      ok(res, {
        messages: result.messages,
        branches: result.branches,
        selectedNoteIds: result.selectedNoteIds,
        selectedEmailIds: result.selectedEmailIds,
        selectedDocumentIds: result.selectedDocumentIds,
      });
    });
  }),
);

ghostwriterRouter.patch(
  "/context",
  asyncRoute(async (req, res) => {
    const jobId = getJobId(req);
    const parsed = updateContextSchema.safeParse(req.body);
    if (!parsed.success) {
      return fail(res, badRequest(parsed.error.message, parsed.error.flatten()));
    }

    await runWithRequestContext({ jobId }, async () => {
      const result = await ghostwriterService.updateContextForJob({
        jobId,
        selectedNoteIds: parsed.data.selectedNoteIds,
        selectedEmailIds: parsed.data.selectedEmailIds,
        selectedDocumentIds: parsed.data.selectedDocumentIds,
      });
      ok(res, result);
    });
  }),
);

ghostwriterRouter.post(
  "/messages",
  asyncRoute(async (req, res) => {
    const jobId = getJobId(req);

    const parsed = sendMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      return fail(res, badRequest(parsed.error.message, parsed.error.flatten()));
    }

    await runWithRequestContext({ jobId }, () =>
      respondWithGhostwriterReply(
        res,
        { stream: parsed.data.stream, toBody: pickReplyBody },
        (stream) =>
          ghostwriterService.sendMessageForJob({
            jobId,
            content: parsed.data.content,
            attachments: parsed.data.attachments,
            ...pickReplyContext(parsed.data),
            stream,
          }),
      ),
    );
  }),
);

ghostwriterRouter.post(
  "/runs/:runId/cancel",
  asyncRoute(async (req, res) => {
    const jobId = getJobId(req);
    const runId = req.params.runId;
    if (!runId) {
      return fail(res, badRequest("Missing run id"));
    }

    await runWithRequestContext({ jobId }, async () => {
      const result = await ghostwriterService.cancelRunForJob({
        jobId,
        runId,
      });

      ok(res, result);
    });
  }),
);

ghostwriterRouter.post(
  "/messages/:assistantMessageId/regenerate",
  asyncRoute(async (req, res) => {
    const jobId = getJobId(req);
    const assistantMessageId = req.params.assistantMessageId;
    if (!assistantMessageId) {
      return fail(res, badRequest("Missing message id"));
    }

    const parsed = regenerateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return fail(res, badRequest(parsed.error.message, parsed.error.flatten()));
    }

    await runWithRequestContext({ jobId }, () =>
      respondWithGhostwriterReply(res, { stream: parsed.data.stream }, (stream) =>
        ghostwriterService.regenerateMessageForJob({
          jobId,
          assistantMessageId,
          ...pickReplyContext(parsed.data),
          stream,
        }),
      ),
    );
  }),
);

ghostwriterRouter.post(
  "/messages/:messageId/edit",
  asyncRoute(async (req, res) => {
    const jobId = getJobId(req);
    const messageId = req.params.messageId;
    if (!messageId) {
      return fail(res, badRequest("Missing message id"));
    }

    const parsed = editMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      return fail(res, badRequest(parsed.error.message, parsed.error.flatten()));
    }

    await runWithRequestContext({ jobId }, () =>
      respondWithGhostwriterReply(
        res,
        { stream: parsed.data.stream, toBody: pickReplyBody },
        (stream) =>
          ghostwriterService.editMessageForJob({
            jobId,
            messageId,
            content: parsed.data.content,
            attachments: parsed.data.attachments,
            ...pickReplyContext(parsed.data),
            stream,
          }),
      ),
    );
  }),
);

ghostwriterRouter.post(
  "/messages/:messageId/switch-branch",
  asyncRoute(async (req, res) => {
    const jobId = getJobId(req);
    const messageId = req.params.messageId;
    if (!messageId) {
      return fail(res, badRequest("Missing message id"));
    }

    await runWithRequestContext({ jobId }, async () => {
      const result = await ghostwriterService.switchBranchForJob({
        jobId,
        messageId,
      });

      ok(res, { messages: result.messages, branches: result.branches });
    });
  }),
);

ghostwriterRouter.post(
  "/reset",
  asyncRoute(async (req, res) => {
    const jobId = getJobId(req);

    await runWithRequestContext({ jobId }, async () => {
      const result = await ghostwriterService.resetConversationForJob({
        jobId,
      });

      ok(res, result);
    });
  }),
);
