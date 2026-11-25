import { describe, expect, it } from "vitest";
import {
  chunk,
  inListChunkSize,
  insertRowsPerStatement,
  SQL_MAX_BOUND_PARAMETERS,
} from "./sql-chunks";

describe("sql chunk helpers", () => {
  it("splits items into ordered chunks", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
    expect(chunk([1, 2], 0)).toEqual([[1], [2]]);
  });

  it("keeps every statement within the bound parameter limit", () => {
    for (const other of [0, 1, 4, 99, 500]) {
      expect(inListChunkSize(other) + other).toBeLessThanOrEqual(
        Math.max(SQL_MAX_BOUND_PARAMETERS, other + 1),
      );
      expect(inListChunkSize(other)).toBeGreaterThanOrEqual(1);
    }
    for (const columns of [1, 7, 13, 40]) {
      expect(insertRowsPerStatement(columns) * columns).toBeLessThanOrEqual(
        Math.max(SQL_MAX_BOUND_PARAMETERS, columns),
      );
    }
    // The watchlist_selected_sources insert binds 13 columns per row.
    expect(insertRowsPerStatement(13)).toBe(7);
  });
});
