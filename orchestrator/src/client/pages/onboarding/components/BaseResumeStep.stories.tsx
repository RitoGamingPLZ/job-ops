import type { Story } from "@ladle/react";
import { BaseResumeStep } from "./BaseResumeStep";

const baseProps = {
  baseResumeValidation: {
    checked: false,
    hydrated: true,
    valid: false,
    message: null,
  },
  importingResumeFileName: "resume.pdf",
  isBusy: true,
  isImportingResume: true,
  onImportResumeFile: async () => {},
};

export const ResumeUploadingLoader: Story = () => (
  <main className="min-h-[420px] bg-background p-6 text-foreground">
    <section className="mx-auto max-w-4xl">
      <BaseResumeStep {...baseProps} />
    </section>
  </main>
);

ResumeUploadingLoader.storyName = "Resume uploading loader";
