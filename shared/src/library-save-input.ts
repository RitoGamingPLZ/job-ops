import { changedLibraryFields, getItemLines, KIND_SECTION } from "./resume-links";
import type {
  ExperienceBullet,
  ExperienceBulletInput,
  ResumeV5Document,
  SaveTarget,
} from "./types";
/** The reviewed fields sent by an explicit Save to library action. */
export function librarySaveInput(
  document: ResumeV5Document,
  target: SaveTarget,
  library: ExperienceBullet[],
):
  | { input: Partial<ExperienceBulletInput>; before: ExperienceBullet }
  | { code: "STALE" | "INVALID_TARGET" } {
  const before = library.find((item) => item.id === target.libraryId);
  if (!before) {
    return { code: "INVALID_TARGET" };
  }
  let patch: Partial<ExperienceBulletInput>;
  if (target.kind === "line") {
    const t = target.target;
    const item = document.sections[t.section].items.find(
      (item) => item.id === t.itemId && !item.hidden,
    );
    const lines = item ? getItemLines(item) : [];
    const hinted = lines[t.bulletIndex];
    const line =
      hinted?.ref === target.libraryId
        ? hinted
        : lines.find((line) => line.ref === target.libraryId && line.text === t.previousText);
    if (
      !item ||
      document.sections[t.section].hidden ||
      !line ||
      line.ref !== before.id ||
      before.parentId !== item.libraryId ||
      before.kind !== (t.section === "experience" ? "bullet" : "project_point")
    ) {
      return { code: "INVALID_TARGET" };
    }
    if (line.text !== t.previousText) {
      return { code: "STALE" };
    }
    patch = line.text === before.text ? {} : { text: line.text };
  } else {
    const section = document.sections[target.section];
    const item = section.items.find((item) => item.id === target.itemId && !item.hidden);
    if (
      !item ||
      section.hidden ||
      item.libraryId !== before.id ||
      KIND_SECTION[before.kind] !== target.section
    ) {
      return { code: "INVALID_TARGET" };
    }
    const textField = {
      experience: "position",
      projects: "name",
      skills: "name",
      education: "degree",
      awards: "title",
      certifications: "title",
    }[target.section];
    const keys = {
      experience: ["company", "location", "period", "website"],
      projects: ["period", "website"],
      skills: ["keywords"],
      education: ["school", "location", "period", "area", "grade", "description", "website"],
      awards: ["date", "awarder", "description", "website"],
      certifications: ["issuer", "date", "description", "website"],
    }[target.section];
    patch = {
      text: String(item[textField] ?? ""),
      data: Object.fromEntries(
        keys.map((key) => [
          key,
          (key === "company" || key === "school") &&
          item[key] === "—" &&
          !String(before.data?.[key] ?? "").trim()
            ? (before.data?.[key] ?? "")
            : item[key],
        ]),
      ),
    };
    const changed = changedLibraryFields(item, library);
    const data = patch.data ?? {};
    const changedKeys = Object.keys(data).filter((key) => key in changed && key !== "keywords");
    patch = {
      ...(Object.keys(changed).some((key) => !(key in data)) ? { text: patch.text } : {}),
      ...(changedKeys.length
        ? { data: Object.fromEntries(changedKeys.map((key) => [key, data[key]])) }
        : {}),
    };
  }
  return { input: patch, before };
}
