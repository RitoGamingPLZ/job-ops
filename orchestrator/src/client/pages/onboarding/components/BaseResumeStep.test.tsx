import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BaseResumeStep } from "./BaseResumeStep";

const defaultProps = {
  baseResumeValidation: {
    checked: false,
    hydrated: true,
    valid: false,
    message: null,
  },
  importingResumeFileName: null,
  isBusy: false,
  isImportingResume: false,
  onImportResumeFile: vi.fn(),
};

describe("BaseResumeStep", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows optimistic resume import progress while a file import is running", () => {
    vi.useFakeTimers();

    render(
      <BaseResumeStep
        {...defaultProps}
        importingResumeFileName="resume.pdf"
        isBusy
        isImportingResume
      />,
    );

    expect(screen.getByText("Importing resume")).toBeInTheDocument();
    expect(screen.getByText("resume.pdf")).toBeInTheDocument();
    expect(screen.getAllByText("Reading file")).toHaveLength(1);
    expect(screen.queryByText("Preparing import")).not.toBeInTheDocument();
    expect(screen.queryByText("Extracting resume text")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /upload resume file/i })).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(25_000);
    });

    expect(screen.getByText("96%")).toBeInTheDocument();
    expect(
      screen.getByText("Still working. Larger PDFs and DOCX files can take a little longer."),
    ).toBeInTheDocument();
  });

  it("uses a longer optimistic import profile for Codex", () => {
    vi.useFakeTimers();

    render(
      <BaseResumeStep
        {...defaultProps}
        importingResumeFileName="resume.pdf"
        isBusy
        isImportingResume
        selectedProvider="codex"
      />,
    );

    act(() => {
      vi.advanceTimersByTime(25_000);
    });

    expect(screen.getByText("40%")).toBeInTheDocument();
    expect(
      screen.queryByText("Still working. Larger PDFs and DOCX files can take a little longer."),
    ).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(35_000);
    });

    expect(screen.getByText("96%")).toBeInTheDocument();
    expect(
      screen.getByText("Still working. Codex imports can take around a minute for larger resumes."),
    ).toBeInTheDocument();
  });

  it("offers a single resume upload with the supported formats", () => {
    render(<BaseResumeStep {...defaultProps} />);

    expect(screen.getByText("Upload a resume file")).toBeInTheDocument();
    expect(screen.getByText("Supported formats: PDF, DOCX, and resume JSON.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /upload resume file/i })).toBeInTheDocument();
    expect(screen.queryByText(/Reactive Resume/i)).not.toBeInTheDocument();
  });
});
