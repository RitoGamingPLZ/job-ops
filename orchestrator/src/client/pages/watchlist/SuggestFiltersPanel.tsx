import { suggestWatchlistFilters } from "@client/api/watchlist";
import type { WatchlistSuggestedFilterPlan } from "@shared/types.js";
import { Loader2, SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SuggestFiltersPanelProps {
  sourceType: string;
  careersUrl: string;
  label: string;
  description?: string;
  onUse: (url: string) => void;
}

export function SuggestFiltersPanel({
  sourceType,
  careersUrl,
  label,
  description,
  onUse,
}: SuggestFiltersPanelProps) {
  const [suggestion, setSuggestion] = useState<WatchlistSuggestedFilterPlan | null>(null);
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
    const trimmedDescription = description?.trim();
    try {
      const result = await suggestWatchlistFilters({
        sourceType,
        careersUrl,
        label,
        ...(trimmedDescription ? { description: trimmedDescription } : {}),
      });
      if (currentRequest === request.current) setSuggestion(result);
    } catch (error) {
      if (currentRequest === request.current) {
        setError(error instanceof Error ? error.message : "Could not suggest filters.");
      }
    } finally {
      if (currentRequest === request.current) setLoading(false);
    }
  }

  return (
    <div className="w-full">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={loading || !careersUrl.trim()}
        aria-busy={loading}
        className="h-6 rounded-md px-2 text-[11px] font-medium text-muted-foreground hover:text-foreground"
        onClick={() => void suggest()}
      >
        {loading ? (
          <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" />
        ) : (
          <SlidersHorizontal aria-hidden="true" className="h-3 w-3" />
        )}
        {loading ? "Suggesting filters…" : "Suggest filters"}
      </Button>
      <div
        aria-live="polite"
        aria-atomic="true"
        className={cn("text-xs", (loading || error || suggestion) && "mt-2 space-y-1.5")}
      >
        {loading ? <p className="text-muted-foreground">Finding and checking filters…</p> : null}
        {error ? <p className="text-destructive">{error}</p> : null}
        {suggestion ? (
          <div className="space-y-2 rounded-md border border-border bg-muted/60 p-2.5 dark:bg-background/70">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium tabular-nums text-foreground">
                {suggestion.totals.filtered} of {suggestion.totals.unfiltered} jobs
              </p>
              {suggestion.reused ? (
                <Badge variant="secondary" className="text-[10px]">
                  Reused saved filter plan
                </Badge>
              ) : null}
            </div>
            <p className="break-all text-muted-foreground">{suggestion.suggestedUrl}</p>
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
            <div className="flex flex-wrap gap-1.5">
              <Button
                type="button"
                size="sm"
                className="h-6 px-2 text-[11px]"
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
                className="h-6 px-2 text-[11px]"
                onClick={() => setSuggestion(null)}
              >
                Dismiss
              </Button>
            </div>
            <p className="text-muted-foreground">Save sources to start using this URL.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
