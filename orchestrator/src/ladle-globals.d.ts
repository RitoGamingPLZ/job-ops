declare global {
  interface Window {
    __mockFetchHandlers: Record<string, unknown> | null;
  }
}

export {};
