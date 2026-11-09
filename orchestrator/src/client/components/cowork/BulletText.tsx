import { useEffect, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";

/** Keep typing whitespace locally while the HTML parser normalizes saved bullets. */
export function BulletText({
  value,
  label,
  onChange,
}: {
  value: string;
  label: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const emitted = useRef(value);
  useEffect(() => {
    if (value !== emitted.current) {
      setDraft(value);
      emitted.current = value;
    }
  }, [value]);
  return (
    <Textarea
      rows={1}
      style={{ height: "auto" }}
      ref={(element) => {
        if (element) {
          element.style.height = "auto";
          element.style.height = `${element.scrollHeight}px`;
        }
      }}
      aria-label={label}
      value={draft}
      onChange={(event) => {
        const text = event.target.value;
        setDraft(text);
        if (text.trim()) {
          emitted.current = text.replace(/[ \t]+/g, " ").trim();
          onChange(text);
        }
      }}
      onBlur={() => {
        if (!draft.trim()) onChange("");
      }}
    />
  );
}
