import {
  USER_ACCESS_PERMISSION_KEYS,
  USER_FEATURE_PERMISSION_KEYS,
  USER_PERMISSION_LABELS,
  type UserPermissionKey,
  type UserPermissions,
} from "@shared/types";
import type React from "react";
import { Checkbox } from "@/components/ui/checkbox";

type PermissionTogglesProps = {
  idPrefix: string;
  value: UserPermissions;
  disabled?: boolean;
  onChange: (key: UserPermissionKey, enabled: boolean) => void;
};

const PERMISSION_GROUPS: ReadonlyArray<{
  legend: string;
  keys: readonly UserPermissionKey[];
}> = [
  { legend: "Pages & features", keys: USER_FEATURE_PERMISSION_KEYS },
  { legend: "AI & server access", keys: USER_ACCESS_PERMISSION_KEYS },
];

/** Grouped checkboxes per feature/resource an admin can switch on or off for a user. */
export const PermissionToggles: React.FC<PermissionTogglesProps> = ({
  idPrefix,
  value,
  disabled,
  onChange,
}) => (
  <div className="space-y-3">
    {PERMISSION_GROUPS.map((group) => (
      <fieldset className="space-y-2" key={group.legend}>
        <legend className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {group.legend}
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {group.keys.map((key) => {
            const { label, description } = USER_PERMISSION_LABELS[key];
            const id = `${idPrefix}-${key}`;
            return (
              <div className="flex items-start gap-2" key={key}>
                <Checkbox
                  id={id}
                  checked={value[key]}
                  disabled={disabled}
                  onCheckedChange={(checked) => onChange(key, checked === true)}
                  className="mt-0.5"
                />
                <label htmlFor={id} className="min-w-0 text-sm leading-tight">
                  <span className="font-medium">{label}</span>
                  <span className="block text-xs text-muted-foreground">{description}</span>
                </label>
              </div>
            );
          })}
        </div>
      </fieldset>
    ))}
  </div>
);
