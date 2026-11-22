import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { WatchedSourceType, WatchlistSource } from "@shared/types";
import { getWatchlistSourceAdapter } from "../watchlist/adapters";

const configDir =
  typeof import.meta.url === "string" && import.meta.url.startsWith("file:")
    ? dirname(fileURLToPath(import.meta.url))
    : process.cwd();
const careerBoardFilePrefix = "career-boards-";

function getSourceTypeFromFilename(fileName: string): WatchedSourceType | null {
  if (
    !fileName.startsWith(careerBoardFilePrefix) ||
    extname(fileName) !== ".json"
  ) {
    return null;
  }

  const sourceType = basename(fileName, ".json").slice(
    careerBoardFilePrefix.length,
  );
  return sourceType.length > 0 ? sourceType : null;
}

async function loadCareerBoardFile(
  fileName: string,
): Promise<WatchlistSource[]> {
  const sourceType = getSourceTypeFromFilename(fileName);
  if (!sourceType) return [];

  const raw = await readFile(join(configDir, fileName), "utf8");
  const parsed = JSON.parse(raw) as unknown;
  const adapter = getWatchlistSourceAdapter(sourceType);
  if (!adapter) return [];

  return adapter.parseCatalogSources(Array.isArray(parsed) ? parsed : []);
}

export async function listCareerBoardSources(): Promise<WatchlistSource[]> {
  let files: string[];
  try {
    files = await readdir(configDir);
  } catch {
    return [];
  }
  const results = await Promise.all(
    files.map((fileName) => loadCareerBoardFile(fileName)),
  );
  return results
    .flat()
    .sort((left, right) => left.label.localeCompare(right.label));
}
