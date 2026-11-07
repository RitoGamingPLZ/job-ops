import type { WatchedSourceType } from "@shared/types";
import { amazonWatchlistAdapter } from "./amazon";
import { appleWatchlistAdapter } from "./apple";
import { bamboohrWatchlistAdapter } from "./bamboohr";
import { eightfoldWatchlistAdapter } from "./eightfold";
import { googleWatchlistAdapter } from "./google";
import { greenhouseWatchlistAdapter } from "./greenhouse";
import type { WatchlistCatalogSourceAdapter } from "./types";
import { workdayWatchlistAdapter } from "./workday";

const adapters = [
  workdayWatchlistAdapter,
  bamboohrWatchlistAdapter,
  greenhouseWatchlistAdapter,
  amazonWatchlistAdapter,
  eightfoldWatchlistAdapter,
  appleWatchlistAdapter,
  googleWatchlistAdapter,
] as const;

const adaptersByType = new Map<
  WatchedSourceType,
  WatchlistCatalogSourceAdapter
>(adapters.map((adapter) => [adapter.sourceType, adapter]));

export function listWatchlistSourceAdapters(): WatchlistCatalogSourceAdapter[] {
  return [...adapters];
}

export function getWatchlistSourceAdapter(
  sourceType: WatchedSourceType,
): WatchlistCatalogSourceAdapter | null {
  return adaptersByType.get(sourceType) ?? null;
}

export function requireWatchlistSourceAdapter(
  sourceType: WatchedSourceType,
): WatchlistCatalogSourceAdapter {
  const adapter = getWatchlistSourceAdapter(sourceType);
  if (!adapter) {
    throw new Error(`Unsupported watchlist source type: ${sourceType}`);
  }
  return adapter;
}
