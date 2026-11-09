import { listExperienceBullets } from "@server/repositories/experience-bullets";
import type { ExperienceBullet } from "@shared/types";

const MAX_CONTEXT = 12000;
const compact = (value: string | null) =>
  (value ?? "").replace(/\s+/g, " ").trim();

/** Read through the private-scope repository on every call; never cache user data. */
export async function buildCandidateExperienceContext(): Promise<
  string | null
> {
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
        newest: items.reduce((latest, item) => {
          const date = /present|current/i.test(item.endDate ?? "")
            ? "9999"
            : item.endDate || item.startDate || item.createdAt;
          return date > latest ? date : latest;
        }, ""),
      })),
    )
    .sort((a, b) => b.newest.localeCompare(a.newest));
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
  while (context.length > MAX_CONTEXT && groups.length > 1) {
    groups.pop();
    context = render();
  }
  // A single oversized group still needs a hard bound, including its skill summary.
  if (context.length > MAX_CONTEXT) {
    const skillsStart = context.lastIndexOf("\n\nSkills:");
    const skills = context.slice(skillsStart).slice(0, 2000);
    context = `${context.slice(0, MAX_CONTEXT - skills.length - 1)}…${skills}`;
  }
  return context;
}
