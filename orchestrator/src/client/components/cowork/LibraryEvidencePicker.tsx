import { isOnResume } from "@shared/resume-links";
import type { ExperienceBullet, ResumeV5Document } from "@shared/types";
import { useState } from "react";
import type { BulletReference } from "./editor";

export function LibraryEvidencePicker({
  library,
  document,
  references,
  onSelect,
}: {
  library: ExperienceBullet[];
  document: ResumeV5Document;
  references: BulletReference[];
  onSelect: (item: BulletReference) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const parents = new Map(library.map((item) => [item.id, item.text]));
  const selected = new Set(references.map((item) => item.id));
  const matches = open
    ? library.filter((item) => {
        const parent = item.parentId ? parents.get(item.parentId) : "";
        return (
          item.kind !== "contact" &&
          [item.text, item.kind, parent]
            .join(" ")
            .toLowerCase()
            .includes(query.trim().toLowerCase())
        );
      })
    : [];
  return (
    <details className="w-full" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer text-sm font-medium">Use from candidate library</summary>
      {open && (
        <div className="space-y-2 py-2">
          <input
            type="search"
            aria-label="Search library evidence"
            placeholder="Search by wording, role or project"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-full rounded border px-2 py-1 text-sm"
          />
          <div className="max-h-48 overflow-auto">
            {matches.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={selected.has(item.id) || references.length >= 80}
                className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-muted disabled:opacity-60"
                onClick={() => onSelect({ id: item.id, text: item.text })}
              >
                <span className="block">{item.text}</span>
                <span className="text-xs text-muted-foreground">
                  {[
                    item.kind.replaceAll("_", " "),
                    item.parentId && parents.get(item.parentId),
                    isOnResume(document, item.id) && "On this resume",
                    selected.has(item.id) && "Selected",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </button>
            ))}
            {matches.length === 0 && <p className="text-sm">No matching library evidence.</p>}
          </div>
        </div>
      )}
    </details>
  );
}
