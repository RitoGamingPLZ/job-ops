import { listResumes } from "@client/api/cowork";
import type { ResumeListItem } from "@shared/types";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  coworkError,
  DutyLibrary,
} from "@/client/components/cowork/DutyLibrary";
import { Button } from "@/components/ui/button";

export function ResumesPage() {
  const [items, setItems] = useState<ResumeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    listResumes()
      .then((result) => {
        if (active) setItems(result.resumes);
      })
      .catch(coworkError)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <main className="mx-auto max-w-6xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Resumes</h1>
        <Button variant="outline" asChild>
          <Link to="/resumes/library">Duty library</Link>
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Open a job’s resume to co-work on its content.
      </p>
      {loading ? (
        <output>Loading resumes…</output>
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
                    <Link
                      className="underline underline-offset-4"
                      to={`/resumes/${item.jobId}`}
                    >
                      {item.title}
                    </Link>
                  </td>
                  <td className="p-3">{item.employer}</td>
                  <td className="p-3">{item.stage ?? "—"}</td>
                  <td className="p-3">
                    {new Date(item.updatedAt).toLocaleString()}
                  </td>
                  <td className="p-3">{item.hasPdf ? "Ready" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No job resumes yet. Open a Targeted job and choose Co-work.
        </p>
      )}
    </main>
  );
}
export function ResumeLibraryPage() {
  return (
    <main className="mx-auto max-w-4xl p-6 space-y-6">
      <Link to="/resumes" className="text-sm underline">
        ← Resumes
      </Link>
      <h1 className="text-2xl font-semibold">Duty library</h1>
      <p className="text-sm text-muted-foreground">
        Reusable achievements and duties for your job resumes.
      </p>
      <DutyLibrary />
    </main>
  );
}
