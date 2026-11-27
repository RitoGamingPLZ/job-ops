import { getRequestContext, runWithRequestContext } from "@infra/request-context";
import { postJsonToPublicUrl } from "@infra/safe-fetch";
import * as settingsRepo from "@server/repositories/settings";
import { afterEach, expect, it, vi } from "vitest";
import { deliverWebhook } from "./webhooks";

vi.mock("@infra/safe-fetch", () => ({ postJsonToPublicUrl: vi.fn() }));
vi.mock("@server/repositories/settings", () => ({ getSetting: vi.fn() }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

it("uses each workspace's webhook secret during concurrent deliveries", async () => {
  vi.stubEnv("WEBHOOK_SECRET", "operator-secret");
  vi.mocked(settingsRepo.getSetting).mockImplementation(async () => {
    const tenantId = getRequestContext()?.tenantId;
    await Promise.resolve();
    return `secret-${tenantId}`;
  });
  vi.mocked(postJsonToPublicUrl).mockImplementation(
    async () => new Response(null, { status: 204 }),
  );

  await Promise.all(
    ["workspace-a", "workspace-b"].map((tenantId) =>
      runWithRequestContext({ tenantId }, () =>
        deliverWebhook({
          url: `https://${tenantId}.example/webhook`,
          operatorTrusted: false,
          payload: { event: "job.completed" },
          failureMessage: "Webhook delivery failed",
          context: { jobId: tenantId },
        }),
      ),
    ),
  );

  for (const tenantId of ["workspace-a", "workspace-b"]) {
    expect(postJsonToPublicUrl).toHaveBeenCalledWith(
      `https://${tenantId}.example/webhook`,
      { event: "job.completed" },
      expect.objectContaining({ Authorization: `Bearer secret-${tenantId}` }),
      expect.objectContaining({ allowPrivateNetwork: false }),
    );
  }
});
