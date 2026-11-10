import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { fitTextarea } from "./BulletText";

export function CommaListInput({
  value,
  onCommit,
  multiline,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "onBlur"> & {
  value: string[];
  onCommit: (value: string[]) => void;
  /** Wrap long lists onto more lines, like the printed resume. */
  multiline?: boolean;
}) {
  const text = value.join(", ");
  const [draft, setDraft] = useState(text);
  useEffect(() => setDraft(text), [text]);
  const commit = () => {
    const values = draft
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    setDraft(values.join(", "));
    onCommit(values);
  };
  const onKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement & HTMLTextAreaElement>,
  ) => {
    props.onKeyDown?.(event);
    if (
      event.key === "Enter" &&
      !event.defaultPrevented &&
      !event.nativeEvent.isComposing
    ) {
      if (multiline) event.preventDefault();
      commit();
    }
  };
  if (multiline)
    return (
      <Textarea
        rows={1}
        aria-label={props["aria-label"]}
        className={props.className}
        style={{ height: "auto", overflow: "hidden" }}
        ref={(element) => {
          if (element) fitTextarea(element);
        }}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
    );
  return (
    <Input
      {...props}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
    />
  );
}
