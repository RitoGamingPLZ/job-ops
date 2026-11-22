import { describe, expect, it } from "vitest";
import { designResumePatchSchema } from "./design-resume";

describe("designResumePatchSchema", () => {
  it("rejects patch paths that are not valid JSON pointers", () => {
    const result = designResumePatchSchema.safeParse({
      baseRevision: 1,
      operations: [
        {
          op: "replace",
          path: "basics/name",
          value: "Taylor",
        },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Patch paths must be valid JSON Pointers.");
  });

  it("requires a value for test operations", () => {
    const result = designResumePatchSchema.safeParse({
      baseRevision: 1,
      operations: [
        {
          op: "test",
          path: "/basics/name",
        },
      ],
    });

    expect(result.success).toBe(false);
  });
});

describe("patch operation required properties", () => {
  it.each(["add", "replace", "test"])("requires a value for %s", (op) => {
    const result = designResumePatchSchema.safeParse({
      baseRevision: 1,
      operations: [{ op, path: "/basics/name" }],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual({
      code: "custom",
      path: ["operations", 0, "value"],
      message: `Patch ${op} operations require a value.`,
    });
  });

  it.each(["add", "replace", "test"])("accepts explicit undefined and null values for %s", (op) => {
    for (const value of [undefined, null]) {
      const result = designResumePatchSchema.parse({
        baseRevision: 1,
        operations: [{ op, path: "", value }],
      });
      expect(result.operations?.[0]).toEqual({ op, path: "", value });
      expect(result.operations?.[0]).toHaveProperty("value");
    }
  });

  it.each(["move", "copy"])("requires a from path for %s", (op) => {
    const result = designResumePatchSchema.safeParse({
      baseRevision: 1,
      operations: [{ op, path: "/basics/name" }],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual({
      code: "custom",
      path: ["operations", 0, "from"],
      message: `Patch ${op} operations require a from path.`,
    });
  });

  it.each(["move", "copy"])("preserves from validation for %s", (op) => {
    for (const from of [undefined, "", "/basics/name"]) {
      const result = designResumePatchSchema.parse({
        baseRevision: 1,
        operations: [{ op, path: "/basics/headline", from }],
      });
      expect(result.operations?.[0]).toEqual({
        op,
        path: "/basics/headline",
        from,
      });
    }
    for (const from of [null, "basics/name"]) {
      expect(
        designResumePatchSchema.safeParse({
          baseRevision: 1,
          operations: [{ op, path: "/basics/headline", from }],
        }).success,
      ).toBe(false);
    }
  });
});
