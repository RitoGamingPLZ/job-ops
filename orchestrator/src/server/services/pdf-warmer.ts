import { logger } from "@infra/logger";

/** Starts the remote PDF renderer so the next render skips its container cold start. */
export type RemotePdfWarmer = () => Promise<void>;

let remotePdfWarmer: RemotePdfWarmer | null = null;
let lastWarmRequestedAt = 0;
let warmInFlight: Promise<void> | null = null;
/** A warm renderer stays up for a while, so repeated page opens need not poke it again. */
const WARM_REQUEST_COOLDOWN_MS = 60_000;

export function setRemotePdfWarmer(warmer: RemotePdfWarmer | null): void {
  remotePdfWarmer = warmer;
  lastWarmRequestedAt = 0;
  warmInFlight = null;
}

/**
 * Best-effort warm-up of the remote PDF renderer. Returns whether a request was made; false
 * when there is no remote renderer (local rendering has no cold start), one is already in
 * flight, or one was made recently. Never throws: a failed warm-up only means the next render
 * is cold.
 */
export async function warmPdfRenderer(now: number = Date.now()): Promise<boolean> {
  if (!remotePdfWarmer) return false;
  if (warmInFlight) return false;
  if (now - lastWarmRequestedAt < WARM_REQUEST_COOLDOWN_MS) return false;
  lastWarmRequestedAt = now;
  warmInFlight = remotePdfWarmer()
    .catch((error) => {
      lastWarmRequestedAt = 0;
      logger.warn("PDF renderer warm-up failed", { error });
    })
    .finally(() => {
      warmInFlight = null;
    });
  await warmInFlight;
  return true;
}
