export const EXTRACTOR_SOURCE_IDS = [
  "indeed",
  "linkedin",
  "adzuna",
  "hiringcafe",
  "jobindex",
  "freehire",
  "manual",
] as const;

export type ExtractorSourceId = (typeof EXTRACTOR_SOURCE_IDS)[number];

export interface ExtractorSourceMetadata {
  label: string;
  order: number;
  category: "pipeline" | "manual";
  requiresCredentials?: boolean;
}

export const EXTRACTOR_SOURCE_METADATA: Record<ExtractorSourceId, ExtractorSourceMetadata> = {
  indeed: { label: "Indeed", order: 20, category: "pipeline" },
  linkedin: { label: "LinkedIn", order: 30, category: "pipeline" },
  adzuna: {
    label: "Adzuna",
    order: 60,
    category: "pipeline",
    requiresCredentials: true,
  },
  hiringcafe: { label: "Hiring Cafe", order: 70, category: "pipeline" },
  jobindex: {
    label: "Jobindex",
    order: 103,
    category: "pipeline",
  },
  freehire: { label: "FreeHire", order: 115, category: "pipeline" },
  manual: { label: "Manual", order: 120, category: "manual" },
};

export const PIPELINE_EXTRACTOR_SOURCE_IDS = EXTRACTOR_SOURCE_IDS.filter(
  (source) => EXTRACTOR_SOURCE_METADATA[source].category === "pipeline",
);

export function isExtractorSourceId(value: string): value is ExtractorSourceId {
  return EXTRACTOR_SOURCE_IDS.includes(value as ExtractorSourceId);
}

export function sourceLabel(source: ExtractorSourceId | (string & {})): string {
  return EXTRACTOR_SOURCE_METADATA[source as ExtractorSourceId]?.label ?? source;
}
