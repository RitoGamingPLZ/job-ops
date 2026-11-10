import { createJob } from "@shared/testing/factories.js";
import { fireEvent, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { renderWithQueryClient } from "@/client/test/renderWithQueryClient";
import { JobDocumentsPanel } from "./JobDocumentsPanel";

vi.mock("@client/api", () => ({
  getJobDocuments: vi.fn().mockResolvedValue([]),
}));
it.each([
  false,
  true,
])("exposes the editor and PDF preview (uploaded: %s)", (uploaded) => {
  const preview = vi.fn();
  renderWithQueryClient(
    <MemoryRouter>
      <JobDocumentsPanel
        job={createJob({
          pdfPath: uploaded ? "uploaded.pdf" : null,
          pdfSource: uploaded ? "uploaded" : "generated",
          pdfFreshness: uploaded ? "uploaded" : "missing",
        })}
        isStalePdf={false}
        isUploadingPdf={false}
        pdfActionsDisabled={false}
        pdfRegeneratingReason={null}
        pdfViewLabel="Preview PDF"
        pdfDownloadLabel="Download PDF"
        stalePdfMessage=""
        onUploadPdf={vi.fn()}
        onViewPdf={preview}
        onDownloadPdf={vi.fn()}
      />
    </MemoryRouter>,
  );
  expect(screen.getAllByRole("link", { name: "Open resume" })).toHaveLength(1);
  expect(screen.getByRole("link", { name: "Open resume" })).toHaveAttribute(
    "href",
    "/resumes/job-1",
  );
  expect(document.querySelector('a[href*="inspector=tailoring"]')).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Preview PDF" }));
  expect(preview).toHaveBeenCalledOnce();
  if (uploaded)
    expect(
      screen.getByText("Uploaded PDF (not from the editor)"),
    ).toBeVisible();
});
