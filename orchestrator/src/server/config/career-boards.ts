import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { WatchedSourceType, WatchlistSource } from "@shared/types";
import { getWatchlistSourceAdapter } from "../watchlist/adapters";
import amazonCareerBoards from "./career-boards-amazon.json";
import appleCareerBoards from "./career-boards-apple.json";
import ashbyCareerBoards from "./career-boards-ashby.json";
import bamboohrCareerBoards from "./career-boards-bamboohr.json";
import careersSiteCareerBoards from "./career-boards-careers_site.json";
import eightfoldCareerBoards from "./career-boards-eightfold.json";
import googleCareerBoards from "./career-boards-google.json";
import greenhouseCareerBoards from "./career-boards-greenhouse.json";
import leverCareerBoards from "./career-boards-lever.json";
import metaCareerBoards from "./career-boards-meta.json";
import oracleCareerBoards from "./career-boards-oracle.json";
import smartrecruitersCareerBoards from "./career-boards-smartrecruiters.json";
import workdayCareerBoards from "./career-boards-workday.json";

const BUNDLED_CAREER_BOARD_CATALOGS: Array<{
  sourceType: WatchedSourceType;
  catalog: unknown;
}> = [
  { sourceType: "amazon", catalog: amazonCareerBoards },
  { sourceType: "apple", catalog: appleCareerBoards },
  { sourceType: "ashby", catalog: ashbyCareerBoards },
  { sourceType: "bamboohr", catalog: bamboohrCareerBoards },
  { sourceType: "careers_site", catalog: careersSiteCareerBoards },
  { sourceType: "eightfold", catalog: eightfoldCareerBoards },
  { sourceType: "google", catalog: googleCareerBoards },
  { sourceType: "greenhouse", catalog: greenhouseCareerBoards },
  { sourceType: "lever", catalog: leverCareerBoards },
  { sourceType: "meta", catalog: metaCareerBoards },
  { sourceType: "oracle", catalog: oracleCareerBoards },
  { sourceType: "smartrecruiters", catalog: smartrecruitersCareerBoards },
  { sourceType: "workday", catalog: workdayCareerBoards },
];

const configDir =
  typeof import.meta.url === "string" && import.meta.url.startsWith("file:")
    ? dirname(fileURLToPath(import.meta.url))
    : process.cwd();
const careerBoardFilePrefix = "career-boards-";

function getSourceTypeFromFilename(fileName: string): WatchedSourceType | null {
  if (!fileName.startsWith(careerBoardFilePrefix) || extname(fileName) !== ".json") {
    return null;
  }

  const sourceType = basename(fileName, ".json").slice(careerBoardFilePrefix.length);
  return sourceType.length > 0 ? sourceType : null;
}

function parseCareerBoardCatalog(
  sourceType: WatchedSourceType,
  parsed: unknown,
): WatchlistSource[] {
  const adapter = getWatchlistSourceAdapter(sourceType);
  if (!adapter) return [];

  return adapter.parseCatalogSources(Array.isArray(parsed) ? parsed : []);
}

async function loadCareerBoardFile(fileName: string): Promise<WatchlistSource[]> {
  const sourceType = getSourceTypeFromFilename(fileName);
  if (!sourceType) return [];

  const raw = await readFile(join(configDir, fileName), "utf8");
  const parsed = JSON.parse(raw) as unknown;
  return parseCareerBoardCatalog(sourceType, parsed);
}

export async function listCareerBoardSources(): Promise<WatchlistSource[]> {
  let files: string[] = [];
  try {
    files = await readdir(configDir);
  } catch {
    files = [];
  }

  const matchedFiles = files.filter((fileName) => getSourceTypeFromFilename(fileName) !== null);

  if (matchedFiles.length === 0) {
    return BUNDLED_CAREER_BOARD_CATALOGS.flatMap(({ sourceType, catalog }) =>
      parseCareerBoardCatalog(sourceType, catalog),
    ).sort((left, right) => left.label.localeCompare(right.label));
  }

  const results = await Promise.all(matchedFiles.map((fileName) => loadCareerBoardFile(fileName)));
  return results.flat().sort((left, right) => left.label.localeCompare(right.label));
}
