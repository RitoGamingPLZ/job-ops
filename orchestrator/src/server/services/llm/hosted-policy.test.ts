import { describe, expect, it } from "vitest";
import { isHostedLocalProvider } from "./hosted-policy";

describe("hosted LLM policy", () => {
  it("blocks deployment-local providers", () => {
    expect(isHostedLocalProvider("ollama")).toBe(true);
    expect(isHostedLocalProvider("lm-studio")).toBe(true);
    expect(isHostedLocalProvider("openai")).toBe(false);
  });
});
