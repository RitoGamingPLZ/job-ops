import { Check, ChevronDown, Plus, Search, X } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useVirtualizedListbox } from "@/components/ui/virtualized-listbox";
import { cn } from "@/lib/utils";

export interface MultiComboboxOption {
  value: string;
  label: string;
  searchText?: string;
  meta?: React.ReactNode;
  disabled?: boolean;
}

export type MultiComboboxVariant = "inline" | "popover";

export interface MultiComboboxProps {
  id?: string;
  variant?: MultiComboboxVariant;
  value: string[];
  options: MultiComboboxOption[];
  onValueChange: (value: string[]) => void;
  disabled?: boolean;
  /** Allow creating values not in `options` via Enter, comma, or custom option row. Default false. */
  allowCustomValues?: boolean;
  /** Commit pending draft text on blur when `allowCustomValues` is true. Default matches `allowCustomValues`. */
  commitOnBlur?: boolean;
  /** Clear search text when an option is selected. Default true for "inline", false for "popover". */
  clearSearchOnSelect?: boolean;
  /** Noun used in default aria-labels (e.g. "tag", "skill", "company"). Default "item". */
  noun?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /** Accessible label for the combobox input. Defaults to `Add ${noun}` for inline, `Search ${noun}` for popover. */
  inputAriaLabel?: string;
  /** Accessible label for the listbox. Defaults to `inputAriaLabel`. */
  listAriaLabel?: string;
  /** Custom label builder for chip remove buttons. Defaults to `Remove ${noun} ${label}`. */
  getRemoveLabel?: (label: string, value: string) => string;
  /** Popover-variant trigger element (rendered inside `PopoverTrigger asChild`). If omitted in `popover` variant, renders a default outline button. */
  trigger?: React.ReactNode;
  /** Optional uppercase title shown in the popover header (`popover` variant). */
  popoverTitle?: string;
  /** Optional clear-all button label shown in the popover header (e.g. "All companies"). */
  clearLabel?: string;
  /** Show removable selected chips strip inside the popover when items are selected (`popover` variant). Default false. */
  showSelectedChips?: boolean;
  align?: "start" | "center" | "end";
  className?: string;
  contentClassName?: string;
  listClassName?: string;
}

type MultiComboboxRow =
  | {
      id: string;
      type: "custom";
      value: string;
    }
  | {
      id: string;
      type: "option";
      disabled: boolean;
      option: MultiComboboxOption;
    };

const VIRTUALIZE_THRESHOLD = 60;
const VIRTUAL_ROW_HEIGHT = 36;
const VIRTUAL_FALLBACK_COUNT = 20;

export function normalizeMultiComboboxText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Adds comma-separated values, resolving known options and skipping blanks or case-insensitive repeats. */
export function addMultiComboboxValues(
  current: string[],
  draft: string,
  options?: MultiComboboxOption[],
): string[] {
  const seen = new Set(current.map(normalizeMultiComboboxText));
  const canonicalByKey = new Map<string, string>();

  if (options) {
    for (const option of options) {
      if (option.disabled) continue;
      const valueKey = normalizeMultiComboboxText(option.value);
      if (valueKey && !canonicalByKey.has(valueKey)) {
        canonicalByKey.set(valueKey, option.value);
      }
    }
    for (const option of options) {
      if (option.disabled) continue;
      const labelKey = normalizeMultiComboboxText(option.label);
      if (labelKey && !canonicalByKey.has(labelKey)) {
        canonicalByKey.set(labelKey, option.value);
      }
    }
  }

  const added: string[] = [];
  for (const segment of draft.split(",")) {
    const trimmed = segment.trim();
    const key = normalizeMultiComboboxText(trimmed);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    added.push(canonicalByKey.get(key) ?? trimmed);
  }

  return added.length > 0 ? [...current, ...added] : current;
}

/** Toggles `targetValue` in `current` using normalized case/whitespace matching. */
export function toggleMultiComboboxValue(current: string[], targetValue: string): string[] {
  const targetKey = normalizeMultiComboboxText(targetValue);
  if (!targetKey) return current;

  const isSelected = current.some((entry) => normalizeMultiComboboxText(entry) === targetKey);
  if (isSelected) {
    return current.filter((entry) => normalizeMultiComboboxText(entry) !== targetKey);
  }
  return [...current, targetValue];
}

function getSearchableValue(option: MultiComboboxOption): string {
  return [option.label, option.searchText ?? "", option.value].join(" ").trim();
}

function toDomIdSegment(value: string): string {
  return Array.from(value)
    .map((character) => {
      if (/^[A-Za-z0-9_-]$/.test(character)) return character;
      return `_${character.codePointAt(0)?.toString(36) ?? "0"}_`;
    })
    .join("");
}

function createRowDomId(listId: string, type: MultiComboboxRow["type"], value: string): string {
  return `${toDomIdSegment(listId)}-${type}-${toDomIdSegment(value)}`;
}

function MultiComboboxChip({
  label,
  removeLabel,
  disabled,
  onRemove,
}: {
  label: string;
  removeLabel: string;
  disabled: boolean;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-border/80 bg-secondary/75 px-1.5 py-0.5 text-xs font-medium text-secondary-foreground">
      <span className="truncate">{label}</span>
      <button
        type="button"
        disabled={disabled}
        aria-label={removeLabel}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
        className="inline-flex h-3.5 w-3.5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none"
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
    </span>
  );
}

function MultiComboboxRowButton({
  row,
  selected,
  isActive,
  dataIndex,
  style,
  buttonRef,
  onMouseEnter,
  onSelect,
}: {
  row: MultiComboboxRow;
  selected: boolean;
  isActive: boolean;
  dataIndex?: number;
  style?: React.CSSProperties;
  buttonRef?: React.Ref<HTMLButtonElement>;
  onMouseEnter: () => void;
  onSelect: () => void;
}) {
  const isDisabled = row.type === "option" && row.disabled;

  return (
    <button
      ref={buttonRef}
      type="button"
      data-index={dataIndex}
      role="option"
      tabIndex={-1}
      aria-selected={selected}
      aria-disabled={isDisabled}
      id={row.id}
      style={style}
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={onMouseEnter}
      onClick={onSelect}
      className={cn(
        "flex w-full cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-normal outline-none transition-colors",
        isActive ? "bg-accent text-accent-foreground" : "",
        isDisabled
          ? "pointer-events-none opacity-50"
          : "hover:bg-accent/80 hover:text-accent-foreground",
        style ? "absolute left-0 top-0" : "",
      )}
    >
      {row.type === "custom" ? (
        <>
          <Plus className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{`Add "${row.value}"`}</span>
        </>
      ) : (
        <>
          <span
            aria-hidden="true"
            className={cn(
              "flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors",
              selected
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input bg-transparent",
            )}
          >
            {selected ? <Check className="h-3 w-3 stroke-[2.5]" /> : null}
          </span>
          <span className="min-w-0 flex-1 truncate" title={row.option.label}>
            {row.option.label}
          </span>
          {row.option.meta !== undefined && row.option.meta !== null ? (
            <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
              {row.option.meta}
            </span>
          ) : null}
        </>
      )}
    </button>
  );
}

interface MultiComboboxListboxProps {
  listId: string;
  listAriaLabel: string;
  listClassName?: string;
  emptyText: string;
  rows: MultiComboboxRow[];
  selectedKeySet: ReadonlySet<string>;
  effectiveActiveRowId: string | null;
  activeRowIndex: number;
  shouldVirtualize: boolean;
  open: boolean;
  navigationSourceRef: React.MutableRefObject<"keyboard" | "pointer" | "filter">;
  onHighlightRow: (row: MultiComboboxRow) => void;
  onSelectRow: (row: MultiComboboxRow) => void;
}

function MultiComboboxListbox({
  listId,
  listAriaLabel,
  listClassName,
  emptyText,
  rows,
  selectedKeySet,
  effectiveActiveRowId,
  activeRowIndex,
  shouldVirtualize,
  open,
  navigationSourceRef,
  onHighlightRow,
  onSelectRow,
}: MultiComboboxListboxProps) {
  const [listElement, setListElement] = React.useState<HTMLDivElement | null>(null);

  const { scrollToIndex, measureElement, getVirtualItems, getTotalSize } =
    useVirtualizedListbox<HTMLButtonElement>({
      count: rows.length,
      estimateSize: () => VIRTUAL_ROW_HEIGHT,
      enabled: open && shouldVirtualize,
      getItemKey: (index) => rows[index]?.id ?? index,
      initialRect: { width: 280, height: 240 },
      overscan: 8,
      scrollElement: listElement,
    });

  React.useEffect(() => {
    if (!open || activeRowIndex < 0) return;
    if (navigationSourceRef.current === "pointer") return;

    if (shouldVirtualize) {
      scrollToIndex(activeRowIndex, { align: "auto" });
      return;
    }

    if (effectiveActiveRowId) {
      document.getElementById(effectiveActiveRowId)?.scrollIntoView?.({ block: "nearest" });
    }
  }, [
    activeRowIndex,
    effectiveActiveRowId,
    navigationSourceRef,
    open,
    scrollToIndex,
    shouldVirtualize,
  ]);

  const virtualItems = shouldVirtualize ? getVirtualItems() : [];
  const useVirtualizedLayout = shouldVirtualize && virtualItems.length > 0;
  const fallbackStart =
    shouldVirtualize && activeRowIndex >= 0
      ? Math.min(
          Math.max(0, activeRowIndex - Math.floor(VIRTUAL_FALLBACK_COUNT / 2)),
          Math.max(0, rows.length - VIRTUAL_FALLBACK_COUNT),
        )
      : 0;
  const fallbackRows = shouldVirtualize
    ? rows.slice(fallbackStart, fallbackStart + VIRTUAL_FALLBACK_COUNT)
    : rows;

  return (
    <div
      ref={setListElement}
      id={listId}
      role="listbox"
      aria-multiselectable="true"
      aria-label={listAriaLabel}
      onWheelCapture={(event) => event.stopPropagation()}
      onTouchMoveCapture={(event) => event.stopPropagation()}
      className={cn("max-h-60 overflow-y-auto overflow-x-hidden p-1", listClassName)}
    >
      {rows.length === 0 ? (
        <div className="px-3 py-6 text-center text-xs text-muted-foreground">{emptyText}</div>
      ) : useVirtualizedLayout ? (
        <div className="relative w-full" style={{ height: getTotalSize() }}>
          {virtualItems.map((virtualItem) => {
            const row = rows[virtualItem.index];
            if (!row) return null;
            const selected =
              row.type === "option" &&
              selectedKeySet.has(normalizeMultiComboboxText(row.option.value));

            return (
              <MultiComboboxRowButton
                key={virtualItem.key}
                row={row}
                selected={selected}
                isActive={row.id === effectiveActiveRowId}
                dataIndex={virtualItem.index}
                buttonRef={measureElement}
                style={{ transform: `translateY(${virtualItem.start}px)` }}
                onMouseEnter={() => {
                  if (row.type === "option" && row.disabled) return;
                  navigationSourceRef.current = "pointer";
                  onHighlightRow(row);
                }}
                onSelect={() => onSelectRow(row)}
              />
            );
          })}
        </div>
      ) : (
        <div className="space-y-0.5">
          {fallbackRows.map((row) => {
            const selected =
              row.type === "option" &&
              selectedKeySet.has(normalizeMultiComboboxText(row.option.value));

            return (
              <MultiComboboxRowButton
                key={row.id}
                row={row}
                selected={selected}
                isActive={row.id === effectiveActiveRowId}
                onMouseEnter={() => {
                  if (row.type === "option" && row.disabled) return;
                  navigationSourceRef.current = "pointer";
                  onHighlightRow(row);
                }}
                onSelect={() => onSelectRow(row)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

export function MultiCombobox({
  id,
  variant = "inline",
  value,
  options,
  onValueChange,
  disabled = false,
  allowCustomValues = false,
  commitOnBlur = allowCustomValues,
  clearSearchOnSelect = variant === "inline",
  noun = "item",
  placeholder,
  searchPlaceholder,
  emptyText = "No results found.",
  inputAriaLabel,
  listAriaLabel,
  getRemoveLabel,
  trigger,
  popoverTitle,
  clearLabel,
  showSelectedChips = false,
  align = "start",
  className,
  contentClassName,
  listClassName,
}: MultiComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [activeRowId, setActiveRowId] = React.useState<string | null>(null);
  const anchorRef = React.useRef<HTMLDivElement | null>(null);
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const navigationSourceRef = React.useRef<"keyboard" | "pointer" | "filter">("filter");
  const listId = React.useId();

  const resolvedInputAriaLabel =
    inputAriaLabel ?? (variant === "inline" ? `Add ${noun}` : `Search ${noun}`);
  const resolvedListAriaLabel = listAriaLabel ?? resolvedInputAriaLabel;
  const resolvedPlaceholder = placeholder ?? `Add ${noun}…`;
  const resolvedSearchPlaceholder = searchPlaceholder ?? `Search ${noun}...`;

  const deferredQuery = React.useDeferredValue(query);
  const normalizedQuery = normalizeMultiComboboxText(deferredQuery);
  const trimmedQuery = query.trim();
  const normalizedTrimmedQuery = normalizeMultiComboboxText(query);

  const selectedKeySet = React.useMemo(
    () => new Set(value.map(normalizeMultiComboboxText)),
    [value],
  );

  const optionByKey = React.useMemo(() => {
    const map = new Map<string, MultiComboboxOption>();
    for (const option of options) {
      const key = normalizeMultiComboboxText(option.value);
      if (key && !map.has(key)) {
        map.set(key, option);
      }
    }
    return map;
  }, [options]);

  const selectedEntries = React.useMemo(
    () =>
      value.map((entryValue) => {
        const option = optionByKey.get(normalizeMultiComboboxText(entryValue));
        const label = option?.label ?? entryValue;
        return {
          value: entryValue,
          label,
          removeLabel: getRemoveLabel
            ? getRemoveLabel(label, entryValue)
            : `Remove ${noun} ${label}`,
        };
      }),
    [getRemoveLabel, noun, optionByKey, value],
  );

  const filteredOptions = React.useMemo(() => {
    if (!normalizedQuery) return options;
    return options.filter((option) =>
      normalizeMultiComboboxText(getSearchableValue(option)).includes(normalizedQuery),
    );
  }, [normalizedQuery, options]);

  const hasCustomValue =
    allowCustomValues &&
    trimmedQuery.length > 0 &&
    !trimmedQuery.includes(",") &&
    !selectedKeySet.has(normalizedTrimmedQuery) &&
    !options.some(
      (option) =>
        normalizeMultiComboboxText(option.value) === normalizedTrimmedQuery ||
        normalizeMultiComboboxText(option.label) === normalizedTrimmedQuery,
    );

  const rows = React.useMemo<MultiComboboxRow[]>(() => {
    const nextRows: MultiComboboxRow[] = [];

    if (hasCustomValue) {
      nextRows.push({
        id: createRowDomId(listId, "custom", trimmedQuery),
        type: "custom",
        value: trimmedQuery,
      });
    }

    for (const option of filteredOptions) {
      nextRows.push({
        id: createRowDomId(listId, "option", option.value),
        type: "option",
        disabled: Boolean(option.disabled),
        option,
      });
    }

    return nextRows;
  }, [filteredOptions, hasCustomValue, listId, trimmedQuery]);

  const selectableRowIndexes = React.useMemo(() => {
    const indexes: number[] = [];
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (row.type === "custom" || !row.disabled) {
        indexes.push(index);
      }
    }
    return indexes;
  }, [rows]);

  const effectiveActiveRowId = React.useMemo(() => {
    if (activeRowId) {
      const matched = rows.find((row) => row.id === activeRowId);
      if (matched && (matched.type === "custom" || !matched.disabled)) {
        return matched.id;
      }
    }
    const firstSelectableIndex = selectableRowIndexes[0];
    return firstSelectableIndex !== undefined ? (rows[firstSelectableIndex]?.id ?? null) : null;
  }, [activeRowId, rows, selectableRowIndexes]);

  const activeRowIndex = effectiveActiveRowId
    ? rows.findIndex((row) => row.id === effectiveActiveRowId)
    : -1;
  const activeRow = activeRowIndex >= 0 ? rows[activeRowIndex] : null;

  const hasDropdownContent =
    options.length > 0 || hasCustomValue || (trimmedQuery.length > 0 && Boolean(emptyText));
  const effectiveOpen =
    variant === "popover" ? open && !disabled : open && !disabled && hasDropdownContent;
  const shouldVirtualize = rows.length > VIRTUALIZE_THRESHOLD;

  const commitDraft = React.useCallback(
    (draft = query) => {
      if (!allowCustomValues || disabled) return;
      const next = addMultiComboboxValues(value, draft, options);
      if (next !== value) onValueChange(next);
      setQuery("");
      setActiveRowId(null);
    },
    [allowCustomValues, disabled, onValueChange, options, query, value],
  );

  const selectRow = React.useCallback(
    (row: MultiComboboxRow) => {
      if (disabled) return;
      if (row.type === "custom") {
        const next = addMultiComboboxValues(value, row.value, options);
        if (next !== value) onValueChange(next);
        setQuery("");
        setActiveRowId(null);
        return;
      }
      if (row.disabled) return;
      onValueChange(toggleMultiComboboxValue(value, row.option.value));
      if (clearSearchOnSelect) {
        setQuery("");
      }
      setActiveRowId(row.id);
    },
    [clearSearchOnSelect, disabled, onValueChange, options, value],
  );

  const moveActive = React.useCallback(
    (direction: 1 | -1) => {
      if (selectableRowIndexes.length === 0) return;

      navigationSourceRef.current = "keyboard";
      const currentSelectableIndex = selectableRowIndexes.indexOf(activeRowIndex);
      let nextSelectableIndex = currentSelectableIndex;
      if (nextSelectableIndex < 0) {
        nextSelectableIndex = direction === 1 ? -1 : 0;
      }
      nextSelectableIndex =
        (nextSelectableIndex + direction + selectableRowIndexes.length) %
        selectableRowIndexes.length;

      setActiveRowId(rows[selectableRowIndexes[nextSelectableIndex]]?.id ?? null);
    },
    [activeRowIndex, rows, selectableRowIndexes],
  );

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;

    if (event.key === "ArrowDown") {
      if (!effectiveOpen && hasDropdownContent) {
        event.preventDefault();
        navigationSourceRef.current = "keyboard";
        setOpen(true);
        return;
      }
      if (selectableRowIndexes.length > 0) {
        event.preventDefault();
        moveActive(1);
      }
      return;
    }

    if (event.key === "ArrowUp") {
      if (!effectiveOpen && hasDropdownContent) {
        event.preventDefault();
        navigationSourceRef.current = "keyboard";
        setOpen(true);
        return;
      }
      if (selectableRowIndexes.length > 0) {
        event.preventDefault();
        moveActive(-1);
      }
      return;
    }

    if (event.key === "Home" && effectiveOpen && selectableRowIndexes.length > 0) {
      event.preventDefault();
      navigationSourceRef.current = "keyboard";
      setActiveRowId(rows[selectableRowIndexes[0]]?.id ?? null);
      return;
    }

    if (event.key === "End" && effectiveOpen && selectableRowIndexes.length > 0) {
      event.preventDefault();
      navigationSourceRef.current = "keyboard";
      setActiveRowId(rows[selectableRowIndexes[selectableRowIndexes.length - 1]]?.id ?? null);
      return;
    }

    if (event.key === "Escape" && effectiveOpen) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setQuery("");
      setActiveRowId(null);
      return;
    }

    if (event.key === "," && allowCustomValues && !event.nativeEvent.isComposing) {
      event.preventDefault();
      commitDraft();
      return;
    }

    if (
      event.key === "Backspace" &&
      variant === "inline" &&
      query.length === 0 &&
      value.length > 0
    ) {
      onValueChange(value.slice(0, -1));
      return;
    }

    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      if (allowCustomValues && query.includes(",")) {
        event.preventDefault();
        commitDraft();
        return;
      }
      if (effectiveOpen && activeRow) {
        event.preventDefault();
        selectRow(activeRow);
        return;
      }
      if (allowCustomValues && trimmedQuery.length > 0) {
        event.preventDefault();
        commitDraft();
      }
    }
  };

  const handleOpenChange = React.useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setQuery("");
      setActiveRowId(null);
    }
  }, []);

  const listbox = (
    <MultiComboboxListbox
      listId={listId}
      listAriaLabel={resolvedListAriaLabel}
      listClassName={listClassName}
      emptyText={emptyText}
      rows={rows}
      selectedKeySet={selectedKeySet}
      effectiveActiveRowId={effectiveActiveRowId}
      activeRowIndex={activeRowIndex}
      shouldVirtualize={shouldVirtualize}
      open={effectiveOpen}
      navigationSourceRef={navigationSourceRef}
      onHighlightRow={(row) => setActiveRowId(row.id)}
      onSelectRow={selectRow}
    />
  );

  if (variant === "popover") {
    const defaultTrigger = (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        className={cn("justify-between gap-2 font-normal", className)}
      >
        <span className="truncate">
          {value.length > 0 ? `${value.length} selected` : resolvedPlaceholder}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden="true" />
      </Button>
    );

    return (
      <Popover open={effectiveOpen} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>{trigger ?? defaultTrigger}</PopoverTrigger>
        <PopoverContent
          ref={contentRef}
          align={align}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
          onEscapeKeyDown={(event) => {
            event.stopPropagation();
          }}
          className={cn("w-72 p-0 font-normal", contentClassName)}
        >
          {popoverTitle || clearLabel ? (
            <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
              {popoverTitle ? (
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {popoverTitle}
                </p>
              ) : (
                <span />
              )}
              {clearLabel ? (
                <Button
                  type="button"
                  size="sm"
                  variant={value.length === 0 ? "secondary" : "ghost"}
                  disabled={disabled}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onValueChange([])}
                  className="h-6 rounded-md px-2 text-xs"
                >
                  {clearLabel}
                </Button>
              ) : null}
            </div>
          ) : null}

          <div className="flex items-center gap-2 border-b border-border/60 px-2.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
            <input
              ref={inputRef}
              id={id}
              type="text"
              role="combobox"
              aria-expanded={effectiveOpen}
              aria-controls={listId}
              aria-activedescendant={effectiveActiveRowId ?? undefined}
              aria-autocomplete="list"
              aria-label={resolvedInputAriaLabel}
              placeholder={resolvedSearchPlaceholder}
              disabled={disabled}
              value={query}
              onChange={(event) => {
                navigationSourceRef.current = "filter";
                setQuery(event.target.value);
              }}
              onKeyDown={handleInputKeyDown}
              className="h-9 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            />
            {query.length > 0 ? (
              <button
                type="button"
                tabIndex={-1}
                aria-label="Clear search"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
                className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            ) : null}
          </div>

          {showSelectedChips && selectedEntries.length > 0 ? (
            <div className="flex max-h-20 flex-wrap gap-1 overflow-y-auto border-b border-border/60 bg-muted/20 px-2.5 py-1.5">
              {selectedEntries.map((entry) => (
                <MultiComboboxChip
                  key={entry.value}
                  label={entry.label}
                  removeLabel={entry.removeLabel}
                  disabled={disabled}
                  onRemove={() => onValueChange(toggleMultiComboboxValue(value, entry.value))}
                />
              ))}
            </div>
          ) : null}

          {listbox}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Popover open={effectiveOpen} onOpenChange={handleOpenChange}>
      <PopoverAnchor asChild>
        <div
          ref={anchorRef}
          onClick={() => {
            if (disabled) return;
            inputRef.current?.focus();
            if (hasDropdownContent) setOpen(true);
          }}
          className={cn(
            "flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-lg border border-input bg-transparent px-2 py-1 text-sm font-normal shadow-2xs transition-[border-color,box-shadow] hover:border-foreground/20 focus-within:border-ring/60 focus-within:ring-1 focus-within:ring-ring",
            disabled && "cursor-not-allowed opacity-50",
            className,
          )}
        >
          {selectedEntries.map((entry) => (
            <MultiComboboxChip
              key={entry.value}
              label={entry.label}
              removeLabel={entry.removeLabel}
              disabled={disabled}
              onRemove={() => onValueChange(toggleMultiComboboxValue(value, entry.value))}
            />
          ))}
          <input
            ref={inputRef}
            id={id}
            type="text"
            role="combobox"
            aria-expanded={effectiveOpen}
            aria-controls={listId}
            aria-activedescendant={effectiveActiveRowId ?? undefined}
            aria-autocomplete="list"
            aria-label={resolvedInputAriaLabel}
            placeholder={value.length > 0 ? undefined : resolvedPlaceholder}
            disabled={disabled}
            value={query}
            onFocus={() => {
              if (!disabled) setOpen(true);
            }}
            onChange={(event) => {
              navigationSourceRef.current = "filter";
              setQuery(event.target.value);
              if (!disabled) setOpen(true);
            }}
            onBlur={(event) => {
              const relatedTarget = event.relatedTarget;
              if (
                relatedTarget instanceof Node &&
                (anchorRef.current?.contains(relatedTarget) ||
                  contentRef.current?.contains(relatedTarget))
              ) {
                return;
              }
              if (allowCustomValues && commitOnBlur && query.trim().length > 0) {
                commitDraft();
              }
              setOpen(false);
            }}
            onKeyDown={handleInputKeyDown}
            className="h-6 min-w-24 flex-1 bg-transparent text-sm font-normal text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
          />
          {options.length > 0 ? (
            <button
              type="button"
              tabIndex={-1}
              disabled={disabled}
              aria-label={effectiveOpen ? `Close ${noun} options` : `Browse ${noun} options`}
              aria-expanded={effectiveOpen}
              aria-controls={listId}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.stopPropagation();
                if (disabled) return;
                setOpen((current) => !current);
                inputRef.current?.focus();
              }}
              className="ml-auto flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none"
            >
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 transition-transform duration-150",
                  effectiveOpen && "rotate-180",
                )}
                aria-hidden="true"
              />
            </button>
          ) : null}
        </div>
      </PopoverAnchor>
      <PopoverContent
        ref={contentRef}
        role="presentation"
        align={align}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          if (event.target instanceof Node && anchorRef.current?.contains(event.target)) {
            event.preventDefault();
          }
        }}
        onEscapeKeyDown={(event) => {
          event.stopPropagation();
        }}
        className={cn(
          "w-[var(--radix-popover-trigger-width)] min-w-[220px] p-0 font-normal",
          contentClassName,
        )}
      >
        {listbox}
      </PopoverContent>
    </Popover>
  );
}
