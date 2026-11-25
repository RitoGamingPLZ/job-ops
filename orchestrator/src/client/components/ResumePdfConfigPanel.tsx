import {
  toggleAiSelectable,
  toggleMustInclude,
} from "@client/pages/settings/resume-projects-state";
import type { ResumeProjectsSettingsInput } from "@shared/settings-schema.js";
import {
  PDF_PAPER_SIZE_LABELS,
  PDF_PAPER_SIZE_VALUES,
  PDF_RENDERER_LABELS,
  PDF_RENDERER_VALUES,
  type PdfPaperSize,
  type PdfRenderer,
  type ResumeProjectCatalogItem,
  TYPST_THEME_LABELS,
  TYPST_THEME_VALUES,
  type TypstTheme,
} from "@shared/types.js";
import type React from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { clampInt } from "@/lib/utils";

type ProjectSelectionConfig = {
  projects: ResumeProjectCatalogItem[];
  value: ResumeProjectsSettingsInput | null | undefined;
  onChange: (next: ResumeProjectsSettingsInput) => void;
  lockedCount: number;
  maxProjectsTotal: number;
  isProjectsLoading: boolean;
  disabled: boolean;
  maxProjectsError?: string;
};

type ResumePdfConfigPanelProps = {
  pdfRenderer: PdfRenderer;
  onPdfRendererChange: (renderer: PdfRenderer) => void;
  pdfRendererError?: string;
  typstTheme: TypstTheme;
  onTypstThemeChange: (theme: TypstTheme) => void;
  typstThemeError?: string;
  pdfPaperSize: PdfPaperSize;
  onPdfPaperSizeChange: (paperSize: PdfPaperSize) => void;
  pdfPaperSizeError?: string;
  disabled?: boolean;
  intro?: {
    title: string;
    description?: string;
  };
  projectSelection?: ProjectSelectionConfig;
};

export const ResumePdfConfigPanel: React.FC<ResumePdfConfigPanelProps> = ({
  pdfRenderer,
  onPdfRendererChange,
  pdfRendererError,
  typstTheme,
  onTypstThemeChange,
  typstThemeError,
  pdfPaperSize,
  onPdfPaperSizeChange,
  pdfPaperSizeError,
  disabled = false,
  intro,
  projectSelection,
}) => {
  const hasProjectCatalog = Boolean(projectSelection?.projects.length);
  const canShowProjectSelection = Boolean(projectSelection && hasProjectCatalog);

  const rendererHelperText: Record<PdfRenderer, string> = {
    latex:
      "LaTeX renders PDFs locally with Jake's template and requires tectonic on the JobOps host.",
    typst: "Typst renders PDFs locally and supports selectable resume themes.",
  };

  const rendererDefaultPaperSizeText: Record<PdfRenderer, string> = {
    latex: "Renderer default is US Letter for the LaTeX template.",
    typst: "Renderer default is A4 for Typst themes.",
  };

  return (
    <div className="space-y-4">
      {intro ? (
        <div>
          <p className="text-sm font-semibold">{intro.title}</p>
          {intro.description ? (
            <p className="text-xs text-muted-foreground">{intro.description}</p>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-2">
        <label htmlFor="pdfRenderer" className="text-sm font-medium">
          PDF renderer
        </label>
        <Select
          value={pdfRenderer}
          onValueChange={(value) => onPdfRendererChange(value as PdfRenderer)}
          disabled={disabled}
        >
          <SelectTrigger id="pdfRenderer">
            <SelectValue placeholder="Choose PDF renderer" />
          </SelectTrigger>
          <SelectContent>
            {PDF_RENDERER_VALUES.map((value) => (
              <SelectItem key={value} value={value}>
                {PDF_RENDERER_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {pdfRendererError ? <p className="text-xs text-destructive">{pdfRendererError}</p> : null}
        <p className="text-xs text-muted-foreground">{rendererHelperText[pdfRenderer]}</p>
      </div>

      {pdfRenderer === "typst" ? (
        <div className="space-y-2">
          <label htmlFor="typstTheme" className="text-sm font-medium">
            Typst theme
          </label>
          <Select
            value={typstTheme}
            onValueChange={(value) => onTypstThemeChange(value as TypstTheme)}
            disabled={disabled}
          >
            <SelectTrigger id="typstTheme">
              <SelectValue placeholder="Choose Typst theme" />
            </SelectTrigger>
            <SelectContent>
              {TYPST_THEME_VALUES.map((value) => (
                <SelectItem key={value} value={value}>
                  {TYPST_THEME_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {typstThemeError ? <p className="text-xs text-destructive">{typstThemeError}</p> : null}
          <p className="text-xs text-muted-foreground">
            Classic mirrors the current resume density; Compact fits more content on the page.
          </p>
        </div>
      ) : null}

      <div className="space-y-2">
        <label htmlFor="pdfPaperSize" className="text-sm font-medium">
          Paper size
        </label>
        <Select
          value={pdfPaperSize}
          onValueChange={(value) => onPdfPaperSizeChange(value as PdfPaperSize)}
          disabled={disabled}
        >
          <SelectTrigger id="pdfPaperSize">
            <SelectValue placeholder="Choose paper size" />
          </SelectTrigger>
          <SelectContent>
            {PDF_PAPER_SIZE_VALUES.map((value) => (
              <SelectItem key={value} value={value}>
                {PDF_PAPER_SIZE_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {pdfPaperSizeError ? <p className="text-xs text-destructive">{pdfPaperSizeError}</p> : null}
        <p className="text-xs text-muted-foreground">{rendererDefaultPaperSizeText[pdfRenderer]}</p>
      </div>

      {projectSelection ? (
        <>
          <Separator />

          {!canShowProjectSelection ? (
            <div className="rounded-md border border-dashed border-muted-foreground/40 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
              No resume projects were found. Add projects to your active resume to configure
              automatic project selection.
            </div>
          ) : (
            <div className="space-y-4">
              {projectSelection.isProjectsLoading ? (
                <div className="rounded-md border border-dashed border-muted-foreground/40 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                  Loading resume projects...
                </div>
              ) : !hasProjectCatalog ? (
                <div className="rounded-md border border-dashed border-muted-foreground/40 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                  No resume projects were found. Add projects to your active resume to configure
                  automatic project selection.
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <div className="text-sm font-medium">Max projects to choose</div>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={projectSelection.lockedCount}
                      max={projectSelection.maxProjectsTotal}
                      value={projectSelection.value?.maxProjects ?? 0}
                      onChange={(event) => {
                        if (!projectSelection.value) return;
                        const next = Number(event.target.value);
                        const clamped = clampInt(
                          next,
                          projectSelection.lockedCount,
                          projectSelection.maxProjectsTotal,
                        );
                        projectSelection.onChange({
                          ...projectSelection.value,
                          maxProjects: clamped,
                        });
                      }}
                      disabled={
                        projectSelection.disabled ||
                        projectSelection.isProjectsLoading ||
                        !projectSelection.value
                      }
                    />
                    {projectSelection.maxProjectsError ? (
                      <p className="text-xs text-destructive">
                        {projectSelection.maxProjectsError}
                      </p>
                    ) : null}
                  </div>

                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs whitespace-wrap sm:whitespace-nowrap">
                          Project
                        </TableHead>
                        <TableHead className="text-xs whitespace-wrap sm:whitespace-nowrap">
                          Visible in template
                        </TableHead>
                        <TableHead className="text-xs whitespace-wrap sm:whitespace-nowrap">
                          Must include
                        </TableHead>
                        <TableHead className="text-xs whitespace-wrap sm:whitespace-nowrap">
                          AI can select
                        </TableHead>
                      </TableRow>
                    </TableHeader>

                    <TableBody>
                      {projectSelection.projects.map((project) => {
                        const value = projectSelection.value;
                        const locked = Boolean(value?.lockedProjectIds.includes(project.id));
                        const aiSelectable = Boolean(
                          value?.aiSelectableProjectIds.includes(project.id),
                        );
                        const projectMeta = project.date;

                        return (
                          <TableRow key={project.id}>
                            <TableCell>
                              <div className="space-y-0.5">
                                <div className="font-medium">{project.name}</div>
                                {projectMeta ? (
                                  <div className="text-xs text-muted-foreground">{projectMeta}</div>
                                ) : null}
                              </div>
                            </TableCell>
                            <TableCell>{project.isVisibleInBase ? "Yes" : "No"}</TableCell>
                            <TableCell>
                              <Checkbox
                                checked={locked}
                                onCheckedChange={() => {
                                  if (!value) return;
                                  projectSelection.onChange(
                                    toggleMustInclude({
                                      settings: value,
                                      projectId: project.id,
                                      checked: !locked,
                                      maxProjectsTotal: projectSelection.maxProjectsTotal,
                                    }),
                                  );
                                }}
                                disabled={
                                  projectSelection.disabled ||
                                  projectSelection.isProjectsLoading ||
                                  !value
                                }
                              />
                            </TableCell>
                            <TableCell>
                              <Checkbox
                                checked={locked ? true : aiSelectable}
                                onCheckedChange={() => {
                                  if (!value) return;
                                  projectSelection.onChange(
                                    toggleAiSelectable({
                                      settings: value,
                                      projectId: project.id,
                                      checked: !aiSelectable,
                                    }),
                                  );
                                }}
                                disabled={
                                  projectSelection.disabled ||
                                  projectSelection.isProjectsLoading ||
                                  locked ||
                                  !value
                                }
                              />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </>
              )}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
};
