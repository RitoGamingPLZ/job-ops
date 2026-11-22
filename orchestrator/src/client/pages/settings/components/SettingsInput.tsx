import type { UpdateSettingsInput } from "@shared/settings-schema.js";
import type React from "react";
import { Controller, useFormContext } from "react-hook-form";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

type SettingsInputProps = {
  label: string;
  inputProps: React.InputHTMLAttributes<HTMLInputElement>;
  placeholder?: string;
  type?: React.HTMLInputTypeAttribute;
  disabled?: boolean;
  error?: string;
  helper?: React.ReactNode;
  current?: string;
};

export const SettingsInput: React.FC<SettingsInputProps> = ({
  label,
  inputProps,
  placeholder,
  type = "text",
  disabled,
  error,
  helper,
  current,
}) => {
  const id = inputProps.id || inputProps.name;

  return (
    <div className="space-y-2">
      {label && (
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
      )}
      <Input {...inputProps} id={id} type={type} placeholder={placeholder} disabled={disabled} />
      {error && <p className="text-xs text-destructive">{error}</p>}
      {current && <div className="text-xs text-muted-foreground">{current}</div>}
      {helper && <div className="text-xs text-muted-foreground">{helper}</div>}
    </div>
  );
};

type BooleanSettingName = {
  [K in keyof UpdateSettingsInput]-?: NonNullable<UpdateSettingsInput[K]> extends boolean
    ? K
    : never;
}[keyof UpdateSettingsInput];

type SettingsCheckboxFieldProps = {
  name: BooleanSettingName;
  defaultValue: boolean;
  label: string;
  disabled: boolean;
  children: React.ReactNode;
};

/** Checkbox bound to a boolean setting; unset falls back to the default, indeterminate clears it. */
export const SettingsCheckboxField: React.FC<SettingsCheckboxFieldProps> = ({
  name,
  defaultValue,
  label,
  disabled,
  children,
}) => {
  const { control } = useFormContext<UpdateSettingsInput>();
  return (
    <div className="flex items-start space-x-3">
      <Controller
        name={name}
        control={control}
        render={({ field }) => (
          <Checkbox
            id={name}
            checked={(field.value as boolean | null | undefined) ?? defaultValue}
            onCheckedChange={(checked) => {
              field.onChange(checked === "indeterminate" ? null : checked === true);
            }}
            disabled={disabled}
          />
        )}
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor={name} className="cursor-pointer text-sm font-medium leading-none">
          {label}
        </label>
        <p className="text-xs text-muted-foreground">{children}</p>
      </div>
    </div>
  );
};

type SettingsEffectiveDefaultProps = {
  label: string;
  effective: React.ReactNode;
  defaultValue: React.ReactNode;
};

export const SettingsEffectiveDefault: React.FC<SettingsEffectiveDefaultProps> = ({
  label,
  effective,
  defaultValue,
}) => (
  <div>
    <div className="text-xs text-muted-foreground">{label}</div>
    <div className="break-words font-mono text-xs">
      Effective: {effective} | Default: {defaultValue}
    </div>
  </div>
);
