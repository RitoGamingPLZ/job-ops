import {
  type WatchedSourceType,
  type WatchlistSource,
  type WatchlistSourceGroup,
  type WatchlistSourceScanInput,
  type WatchlistSourceScanResponse,
} from "@shared/types.js";
import { Layers, Loader2, Plus, Sparkles } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { getWatchlistBaseUrlMatchKey } from "./utils";

interface WatchlistEmptyTemplateCardProps {
  groups: WatchlistSourceGroup[];
  catalogSources?: WatchlistSource[];
  isMutating?: boolean;
  /** Draft mode is used on WatchlistPage; immediate mode saves directly from Find jobs / Daily search. */
  mode?: "immediate" | "draft";
  title?: string;
  description?: string;
  showWatchlistLink?: boolean;
  className?: string;
  onApplyGroup?: (group: WatchlistSourceGroup) => Promise<void> | void;
  onAddCustomSource?: (input: {
    careersUrl: string;
    label?: string;
    description?: string;
    sourceType?: WatchedSourceType;
    catalogSourceId?: string | null;
  }) => Promise<boolean>;
  onScanSource?: (input: WatchlistSourceScanInput) => Promise<WatchlistSourceScanResponse>;
  onOpenCustomDraft?: () => void;
}

export const WatchlistEmptyTemplateCard: React.FC<WatchlistEmptyTemplateCardProps> = ({
  groups,
  catalogSources = [],
  isMutating = false,
  mode = "immediate",
  title = mode === "draft" ? "No watchlist sources selected yet." : "Your Watchlist is empty",
  description = "Choose a starter group or paste a company career site URL to monitor company boards alongside your search.",
  showWatchlistLink = mode === "immediate",
  className,
  onApplyGroup,
  onAddCustomSource,
  onScanSource,
  onOpenCustomDraft,
}) => {
  const [busyGroupId, setBusyGroupId] = useState<string | null>(null);
  const [isCustomFormOpen, setIsCustomFormOpen] = useState(false);
  const [customUrl, setCustomUrl] = useState("");
  const [customName, setCustomName] = useState("");
  const [customDescription, setCustomDescription] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<WatchlistSourceScanResponse | null>(null);

  const matchedCatalogSource = useMemo(() => {
    const key = getWatchlistBaseUrlMatchKey(customUrl);
    if (!key) return null;
    return (
      catalogSources.find((source) => getWatchlistBaseUrlMatchKey(source.careersUrl) === key) ??
      null
    );
  }, [catalogSources, customUrl]);

  const handleGroupClick = async (group: WatchlistSourceGroup) => {
    if (!onApplyGroup || isMutating) return;
    if (mode === "draft") {
      onApplyGroup(group);
      return;
    }
    setBusyGroupId(group.id);
    try {
      await onApplyGroup(group);
    } finally {
      setBusyGroupId(null);
    }
  };

  const handleScan = async () => {
    const trimmedUrl = customUrl.trim();
    if (!trimmedUrl || !onScanSource || isScanning) return;

    setIsScanning(true);
    setScanError(null);
    try {
      const result = await onScanSource({
        careersUrl: trimmedUrl,
        name: customName.trim() || null,
        description: customDescription.trim() || null,
      });
      setScanResult(result);
      if (!customName.trim() && result.source.label) {
        setCustomName(result.source.label);
      }
      if (!customDescription.trim() && result.source.description) {
        setCustomDescription(result.source.description);
      }
    } catch (error) {
      setScanResult(null);
      setScanError(error instanceof Error ? error.message : "Could not scan this career site URL.");
    } finally {
      setIsScanning(false);
    }
  };

  const handleSubmitCustomSource = async (careersUrlOverride?: string) => {
    if (!onAddCustomSource || isMutating) return;
    const effectiveUrl = (careersUrlOverride ?? customUrl).trim();
    if (!effectiveUrl) return;

    const matchingSuggested =
      matchedCatalogSource?.suggestedFilterUrl &&
      effectiveUrl === matchedCatalogSource.suggestedFilterUrl;
    const matchingCanonical =
      matchedCatalogSource && effectiveUrl === matchedCatalogSource.careersUrl;
    const canLinkCatalog =
      Boolean(matchedCatalogSource) &&
      (matchingCanonical || matchingSuggested) &&
      (!customName.trim() || customName.trim() === matchedCatalogSource?.label);

    const added = await onAddCustomSource({
      careersUrl: effectiveUrl,
      label:
        customName.trim() ||
        matchedCatalogSource?.label ||
        scanResult?.source.label ||
        effectiveUrl,
      description:
        customDescription.trim() ||
        matchedCatalogSource?.description ||
        scanResult?.source.description ||
        undefined,
      sourceType:
        matchedCatalogSource?.sourceType ?? scanResult?.source.sourceType ?? "careers_site",
      catalogSourceId: canLinkCatalog ? (matchedCatalogSource?.id ?? null) : null,
    });

    if (added) {
      setCustomUrl("");
      setCustomName("");
      setCustomDescription("");
      setScanResult(null);
      setScanError(null);
      setIsCustomFormOpen(false);
    }
  };

  return (
    <div
      className={cn(
        "rounded-xl border border-dashed border-border bg-card/70 p-4 text-left",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <Layers aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-semibold text-foreground">{title}</p>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {mode === "draft" && onOpenCustomDraft ? (
            <Button type="button" size="sm" variant="default" onClick={onOpenCustomDraft}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Paste career site URL
            </Button>
          ) : onAddCustomSource ? (
            <Button
              type="button"
              size="sm"
              variant={isCustomFormOpen ? "secondary" : "default"}
              disabled={isMutating}
              onClick={() => setIsCustomFormOpen((current) => !current)}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              {isCustomFormOpen ? "Hide custom URL form" : "Paste career site URL"}
            </Button>
          ) : null}
          {showWatchlistLink ? (
            <Button type="button" size="sm" variant="outline" asChild>
              <a href="/watchlist">Open Watchlist</a>
            </Button>
          ) : null}
        </div>
      </div>

      {groups.length > 0 && onApplyGroup ? (
        <div className="mt-4 space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Starter Watchlist groups
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {groups.map((group) => {
              const isBusy = busyGroupId === group.id;
              return (
                <div
                  key={group.id}
                  className="flex items-start justify-between gap-3 rounded-lg border border-border/70 bg-background/70 p-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-foreground">{group.label}</span>
                      <Badge variant="outline" className="text-[10px] font-medium">
                        {group.sourceIds.length} companies
                      </Badge>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                      {group.description}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 px-2.5 text-xs"
                    aria-label={`Add ${group.label}`}
                    disabled={isMutating || isScanning || busyGroupId !== null}
                    onClick={() => void handleGroupClick(group)}
                  >
                    {isBusy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                    {mode === "draft" ? "Add group" : "Use group"}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {mode === "immediate" && isCustomFormOpen && onAddCustomSource ? (
        <div className="mt-4 space-y-3 rounded-lg border border-border bg-background/80 p-3">
          <div className="space-y-1.5">
            <Label htmlFor="empty-watchlist-url" className="text-xs font-medium">
              Career site URL
            </Label>
            <Input
              id="empty-watchlist-url"
              type="url"
              value={customUrl}
              onChange={(event) => {
                setCustomUrl(event.target.value);
                setScanResult(null);
                setScanError(null);
              }}
              placeholder="https://www.company.com/careers"
              aria-label="Career site URL"
              className="h-8 text-xs"
            />
          </div>

          {matchedCatalogSource ? (
            <div className="space-y-1.5 rounded-md border border-primary/25 bg-primary/5 p-2.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-foreground">
                  Saved source found: {matchedCatalogSource.label}
                </span>
                <Badge variant="secondary" className="text-[10px]">
                  Reuses saved setup
                </Badge>
              </div>
              {matchedCatalogSource.description ? (
                <p className="text-[11px] text-muted-foreground">
                  {matchedCatalogSource.description}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => {
                    if (!customName.trim()) setCustomName(matchedCatalogSource.label);
                    if (!customDescription.trim() && matchedCatalogSource.description) {
                      setCustomDescription(matchedCatalogSource.description);
                    }
                    setCustomUrl(matchedCatalogSource.careersUrl);
                  }}
                >
                  Use saved source details
                </Button>
                {matchedCatalogSource.suggestedFilterUrl ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => {
                      if (!customName.trim()) setCustomName(matchedCatalogSource.label);
                      if (!customDescription.trim() && matchedCatalogSource.description) {
                        setCustomDescription(matchedCatalogSource.description);
                      }
                      if (matchedCatalogSource.suggestedFilterUrl) {
                        setCustomUrl(matchedCatalogSource.suggestedFilterUrl);
                      }
                    }}
                  >
                    Use saved filter URL
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="empty-watchlist-name" className="text-xs font-medium">
                Name
              </Label>
              <Input
                id="empty-watchlist-name"
                value={customName}
                onChange={(event) => setCustomName(event.target.value)}
                placeholder="Company or board name"
                aria-label="Source name"
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="empty-watchlist-description" className="text-xs font-medium">
                Description
              </Label>
              <Textarea
                id="empty-watchlist-description"
                value={customDescription}
                onChange={(event) => setCustomDescription(event.target.value)}
                placeholder="Roles, team, or location focus (helps AI suggest filters)"
                aria-label="Source description"
                rows={2}
                className="min-h-8 resize-y text-xs"
              />
            </div>
          </div>

          {scanError ? <p className="text-xs text-destructive">{scanError}</p> : null}

          {scanResult ? (
            <div className="space-y-2 rounded-md border border-border bg-muted/40 p-2.5 text-xs">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className="text-[10px]">
                  {scanResult.source.sourceType}
                </Badge>
                {scanResult.reusedSource ? (
                  <Badge variant="secondary" className="text-[10px]">
                    Reused saved source
                  </Badge>
                ) : null}
                {scanResult.reusedScrapingPlan ? (
                  <Badge variant="secondary" className="text-[10px]">
                    Reused scraping plan
                  </Badge>
                ) : null}
                {scanResult.reusedFilterPlan ? (
                  <Badge variant="secondary" className="text-[10px]">
                    Reused filter plan
                  </Badge>
                ) : null}
              </div>
              {scanResult.filterPlan ? (
                <div className="space-y-1.5">
                  <p className="font-medium text-foreground">
                    Suggested filter: {scanResult.filterPlan.totals.filtered} of{" "}
                    {scanResult.filterPlan.totals.unfiltered} jobs
                  </p>
                  <p className="break-all text-[11px] text-muted-foreground">
                    {scanResult.filterPlan.suggestedUrl}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {scanResult.filterPlan.rationale}
                  </p>
                  {scanResult.filterPlan.sampleTitles.length > 0 ? (
                    <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">
                      {scanResult.filterPlan.sampleTitles.map((sampleTitle) => (
                        <li key={sampleTitle}>{sampleTitle}</li>
                      ))}
                    </ul>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => {
                      if (scanResult.filterPlan) {
                        setCustomUrl(scanResult.filterPlan.suggestedUrl);
                      }
                    }}
                  >
                    Use suggested filter URL
                  </Button>
                </div>
              ) : scanResult.filterNote ? (
                <p className="text-[11px] text-muted-foreground">{scanResult.filterNote}</p>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-2">
            {onScanSource ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!customUrl.trim() || isScanning || isMutating}
                onClick={() => void handleScan()}
              >
                {isScanning ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                )}
                {isScanning ? "Scanning…" : "Scan & suggest filter"}
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              disabled={!customUrl.trim() || isMutating || isScanning}
              onClick={() => void handleSubmitCustomSource()}
            >
              {isMutating ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Add to Watchlist
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
};
