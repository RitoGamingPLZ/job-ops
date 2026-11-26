import type { WatchlistSource, WatchlistSourceGroup } from "@shared/types";
import groupDefinitions from "./watchlist-groups.json";

interface WatchlistGroupDefinition {
  id: string;
  label: string;
  description: string;
  members: Array<{ sourceType: string; label: string }>;
}

const memberKey = (sourceType: string, label: string) => `${sourceType}\u0000${label}`;

/**
 * Resolves bundled group definitions against the live catalog. Members are
 * matched by source type and label, so a missing or renamed catalog entry is
 * dropped from its group instead of breaking it.
 */
export function resolveWatchlistSourceGroups(
  catalogSources: WatchlistSource[],
  definitions: WatchlistGroupDefinition[] = groupDefinitions,
): WatchlistSourceGroup[] {
  const idByKey = new Map(
    catalogSources.map((source) => [memberKey(source.sourceType, source.label), source.id]),
  );

  return definitions.flatMap((definition) => {
    const sourceIds = [
      ...new Set(
        definition.members.flatMap((member) => {
          const id = idByKey.get(memberKey(member.sourceType, member.label));
          return id ? [id] : [];
        }),
      ),
    ];
    if (sourceIds.length === 0) return [];
    return [
      {
        id: definition.id,
        label: definition.label,
        description: definition.description,
        sourceIds,
      },
    ];
  });
}
