import { z } from "zod";
import { htmlToPlainText } from "./resume-bullets";
import type { CandidateItemKind } from "./types/cowork";

const scalar = z.string().max(500).default("");
const date = z.string().max(200).default("");
const websiteSchema = z
  .object({
    url: z.string().max(2000).default(""),
    label: scalar,
    inlineLink: z.boolean().optional(),
  })
  .strict();
const website = z.preprocess(
  (value) => (typeof value === "string" ? { url: value, label: "" } : (value ?? {})),
  websiteSchema,
);
const common = {
  schemaVersion: z.literal(2).default(2),
  description: z.string().max(10000).default(""),
  website,
};
export const educationDataSchema = z
  .object({
    ...common,
    school: scalar,
    location: scalar,
    period: date,
    area: scalar,
    grade: scalar,
  })
  .passthrough();
export const awardDataSchema = z.object({ ...common, date, awarder: scalar }).passthrough();
export const certificationDataSchema = z.object({ ...common, issuer: scalar, date }).passthrough();
export type LibraryWebsite = z.infer<typeof websiteSchema>;
export type EducationLibraryData = z.infer<typeof educationDataSchema>;
export type AwardLibraryData = z.infer<typeof awardDataSchema>;
export type CertificationLibraryData = z.infer<typeof certificationDataSchema>;
export function parseLibraryData(kind: "education", data: unknown): EducationLibraryData;
export function parseLibraryData(kind: "award", data: unknown): AwardLibraryData;
export function parseLibraryData(kind: "certification", data: unknown): CertificationLibraryData;
export function parseLibraryData(kind: CandidateItemKind, data: unknown): Record<string, unknown>;
export function parseLibraryData(kind: CandidateItemKind, data: unknown): Record<string, unknown> {
  const schema =
    kind === "education"
      ? educationDataSchema
      : kind === "award"
        ? awardDataSchema
        : kind === "certification"
          ? certificationDataSchema
          : z.record(z.unknown());
  return schema.parse(data ?? {});
}
/** The pre-v2 representation, reconstructed only from current facts. */
export function foldedLibraryText(
  kind: CandidateItemKind,
  text: string,
  data: Record<string, unknown> | null,
): string {
  const parts =
    kind === "education"
      ? [text, data?.area, data?.grade, data?.description]
      : kind === "award"
        ? [text, data?.awarder, data?.description]
        : kind === "certification"
          ? [text, data?.description]
          : [text];
  return parts
    .map((value) =>
      htmlToPlainText(typeof value === "string" ? value : "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .join(" · ");
}
