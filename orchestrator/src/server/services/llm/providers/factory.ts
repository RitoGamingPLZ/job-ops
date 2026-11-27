import type {
  JsonSchemaDefinition,
  LlmMessage,
  LlmMessageContent,
  LlmRequestOptions,
  ProviderStrategy,
  ResponseMode,
} from "../types";
import { buildHeaders, joinUrl } from "../utils/http";
import { getNestedValue } from "../utils/object";

type ProviderStrategyArgs = Omit<ProviderStrategy, "getValidationUrls"> & {
  validationPaths: string[];
  getValidationUrls?: ProviderStrategy["getValidationUrls"];
};

export function createProviderStrategy(args: ProviderStrategyArgs): ProviderStrategy {
  const { validationPaths, ...strategy } = args;
  return {
    ...strategy,
    getValidationUrls:
      args.getValidationUrls ??
      (({ baseUrl }) => validationPaths.map((path) => joinUrl(baseUrl, path))),
  };
}

export function buildChatCompletionsBody(args: {
  mode: ResponseMode;
  model: string;
  messages: LlmRequestOptions<unknown>["messages"];
  jsonSchema: JsonSchemaDefinition;
  extra?: Record<string, unknown>;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: args.model,
    messages: toChatCompletionsMessages(args.messages),
    stream: false,
    ...args.extra,
  };

  if (args.mode === "json_schema") {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: args.jsonSchema.name,
        strict: true,
        schema: args.jsonSchema.schema,
      },
    };
  } else if (args.mode === "json_object") {
    body.response_format = { type: "json_object" };
  } else if (args.mode === "text") {
    body.response_format = { type: "text" };
  }

  return body;
}

function toChatCompletionsContent(content: LlmMessageContent) {
  if (typeof content === "string") return content;
  return content.map((part) => {
    if (part.type === "text") {
      return { type: "text", text: part.text };
    }
    return {
      type: "image_url",
      image_url: {
        url: part.imageUrl,
      },
    };
  });
}

function toChatCompletionsMessages(messages: LlmMessage[]) {
  return messages.map((message) => ({
    role: message.role,
    content: toChatCompletionsContent(message.content),
  }));
}

export function extractChatCompletionsText(response: unknown): string | null {
  const content = getNestedValue(response, ["choices", 0, "message", "content"]);
  return typeof content === "string" ? content : null;
}

export function createCliStrategy(
  provider: ProviderStrategy["provider"],
  label: string,
): ProviderStrategy {
  return createProviderStrategy({
    provider,
    defaultBaseUrl: "",
    requiresApiKey: false,
    modes: ["none"],
    validationPaths: [],
    buildRequest: () => {
      throw new Error(`${label} provider does not use HTTP requests.`);
    },
    extractText: () => null,
  });
}

export function createChatCompletionsStrategy(args: {
  provider: ProviderStrategy["provider"];
  defaultBaseUrl: string;
  requestPath?: string;
  modelsPath?: string;
}): ProviderStrategy {
  return createProviderStrategy({
    provider: args.provider,
    defaultBaseUrl: args.defaultBaseUrl,
    requiresApiKey: true,
    modes: ["json_schema", "json_object", "text", "none"],
    validationPaths: [args.modelsPath ?? "/models"],
    buildRequest: ({ mode, baseUrl, apiKey, model, messages, jsonSchema }) => ({
      url: joinUrl(baseUrl, args.requestPath ?? "/chat/completions"),
      headers: buildHeaders({ apiKey, provider: args.provider }),
      body: buildChatCompletionsBody({ mode, model, messages, jsonSchema }),
    }),
    extractText: extractChatCompletionsText,
  });
}
