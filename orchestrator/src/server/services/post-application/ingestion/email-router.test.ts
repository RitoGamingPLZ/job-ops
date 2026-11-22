import { expect, it, vi } from "vitest";

const { callJson } = vi.hoisted(() => ({ callJson: vi.fn() }));
vi.mock("@server/services/modelSelection", () => ({
  resolveLlmModel: vi.fn().mockResolvedValue("test-model"),
  createConfiguredLlmService: vi.fn().mockResolvedValue({ callJson }),
}));
vi.mock("@server/services/hosted-usage", () => ({
  withHostedUsageReservation: async (_options: unknown, run: () => Promise<{ result: unknown }>) =>
    (await run()).result,
}));

import { classifyWithSmartRouter } from "./email-router";

it("routes behavioural interviews and guides the LLM to distinguish technical interviews", async () => {
  callJson.mockResolvedValueOnce({
    success: true,
    data: {
      bestMatchIndex: 1,
      confidence: 95,
      stageTarget: "behavioural",
      isRelevant: true,
      stageEventPayload: null,
      reason: "Competency interview invitation",
    },
  });
  const result = await classifyWithSmartRouter({
    emailText: "Please attend a competency interview",
    activeJobs: [{ id: "job-a", company: "Acme", title: "Engineer" }],
  });
  expect(result).toMatchObject({
    bestMatchId: "job-a",
    stageTarget: "behavioural",
    messageType: "interview",
  });
  const request = callJson.mock.calls[0][0];
  expect(request.jsonSchema.schema.properties.stageTarget.enum).toContain("behavioural");
  expect(request.messages[1].content).toContain(
    "Use behavioural for behavioural/behavioral questions",
  );
  expect(request.messages[1].content).toContain("Keep technical_interview coarse");
});
