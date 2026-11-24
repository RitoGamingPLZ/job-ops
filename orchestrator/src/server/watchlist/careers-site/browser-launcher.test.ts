import { afterEach, describe, expect, it, vi } from "vitest";
import { hasCareersBrowser, loadPage, setCareersBrowserLauncher } from "./fetch";

describe("careers browser launcher", () => {
  afterEach(() => setCareersBrowserLauncher(null));

  it("reports whether a launcher was injected", () => {
    expect(hasCareersBrowser()).toBe(false);
    setCareersBrowserLauncher(async () => ({}) as never);
    expect(hasCareersBrowser()).toBe(true);
    setCareersBrowserLauncher(null);
    expect(hasCareersBrowser()).toBe(false);
  });

  it("closes the previous shared browser when the launcher changes", async () => {
    const close = vi.fn(async () => {});
    const browser = {
      on: vi.fn(),
      close,
      newContext: vi.fn(async () => {
        throw new Error("stop after launch");
      }),
    };
    const launcher = vi.fn(async () => browser as never);
    setCareersBrowserLauncher(launcher);

    // 93.184.216.34 is a public literal IP, so no DNS lookup is needed to reach the launcher.
    await expect(loadPage("https://93.184.216.34/jobs", { render: true })).rejects.toThrow(
      "stop after launch",
    );
    expect(launcher).toHaveBeenCalledTimes(1);

    setCareersBrowserLauncher(null);
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  });
});
