import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMediaQuery } from "./useMediaQuery";

const originalMatchMedia = window.matchMedia;

function installMatchMedia(initial: boolean, legacy = false) {
  const listeners = new Set<() => void>();
  const media = {
    matches: initial,
    addEventListener: legacy
      ? undefined
      : vi.fn((_: string, cb: () => void) => listeners.add(cb)),
    removeEventListener: vi.fn((_: string, cb: () => void) =>
      listeners.delete(cb),
    ),
    addListener: vi.fn((cb: () => void) => listeners.add(cb)),
    removeListener: vi.fn((cb: () => void) => listeners.delete(cb)),
  };
  window.matchMedia = vi.fn(() => media) as unknown as typeof window.matchMedia;
  const set = (value: boolean) =>
    act(() => {
      media.matches = value;
      for (const cb of listeners) cb();
    });
  return { media, listeners, set };
}

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

describe("useMediaQuery", () => {
  it("tracks changes through modern listeners and cleans up", () => {
    const { media, listeners, set } = installMatchMedia(true);
    const { result, unmount } = renderHook(() =>
      useMediaQuery("(min-width: 1024px)"),
    );
    expect(result.current).toBe(true);
    expect(window.matchMedia).toHaveBeenCalledWith("(min-width: 1024px)");
    expect(media.addEventListener).toHaveBeenCalledTimes(1);
    expect(media.addListener).not.toHaveBeenCalled();
    set(false);
    expect(result.current).toBe(false);
    unmount();
    expect(media.removeEventListener).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
  });

  it("falls back to legacy listeners", () => {
    const { media, listeners, set } = installMatchMedia(false, true);
    const { result, unmount } = renderHook(() =>
      useMediaQuery("(min-width: 1024px)"),
    );
    expect(result.current).toBe(false);
    expect(media.addListener).toHaveBeenCalledTimes(1);
    set(true);
    expect(result.current).toBe(true);
    unmount();
    expect(media.removeListener).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
  });

  it("re-syncs on mount when the match changed after initial render", () => {
    const { media } = installMatchMedia(false);
    const { result } = renderHook(() => {
      const matches = useMediaQuery("(min-width: 1024px)");
      media.matches = true;
      return matches;
    });
    expect(result.current).toBe(true);
  });

  it("returns false without matchMedia when told to", () => {
    // @ts-expect-error simulate an environment without matchMedia
    window.matchMedia = undefined;
    const { result } = renderHook(() =>
      useMediaQuery("(min-width: 1024px)", "false"),
    );
    expect(result.current).toBe(false);
  });

  it("throws without matchMedia by default", () => {
    // @ts-expect-error simulate an environment without matchMedia
    window.matchMedia = undefined;
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      renderHook(() => useMediaQuery("(min-width: 1024px)")),
    ).toThrow(TypeError);
  });
});
