import {
  USER_PERMISSION_KEYS,
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

/** One labelled checkbox per feature an admin can switch on or off for a user. */
export const PermissionToggles: React.FC<PermissionTogglesProps> = ({
  idPrefix,
  value,
  disabled,
  onChange,
}) => (
  <div className="grid gap-2 sm:grid-cols-2">
    {USER_PERMISSION_KEYS.map((key) => {
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
);
