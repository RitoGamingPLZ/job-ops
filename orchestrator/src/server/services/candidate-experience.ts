import { listExperienceBullets } from "@server/repositories/experience-bullets";
import { htmlToPlainText } from "@shared/resume-bullets";
import type { ExperienceBullet } from "@shared/types";
import { candidateLibraryNeedsFirstBuild } from "./candidate-library";

const compact = (value: string | null) =>
  (value ?? "").replace(/\s+/g, " ").trim();

// Free-text periods commonly use ISO dates or English month names.
function dateOrder(value: string | null): number {
  if (!value) return 0;
  if (/\b(present|current)\b/i.test(value)) return Number.MAX_SAFE_INTEGER;
  const year = value.match(/\b\d{4}\b/);
  if (!year) return 0;
  const numericMonth = value
    .slice((year.index ?? 0) + 4)
    .match(/^[-/.](0?[1-9]|1[0-2])(?:\b|[-/.])/);
  const monthName = value.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i,
  );
  const months = [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
  ];
  const month = numericMonth
    ? Number(numericMonth[1])
    : monthName
      ? months.indexOf(monthName[1].slice(0, 3).toLowerCase()) + 1
      : 0;
  return Number(year[0]) * 100 + month;
}

const dataText = (item: ExperienceBullet, key: string) =>
  compact(
    typeof item.data?.[key] === "string"
      ? htmlToPlainText(item.data[key])
      : null,
  );

/** Read through the private-scope repository on every call; never cache user data.
 * Only a never-initialised, empty library permits callers to use legacy facts.
 */
export async function buildCandidateExperienceContext(
  maxChars = 12000,
): Promise<string | null> {
  return renderCandidateExperienceContext(
    await listExperienceBullets(true),
    maxChars,
  );
}

/** Tailoring already supplies skills and AI-filtered projects in separate fields. */
export async function buildCandidateTailoringContext() {
  const library = await listExperienceBullets(true);
  const experience = renderCandidateExperienceContext(library, 12000, false);
  return {
    experience,
    skills:
      experience === null
        ? null
        : {
            items: library
              .filter((item) => item.kind === "skill")
              .map((item) => ({
                name: item.text,
                keywords: Array.isArray(item.data?.keywords)
                  ? item.data.keywords.filter(
                      (value): value is string => typeof value === "string",
                    )
                  : [],
              })),
          },
  };
}

function renderCandidateExperienceContext(
  library: ExperienceBullet[],
  maxChars: number,
  includeSkillsAndProjects = true,
): string | null {
  if (!library.length) return candidateLibraryNeedsFirstBuild() ? null : "";
  const budget = Math.max(0, Math.floor(maxChars));
  const duties = library.filter((item) => item.kind === "bullet");
  const roles = library.filter((item) => item.kind === "role");
  const roleIds = new Set(roles.map((role) => role.id));
  // Parent identity is authoritative, even when two roles have identical labels.
  const groups = roles.map((role) => ({
    company:
      dataText(role, "company") ||
      compact(role.company) ||
      "Unspecified company",
    role: compact(role.text) || "Unspecified role",
    period:
      dataText(role, "period") ||
      [role.startDate, role.endDate].map(compact).filter(Boolean).join(" – "),
    items: duties.filter((duty) => duty.parentId === role.id),
    createdAt: role.createdAt,
  }));
  const legacy = new Map<string, (typeof groups)[number]>();
  for (const duty of duties) {
    if (duty.parentId && roleIds.has(duty.parentId)) continue;
    // Preserve legacy unparented duties; missing parents remain distinct by id.
    const key =
      duty.parentId ||
      duty.sourceExperienceId ||
      JSON.stringify([duty.company, duty.role, duty.startDate, duty.endDate]);
    const group: (typeof groups)[number] = legacy.get(key) ?? {
      company: compact(duty.company) || "Unspecified company",
      role: compact(duty.role) || "Unspecified role",
      period: [duty.startDate, duty.endDate]
        .map(compact)
        .filter(Boolean)
        .join(" – "),
      items: [],
      createdAt: duty.createdAt,
    };
    group.items.push(duty);
    if (duty.createdAt > group.createdAt) group.createdAt = duty.createdAt;
    legacy.set(key, group);
  }
  groups.push(...legacy.values());
  const newest = (period: string) => {
    if (/\b(present|current)\b/i.test(period)) return Number.MAX_SAFE_INTEGER;
    // Periods contain both start and end; order by the most recent endpoint.
    return Math.max(
      0,
      ...period
        .split(/[–—]|\s+-\s+|(?<=\b\d{4})-(?=\d{4}\b)|\s+to\s+/i)
        .map(dateOrder),
    );
  };
  groups.sort(
    (a, b) =>
      newest(b.period) - newest(a.period) ||
      b.createdAt.localeCompare(a.createdAt),
  );
  const sections: string[] = [];
  for (const [kind, heading, fields] of [
    ["skill", "Skills", ["keywords"]],
    ["project", "Projects", ["period"]],
    [
      "education",
      "Education",
      ["school", "location", "period", "area", "grade", "description"],
    ],
    ["certification", "Certifications", ["issuer", "date", "description"]],
    ["award", "Awards", ["date", "awarder", "description"]],
  ] as const) {
    if (!includeSkillsAndProjects && (kind === "skill" || kind === "project"))
      continue;
    const lines = library
      .filter((item) => item.kind === kind)
      .map((item) => {
        const details = fields
          .flatMap((key) => {
            if (key === "keywords") {
              const values = item.data?.keywords;
              return Array.isArray(values)
                ? values
                    .filter(
                      (value): value is string => typeof value === "string",
                    )
                    .map(compact)
                : [];
            }
            return [dataText(item, key)];
          })
          .filter(Boolean)
          .join(", ");
        const points =
          kind === "project"
            ? library
                .filter(
                  (point) =>
                    point.kind === "project_point" &&
                    point.parentId === item.id,
                )
                .map((point) => `  - ${compact(point.text)}`)
                .join("\n")
            : "";
        return `- ${compact(item.text)}${details ? `: ${details}` : ""}${points ? `\n${points}` : ""}`;
      });
    if (lines.length) sections.push(`${heading}:\n${lines.join("\n")}`);
  }
  const sectionBudget = Math.floor(budget / 3);
  const joinSections = () => sections.join("\n\n");
  while (joinSections().length > sectionBudget && sections.length > 1)
    sections.pop();
  if (joinSections().length > sectionBudget)
    sections[0] = clip(sections[0], sectionBudget);
  const facts = joinSections();
  const render = () => {
    const counts = new Map<string, { name: string; count: number }>();
    const experience = groups
      .map((group) => {
        const lines = group.items.map((item) => {
          const tags = [...new Set(item.tags.map(compact).filter(Boolean))];
          for (const key of new Set(tags.map((tag) => tag.toLowerCase()))) {
            const entry = counts.get(key) ?? {
              name: tags.find((tag) => tag.toLowerCase() === key) ?? key,
              count: 0,
            };
            entry.count++;
            counts.set(key, entry);
          }
          return `- ${compact(item.text)}${tags.length ? ` [${tags.join(", ")}]` : ""}`;
        });
        return `${group.company}\n${group.role} (${group.period || "dates unspecified"})${lines.length ? `\n${lines.join("\n")}` : ""}`;
      })
      .join("\n\n");
    const tags = [...counts.values()]
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .map(({ name, count }) => `${name} (${count})`)
      .join(", ");
    const suffixBudget = Math.max(
      0,
      sectionBudget - facts.length - (facts ? 2 : 0),
    );
    const tagSummary = clip(tags ? `Duty tags: ${tags}` : "", suffixBudget);
    return {
      experience,
      suffix: [facts, tagSummary].filter(Boolean).join("\n\n"),
    };
  };
  let rendered = render();
  const totalLength = () =>
    rendered.experience.length +
    rendered.suffix.length +
    (rendered.experience && rendered.suffix ? 2 : 0);
  while (totalLength() > budget && groups.length > 1) {
    groups.pop();
    rendered = render();
  }
  const experienceBudget = Math.max(
    0,
    budget -
      rendered.suffix.length -
      (rendered.experience && rendered.suffix ? 2 : 0),
  );
  return [clip(rendered.experience, experienceBudget), rendered.suffix]
    .filter(Boolean)
    .join("\n\n");
}

function clip(value: string, budget: number): string {
  if (value.length <= budget) return value;
  return budget > 0 ? `${value.slice(0, budget - 1)}…` : "";
}
