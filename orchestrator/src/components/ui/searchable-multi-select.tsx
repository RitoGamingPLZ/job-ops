import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { SearchableDropdown } from "@/components/ui/searchable-dropdown";

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
  const [managing, setManaging] = useState(false);
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
              disabled={disabled || !selectionEnabled}
              className="rounded bg-muted px-2 py-1 text-xs hover:bg-accent"
              aria-label={`Untick ${keyword}`}
              onClick={() =>
                onValueChange(value.filter((item) => item !== keyword))
              }
            >
              {keyword}
              {selectionEnabled ? " ×" : ""}
            </button>
          ) : (
            <span key={keyword} className="rounded bg-muted px-2 py-1 text-xs">
              {keyword}
            </span>
          ),
        )}
      </section>
      {selectionEnabled && (
        <SearchableDropdown
          value=""
          options={options.map((keyword) => ({
            value: keyword,
            label: `${value.includes(keyword) ? "✓ " : ""}${keyword}`,
          }))}
          ariaLabel={ariaLabel}
          placeholder="Select keywords…"
          allowCustomValue={false}
          disabled={disabled || !selectionEnabled}
          onValueChange={(keyword) =>
            onValueChange(
              value.includes(keyword)
                ? value.filter((item) => item !== keyword)
                : [...value, keyword],
            )
          }
        />
      )}
      <Button
        size="sm"
        variant="ghost"
        disabled={disabled}
        onClick={() => setManaging(!managing)}
        aria-expanded={managing}
      >
        Create / delete keywords
      </Button>
      {managing && (
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
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  aria-label={`Delete keyword ${keyword}`}
                  onClick={() => onDelete(keyword)}
                >
                  Delete
                </Button>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
