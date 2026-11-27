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

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function createCareerBoardResponseHelpers(board: string) {
  return {
    fetchJson: <T>(fetchFn: typeof fetch, input: Parameters<typeof fetchJson>[2]) =>
      fetchJson<T>(board, fetchFn, input),
    requiredString: (value: unknown, fieldName: string, url: string) =>
      requiredString(board, value, fieldName, url),
    optionalString,
  };
}
