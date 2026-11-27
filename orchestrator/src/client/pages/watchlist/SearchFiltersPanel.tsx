import {
  applyWatchlistSearchFilters,
  getWatchlistSearchControls,
  rescanWatchlistSearchControls,
} from "@client/api/watchlist";
import {
  WATCHLIST_CONTROL_ROLE_LABELS,
  type WatchlistSearchControl,
  type WatchlistSearchControlsResponse,
} from "@shared/types.js";
import { Loader2, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface SearchFiltersPanelProps {
  careersUrl: string;
  /** Receives the server-built source URL; the user still saves sources as usual. */
  onUse: (url: string) => void;
  /** Scan the site by itself (a saved source). An unsaved URL is only scanned once saved. */
  autoScan?: boolean;
  /** Whether the site's filter scan has an answer; Suggest filters waits for it. */
  onPlanDone?: (done: boolean) => void;
}

const TEXT_DEBOUNCE_MS = 400;
const POLL_MS = 15_000;
const MAX_POLLS = 24;

/** The listing this URL belongs to, ignoring its query: controls are learned per listing. */
function listingKey(value: string): string | null {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

/**
 * Keyword and filter inputs for a custom careers site whose search controls were learned and
 * verified. Each edit asks the server to build the source URL, so the user's own words are only
 * ever placed in their own URL and never reach a model.
 */
export function SearchFiltersPanel({
  careersUrl,
  onUse,
  autoScan = false,
  onPlanDone,
}: SearchFiltersPanelProps) {
  const [response, setResponse] = useState<WatchlistSearchControlsResponse | null>(null);
  const [values, setValues] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stalled, setStalled] = useState(false);
  const autoStarted = useRef<string | null>(null);
  const [rawText, setRawText] = useState<Record<string, string>>({});
  const request = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const urlRef = useRef(careersUrl);
  urlRef.current = careersUrl;
  const listing = listingKey(careersUrl);

  const load = useCallback(async () => {
    const current = ++request.current;
    setError(null);
    try {
      const next = await getWatchlistSearchControls({ careersUrl: urlRef.current });
      if (current !== request.current) return;
      setResponse(next);
      setValues(next.status === "ready" ? next.values : {});
    } catch {
      if (current === request.current) setResponse({ status: "unsupported" });
    }
  }, []);

  // The scan is "done" once there is an answer for this site (controls, none, or a scan that ended
  // without one). Anything still loading, running, or not yet started is not.
  const planDone =
    response !== null &&
    (response.status === "ready" ||
      response.status === "none" ||
      response.status === "unsupported" ||
      (response.status === "rescan" &&
        (response.lastScan?.outcome === "failed" || response.lastScan?.outcome === "blocked")));
  useEffect(() => {
    onPlanDone?.(planDone);
  }, [planDone, onPlanDone]);

  // A saved source is scanned by itself, once per listing: the first scan, or one more after a
  // scanner that was still starting. A scan that finished (or failed for a real reason) is never
  // repeated automatically.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `rescan` only reads refs and setters.
  useEffect(() => {
    if (!autoScan || !listing || response?.status !== "rescan") return;
    if (response.lastScan && response.lastScan.outcome !== "unavailable") return;
    if (autoStarted.current === listing) return;
    autoStarted.current = listing;
    void rescan();
  }, [autoScan, listing, response]);

  // While a scan runs, look again every so often, and give up quietly after a few minutes.
  useEffect(() => {
    if (response?.status !== "learning") return;
    setStalled(false);
    let polls = 0;
    const id = setInterval(() => {
      if (++polls > MAX_POLLS) {
        clearInterval(id);
        setStalled(true);
        return;
      }
      void load();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [response?.status, load]);

  // Controls belong to a listing, not to the query the user is editing: reload only when the
  // listing changes so typing never resets the inputs.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `listing` is the intended trigger.
  useEffect(() => {
    setResponse(null);
    setRawText({});
    if (!listing) return;
    void load();
    return () => {
      request.current += 1;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [listing, load]);

  function apply(next: Record<string, string[]>) {
    const current = ++request.current;
    setBusy(true);
    setError(null);
    applyWatchlistSearchFilters({ careersUrl: urlRef.current, values: next })
      .then((result) => {
        if (current === request.current) onUse(result.careersUrl);
      })
      .catch((cause: unknown) => {
        if (current === request.current)
          setError(cause instanceof Error ? cause.message : "Could not apply filters.");
      })
      .finally(() => {
        if (current === request.current) setBusy(false);
      });
  }

  function change(control: WatchlistSearchControl, selected: string[]) {
    const next = { ...values };
    if (selected.length) next[control.key] = selected;
    else delete next[control.key];
    setValues(next);
    if (timer.current) clearTimeout(timer.current);
    if (control.input.kind === "text") {
      timer.current = setTimeout(() => apply(next), TEXT_DEBOUNCE_MS);
    } else apply(next);
  }

  async function rescan() {
    setBusy(true);
    setError(null);
    try {
      await rescanWatchlistSearchControls({ careersUrl });
      setResponse({ status: "learning" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start learning this site.");
    } finally {
      setBusy(false);
    }
  }

  if (!response || response.status === "unsupported") return null;

  if (response.status === "none") {
    return (
      <p className="w-full text-xs text-muted-foreground" aria-live="polite">
        No search filters were found for this site.
      </p>
    );
  }

  if (response.status !== "ready") {
    const unfinished =
      response.status === "rescan" && response.lastScan && response.lastScan.outcome !== "found"
        ? response.lastScan
        : null;
    const scanning =
      response.status === "learning" ||
      (autoScan && busy) ||
      (autoScan && response.status === "rescan" && !response.lastScan);
    return (
      <div className="w-full text-xs text-muted-foreground" aria-live="polite" aria-busy={scanning}>
        {scanning ? (
          <div className="flex flex-wrap items-center gap-2">
            <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" />
            <span>Finding search filters for this site…</span>
            {stalled ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 px-2 text-[11px]"
                onClick={() => {
                  setStalled(false);
                  void load();
                }}
              >
                Check again
              </Button>
            ) : null}
          </div>
        ) : !autoScan && !unfinished ? (
          <p>Search filters are found automatically once this source is saved.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {unfinished ? (
              <span>
                {unfinished.outcome === "unavailable"
                  ? "The site scanner was still starting."
                  : `The last scan did not finish${unfinished.reason ? `: ${unfinished.reason}` : "."}`}
              </span>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              className="h-6 rounded-md px-2 text-[11px] font-medium text-muted-foreground hover:text-foreground"
              onClick={() => void rescan()}
            >
              <Search aria-hidden="true" className="h-3 w-3" />
              Scan again
            </Button>
          </div>
        )}
        {error ? <p className="mt-1 text-destructive">{error}</p> : null}
      </div>
    );
  }
  return (
    <fieldset className="w-full space-y-1.5" aria-busy={busy}>
      <legend className="sr-only">Search filters</legend>
      {response.controls.map((control) => {
        // Boards name the same filter differently; fall back to the shared name for its role.
        const label =
          control.label ??
          (control.role ? WATCHLIST_CONTROL_ROLE_LABELS[control.role] : undefined) ??
          control.key;
        const selected = values[control.key] ?? [];
        if (control.input.kind === "text") {
          // Several free-text values share one box, separated by ";" (commas occur in places).
          const raw = control.multiple ? (rawText[control.key] ?? selected.join("; ")) : undefined;
          return (
            <Input
              key={control.key}
              value={raw ?? selected[0] ?? ""}
              maxLength={control.multiple ? 400 : 120}
              placeholder={control.multiple ? `${label} (separate with ;)` : label}
              aria-label={label}
              className="h-8 rounded-md bg-background/60 text-xs"
              onChange={(event) => {
                const typed = event.target.value;
                if (control.multiple)
                  setRawText((current) => ({ ...current, [control.key]: typed }));
                change(
                  control,
                  control.multiple
                    ? typed
                        .split(";")
                        .map((part) => part.trim())
                        .filter(Boolean)
                    : typed
                      ? [typed]
                      : [],
                );
              }}
            />
          );
        }
        return (
          <select
            key={control.key}
            multiple={control.multiple}
            value={control.multiple ? selected : (selected[0] ?? "")}
            aria-label={label}
            className="h-8 w-full rounded-md border border-input bg-background/60 px-2 text-xs"
            onChange={(event) =>
              change(
                control,
                Array.from(event.target.selectedOptions, (option) => option.value).filter(Boolean),
              )
            }
          >
            {control.multiple ? null : <option value="">{`Any ${label}`}</option>}
            {control.input.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label ?? option.value}
              </option>
            ))}
          </select>
        );
      })}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </fieldset>
  );
}
