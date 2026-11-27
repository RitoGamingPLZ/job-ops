export class WorkdayCxsFetchError extends Error {
  readonly status?: number;
  readonly url: string;
  readonly responseBody?: string;

  constructor(args: { message: string; url: string; status?: number; responseBody?: string }) {
    super(args.message);
    this.name = "WorkdayCxsFetchError";
    this.url = args.url;
    this.status = args.status;
    this.responseBody = args.responseBody;
  }
}

export async function fetchWorkdayCxsJson<T>(
  fetchFn: typeof fetch,
  args: {
    url: string | URL;
    method: "GET" | "POST";
    headers: HeadersInit;
    body?: string;
    signal?: AbortSignal;
    errorContext: string;
  },
): Promise<T> {
  const response = await fetchFn(args.url, {
    method: args.method,
    signal: args.signal,
    headers: args.headers,
    ...(args.body !== undefined ? { body: args.body } : {}),
  });

  const responseText = await response.text();
  const urlString = args.url.toString();

  if (!response.ok) {
    throw new WorkdayCxsFetchError({
      url: urlString,
      status: response.status,
      message: `${args.errorContext} failed with HTTP ${response.status}.`,
      responseBody: responseText.slice(0, 2_000),
    });
  }

  try {
    return JSON.parse(responseText) as T;
  } catch {
    throw new WorkdayCxsFetchError({
      url: urlString,
      status: response.status,
      message: `${args.errorContext.replace(/ request$/, "")} response was not valid JSON.`,
      responseBody: responseText.slice(0, 2_000),
    });
  }
}

export function requiredWorkdayString(
  value: unknown,
  fieldName: string,
  options: { url: string; contextLabel: string },
): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  throw new WorkdayCxsFetchError({
    url: options.url,
    message: `${options.contextLabel} is missing required field: ${fieldName}.`,
  });
}
