import type { ExperienceBullet } from "@shared/types";

export function ResumeWordingReview({
  current,
  proposed,
  sourceIds = [],
  library,
}: {
  current: string;
  proposed: string;
  sourceIds?: string[];
  library: ExperienceBullet[];
}) {
  return (
    <dl className="space-y-2 text-sm">
      {sourceIds.map((id) => {
        const source = library.find((item) => item.id === id && item.kind !== "contact");
        const parent = source?.parentId && library.find((item) => item.id === source.parentId);
        return (
          <div key={id}>
            <dt className="font-medium">Library evidence{parent ? ` · ${parent.text}` : ""}</dt>
            <dd>{source?.text ?? "Source no longer available"}</dd>
          </div>
        );
      })}
      <div>
        <dt className="font-medium">Current resume wording</dt>
        <dd>
          <del className="resume-deletion">{current || "(empty)"}</del>
        </dd>
      </div>
      <div>
        <dt className="font-medium">Proposed wording</dt>
        <dd>
          <mark className="resume-insertion">{proposed || "(empty)"}</mark>
        </dd>
      </div>
    </dl>
  );
}
