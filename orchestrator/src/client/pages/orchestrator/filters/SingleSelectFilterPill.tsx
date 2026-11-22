import type React from "react";
import { Button } from "@/components/ui/button";
import { FilterPill } from "./FilterPill";

export interface SingleSelectFilterOption<T> {
  value: T;
  label: string;
}

interface SingleSelectFilterPillProps<T> {
  icon: React.ReactElement;
  label: string;
  active: boolean;
  summary: string | null;
  value: T;
  options: ReadonlyArray<SingleSelectFilterOption<T>>;
  onChange: (value: T) => void;
  deselectValue?: T;
  contentClassName?: string;
}

export function SingleSelectFilterPill<T>({
  icon,
  label,
  active,
  summary,
  value,
  options,
  onChange,
  deselectValue,
  contentClassName,
}: SingleSelectFilterPillProps<T>): React.ReactElement {
  return (
    <FilterPill
      icon={icon}
      label={label}
      active={active}
      summary={summary}
      contentClassName={contentClassName}
    >
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const isSelected = value === option.value;
          return (
            <Button
              key={String(option.value)}
              type="button"
              size="sm"
              variant={isSelected ? "default" : "outline"}
              onClick={() =>
                onChange(
                  isSelected && deselectValue !== undefined
                    ? deselectValue
                    : option.value,
                )
              }
            >
              {option.label}
            </Button>
          );
        })}
      </div>
    </FilterPill>
  );
}
