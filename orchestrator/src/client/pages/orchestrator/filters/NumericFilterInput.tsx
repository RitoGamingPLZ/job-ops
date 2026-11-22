import type React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function NumericFilterInput(props: {
  id: string;
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  normalize: (parsed: number) => number | null;
  placeholder: string;
  min?: number;
  max?: number;
}): React.JSX.Element {
  const { id, label, value, onChange, normalize, placeholder, min, max } = props;
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value == null ? "" : String(value)}
        onChange={(event) => {
          const parsed = Number.parseInt(event.target.value.trim(), 10);
          onChange(Number.isFinite(parsed) ? normalize(parsed) : null);
        }}
        inputMode="numeric"
        min={min}
        max={max}
        placeholder={placeholder}
      />
    </div>
  );
}
