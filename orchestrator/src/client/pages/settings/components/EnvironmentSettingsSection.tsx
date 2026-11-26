import { ConnectedAccountsSection } from "@client/pages/settings/components/ConnectedAccountsSection";
import { SettingsInput } from "@client/pages/settings/components/SettingsInput";
import { SettingsSectionFrame } from "@client/pages/settings/components/SettingsSectionFrame";
import type { EnvSettingsValues } from "@client/pages/settings/types";
import { formatSecretHint } from "@client/pages/settings/utils";
import type { UpdateSettingsInput } from "@shared/settings-schema.js";
import type React from "react";
import { useFormContext } from "react-hook-form";
import { Separator } from "@/components/ui/separator";

type EnvironmentSettingsSectionProps = {
  values: EnvSettingsValues;
  isLoading: boolean;
  isSaving: boolean;
  layoutMode?: "accordion" | "panel";
};

export const EnvironmentSettingsSection: React.FC<EnvironmentSettingsSectionProps> = ({
  values,
  isLoading,
  isSaving,
  layoutMode,
}) => {
  const {
    register,
    formState: { errors },
  } = useFormContext<UpdateSettingsInput>();
  const { private: privateValues } = values;

  return (
    <SettingsSectionFrame mode={layoutMode} title="Environment & Workspaces" value="environment">
      <div className="space-y-8">
        <div className="space-y-6">
          <div className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Service Accounts
          </div>

          <div className="space-y-4">
            <div className="text-sm font-semibold">Adzuna</div>
            <div className="grid gap-4 md:grid-cols-2">
              <SettingsInput
                label="App ID"
                inputProps={register("adzunaAppId")}
                placeholder="your-app-id"
                disabled={isLoading || isSaving}
                error={errors.adzunaAppId?.message as string | undefined}
              />
              <SettingsInput
                label="App Key"
                inputProps={register("adzunaAppKey")}
                type="password"
                placeholder="Enter new app key"
                disabled={isLoading || isSaving}
                error={errors.adzunaAppKey?.message as string | undefined}
                current={formatSecretHint(privateValues.adzunaAppKeyHint)}
              />
            </div>
          </div>
        </div>

        <Separator />

        <div className="space-y-4">
          <div className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Security
          </div>
          <ConnectedAccountsSection />
        </div>
      </div>
    </SettingsSectionFrame>
  );
};
