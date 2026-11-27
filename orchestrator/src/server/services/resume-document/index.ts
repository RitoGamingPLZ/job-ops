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

type PreparedResumePdfPayload = {
  data: Record<string, unknown>;
};

export function extractProjectsFromResume(resumeData: unknown): {
  catalog: ResumeProjectCatalogItem[];
} {
  const parsed = safeParseV5ResumeData(resumeData);
  if (!parsed.success) {
    throw new Error(getResumeSchemaValidationMessage(parsed.error));
  }
  const { catalog } = extractProjectsFromResumeV5(parsed.data as Record<string, unknown>);
  return { catalog };
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
    data: workingCopy,
  };
}
