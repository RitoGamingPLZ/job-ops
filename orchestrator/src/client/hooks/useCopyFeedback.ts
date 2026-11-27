import { useCallback, useEffect, useRef, useState } from "react";

export function useCopyFeedback<T>(durationMs: number) {
  const [copied, setCopied] = useState<T | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const clearTimer = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const clearCopied = useCallback(() => {
    clearTimer();
    setCopied(null);
  }, [clearTimer]);

  const markCopied = useCallback(
    (value: T) => {
      clearTimer();
      setCopied(value);
      timer.current = window.setTimeout(clearCopied, durationMs);
    },
    [clearCopied, clearTimer, durationMs],
  );

  return { copied, clearCopied, markCopied };
}
