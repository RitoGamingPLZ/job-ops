export type ResumeEditorMode = "edit" | "preview";
export type ResumeEditorTarget = { kind: "job"; jobId: string } | { kind: "base" };

export function resumeEditorLocation(
  target: ResumeEditorTarget,
  mode: ResumeEditorMode,
): { pathname: string; search: string } {
  return {
    pathname:
      target.kind === "base" ? "/resumes/base" : `/resumes/${encodeURIComponent(target.jobId)}`,
    search: `?mode=${mode}`,
  };
}

export function readResumeEditorMode(search: string): ResumeEditorMode | undefined {
  const mode = new URLSearchParams(search).get("mode");
  return mode === "edit" || mode === "preview" ? mode : undefined;
}
