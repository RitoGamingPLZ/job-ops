import { type GlobalProvider, ThemeState } from "@ladle/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { MemoryRouter } from "react-router-dom";
import "../src/index.css";

declare global {
  interface Window {
    __mockFetchHandlers: Record<string, unknown> | null;
  }
}

const originalFetch = window.fetch;

window.__mockFetchHandlers = null;

window.fetch = async (url, init) => {
  const urlStr = typeof url === "string" ? url : (url as Request).url || "";
  const path = urlStr.replace(/^https?:\/\/[^/]+/, "");

  const handlers = window.__mockFetchHandlers;
  if (handlers) {
    for (const [pattern, handler] of Object.entries(handlers)) {
      if (path.includes(pattern)) {
        const resData =
          typeof handler === "function"
            ? await (handler as (...args: unknown[]) => unknown)(urlStr, init)
            : handler;
        if (resData instanceof Response) {
          return resData;
        }
        return new Response(JSON.stringify({ ok: true, data: resData }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
  }
  return originalFetch(url, init);
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
      staleTime: Infinity,
    },
  },
});

export const Provider: GlobalProvider = ({ children, globalState }) => {
  const isDark =
    globalState.theme === ThemeState.Dark ||
    (globalState.theme === ThemeState.Auto &&
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-color-scheme: dark)")?.matches);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <div
          className={`${isDark ? "dark " : ""}min-h-screen bg-background p-3 text-foreground sm:p-6`}
        >
          {children}
        </div>
      </MemoryRouter>
    </QueryClientProvider>
  );
};
