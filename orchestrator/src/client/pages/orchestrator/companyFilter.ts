import type { JobListItem } from "@shared/types.js";

export const normalizeCompany = (value: string): string =>
  value.trim().replace(/\s+/g, " ").toLowerCase();

export const normalizeCompanies = (values: string[]): string[] => [
  ...new Set(values.map(normalizeCompany).filter(Boolean)),
];

export interface CompanyOption {
  value: string;
  label: string;
  count: number;
}

export const getCompaniesWithJobs = (jobs: JobListItem[]): CompanyOption[] => {
  const companies = new Map<string, CompanyOption>();
  for (const job of jobs) {
    const label = job.employer?.trim().replace(/\s+/g, " ") ?? "";
    const value = normalizeCompany(label);
    if (!value) continue;
    const existing = companies.get(value);
    if (existing) existing.count += 1;
    else companies.set(value, { value, label, count: 1 });
  }
  return [...companies.values()].sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label),
  );
};
