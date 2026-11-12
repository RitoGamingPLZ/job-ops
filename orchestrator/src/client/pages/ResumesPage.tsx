import { listResumes } from "@client/api/cowork";
import type { ResumeListItem } from "@shared/types";
import { Files, Library } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CandidateLibrary } from "@/client/components/cowork/CandidateLibrary";
import { coworkError } from "@/client/components/cowork/DutyLibrary";
import { PageHeader, PageMain } from "@/client/components/layout";
import { getResumeState } from "@/client/lib/pdf-freshness";
import { resumeEditorLocation } from "@/client/lib/resume-opening";
import { Button } from "@/components/ui/button";

export function ResumesPage() {
  const [items, setItems] = useState<ResumeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const navigate = useNavigate();
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly triggers a retry.
  useEffect(() => {
    setLoading(true);
    setError(false);
    let active = true;
    listResumes()
      .then((result) => {
        if (active) setItems(result.resumes);
      })
      .catch((failure) => {
        if (active) {
          setError(true);
          coworkError(failure);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  return (
    <>
      <PageHeader
        icon={Files}
        title="Resumes"
        subtitle="Open a job’s resume to edit it in the editor, or preview its PDF."
        actions={
          <Button variant="outline" asChild>
            <Link to="/resumes/base">Base resume</Link>
          </Button>
        }
      />
      <PageMain>
        {loading ? (
          <output>Loading resumes…</output>
        ) : error ? (
          <div role="alert">
            <p>Could not load resumes</p>
            <Button
              variant="outline"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Retry
            </Button>
          </div>
        ) : items.length ? (
          <div className="overflow-auto">
            <table className="w-full text-sm text-left">
              <thead className="border-b text-muted-foreground">
                <tr>
                  {["Job", "Company", "Stage", "Updated", "PDF"].map((h) => (
                    <th key={h} className="p-3 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.jobId} className="border-b">
                    <td className="p-3">
                      {getResumeState(item) === "available" ? (
                        <Link
                          className="underline underline-offset-4"
                          to={resumeEditorLocation(
                            { kind: "job", jobId: item.jobId },
                            "edit",
                          )}
                        >
                          {item.title}
                        </Link>
                      ) : (
                        item.title
                      )}
                    </td>
                    <td className="p-3">{item.employer}</td>
                    <td className="p-3">{item.stage ?? "—"}</td>
                    <td className="p-3">
                      {new Date(item.updatedAt).toLocaleString()}
                    </td>
                    <td className="p-3">
                      <Button
                        variant="link"
                        className="h-auto p-0"
                        disabled={getResumeState(item) !== "available"}
                        onClick={() =>
                          navigate(
                            resumeEditorLocation(
                              { kind: "job", jobId: item.jobId },
                              "preview",
                            ),
                          )
                        }
                      >
                        Preview PDF
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No resumes yet. Target a job to create its resume.
          </p>
        )}
      </PageMain>
    </>
  );
}
export function ResumeLibraryPage() {
  return (
    <>
      <PageHeader
        icon={Library}
        title="Candidate Library"
        subtitle="Manage your experience, projects, skills, education, awards and certifications."
      />
      <PageMain>
        <CandidateLibrary />
      </PageMain>
    </>
  );
}
