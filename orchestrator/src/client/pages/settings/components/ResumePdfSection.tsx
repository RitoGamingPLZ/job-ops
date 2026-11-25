import { ResumePdfConfigPanel } from "@client/components/ResumePdfConfigPanel";
import { SettingsSectionFrame } from "@client/pages/settings/components/SettingsSectionFrame";
import type { UpdateSettingsInput } from "@shared/settings-schema.js";
import type {
  PdfPaperSize,
  PdfRenderer,
  ResumeProjectCatalogItem,
  TypstTheme,
} from "@shared/types.js";
import type React from "react";
import { type Path, type PathValue, useFormContext, useWatch } from "react-hook-form";

type ResumePdfSectionProps = {
  profileProjects: ResumeProjectCatalogItem[];
  lockedCount: number;
  maxProjectsTotal: number;
  isProjectsLoading: boolean;
  isLoading: boolean;
  isSaving: boolean;
  layoutMode?: "accordion" | "panel";
};

export const ResumePdfSection: React.FC<ResumePdfSectionProps> = ({
  profileProjects,
  lockedCount,
  maxProjectsTotal,
  isProjectsLoading,
  isLoading,
  isSaving,
  layoutMode,
}) => {
  const {
    control,
    setValue,
    formState: { errors },
  } = useFormContext<UpdateSettingsInput>();

  const pdfRendererValue = (useWatch({
    control,
    name: "pdfRenderer",
  }) ?? "typst") as PdfRenderer;
  const typstThemeValue = (useWatch({
    control,
    name: "typstTheme",
  }) ?? "classic") as TypstTheme;
  const pdfPaperSizeValue = (useWatch({
    control,
    name: "pdfPaperSize",
  }) ?? "auto") as PdfPaperSize;
  const resumeProjectsValue = useWatch({ control, name: "resumeProjects" });
  const setDirtyTouchedValue = <TField extends Path<UpdateSettingsInput>>(
    field: TField,
    value: PathValue<UpdateSettingsInput, TField>,
  ) =>
    setValue(field, value, {
      shouldDirty: true,
      shouldTouch: true,
    });

  return (
    <SettingsSectionFrame mode={layoutMode} title="Resume PDF" value="resume-pdf">
      <ResumePdfConfigPanel
        pdfRenderer={pdfRendererValue}
        onPdfRendererChange={(value) => setDirtyTouchedValue("pdfRenderer", value)}
        pdfRendererError={errors.pdfRenderer?.message as string | undefined}
        typstTheme={typstThemeValue}
        onTypstThemeChange={(value) => setDirtyTouchedValue("typstTheme", value)}
        typstThemeError={errors.typstTheme?.message as string | undefined}
        pdfPaperSize={pdfPaperSizeValue}
        onPdfPaperSizeChange={(value) => setDirtyTouchedValue("pdfPaperSize", value)}
        pdfPaperSizeError={errors.pdfPaperSize?.message as string | undefined}
        disabled={isLoading || isSaving}
        projectSelection={{
          projects: profileProjects,
          value: resumeProjectsValue,
          onChange: (next) => setDirtyTouchedValue("resumeProjects", next),
          lockedCount,
          maxProjectsTotal,
          isProjectsLoading,
          disabled: isLoading || isSaving,
          maxProjectsError: errors.resumeProjects?.maxProjects?.message?.toString(),
        }}
      />
    </SettingsSectionFrame>
  );
};
