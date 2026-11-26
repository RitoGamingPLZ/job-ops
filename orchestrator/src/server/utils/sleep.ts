export function sleep(ms: number, options?: { unref?: boolean }): Promise<void> {
  return new Promise((resolve) => {
    const handle = setTimeout(resolve, ms);
    if (options?.unref) {
      handle.unref?.();
    }
  });
}
