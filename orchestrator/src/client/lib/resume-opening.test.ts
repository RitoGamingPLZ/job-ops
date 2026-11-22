import { describe, expect, it } from "vitest";
import { readResumeEditorMode, resumeEditorLocation } from "./resume-opening";

describe("resume editor entry", () => {
  it.each(["edit", "preview"] as const)("routes job and base identities in %s mode", (mode) => {
    expect(resumeEditorLocation({ kind: "job", jobId: "job /?#" }, mode)).toEqual({
      pathname: "/resumes/job%20%2F%3F%23",
      search: `?mode=${mode}`,
    });
    expect(resumeEditorLocation({ kind: "base" }, mode)).toEqual({
      pathname: "/resumes/base",
      search: `?mode=${mode}`,
    });
    expect(readResumeEditorMode(`?mode=${mode}`)).toBe(mode);
  });
  it.each(["", "?mode=", "?mode=other", "?mode=PREVIEW", "?preview=true"])(
    "keeps preference fallback for %s",
    (search) => expect(readResumeEditorMode(search)).toBeUndefined(),
  );
});
