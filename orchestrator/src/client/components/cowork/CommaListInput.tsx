import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";

export function CommaListInput({
  value,
  onCommit,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "onBlur"> & {
  value: string[];
  onCommit: (value: string[]) => void;
}) {
  const text = value.join(", ");
  const [draft, setDraft] = useState(text);
  useEffect(() => setDraft(text), [text]);
  return (
    <Input
      {...props}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const values = draft
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
        setDraft(values.join(", "));
        onCommit(values);
      }}
    />
  );
}
