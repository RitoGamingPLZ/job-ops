import { describe, expect, it } from "vitest";
import {
  getDefaultValidationBaseUrl,
  resolveLlmValidationEndpoint,
} from "./llm-validation-endpoint";

const providers = [
  ["litellm", "http://localhost:4000"],
  ["lmstudio", "http://localhost:1234"],
  ["ollama", "http://localhost:11434"],
  ["openai_compatible", "https://api.openai.com"],
  ["glm", "https://api.z.ai/api/paas/v4"],
] as const;

describe("LLM validation endpoints", () => {
  it.each(
    providers,
  )("preserves %s defaults and the caller fallback policy", (provider, baseUrl) => {
    expect(getDefaultValidationBaseUrl(provider)).toBe(baseUrl);
    for (const fallbackToDefault of [false, true]) {
      for (const override of [undefined, null, "", " "]) {
        expect(
          resolveLlmValidationEndpoint({
            provider,
            override,
            stored: undefined,
            environment: undefined,
            fallbackToDefault,
          }),
        ).toEqual({
          usesBaseUrl: true,
          baseUrl: fallbackToDefault || override != null ? baseUrl : undefined,
          hasCustomUserBaseUrl: false,
        });
      }
    }
  });

  it.each([
    [
      undefined,
      " http://stored.example ",
      "http://env.example",
      "http://stored.example",
      true,
    ],
    [
      null,
      "http://stored.example",
      "http://env.example",
      "http://stored.example",
      true,
    ],
    [
      "",
      "http://stored.example",
      " http://env.example ",
      "http://env.example",
      false,
    ],
    [" ", "http://stored.example", "", "http://localhost:4000", false],
    [
      " http://override.example ",
      "http://stored.example",
      "http://env.example",
      "http://override.example",
      true,
    ],
    [undefined, "", " http://env.example ", "http://env.example", false],
    [
      "http://localhost:4000",
      "http://stored.example",
      "http://env.example",
      "http://localhost:4000",
      false,
    ],
    [
      undefined,
      " http://localhost:4000 ",
      "http://env.example",
      "http://localhost:4000",
      false,
    ],
  ] as const)("resolves override %s, stored %s, environment %s", (override, stored, environment, baseUrl, hasCustomUserBaseUrl) => {
    for (const fallbackToDefault of [false, true]) {
      expect(
        resolveLlmValidationEndpoint({
          provider: "litellm",
          override,
          stored,
          environment,
          fallbackToDefault,
        }),
      ).toEqual({ usesBaseUrl: true, baseUrl, hasCustomUserBaseUrl });
    }
  });

  it.each([
    undefined,
    "openai",
    "anthropic",
    "openrouter",
    "unknown",
  ])("does not use a base URL for %s but still detects custom user URLs", (provider) => {
    expect(getDefaultValidationBaseUrl(provider)).toBeUndefined();
    expect(
      resolveLlmValidationEndpoint({
        provider,
        override: undefined,
        stored: "http://custom.example",
        environment: "http://env.example",
        fallbackToDefault: true,
      }),
    ).toEqual({
      usesBaseUrl: false,
      baseUrl: undefined,
      hasCustomUserBaseUrl: true,
    });
  });
});
