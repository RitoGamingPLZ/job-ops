import { listExperienceBullets } from "@server/repositories/experience-bullets";
import type { ExperienceBullet } from "@shared/types";

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

/** Read through the private-scope repository on every call; never cache user data. */
export async function buildCandidateExperienceContext(
  maxChars = 12000,
): Promise<string | null> {
  const bullets = await listExperienceBullets();
  if (!bullets.length) return null;
  const companies = new Map<string, Map<string, ExperienceBullet[]>>();
  for (const bullet of bullets) {
    const company = compact(bullet.company) || "Unspecified company";
    const role = `${compact(bullet.role) || "Unspecified role"} (${[bullet.startDate, bullet.endDate].map(compact).filter(Boolean).join(" – ") || "dates unspecified"})`;
    let roles = companies.get(company);
    if (!roles) {
      roles = new Map();
      companies.set(company, roles);
    }
    const group = roles.get(role) ?? [];
    group.push(bullet);
    roles.set(role, group);
  }
  const groups = [...companies]
    .flatMap(([company, roles]) =>
      [...roles].map(([role, items]) => ({
        company,
        role,
        items,
        newest: Math.max(
          ...items.map(
            (item) => dateOrder(item.endDate) || dateOrder(item.startDate),
          ),
        ),
        createdAt: items.reduce(
          (latest, item) => (item.createdAt > latest ? item.createdAt : latest),
          "",
        ),
      })),
    )
    .sort(
      (a, b) => b.newest - a.newest || b.createdAt.localeCompare(a.createdAt),
    );
  const render = () => {
    const counts = new Map<string, { name: string; count: number }>();
    const sections = new Map<string, string[]>();
    for (const group of groups) {
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
      const roles = sections.get(group.company) ?? [];
      roles.push(`${group.role}\n${lines.join("\n")}`);
      sections.set(group.company, roles);
    }
    const skills = [...counts.values()]
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .map(({ name, count }) => `${name} (${count})`)
      .join(", ");
    return `${[...sections].map(([company, roles]) => `${company}\n${roles.join("\n")}`).join("\n\n")}\n\nSkills: ${skills}`;
  };
  let context = render();
  while (context.length > maxChars && groups.length > 1) {
    groups.pop();
    context = render();
  }
  // A single oversized group still needs a hard bound, including its skill summary.
  if (context.length > maxChars) {
    const skillsStart = context.lastIndexOf("\n\nSkills:");
    const skills = context
      .slice(skillsStart)
      .slice(0, Math.min(2000, Math.max(0, maxChars - 1)));
    context = `${context.slice(0, maxChars - skills.length - 1)}…${skills}`;
  }
  return context;
}
