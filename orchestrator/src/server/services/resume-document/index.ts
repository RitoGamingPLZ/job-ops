/**
 * Pure helpers for the resume document model (the v5 document shape JobOps stores
 * and renders itself). Nothing here talks to an external resume service.
 */
import { getSetting } from "@server/repositories/settings";
import { resolveResumeProjectsSettings } from "@server/services/resumeProjects";
import { resolveResumeProjectSelection } from "@shared/resume-projects";
import type { ResumeProjectCatalogItem } from "@shared/types";
import { getResumeSchemaValidationMessage, safeParseV5ResumeData } from "./schema";
import {
  applyProjectVisibility,
  applyTailoredChunks,
  cloneResumeData,
  extractProjectsFromResume as extractProjectsFromResumeV5,
  type TailoredSkillsInput,
} from "./tailoring";

export type PreparedResumePdfPayload = {
  mode: "v5";
  data: Record<string, unknown>;
  projectCatalog: ResumeProjectCatalogItem[];
  selectedProjectIds: string[];
};

export async function validateResumeSchema(
  resumeData: unknown,
): Promise<
  | { ok: true; mode: "v5"; data: Record<string, unknown> }
  | { ok: false; mode: "v5"; message: string }
> {
  const result = safeParseV5ResumeData(resumeData);
  if (!result.success) {
    return {
      ok: false,
      mode: "v5",
      message: getResumeSchemaValidationMessage(result.error),
    };
  }

  if (!result.data || typeof result.data !== "object" || Array.isArray(result.data)) {
    return {
      ok: false,
      mode: "v5",
      message: "Resume schema validation failed: root payload must be an object.",
    };
  }

  return {
    ok: true,
    mode: "v5",
    data: result.data as Record<string, unknown>,
  };
}

export function extractProjectsFromResume(resumeData: unknown): {
  mode: "v5";
  catalog: ResumeProjectCatalogItem[];
} {
  const parsed = safeParseV5ResumeData(resumeData);
  if (!parsed.success) {
    throw new Error(getResumeSchemaValidationMessage(parsed.error));
  }
  const { catalog } = extractProjectsFromResumeV5(parsed.data as Record<string, unknown>);
  return { mode: "v5", catalog };
}

export async function prepareTailoredResumeForPdf(args: {
  resumeData: unknown;
  tailoredContent: {
    summary?: string | null;
    headline?: string | null;
    skills?: TailoredSkillsInput;
  };
  jobDescription: string;
  selectedProjectIds?: string | null;
  forceVisibleProjectsSection?: boolean;
  jobId?: string;
}): Promise<PreparedResumePdfPayload> {
  const parsed = safeParseV5ResumeData(args.resumeData);
  if (!parsed.success) {
    throw new Error(getResumeSchemaValidationMessage(parsed.error));
  }

  const workingCopy = cloneResumeData(parsed.data as Record<string, unknown>);
  applyTailoredChunks({
    resumeData: workingCopy,
    tailoredContent: args.tailoredContent,
  });

  const { catalog } = extractProjectsFromResumeV5(workingCopy);
  const { resumeProjects } = resolveResumeProjectsSettings({
    catalog,
    overrideRaw: await getSetting("resumeProjects"),
  });
  const selectedIds = resolveResumeProjectSelection({
    catalog,
    resumeProjects,
    selectedProjectIds: args.selectedProjectIds,
  }).effectiveSelectedIds;

  applyProjectVisibility({
    resumeData: workingCopy,
    selectedProjectIds: new Set(selectedIds),
    forceVisibleProjectsSection: args.forceVisibleProjectsSection,
  });

  return {
    mode: "v5",
    data: workingCopy,
    projectCatalog: catalog,
    selectedProjectIds: selectedIds,
  };
}
