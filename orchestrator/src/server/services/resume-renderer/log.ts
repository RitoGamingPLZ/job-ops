import { sanitizeUnknown } from "@infra/sanitize";
import type { LatexResumeDocument } from "./types";

/** Section sizes (never content) of a resume document, safe to attach to error logs. */
export function summarizeResumeDocumentForLog(document: LatexResumeDocument) {
  return sanitizeUnknown({
    name: document.name,
    headline: document.headline,
    location: document.location,
    experienceCount: document.experience.length,
    educationCount: document.education.length,
    projectCount: document.projects.length,
    skillGroupCount: document.skillGroups.length,
    languageCount: document.languages.length,
    interestCount: document.interests.length,
    awardCount: document.awards.length,
    certificationCount: document.certifications.length,
    publicationCount: document.publications.length,
    volunteerCount: document.volunteer.length,
    referenceCount: document.references.length,
  });
}
