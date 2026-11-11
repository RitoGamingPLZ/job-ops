import { useId, useState } from "react";
import { cn } from "@/lib/utils";

/** Adds comma-separated values, skipping blanks and case-insensitive repeats. */
export function addTags(tags: string[], draft: string): string[] {
  const seen = new Set(tags.map((value) => value.trim().toLowerCase()));
  const added = draft
    .split(",")
    .map((value) => value.trim())
    .filter((value) => {
      const key = value.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return added.length ? [...tags, ...added] : tags;
}

/**
 * A multi-select box: chosen values are chips with ×, and the input bar adds
 * new ones (Enter or comma) with the native suggestion list from `options`.
 */
export function TagInput({
  value,
  onChange,
  options = [],
  noun = "tag",
  id,
  disabled = false,
  placeholder,
  className,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  options?: string[];
  noun?: string;
  id?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState("");
  const listId = useId();
  const chosen = new Set(value.map((item) => item.toLowerCase()));
  const suggestions = options.filter((item) => !chosen.has(item.toLowerCase()));
  function commit(text = draft) {
    const next = addTags(value, text);
    if (next !== value) onChange(next);
    setDraft("");
  }
  return (
    <div
      className={cn(
        "flex min-h-9 w-full flex-wrap items-center gap-1 rounded-md border border-input bg-transparent px-2 py-1 shadow-sm focus-within:ring-1 focus-within:ring-ring",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      {value.map((item) => (
        <span
          key={item}
          className="inline-flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-xs"
        >
          {item}
          <button
            type="button"
            disabled={disabled}
            className="text-muted-foreground hover:text-foreground"
            aria-label={`Remove ${noun} ${item}`}
            onClick={() => onChange(value.filter((entry) => entry !== item))}
          >
            ×
          </button>
        </span>
      ))}
      <input
        id={id}
        list={suggestions.length ? listId : undefined}
        aria-label={`Add ${noun}`}
        placeholder={value.length ? undefined : (placeholder ?? `Add ${noun}…`)}
        disabled={disabled}
        className="h-6 min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        value={draft}
        onChange={(event) => {
          const text = event.target.value;
          // Picking a suggestion fills the whole value at once: add it straight away.
          if (suggestions.includes(text)) commit(text);
          else setDraft(text);
        }}
        onBlur={() => commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            commit();
          } else if (event.key === "Backspace" && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
      />
      {suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions.map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>
      )}
    </div>
  );
}
