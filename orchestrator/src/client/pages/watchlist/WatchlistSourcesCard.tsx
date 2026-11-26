import * as api from "@client/api";
import { StatusIndicator } from "@client/components/StatusIndicator";
import {
  MAX_WATCHLIST_SOURCES,
  type WatchlistSource,
  type WatchlistSourceTypeDescriptor,
} from "@shared/types.js";
import { ExternalLink, Loader2, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableDropdown } from "@/components/ui/searchable-dropdown";
import { cn } from "@/lib/utils";
import { CompanyRatingBadges } from "./CompanyRatingBadges";
import { SuggestFiltersPanel } from "./SuggestFiltersPanel";
import type { WatchlistSourceDraftCardProps } from "./types";
import {
  CUSTOM_SOURCE_VALUE,
  getCoveredCatalogSourceIds,
  getNormalizedWatchlistCareersUrl,
  getWatchlistBaseUrlMatchKey,
  getWatchlistPreviewLabel,
} from "./utils";
import { WatchlistEmptyTemplateCard } from "./WatchlistEmptyTemplateCard";
import { WatchlistGroupsMenu } from "./WatchlistGroupsMenu";

function getSourceDraftDetails(
  draftCatalogSourceId: string | null,
  catalogSources: WatchlistSource[],
) {
  return catalogSources.find((source) => source.id === draftCatalogSourceId);
}

function getCustomSourceValue(sourceType: string): string {
  return `${CUSTOM_SOURCE_VALUE}:${sourceType}`;
}

function getSourceDropdownOptions(
  catalogSources: WatchlistSource[],
  sourceTypes: WatchlistSourceTypeDescriptor[],
) {
  const customSourceTypes = sourceTypes.filter((sourceType) => sourceType.supportsCustomSource);
  const careersSiteCustom = customSourceTypes.filter(
    (sourceType) => sourceType.sourceType === "careers_site",
  );
  const otherCustom = customSourceTypes.filter(
    (sourceType) => sourceType.sourceType !== "careers_site",
  );
  // Put copy-and-paste careers site URL as the very first option so users can
  // paste any career page before scrolling the curated company catalog.
  const firstCustomOptions =
    careersSiteCustom.length > 0 ? careersSiteCustom : otherCustom.slice(0, 1);
  const remainingCustomOptions = careersSiteCustom.length > 0 ? otherCustom : otherCustom.slice(1);

  return [
    ...firstCustomOptions.map((sourceType) => ({
      value: getCustomSourceValue(sourceType.sourceType),
      label: sourceType.customSourceOptionLabel,
      searchText: sourceType.customSourceSearchText,
    })),
    ...catalogSources.map((source) => ({
      value: source.id,
      label: source.label,
      searchText: `${source.label} ${source.careersUrl} ${source.description ?? ""}`.trim(),
    })),
    ...remainingCustomOptions.map((sourceType) => ({
      value: getCustomSourceValue(sourceType.sourceType),
      label: sourceType.customSourceOptionLabel,
      searchText: sourceType.customSourceSearchText,
    })),
  ];
}

function getWatchlistStatusCopy(status: "watching" | "unsaved"): {
  label: string;
  variant: "emerald" | "amber";
  tooltip: string;
} {
  if (status === "watching") {
    return {
      label: "Watching",
      variant: "emerald",
      tooltip:
        "This source matches your saved watchlist settings and is currently being monitored.",
    };
  }

  return {
    label: "Unsaved",
    variant: "amber",
    tooltip:
      "This source has local changes that have not been saved yet, so watchlist monitoring is not using this version.",
  };
}

export function WatchlistSourcesCard({
  sourceDrafts,
  sourceStatusByDraftId,
  catalogSources,
  sourceTypes,
  formattedLastCheckedAt,
  formattedPreviousLastCheckedAt,
  newJobsCount,
  hasUnsavedChanges,
  isSaving,
  onAddSource,
  onAddGroup,
  groups,
  onRemoveSource,
  onUpdateDraft,
  onSourceMethodSelected,
  onSourceSearchNoResults,
  onSave,
}: WatchlistSourceDraftCardProps) {
  const [logoDataUrls, setLogoDataUrls] = useState<Record<string, string | null>>({});
  const sourceDropdownOptions = useMemo(
    () => getSourceDropdownOptions(catalogSources, sourceTypes),
    [catalogSources, sourceTypes],
  );
  const sourceTypeById = useMemo(
    () => new Map(sourceTypes.map((sourceType) => [sourceType.sourceType, sourceType])),
    [sourceTypes],
  );
  const defaultSourceType = sourceTypes[0]?.sourceType ?? "workday";
  const addedCatalogSourceIds = useMemo(
    () => getCoveredCatalogSourceIds(sourceDrafts, catalogSources),
    [sourceDrafts, catalogSources],
  );
  const logoCareersUrls = useMemo(() => {
    const urls = new Map<string, { sourceType: string; careersUrl: string }>();

    for (const draft of sourceDrafts) {
      const selectedSource = getSourceDraftDetails(draft.catalogSourceId, catalogSources);
      const careersUrl = draft.isCustom
        ? getNormalizedWatchlistCareersUrl(draft.sourceType, draft.customUrl.trim())
        : (selectedSource?.careersUrl ?? "").trim();

      if (!careersUrl) continue;
      urls.set(careersUrl, {
        sourceType: draft.isCustom
          ? draft.sourceType
          : (selectedSource?.sourceType ?? defaultSourceType),
        careersUrl,
      });
    }

    return [...urls.values()];
  }, [catalogSources, defaultSourceType, sourceDrafts]);

  useEffect(() => {
    const pendingUrls = logoCareersUrls
      .filter((item) => sourceTypeById.get(item.sourceType)?.supportsBranding)
      .filter((item) => logoDataUrls[item.careersUrl] === undefined)
      .slice(0, 5);
    if (pendingUrls.length === 0) return;

    let cancelled = false;

    void Promise.all(
      pendingUrls.map(async (item) => {
        try {
          const response = await api.fetchWatchlistSourceBranding({
            sourceType: item.sourceType,
            careersUrl: item.careersUrl,
          });
          return [item.careersUrl, response.imageDataUrl] as const;
        } catch {
          return [item.careersUrl, null] as const;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;

      setLogoDataUrls((current) => {
        const next = { ...current };
        for (const [careersUrl, imageDataUrl] of entries) {
          next[careersUrl] = imageDataUrl;
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [logoCareersUrls, logoDataUrls, sourceTypeById]);

  return (
    <Accordion
      type="single"
      collapsible
      defaultValue="watched-sources"
      className="w-full overflow-hidden rounded-lg border border-border bg-card"
    >
      <AccordionItem value="watched-sources" className="border-b-0">
        <div className="relative">
          <AccordionTrigger className="cursor-pointer items-center justify-between gap-2 px-3 py-2.5 text-left hover:no-underline">
            <div className="min-w-0 w-full">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold tracking-tight text-foreground/90">
                  Watched sources
                </h2>
                <Badge variant="secondary">{sourceDrafts.length}</Badge>
              </div>
              <p className="mt-0.5 max-w-3xl text-xs text-muted-foreground/70">
                Pick the company boards you want to monitor manually or add your own supported
                careers URL.
              </p>
              {formattedLastCheckedAt ? (
                <p className="mt-1 text-xs text-muted-foreground/70">
                  Last checked {formattedLastCheckedAt}
                  {formattedPreviousLastCheckedAt
                    ? ` · ${newJobsCount} new since ${formattedPreviousLastCheckedAt}`
                    : " · First check saved your baseline"}
                </p>
              ) : null}
            </div>
          </AccordionTrigger>

          {/* right controls */}
          <div className="flex flex-wrap justify-end gap-2 px-3 pb-2 sm:absolute sm:right-12 sm:top-1/2 sm:border-b-0 sm:bg-transparent sm:p-0 sm:-translate-y-1/2">
            {onAddGroup ? (
              <WatchlistGroupsMenu
                groups={groups ?? []}
                addedCatalogSourceIds={addedCatalogSourceIds}
                isFull={sourceDrafts.length >= MAX_WATCHLIST_SOURCES}
                onAddGroup={onAddGroup}
              />
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={sourceDrafts.length >= MAX_WATCHLIST_SOURCES}
              onClick={(e) => {
                e.preventDefault();
                onAddSource();
              }}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add source
            </Button>
            <Button
              type="button"
              size="sm"
              variant={hasUnsavedChanges ? "default" : "secondary"}
              disabled={isSaving || !hasUnsavedChanges}
              onClick={(e) => {
                e.preventDefault();
                onSave();
              }}
            >
              {isSaving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Save sources
            </Button>
          </div>
        </div>

        <AccordionContent className="border-t border-border bg-muted p-3 dark:bg-background">
          {sourceDrafts.length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {sourceDrafts.map((draft, index) => {
                const selectedSource = getSourceDraftDetails(draft.catalogSourceId, catalogSources);
                const sourceStatus = sourceStatusByDraftId[draft.id] ?? "unsaved";
                const statusCopy = getWatchlistStatusCopy(sourceStatus);
                const dropdownInputId = `watchlist-source-${draft.id}`;
                const descriptor = sourceTypeById.get(draft.sourceType) ?? sourceTypes[0] ?? null;
                const normalizedCustomUrl = draft.isCustom
                  ? getNormalizedWatchlistCareersUrl(draft.sourceType, draft.customUrl)
                  : "";
                const customUrlMatchKey = draft.isCustom
                  ? getWatchlistBaseUrlMatchKey(draft.customUrl)
                  : "";
                const matchingCatalogSource = draft.isCustom
                  ? catalogSources.find(
                      (source) =>
                        (source.sourceType === draft.sourceType &&
                          source.careersUrl === normalizedCustomUrl) ||
                        (customUrlMatchKey.length > 0 &&
                          getWatchlistBaseUrlMatchKey(source.careersUrl) === customUrlMatchKey),
                    )
                  : null;
                const customLabel = (draft.customLabel ?? "").trim();
                const label = draft.isCustom
                  ? customLabel ||
                    (draft.customUrl.trim()
                      ? (matchingCatalogSource?.label ??
                        getWatchlistPreviewLabel(draft.sourceType, draft.customUrl))
                      : (descriptor?.customSourceInputLabel ?? "Paste career site URL"))
                  : (selectedSource?.label ?? `New Source`);
                const descriptionText =
                  (draft.description ?? "").trim() ||
                  (draft.isCustom ? "" : (selectedSource?.description ?? ""));
                const rating = (draft.isCustom ? matchingCatalogSource : selectedSource)?.rating;
                const careersUrl = draft.isCustom
                  ? normalizedCustomUrl
                  : (selectedSource?.careersUrl ?? "");
                const isEmpty = !careersUrl.trim();
                const showEditor = isEmpty || (draft.isCustom && sourceStatus === "unsaved");
                const companyLogoUrl = logoDataUrls[careersUrl.trim()] ?? null;

                return (
                  <article
                    key={draft.id}
                    className="group relative flex h-full min-w-0 w-full flex-col gap-2 rounded-lg border border-border bg-card p-2.5 shadow-xs transition-colors hover:border-foreground/20"
                  >
                    {isEmpty ? (
                      <p className="truncate pr-7 text-xs font-medium text-muted-foreground">
                        {draft.isCustom
                          ? (descriptor?.customSourceInputLabel ?? "Custom source")
                          : "New source"}
                      </p>
                    ) : (
                      <div className="flex items-start gap-2.5 pr-6">
                        {companyLogoUrl ? (
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/40 p-1">
                            <img
                              src={companyLogoUrl}
                              alt={label}
                              className="h-full w-full object-contain"
                            />
                          </div>
                        ) : null}

                        <div className="min-w-0 flex-1">
                          <h3 className="min-w-0 text-[13px] font-semibold leading-tight text-foreground">
                            {careersUrl ? (
                              <a
                                href={careersUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={`Open ${label} careers page`}
                                className="group/link inline-flex max-w-full min-w-0 items-center gap-1 underline-offset-2 hover:text-primary hover:underline"
                              >
                                <span className="truncate">{label}</span>
                                <ExternalLink
                                  aria-hidden="true"
                                  className="h-3 w-3 shrink-0 text-muted-foreground/70 transition-colors group-hover/link:text-primary"
                                />
                              </a>
                            ) : (
                              <span className="block truncate">{label}</span>
                            )}
                          </h3>

                          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                            <span>
                              {draft.isCustom
                                ? (descriptor?.label ?? draft.sourceType)
                                : (descriptor?.label ?? selectedSource?.sourceType)}
                            </span>
                            <StatusIndicator
                              label={statusCopy.label}
                              variant={statusCopy.variant}
                              tooltip={statusCopy.tooltip}
                              tooltipClassName="max-w-64 text-xs leading-relaxed"
                            />
                          </div>
                          {descriptionText && !showEditor ? (
                            <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                              {descriptionText}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    )}

                    {isEmpty ? null : <CompanyRatingBadges rating={rating} />}

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className={cn(
                        "absolute right-1.5 top-1.5 h-6 w-6 shrink-0 rounded-md text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus:outline-none group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100",
                        isEmpty && "opacity-100",
                      )}
                      aria-label={`Remove watchlist source ${index + 1}`}
                      onClick={() => onRemoveSource(index)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>

                    {showEditor && (
                      <div className="w-full space-y-1.5">
                        {draft.isCustom ? (
                          <Input
                            value={draft.customUrl}
                            onChange={(event) =>
                              onUpdateDraft(index, (current) => ({
                                ...current,
                                customUrl: event.target.value,
                              }))
                            }
                            placeholder={
                              descriptor?.customSourcePlaceholder ??
                              "https://www.company.com/careers"
                            }
                            aria-label={`${descriptor?.customSourceInputLabel ?? "Custom source URL"} ${index + 1}`}
                            className="h-8 rounded-md bg-background/60 text-xs"
                          />
                        ) : null}
                        {draft.isCustom && matchingCatalogSource ? (
                          <div className="flex flex-wrap items-center justify-between gap-1.5 rounded-md border border-primary/25 bg-primary/5 px-2 py-1.5 text-[11px]">
                            <span className="min-w-0 truncate font-medium text-foreground">
                              Saved source: {matchingCatalogSource.label}
                            </span>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-[10px]"
                              onClick={() => {
                                onSourceMethodSelected({
                                  method: "catalog",
                                  catalogSourceId: matchingCatalogSource.id,
                                  sourceType: matchingCatalogSource.sourceType,
                                  careersUrl: matchingCatalogSource.careersUrl,
                                });
                                onUpdateDraft(index, (current) => ({
                                  ...current,
                                  isCustom: false,
                                  sourceType: matchingCatalogSource.sourceType,
                                  catalogSourceId: matchingCatalogSource.id,
                                  customLabel: matchingCatalogSource.label,
                                  description:
                                    matchingCatalogSource.description ?? current.description ?? "",
                                }));
                              }}
                            >
                              Reuse saved
                            </Button>
                          </div>
                        ) : null}
                        <SearchableDropdown
                          inputId={dropdownInputId}
                          value={
                            draft.isCustom
                              ? getCustomSourceValue(draft.sourceType)
                              : (draft.catalogSourceId ?? "")
                          }
                          options={sourceDropdownOptions}
                          onValueChange={(value) => {
                            if (value.startsWith(`${CUSTOM_SOURCE_VALUE}:`)) {
                              const sourceType =
                                value.slice(CUSTOM_SOURCE_VALUE.length + 1) || defaultSourceType;
                              onSourceMethodSelected({
                                method: "custom_url",
                                sourceType,
                              });
                              onUpdateDraft(index, (current) => ({
                                ...current,
                                isCustom: true,
                                sourceType,
                                catalogSourceId: null,
                              }));
                              return;
                            }

                            const selectedCatalogSource = catalogSources.find(
                              (source) => source.id === value,
                            );
                            onSourceMethodSelected({
                              method: "catalog",
                              catalogSourceId: value,
                              sourceType: selectedCatalogSource?.sourceType,
                              careersUrl: selectedCatalogSource?.careersUrl ?? undefined,
                            });
                            onUpdateDraft(index, (current) => ({
                              ...current,
                              isCustom: false,
                              sourceType: selectedCatalogSource?.sourceType ?? current.sourceType,
                              catalogSourceId: value,
                            }));
                          }}
                          placeholder="Choose company"
                          searchPlaceholder="Search companies..."
                          emptyText={descriptor?.emptyCatalogText ?? "No companies found."}
                          ariaLabel={`Watchlist source ${index + 1}`}
                          allowCustomValue={false}
                          onEmptyResults={(searchText) => onSourceSearchNoResults({ searchText })}
                          triggerClassName="h-8 w-full justify-between rounded-md border-input bg-background/60 text-xs"
                          contentClassName="w-[var(--radix-popover-trigger-width)] min-w-[320px]"
                        />
                        {draft.isCustom ? (
                          <>
                            <Input
                              value={draft.customLabel ?? ""}
                              onChange={(event) =>
                                onUpdateDraft(index, (current) => ({
                                  ...current,
                                  customLabel: event.target.value,
                                }))
                              }
                              placeholder="Company or source name (optional)"
                              aria-label={`Source name ${index + 1}`}
                              className="h-8 rounded-md bg-background/60 text-xs"
                            />
                            <Input
                              value={draft.description ?? ""}
                              onChange={(event) =>
                                onUpdateDraft(index, (current) => ({
                                  ...current,
                                  description: event.target.value,
                                }))
                              }
                              placeholder="Description (role focus, team, or notes)"
                              aria-label={`Source description ${index + 1}`}
                              className="h-8 rounded-md bg-background/60 text-xs"
                            />
                          </>
                        ) : null}
                      </div>
                    )}
                    <div className="mt-auto pt-0.5">
                      <SuggestFiltersPanel
                        sourceType={
                          draft.isCustom
                            ? draft.sourceType
                            : (selectedSource?.sourceType ?? draft.sourceType)
                        }
                        careersUrl={careersUrl}
                        label={label}
                        description={draft.description}
                        onUse={(suggestedUrl) => {
                          const sourceType = draft.isCustom
                            ? draft.sourceType
                            : (selectedSource?.sourceType ?? draft.sourceType);
                          onSourceMethodSelected({
                            method: "custom_url",
                            sourceType,
                            careersUrl: suggestedUrl,
                          });
                          onUpdateDraft(index, (current) => ({
                            ...current,
                            isCustom: true,
                            sourceType,
                            catalogSourceId: null,
                            customUrl: suggestedUrl,
                          }));
                        }}
                      />
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <WatchlistEmptyTemplateCard
              mode="draft"
              groups={groups ?? []}
              catalogSources={catalogSources}
              onApplyGroup={onAddGroup}
              onOpenCustomDraft={onAddSource}
            />
          )}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
