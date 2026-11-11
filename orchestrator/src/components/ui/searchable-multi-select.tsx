import { Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

/** A keyword picker: removing a chip only unticks it; Delete removes a library option. */
export function SearchableMultiSelect({
  options,
  value,
  onValueChange,
  onCreate,
  onDelete,
  disabled = false,
  ariaLabel = "Keywords",
  selectionEnabled = true,
}: {
  options: string[];
  value: string[];
  onValueChange: (value: string[]) => void;
  onCreate: (value: string) => void;
  onDelete: (value: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
  selectionEnabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const existing = options.find(
    (option) => option.toLowerCase() === trimmed.toLowerCase(),
  );
  return (
    <div className="min-w-0 space-y-2">
      <section
        className="flex flex-wrap gap-1"
        aria-label={`${ariaLabel} selected`}
      >
        {value.map((keyword) =>
          selectionEnabled ? (
            <button
              type="button"
              key={keyword}
              disabled={disabled}
              className="rounded bg-muted px-2 py-1 text-xs hover:bg-accent"
              aria-label={`Untick ${keyword}`}
              onClick={() =>
                onValueChange(value.filter((item) => item !== keyword))
              }
            >
              {keyword}
              {" ×"}
            </button>
          ) : (
            <span key={keyword} className="rounded bg-muted px-2 py-1 text-xs">
              {keyword}
            </span>
          ),
        )}
      </section>
      <div className="space-y-1 border-l pl-2">
        <Input
          aria-label={`Search or create ${ariaLabel}`}
          placeholder="Search or create keyword…"
          value={query}
          disabled={disabled}
          onChange={(e) => setQuery(e.target.value)}
        />
        {trimmed && !existing && (
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              onCreate(trimmed);
              setQuery("");
            }}
          >
            Create '{trimmed}'
          </Button>
        )}
        {options
          .filter((keyword) =>
            keyword.toLowerCase().includes(trimmed.toLowerCase()),
          )
          .map((keyword) => (
            <div key={keyword} className="flex items-center gap-2 text-sm">
              <div className="flex flex-1 items-center gap-2">
                {selectionEnabled && (
                  <Checkbox
                    aria-label={keyword}
                    disabled={disabled}
                    checked={value.includes(keyword)}
                    onCheckedChange={() =>
                      onValueChange(
                        value.includes(keyword)
                          ? value.filter((item) => item !== keyword)
                          : [...value, keyword],
                      )
                    }
                  />
                )}
                {keyword}
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                disabled={disabled}
                aria-label={`Delete keyword ${keyword}`}
                onClick={() => onDelete(keyword)}
              >
                <Trash2 className="h-3 w-3" aria-hidden="true" />
              </Button>
            </div>
          ))}
      </div>
    </div>
  );
}
