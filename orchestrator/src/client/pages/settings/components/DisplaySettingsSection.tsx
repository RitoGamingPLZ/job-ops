import { SettingsCheckboxField } from "@client/pages/settings/components/SettingsInput";
import { SettingsSectionFrame } from "@client/pages/settings/components/SettingsSectionFrame";
import type { DisplayValues } from "@client/pages/settings/types";
import type React from "react";
import { Separator } from "@/components/ui/separator";

type DisplaySettingsSectionProps = {
  values: DisplayValues;
  isLoading: boolean;
  isSaving: boolean;
  layoutMode?: "accordion" | "panel";
};

export const DisplaySettingsSection: React.FC<DisplaySettingsSectionProps> = ({
  values,
  isLoading,
  isSaving,
  layoutMode,
}) => {
  const { renderMarkdownInJobDescriptions, autoTailorOnManualImport } = values;

  return (
    <SettingsSectionFrame mode={layoutMode} title="Display Settings" value="display">
      <div className="space-y-4">
        <SettingsCheckboxField
          name="renderMarkdownInJobDescriptions"
          defaultValue={renderMarkdownInJobDescriptions.default}
          label="Render Markdown in job descriptions"
          disabled={isLoading || isSaving}
        >
          Show headings, bold text, lists, and code blocks as formatted content when you expand a
          full job description. Turn this off if you prefer the raw source text.
        </SettingsCheckboxField>

        <Separator />

        <SettingsCheckboxField
          name="autoTailorOnManualImport"
          defaultValue={autoTailorOnManualImport.default}
          label="Auto-tailor manually imported jobs"
          disabled={isLoading || isSaving}
        >
          When enabled, jobs added via Manual Import are immediately scored and have a tailored
          resume PDF generated. Turn off to save LLM tokens and tailor later from the job detail
          view. You can override this per import in the review step.
        </SettingsCheckboxField>

        <Separator />

        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <div className="text-xs text-muted-foreground">Markdown rendering effective</div>
            <div className="break-words font-mono text-xs">
              {renderMarkdownInJobDescriptions.effective ? "Enabled" : "Disabled"}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Markdown rendering default</div>
            <div className="break-words font-mono text-xs font-semibold">
              {renderMarkdownInJobDescriptions.default ? "Enabled" : "Disabled"}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Auto-tailor on import effective</div>
            <div className="break-words font-mono text-xs">
              {autoTailorOnManualImport.effective ? "Enabled" : "Disabled"}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Auto-tailor on import default</div>
            <div className="break-words font-mono text-xs font-semibold">
              {autoTailorOnManualImport.default ? "Enabled" : "Disabled"}
            </div>
          </div>
        </div>
      </div>
    </SettingsSectionFrame>
  );
};
