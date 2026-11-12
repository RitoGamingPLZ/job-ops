import type { CandidateItemKind } from "./cowork";

export type EntrySection =
  | "experience"
  | "education"
  | "projects"
  | "skills"
  | "awards"
  | "certifications";
export type LineParent = {
  section: "experience" | "projects";
  itemId: string;
};
export type LineTarget = LineParent & {
  bulletIndex: number;
  previousText: string;
};
export type SaveTarget =
  | { kind: "line"; target: LineTarget; libraryId: string }
  | {
      kind: "entry";
      section: EntrySection;
      itemId: string;
      libraryId: string;
    };
export type LibraryCreate = {
  kind: CandidateItemKind;
  text: string;
  parentId?: string | null;
  company?: string | null;
  role?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  data?: Record<string, unknown> | null;
};
export type SuggestionBody =
  | { op: "include_library_item"; libraryId: string }
  | { op: "exclude_library_item"; libraryId: string }
  | {
      op: "create_library_item";
      item: LibraryCreate;
      includeOnResume: boolean;
    }
  | { op: "save_to_library"; target: SaveTarget }
  | {
      op: "add_entry";
      section: EntrySection;
      index: number;
      item: Record<string, unknown>;
    }
  | { op: "remove_entry"; section: EntrySection; itemId: string }
  | { op: "reorder_entries"; section: EntrySection; itemIds: string[] }
  | ({ op: "replace_bullet"; text: string } & LineTarget)
  | ({ op: "delete_bullet" } & LineTarget)
  | ({
      op: "insert_bullet";
      bulletIndex: number;
      text: string;
      libraryId?: string;
      sourceBulletIds?: string[];
    } & LineParent)
  | ({ op: "reorder_bullets"; order: number[] } & LineParent & {
        previousTexts: string[];
      })
  | ({ op: "replace_intro"; previousText: string; text: string } & LineParent)
  | {
      op: "replace_headline" | "replace_summary";
      previousText: string;
      text: string;
    }
  | {
      op: "replace_field";
      field: { section: EntrySection; itemId: string; name: string };
      previousText: string;
      text: string;
    }
  | {
      op: "set_skill_keywords";
      itemId: string;
      previousKeywords: string[];
      keywords: string[];
    };
export type ResumeSuggestionV2 = SuggestionBody & {
  id: string;
  reason: string;
};
