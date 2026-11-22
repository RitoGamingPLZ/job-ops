import { TokenizedInput } from "@client/pages/orchestrator/TokenizedInput";
import {
  SettingsCheckboxField,
  SettingsEffectiveDefault,
  SettingsInput,
} from "@client/pages/settings/components/SettingsInput";
import { SettingsSectionFrame } from "@client/pages/settings/components/SettingsSectionFrame";
import type { ScoringValues } from "@client/pages/settings/types";
import type { UpdateSettingsInput } from "@shared/settings-schema.js";
import type React from "react";
import { useState } from "react";
import { Controller, useFormContext } from "react-hook-form";
import { Separator } from "@/components/ui/separator";

type ScoringSettingsSectionProps = {
  values: ScoringValues;
  isLoading: boolean;
  isSaving: boolean;
  layoutMode?: "accordion" | "panel";
};

function parseTokenizedKeywordInput(input: string): string[] {
  return input
    .split(/[\n,]/g)
    .map((value) => value.trim())
    .filter(Boolean);
}

export const ScoringSettingsSection: React.FC<ScoringSettingsSectionProps> = ({
  values,
  isLoading,
  isSaving,
  layoutMode,
}) => {
  const {
    penalizeMissingSalary,
    missingSalaryPenalty,
    autoSkipScoreThreshold,
    blockedCompanyKeywords,
  } = values;
  const { control, watch, setValue } = useFormContext<UpdateSettingsInput>();
  const [blockedCompanyKeywordDraft, setBlockedCompanyKeywordDraft] = useState("");

  // Watch the current form value to conditionally show/hide penalty input
  const currentPenalizeEnabled = watch("penalizeMissingSalary") ?? penalizeMissingSalary.default;

  // Watch auto-skip threshold to show current value
  const currentAutoSkipThreshold = watch("autoSkipScoreThreshold");
  const blockedCompanyKeywordValues =
    watch("blockedCompanyKeywords") ?? blockedCompanyKeywords.default;

  return (
    <SettingsSectionFrame mode={layoutMode} title="Scoring Settings" value="scoring">
      <div className="space-y-4">
        {/* Enable penalty toggle */}
        <SettingsCheckboxField
          name="penalizeMissingSalary"
          defaultValue={penalizeMissingSalary.default}
          label="Penalize Missing Salary"
          disabled={isLoading || isSaving}
        >
          Reduce suitability scores for jobs that do not include salary information. Jobs with any
          salary text (including "Competitive") are not penalized.
        </SettingsCheckboxField>

        {/* Penalty amount input - only shown when enabled */}
        {currentPenalizeEnabled && (
          <div className="pl-7">
            <Controller
              name="missingSalaryPenalty"
              control={control}
              render={({ field }) => (
                <SettingsInput
                  label="Penalty Amount"
                  type="number"
                  inputProps={{
                    ...field,
                    inputMode: "numeric",
                    min: 0,
                    max: 100,
                    step: 1,
                    value: field.value ?? missingSalaryPenalty.default,
                    onChange: (event) => {
                      const value = parseInt(event.target.value, 10);
                      if (Number.isNaN(value)) {
                        field.onChange(null);
                      } else {
                        field.onChange(Math.min(100, Math.max(0, value)));
                      }
                    },
                  }}
                  disabled={isLoading || isSaving}
                  helper={`Points to subtract from suitability score (0-100). Default: ${missingSalaryPenalty.default}.`}
                  current={`Effective: ${missingSalaryPenalty.effective} | Default: ${missingSalaryPenalty.default}`}
                />
              )}
            />
          </div>
        )}

        <Separator />

        {/* Auto-skip threshold input */}
        <div className="space-y-3">
          <Controller
            name="autoSkipScoreThreshold"
            control={control}
            render={({ field }) => (
              <SettingsInput
                label="Auto-skip Score Threshold"
                type="number"
                inputProps={{
                  ...field,
                  inputMode: "numeric",
                  min: 0,
                  max: 100,
                  step: 1,
                  value: field.value ?? "",
                  onChange: (event) => {
                    const value = event.target.value;
                    if (value === "" || value === null) {
                      field.onChange(null);
                    } else {
                      const parsed = parseInt(value, 10);
                      if (Number.isNaN(parsed)) {
                        field.onChange(null);
                      } else {
                        field.onChange(Math.min(100, Math.max(0, parsed)));
                      }
                    }
                  },
                  placeholder: "Disabled",
                }}
                disabled={isLoading || isSaving}
                helper="Jobs scoring below this threshold will be automatically skipped during scoring. Leave empty to disable auto-skip. (0-100)"
                current={`Effective: ${currentAutoSkipThreshold === null || currentAutoSkipThreshold === undefined ? "Disabled" : currentAutoSkipThreshold} | Default: ${autoSkipScoreThreshold.default ?? "Disabled"}`}
              />
            )}
          />
        </div>

        <div className="space-y-3">
          <label htmlFor="blocked-company-keywords" className="text-sm font-medium leading-none">
            Blocked Company Keywords
          </label>
          <TokenizedInput
            id="blocked-company-keywords"
            values={blockedCompanyKeywordValues}
            draft={blockedCompanyKeywordDraft}
            parseInput={parseTokenizedKeywordInput}
            onDraftChange={setBlockedCompanyKeywordDraft}
            onValuesChange={(value) =>
              setValue("blockedCompanyKeywords", value, { shouldDirty: true })
            }
            placeholder='e.g. "recruitment", "staffing"'
            helperText="Jobs whose company name contains one of these keywords will be dropped during discovery."
            removeLabelPrefix="Remove blocked keyword"
            disabled={isLoading || isSaving}
          />
          <div className="break-words font-mono text-xs text-muted-foreground">
            Effective:{" "}
            {blockedCompanyKeywordValues.length > 0
              ? blockedCompanyKeywordValues.join(", ")
              : "None"}{" "}
            | Default:{" "}
            {blockedCompanyKeywords.default.length > 0
              ? blockedCompanyKeywords.default.join(", ")
              : "None"}
          </div>
        </div>

        <Separator />

        {/* Effective/Default values display */}
        <div className="grid gap-2 text-sm sm:grid-cols-2">
          <SettingsEffectiveDefault
            label="Penalty Enabled"
            effective={penalizeMissingSalary.effective ? "Yes" : "No"}
            defaultValue={penalizeMissingSalary.default ? "Yes" : "No"}
          />
          <SettingsEffectiveDefault
            label="Penalty Amount"
            effective={missingSalaryPenalty.effective}
            defaultValue={missingSalaryPenalty.default}
          />
          <SettingsEffectiveDefault
            label="Auto-skip Threshold"
            effective={autoSkipScoreThreshold.effective ?? "Disabled"}
            defaultValue={autoSkipScoreThreshold.default ?? "Disabled"}
          />
        </div>
      </div>
    </SettingsSectionFrame>
  );
};
