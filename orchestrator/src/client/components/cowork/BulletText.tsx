import { useEffect, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";

/** Grow a textarea to its text: a whole number of lines, so stacked fields stay
 * on the same line grid as the PDF (scrollHeight is rounded to whole pixels). */
export function fitTextarea(element: HTMLTextAreaElement) {
  element.style.height = "auto";
  const style = getComputedStyle(element);
  const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
  const lineHeight = Number.parseFloat(style.lineHeight);
  let content = element.scrollHeight - (padding || 0);
  if (lineHeight > 0) content = Math.round(content / lineHeight) * lineHeight;
  // scrollHeight includes padding, but border-box height needs borders too.
  const borders = element.offsetHeight - element.clientHeight;
  element.style.height = `${content + (padding || 0) + borders}px`;
}

/** Keep typing whitespace locally while the HTML parser normalizes saved bullets. */
export function BulletText({
  value,
  label,
  onChange,
  linked = false,
  readOnly = false,
}: {
  linked?: boolean;
  readOnly?: boolean;
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
      readOnly={readOnly}
      style={{ height: "auto", overflow: "hidden" }}
      ref={(element) => {
        if (element) fitTextarea(element);
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
        if (!draft.trim()) {
          if (linked) {
            setDraft(value);
            emitted.current = value;
          } else onChange("");
        }
      }}
    />
  );
}
