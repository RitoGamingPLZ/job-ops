import { toOptionalString } from "./utils/type-conversion";

export const CAREER_BOARD_DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

async function fetchJson<T>(
  board: string,
  fetchFn: typeof fetch,
  input: {
    url: string;
    signal?: AbortSignal;
    headers?: HeadersInit;
  },
): Promise<T> {
  const response = await fetchFn(input.url, {
    method: "GET",
    signal: input.signal,
    headers: input.headers,
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`${board} request failed with HTTP ${response.status} for ${input.url}.`);
  }

  try {
    return JSON.parse(responseText) as T;
  } catch {
    throw new Error(`${board} response was not valid JSON for ${input.url}.`);
  }
}

/** Returns a trimmed non-empty string (finite numbers are stringified, e.g. numeric job ids). */
function requiredString(board: string, value: unknown, fieldName: string, url: string): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string" && value.trim()) return value.trim();
  throw new Error(`${board} response is missing required field ${fieldName} for ${url}.`);
}

export function createCareerBoardResponseHelpers(board: string) {
  return {
    fetchJson: <T>(fetchFn: typeof fetch, input: Parameters<typeof fetchJson>[2]) =>
      fetchJson<T>(board, fetchFn, input),
    requiredString: (value: unknown, fieldName: string, url: string) =>
      requiredString(board, value, fieldName, url),
    optionalString: toOptionalString,
  };
}
