import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setRemotePdfWarmer, warmPdfRenderer } from "./pdf-warmer";

// Any realistic clock value: later than the cooldown measured from the epoch.
const T0 = 1_800_000_000_000;

describe("warmPdfRenderer", () => {
  beforeEach(() => setRemotePdfWarmer(null));
  afterEach(() => setRemotePdfWarmer(null));

  it("does nothing when rendering is local", async () => {
    expect(await warmPdfRenderer()).toBe(false);
  });

  it("starts the remote renderer once and then waits out the cooldown", async () => {
    const warm = vi.fn().mockResolvedValue(undefined);
    setRemotePdfWarmer(warm);

    expect(await warmPdfRenderer(T0)).toBe(true);
    expect(await warmPdfRenderer(T0 + 29_000)).toBe(false);
    expect(warm).toHaveBeenCalledTimes(1);

    expect(await warmPdfRenderer(T0 + 61_000)).toBe(true);
    expect(warm).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight warm-up between concurrent callers", async () => {
    let release!: () => void;
    const warm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    setRemotePdfWarmer(warm);

    const first = warmPdfRenderer(T0);
    expect(await warmPdfRenderer(T0 + 1)).toBe(false);
    release();
    expect(await first).toBe(true);
    expect(warm).toHaveBeenCalledTimes(1);
  });

  it("never throws and allows an immediate retry after a failed warm-up", async () => {
    const warm = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(undefined);
    setRemotePdfWarmer(warm);

    await expect(warmPdfRenderer(T0)).resolves.toBe(true);
    await expect(warmPdfRenderer(T0 + 100)).resolves.toBe(true);
    expect(warm).toHaveBeenCalledTimes(2);
  });
});
