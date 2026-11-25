import { describe, expect, it } from "vitest";
import { listCareerBoardSources } from "./career-boards";
import { listWatchlistGroupDefinitions, resolveWatchlistSourceGroups } from "./watchlist-groups";

describe("watchlist source groups", () => {
  it("resolves every bundled group member to a catalog source", async () => {
    const catalog = await listCareerBoardSources();
    const catalogKeys = new Set(catalog.map((source) => `${source.sourceType}:${source.label}`));

    const missing = listWatchlistGroupDefinitions().flatMap((group) =>
      group.members
        .filter((member) => !catalogKeys.has(`${member.sourceType}:${member.label}`))
        .map((member) => `${group.id}: ${member.sourceType}:${member.label}`),
    );

    expect(missing).toEqual([]);
  });

  it("keeps every group within the watchlist source cap and free of duplicates", async () => {
    const groups = resolveWatchlistSourceGroups(await listCareerBoardSources());

    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      expect(group.sourceIds.length).toBeGreaterThan(0);
      expect(group.sourceIds.length).toBeLessThanOrEqual(50);
      expect(new Set(group.sourceIds).size).toBe(group.sourceIds.length);
    }
  });

  it("drops members that are missing from the catalog", () => {
    const groups = resolveWatchlistSourceGroups(
      [
        {
          id: "greenhouse:acme",
          label: "Acme",
          careersUrl: "https://job-boards.greenhouse.io/acme",
          cxsJobsUrl: null,
          sourceType: "greenhouse",
        },
      ],
      [
        {
          id: "g",
          label: "G",
          description: "d",
          members: [
            { sourceType: "greenhouse", label: "Acme" },
            { sourceType: "greenhouse", label: "Gone" },
          ],
        },
        {
          id: "empty",
          label: "E",
          description: "d",
          members: [{ sourceType: "lever", label: "x" }],
        },
      ],
    );

    expect(groups).toEqual([
      { id: "g", label: "G", description: "d", sourceIds: ["greenhouse:acme"] },
    ]);
  });
});
