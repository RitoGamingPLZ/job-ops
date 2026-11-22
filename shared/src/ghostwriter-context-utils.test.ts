import { describe, expect, it } from "vitest";
import { normalizeGhostwriterSelectedContextIds } from "./ghostwriter-context-utils";

describe("normalizeGhostwriterSelectedContextIds", () => {
  it("trims, drops empties, and dedupes case-sensitively", () => {
    expect(normalizeGhostwriterSelectedContextIds(["Id1", " id1 ", "Id1", " ", "ID1"])).toEqual([
      "Id1",
      "id1",
      "ID1",
    ]);
  });
});
