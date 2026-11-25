import type { Story } from "@ladle/react";
import { BaseResumeStep } from "./BaseResumeStep";

const baseProps = {
  baseResumeValidation: {
    checked: false,
    hydrated: true,
    valid: false,
    message: null,
  },
  importingResumeFileName: null,
  isBusy: false,
  isImportingResume: false,
  onImportResumeFile: async () => {},
};

function StoryFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-[420px] bg-background p-3 text-foreground sm:p-6">
      <section className="mx-auto max-w-4xl">{children}</section>
    </main>
  );
}

export const Idle: Story = () => (
  <StoryFrame>
    <BaseResumeStep {...baseProps} />
  </StoryFrame>
);
Idle.storyName = "Idle";

export const ResumeUploadingLoader: Story = () => (
  <StoryFrame>
    <BaseResumeStep
      {...baseProps}
      importingResumeFileName="resume.pdf"
      isBusy={true}
      isImportingResume={true}
    />
  </StoryFrame>
);
ResumeUploadingLoader.storyName = "Resume uploading loader";

export const ValidationError: Story = () => (
  <StoryFrame>
    <BaseResumeStep
      {...baseProps}
      selectedProvider="anthropic"
      baseResumeValidation={{
        checked: true,
        hydrated: true,
        valid: false,
        status: 422,
        message: "Could not parse the uploaded resume. Upload a text-based PDF, DOCX, or TXT file.",
      }}
    />
  </StoryFrame>
);
ValidationError.storyName = "Validation error";

export const Ready: Story = () => (
  <StoryFrame>
    <BaseResumeStep
      {...baseProps}
      selectedProvider="openai"
      baseResumeValidation={{
        checked: true,
        hydrated: true,
        valid: true,
        status: 200,
        message: "Base resume uploaded and parsed cleanly.",
      }}
    />
  </StoryFrame>
);
Ready.storyName = "Ready";
