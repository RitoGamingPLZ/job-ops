import { expect, it } from "vitest";
import {
  awardDataSchema,
  certificationDataSchema,
  educationDataSchema,
  parseLibraryData,
} from "./candidate-library-schema";

it("normalizes legacy fields and websites without discarding unknown keys", () => {
  expect(
    parseLibraryData("education", {
      school: "School",
      website: "https://example.com",
      legacy: "keep",
    }),
  ).toEqual({
    schemaVersion: 2,
    school: "School",
    location: "",
    period: "",
    area: "",
    grade: "",
    description: "",
    website: { url: "https://example.com", label: "" },
    legacy: "keep",
  });
  expect(parseLibraryData("award", null)).toMatchObject({
    schemaVersion: 2,
    awarder: "",
  });
  expect(parseLibraryData("certification", { description: "<p>Rich</p>" }).description).toBe(
    "<p>Rich</p>",
  );
});
it("enforces scalar, date, description and strict website limits", () => {
  for (const schema of [educationDataSchema, awardDataSchema, certificationDataSchema]) {
    expect(schema.safeParse({ description: "x".repeat(10001) }).success).toBe(false);
    expect(schema.safeParse({ website: { url: "", label: "", extra: true } }).success).toBe(false);
    expect(schema.safeParse({ website: { url: "x".repeat(2001) } }).success).toBe(false);
    expect(schema.safeParse({ schemaVersion: 1 }).success).toBe(false);
  }
  expect(educationDataSchema.safeParse({ school: "x".repeat(501) }).success).toBe(false);
  expect(educationDataSchema.safeParse({ period: "x".repeat(201) }).success).toBe(false);
  expect(awardDataSchema.safeParse({ date: "x".repeat(201) }).success).toBe(false);
});
