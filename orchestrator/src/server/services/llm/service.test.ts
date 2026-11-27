import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClaudeCliClient } from "./claude-cli/client";
import { CodexClient } from "./codex/client";
import { GeminiCliClient } from "./gemini-cli/client";
import { __clearModeCacheForTests } from "./policies/mode-selection";
import { EMPTY_RESPONSE_ERROR } from "./policies/retry-policy";
import { LlmService } from "./service";
import type { JsonSchemaDefinition } from "./types";

const TEST_SCHEMA: JsonSchemaDefinition = {
  name: "test",
  schema: {
    type: "object",
    properties: { value: { type: "string" } },
    required: ["value"],
    additionalProperties: false,
  },
};

function completionResponse(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("LlmService provider normalization", () => {
  afterEach(() => {
    delete process.env.LLM_BASE_URL;
    vi.restoreAllMocks();
  });

  it("keeps legacy localhost openai_compatible configs on LM Studio", () => {
    const llm = new LlmService({
      provider: "openai_compatible",
      baseUrl: "http://localhost:1234",
    });

    expect(llm.getProvider()).toBe("lmstudio");
    expect(llm.getBaseUrl()).toBe("http://localhost:1234");
  });

  it("does not inherit the deployment base URL when environment credentials are disabled", () => {
    process.env.LLM_BASE_URL = "https://internal.jobops.example/llm";

    const llm = new LlmService({
      provider: "openrouter",
      apiKey: "user-key",
      allowEnvironmentCredentials: false,
    });

    expect(llm.getBaseUrl()).toBe("https://openrouter.ai");
  });

  it("defaults CLI providers off with environment credentials disabled", async () => {
    const llm = new LlmService({
      provider: "codex",
      allowEnvironmentCredentials: false,
    });

    const result = await llm.callJson({
      model: "codex-mini",
      messages: [{ role: "user", content: "test" }],
      jsonSchema: TEST_SCHEMA,
    });

    expect(result).toEqual({
      success: false,
      error: "CLI LLM providers are unavailable for this hosted account",
    });
  });

  it("uses the dedicated provider for non-local OpenAI-compatible endpoints", () => {
    const llm = new LlmService({
      provider: "openai_compatible",
      baseUrl: "https://llm.example.com",
    });

    expect(llm.getProvider()).toBe("openai_compatible");
    expect(llm.getBaseUrl()).toBe("https://llm.example.com");
  });

  it("uses the dedicated Atlas Cloud provider and endpoint", () => {
    const llm = new LlmService({
      provider: "atlascloud",
      apiKey: "atlas-test",
    });

    expect(llm.getProvider()).toBe("atlascloud");
    expect(llm.getBaseUrl()).toBe("https://api.atlascloud.ai");
  });

  it("uses the configured LiteLLM proxy URL and an optional virtual key", () => {
    const withKey = new LlmService({
      provider: "litellm",
      baseUrl: "http://litellm.internal:4000",
      apiKey: "sk-virtual",
    });
    expect(withKey.getProvider()).toBe("litellm");
    expect(withKey.getBaseUrl()).toBe("http://litellm.internal:4000");

    const keyless = new LlmService({ provider: "litellm_proxy" });
    expect(keyless.getProvider()).toBe("litellm");
    expect(keyless.getBaseUrl()).toBe("http://localhost:4000");
  });

  it("normalizes the hyphenated openai-compatible alias", () => {
    const llm = new LlmService({
      provider: "openai-compatible",
      baseUrl: "https://llm.example.com",
    });

    expect(llm.getProvider()).toBe("openai_compatible");
    expect(llm.getBaseUrl()).toBe("https://llm.example.com");
  });

  it("supports codex provider normalization", () => {
    const llm = new LlmService({
      provider: "codex",
    });

    expect(llm.getProvider()).toBe("codex");
    expect(llm.getBaseUrl()).toBe("");
  });

  it("supports gemini_cli provider normalization", () => {
    const llm = new LlmService({
      provider: "gemini-cli",
    });

    expect(llm.getProvider()).toBe("gemini_cli");
    expect(llm.getBaseUrl()).toBe("");
  });

  it("supports claude_cli provider normalization", () => {
    const llm = new LlmService({
      provider: "claude-cli",
    });

    expect(llm.getProvider()).toBe("claude_cli");
    expect(llm.getBaseUrl()).toBe("");
  });

  it("supports GLM provider normalization and aliases", () => {
    const glm = new LlmService({
      provider: "glm",
    });
    const zhipu = new LlmService({
      provider: "zhipu-ai",
    });

    expect(glm.getProvider()).toBe("glm");
    expect(glm.getBaseUrl()).toBe("https://api.z.ai/api/paas/v4");
    expect(zhipu.getProvider()).toBe("glm");
  });

  it("supports Anthropic provider normalization and Claude alias", () => {
    const anthropic = new LlmService({
      provider: "anthropic",
    });
    const claude = new LlmService({
      provider: "claude",
    });

    expect(anthropic.getProvider()).toBe("anthropic");
    expect(anthropic.getBaseUrl()).toBe("https://api.anthropic.com");
    expect(claude.getProvider()).toBe("anthropic");
    expect(claude.getBaseUrl()).toBe("https://api.anthropic.com");
  });

  it("ignores stale configured base URLs for native Anthropic", () => {
    const llm = new LlmService({
      provider: "anthropic",
      baseUrl: "https://openrouter.ai",
    });

    expect(llm.getProvider()).toBe("anthropic");
    expect(llm.getBaseUrl()).toBe("https://api.anthropic.com");
  });

  it("retries codex JSON parsing failures and succeeds on a later attempt", async () => {
    const codexCallSpy = vi
      .spyOn(CodexClient.prototype, "callJson")
      .mockResolvedValueOnce({ text: "not-json", turnId: "turn-1" })
      .mockResolvedValueOnce({
        text: '{"value":"ok"}',
        turnId: "turn-2",
      });

    const llm = new LlmService({ provider: "codex" });
    const result = await llm.callJson<{ value: string }>({
      model: "",
      messages: [{ role: "user", content: "Return JSON." }],
      jsonSchema: {
        name: "test",
        schema: {
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
          additionalProperties: false,
        },
      },
      maxRetries: 1,
      retryDelayMs: 1,
    });

    expect(result).toEqual({ success: true, data: { value: "ok" } });
    expect(codexCallSpy).toHaveBeenCalledTimes(2);
  });

  it("delegates codex credential validation to the codex client", async () => {
    const validateSpy = vi
      .spyOn(CodexClient.prototype, "validateCredentials")
      .mockResolvedValue({ valid: true, message: null });

    const llm = new LlmService({ provider: "codex" });
    const result = await llm.validateCredentials();

    expect(result).toEqual({ valid: true, message: null });
    expect(validateSpy).toHaveBeenCalledOnce();
  });

  it("delegates codex model discovery to the codex client", async () => {
    const listSpy = vi
      .spyOn(CodexClient.prototype, "listModels")
      .mockResolvedValue(["gpt-5", "o4-mini"]);

    const llm = new LlmService({ provider: "codex" });
    const models = await llm.listModels();

    expect(models).toEqual(["gpt-5", "o4-mini"]);
    expect(listSpy).toHaveBeenCalledOnce();
  });

  it("delegates gemini_cli credential validation to the Gemini CLI client", async () => {
    const validateSpy = vi
      .spyOn(GeminiCliClient.prototype, "validateCredentials")
      .mockResolvedValue({ valid: true, message: null });

    const llm = new LlmService({ provider: "gemini_cli" });
    const result = await llm.validateCredentials();

    expect(result).toEqual({ valid: true, message: null });
    expect(validateSpy).toHaveBeenCalledOnce();
  });

  it("returns curated models for gemini_cli", async () => {
    const llm = new LlmService({ provider: "gemini_cli" });
    const models = await llm.listModels();

    expect(models[0]).toBe("google/gemini-3.1-flash-lite");
    expect(models.length).toBeGreaterThan(1);
  });

  it("delegates claude_cli credential validation to the Claude CLI client", async () => {
    const validateSpy = vi
      .spyOn(ClaudeCliClient.prototype, "validateCredentials")
      .mockResolvedValue({ valid: true, message: null });

    const llm = new LlmService({ provider: "claude_cli" });
    const result = await llm.validateCredentials();

    expect(result).toEqual({ valid: true, message: null });
    expect(validateSpy).toHaveBeenCalledOnce();
  });

  it("returns curated models for claude_cli", async () => {
    const llm = new LlmService({ provider: "claude_cli" });
    const models = await llm.listModels();

    expect(models[0]).toBe("claude-sonnet-5");
    expect(models.length).toBeGreaterThan(1);
  });

  it("retries a 200 response whose completion is empty and succeeds on the next attempt", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(completionResponse(""))
      .mockResolvedValueOnce(completionResponse('{"value":"ok"}'));

    const llm = new LlmService({
      provider: "openrouter",
      apiKey: "sk-or-test",
    });
    const result = await llm.callJson<{ value: string }>({
      model: "google/gemini-2.5-flash",
      messages: [{ role: "user", content: "Return JSON." }],
      jsonSchema: TEST_SCHEMA,
      maxRetries: 2,
      retryDelayMs: 1,
    });

    expect(result).toEqual({ success: true, data: { value: "ok" } });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("reports the empty completion once the retry budget is exhausted", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => completionResponse(""));

    const llm = new LlmService({
      provider: "openrouter",
      apiKey: "sk-or-test",
    });
    const result = await llm.callJson<{ value: string }>({
      model: "google/gemini-2.5-flash",
      messages: [{ role: "user", content: "Return JSON." }],
      jsonSchema: TEST_SCHEMA,
      maxRetries: 2,
      retryDelayMs: 1,
    });

    expect(result).toEqual({ success: false, error: EMPTY_RESPONSE_ERROR });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("lists Requesty models from the /models endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: "openai/gpt-4o-mini" }, { id: "anthropic/claude-sonnet-4-5" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const llm = new LlmService({
      provider: "requesty",
      apiKey: "rqsty-sk-test",
    });
    const models = await llm.listModels();

    expect(models).toContain("openai/gpt-4o-mini");
    expect(models).toContain("anthropic/claude-sonnet-4-5");
    const [requestedUrl] = fetchSpy.mock.calls[0] ?? [];
    expect(String(requestedUrl)).toBe("https://router.requesty.ai/v1/models");
  });

  it("discovers API Route chat models with the supplied tenant key", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { id: "claude-haiku-4-5" },
            { id: "gpt-6.1-sol" },
            { id: "gpt-image-2" },
            { id: "bytedance/seedance-2" },
            { id: "deepseek-v4-flash-vision-exp" },
            { id: "gpt-6.1-sol" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const llm = new LlmService({
      provider: "api-route",
      apiKey: "tenant-route-test",
      allowEnvironmentCredentials: false,
    });
    expect(llm.getProvider()).toBe("api_route");
    expect(await llm.listModels()).toEqual([
      "gpt-6.1-sol",
      "claude-haiku-4-5",
      "deepseek-v4-flash-vision-exp",
    ]);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://global.api-route.com/v1/models");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer tenant-route-test");
  });

  it("lists console-visible Atlas Cloud text models", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: "deepseek-ai/deepseek-v3.2",
              type: "Text",
              display_console: true,
            },
            { id: "hidden/text-model", type: "Text", display_console: false },
            { id: "image/model", type: "Image", display_console: true },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const llm = new LlmService({
      provider: "atlascloud",
      apiKey: "atlas-test",
    });
    const models = await llm.listModels();

    expect(models).toEqual(["deepseek-ai/deepseek-v3.2"]);
    const [requestedUrl] = fetchSpy.mock.calls[0] ?? [];
    expect(String(requestedUrl)).toBe("https://api.atlascloud.ai/api/v1/models");
  });

  it("lists LiteLLM chat deployments from /model/info", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { model_name: "claude-sonnet", model_info: { mode: "chat" } },
            { model_name: "claude-sonnet", model_info: { mode: "chat" } },
            { model_name: "gpt-4.1-mini", model_info: { mode: null } },
            {
              model_name: "text-embedding-3-small",
              model_info: { mode: "embedding" },
            },
            {
              model_name: "gemini-2.5-flash-image",
              model_info: { mode: "image_generation" },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const llm = new LlmService({
      provider: "litellm",
      baseUrl: "http://localhost:4000/v1/",
      apiKey: "sk-virtual",
    });
    const models = await llm.listModels();

    expect(models).toEqual(["claude-sonnet", "gpt-4.1-mini"]);
    const [requestedUrl, init] = fetchSpy.mock.calls[0] ?? [];
    expect(String(requestedUrl)).toBe("http://localhost:4000/model/info");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer sk-virtual");
  });

  it("falls back to /v1/models when a LiteLLM key cannot read /model/info", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "forbidden" } }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: "claude-sonnet" }, { id: "" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const llm = new LlmService({ provider: "litellm" });
    const models = await llm.listModels();

    expect(models).toEqual(["claude-sonnet"]);
    const [requestedUrl, init] = fetchSpy.mock.calls[1] ?? [];
    expect(String(requestedUrl)).toBe("http://localhost:4000/v1/models");
    expect(new Headers(init?.headers).has("Authorization")).toBe(false);
  });

  it("reports the LiteLLM proxy error when no model list is readable", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "Invalid proxy server token" } }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const llm = new LlmService({ provider: "litellm", apiKey: "sk-bad" });

    await expect(llm.listModels()).rejects.toThrow("Invalid proxy server token");
  });

  it("lists OrcaRouter models from the /models endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: "openai/gpt-4o-mini" }, { id: "anthropic/claude-sonnet-4-5" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const llm = new LlmService({
      provider: "orcarouter",
      apiKey: "sk-orca-test",
    });
    const models = await llm.listModels();

    expect(models).toContain("openai/gpt-4o-mini");
    expect(models).toContain("anthropic/claude-sonnet-4-5");
    const [requestedUrl] = fetchSpy.mock.calls[0] ?? [];
    expect(String(requestedUrl)).toBe("https://api.orcarouter.ai/v1/models");
  });
});

describe("LlmService OpenRouter and fallback behavior", () => {
  const openRouterSchema: JsonSchemaDefinition = {
    name: "test_schema",
    schema: {
      type: "object",
      properties: {
        value: { type: "string", description: "A test value" },
        count: { type: "integer", description: "A test count" },
      },
      required: ["value", "count"],
      additionalProperties: false,
    },
  };

  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    originalEnv = {
      LLM_PROVIDER: process.env.LLM_PROVIDER,
      LLM_BASE_URL: process.env.LLM_BASE_URL,
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
      LLM_API_KEY: process.env.LLM_API_KEY,
    };
    process.env.LLM_PROVIDER = "openrouter";
    process.env.OPENROUTER_API_KEY = "test-api-key";
    delete process.env.LLM_API_KEY;
  });

  afterEach(() => {
    __clearModeCacheForTests();
    for (const [key, val] of Object.entries(originalEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
    vi.restoreAllMocks();
  });

  it("returns error when API key is missing", async () => {
    delete process.env.OPENROUTER_API_KEY;

    const llm = new LlmService({ provider: "openrouter" });
    const result = await llm.callJson({
      model: "test-model",
      messages: [{ role: "user", content: "test" }],
      jsonSchema: openRouterSchema,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("API key");
    }
  });

  it("returns parsed data on successful response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ value: "hello", count: 42 }) } }],
      }),
    } as Response);

    const llm = new LlmService({ provider: "openrouter", apiKey: "test-api-key" });
    expect(process.env.LLM_API_KEY).toBeUndefined();

    const result = await llm.callJson<{ value: string; count: number }>({
      model: "test-model",
      messages: [{ role: "user", content: "test" }],
      jsonSchema: openRouterSchema,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.value).toBe("hello");
      expect(result.data.count).toBe(42);
    }
  });

  it("handles API errors gracefully", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    } as Response);

    const llm = new LlmService({ provider: "openrouter", apiKey: "test-api-key" });
    const result = await llm.callJson({
      model: "test-model",
      messages: [{ role: "user", content: "test" }],
      jsonSchema: openRouterSchema,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("500");
    }
  });

  it("includes json_schema and OpenRouter plugins in request body", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"value": "test", "count": 1}' } }],
      }),
    } as Response);

    const llm = new LlmService({ provider: "openrouter", apiKey: "test-api-key" });
    await llm.callJson({
      model: "test-model",
      messages: [{ role: "user", content: "test prompt" }],
      jsonSchema: openRouterSchema,
    });

    const fetchCall = fetchSpy.mock.calls[0];
    const body = JSON.parse(fetchCall?.[1]?.body as string);
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.name).toBe("test_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.plugins[0].id).toBe("response-healing");
  });

  it("adds OpenRouter headers", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"value": "test", "count": 1}' } }],
      }),
    } as Response);

    const llm = new LlmService({ provider: "openrouter", apiKey: "test-api-key" });
    await llm.callJson({
      model: "test-model",
      messages: [{ role: "user", content: "test prompt" }],
      jsonSchema: openRouterSchema,
    });

    const fetchCall = fetchSpy.mock.calls[0];
    const headers = fetchCall?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toContain("Bearer");
    expect(headers["HTTP-Referer"]).toBe("JobOps");
    expect(headers["X-Title"]).toBe("JobOpsOrchestrator");
  });

  it("retries on parsing failures when maxRetries is set", async () => {
    let callCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      callCount++;
      if (callCount < 3) {
        return {
          ok: true,
          json: async () => ({ choices: [{ message: { content: "invalid json" } }] }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"value": "success", "count": 3}' } }],
        }),
      } as Response;
    });

    const llm = new LlmService({ provider: "openrouter", apiKey: "test-api-key" });
    const result = await llm.callJson<{ value: string; count: number }>({
      model: "test-model",
      messages: [{ role: "user", content: "test" }],
      jsonSchema: openRouterSchema,
      maxRetries: 2,
      retryDelayMs: 10,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.value).toBe("success");
    }
    expect(callCount).toBe(3);
  });

  it("falls back to a looser mode when schema is rejected", async () => {
    process.env.LLM_PROVIDER = "lmstudio";
    delete process.env.OPENROUTER_API_KEY;

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const body = JSON.parse(init?.body as string);
      if (body.response_format?.type === "json_schema") {
        return {
          ok: false,
          status: 400,
          text: async () =>
            JSON.stringify({
              error: "'response_format.type' must be 'json_schema' or 'text'",
            }),
        } as Response;
      }
      if (body.response_format?.type === "text") {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: '{"value": "ok", "count": 1}' } }],
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"value": "fallback", "count": 2}' } }],
        }),
      } as Response;
    });

    const llm = new LlmService({ provider: "lmstudio" });
    const result = await llm.callJson<{ value: string; count: number }>({
      model: "test-model",
      messages: [{ role: "user", content: "test" }],
      jsonSchema: openRouterSchema,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.value).toBe("ok");
    }
    expect(fetchSpy.mock.calls.length).toBe(2);
  });

  it("does not send Authorization header for Gemini key validation", async () => {
    process.env.LLM_PROVIDER = "gemini";
    process.env.LLM_API_KEY = "AIza-valid-gemini-key";
    delete process.env.OPENROUTER_API_KEY;

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ models: [] }),
    } as Response);

    const llm = new LlmService({ provider: "gemini", apiKey: "AIza-valid-gemini-key" });
    const result = await llm.validateCredentials();

    expect(result.valid).toBe(true);
    const fetchCall = fetchSpy.mock.calls[0];
    const headers = fetchCall?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });
});
