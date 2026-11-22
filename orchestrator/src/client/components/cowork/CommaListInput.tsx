import { useEffect, useRef, useState } from "react";
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
  "data-library-changed"?: string;
}) {
  const text = value.join(", ");
  const [draft, setDraft] = useState(text);
  const dirty = useRef(false);
  useEffect(() => {
    setDraft(text);
    dirty.current = false;
  }, [text]);
  const pending = useRef({ draft, text, onCommit });
  pending.current = { draft, text, onCommit };
  useEffect(
    () => () => {
      const latest = pending.current;
      if (dirty.current)
        latest.onCommit(
          latest.draft
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
        );
    },
    [],
  );
  const commit = () => {
    dirty.current = false;
    const values = draft
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const normalized = values.join(", ");
    pending.current = { draft: normalized, text: normalized, onCommit };
    setDraft(normalized);
    onCommit(values);
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement & HTMLTextAreaElement>) => {
    props.onKeyDown?.(event);
    if (event.key === "Enter" && !event.defaultPrevented && !event.nativeEvent.isComposing) {
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
        title={props.title}
        data-library-changed={props["data-library-changed"]}
        style={{ height: "auto", overflow: "hidden" }}
        ref={(element) => {
          if (element) fitTextarea(element);
        }}
        value={draft}
        onChange={(event) => {
          dirty.current = true;
          setDraft(event.target.value);
        }}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
    );
  return (
    <Input
      {...props}
      value={draft}
      onChange={(event) => {
        dirty.current = true;
        setDraft(event.target.value);
      }}
      onBlur={commit}
      onKeyDown={onKeyDown}
    />
  );
}
