import * as api from "@client/api";
import { useSyncExternalStore } from "react";

const subscribeNoop = () => () => {};
const getFallbackSnapshot = () => "0";
const fallbackHasSession = () => false;

function getOptionalApiFn<T extends (...args: never[]) => unknown>(
  name: keyof typeof api,
  fallback: T,
): T {
  try {
    const candidate = api[name];
    return typeof candidate === "function" ? (candidate as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Subscribes to in-tab auth session transitions (login, logout, account switch). */
export function useAuthSession(): boolean {
  const subscribe = getOptionalApiFn("subscribeAuthSession", subscribeNoop);
  const getSnapshot = getOptionalApiFn("getAuthSessionSnapshot", getFallbackSnapshot);
  const hasSession = getOptionalApiFn("hasAuthenticatedSession", fallbackHasSession);

  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return hasSession();
}
