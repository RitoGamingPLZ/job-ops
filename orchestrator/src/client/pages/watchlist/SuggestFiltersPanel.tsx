import { suggestWatchlistFilters } from "@client/api/watchlist";
import type { Suggestion } from "@server/watchlist/autofilter/types";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

interface SuggestFiltersPanelProps {
  sourceType: string;
  careersUrl: string;
  label: string;
  onUse: (url: string) => void;
}

export function SuggestFiltersPanel({
  sourceType,
  careersUrl,
  label,
  onUse,
}: SuggestFiltersPanelProps) {
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const request = useRef(0);

  // An answer belongs to the URL/type it was requested for, including while
  // the user edits a source or removes its card before the request completes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reset request state whenever the source identity changes.
  useEffect(() => {
    setSuggestion(null);
    setError(null);
    setLoading(false);
    return () => {
      request.current += 1;
    };
  }, [sourceType, careersUrl]);

  async function suggest() {
    const currentRequest = ++request.current;
    setLoading(true);
    setError(null);
    setSuggestion(null);
    try {
      const result = await suggestWatchlistFilters({
        sourceType,
        careersUrl,
        label,
      });
      if (currentRequest === request.current) setSuggestion(result);
    } catch (error) {
      if (currentRequest === request.current) {
        setError(
          error instanceof Error ? error.message : "Could not suggest filters.",
        );
      }
    } finally {
      if (currentRequest === request.current) setLoading(false);
    }
  }

  return (
    <div className="w-full space-y-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={loading || !careersUrl.trim()}
        aria-busy={loading}
        onClick={() => void suggest()}
      >
        {loading ? (
          <Loader2
            aria-hidden="true"
            className="mr-1.5 h-3.5 w-3.5 animate-spin"
          />
        ) : null}
        {loading ? "Suggesting filters…" : "Suggest filters"}
      </Button>
      <div aria-live="polite" aria-atomic="true" className="space-y-2 text-xs">
        {loading ? (
          <p className="text-muted-foreground">Finding and checking filters…</p>
        ) : null}
        {error ? <p className="text-destructive">{error}</p> : null}
        {suggestion ? (
          <div className="space-y-3 rounded-lg border border-border/70 bg-background/40 p-3">
            <p className="font-medium tabular-nums text-foreground">
              {suggestion.totals.filtered} of {suggestion.totals.unfiltered}{" "}
              jobs
            </p>
            <p className="break-all text-muted-foreground">
              {suggestion.suggestedUrl}
            </p>
            <p className="text-muted-foreground">{suggestion.rationale}</p>
            {suggestion.sampleTitles.length > 0 ? (
              <ul
                aria-label="Sample job titles"
                className="list-disc space-y-1 pl-4 text-muted-foreground"
              >
                {suggestion.sampleTitles.map((title, index) => (
                  <li key={`${index}-${title}`}>{title}</li>
                ))}
              </ul>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  onUse(suggestion.suggestedUrl);
                  setSuggestion(null);
                }}
              >
                Use this URL
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSuggestion(null)}
              >
                Dismiss
              </Button>
            </div>
            <p className="text-muted-foreground">
              Save sources to start using this URL.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
