import type { WatchlistSourceGroup } from "@shared/types.js";
import { Layers } from "lucide-react";
import type React from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface WatchlistGroupsMenuProps {
  groups: WatchlistSourceGroup[];
  /** Catalog source ids that are already in the draft list. */
  addedCatalogSourceIds: ReadonlySet<string>;
  /** True once the watchlist has no room for more sources. */
  isFull: boolean;
  onAddGroup: (group: WatchlistSourceGroup) => void;
}

export const WatchlistGroupsMenu: React.FC<WatchlistGroupsMenuProps> = ({
  groups,
  addedCatalogSourceIds,
  isFull,
  onAddGroup,
}) => {
  if (groups.length === 0) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="ghost" aria-label="Add a group of sources">
          <Layers className="mr-1.5 h-3.5 w-3.5" />
          Groups
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-2">
        <p className="px-2 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Add a group of sources
        </p>
        <ul className="max-h-96 space-y-1 overflow-y-auto">
          {groups.map((group) => {
            const remaining = group.sourceIds.filter((id) => !addedCatalogSourceIds.has(id)).length;
            return (
              <li
                key={group.id}
                className="flex items-start justify-between gap-3 rounded-md px-2 py-2 hover:bg-accent/50"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{group.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{group.description}</p>
                  <p className="mt-1 text-[11px] tabular-nums text-muted-foreground/80">
                    {group.sourceIds.length - remaining} of {group.sourceIds.length} added
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  disabled={remaining === 0 || isFull}
                  aria-label={`Add ${group.label}`}
                  onClick={() => onAddGroup(group)}
                >
                  {remaining === 0 ? "Added" : `Add ${remaining}`}
                </Button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
};
