import { getLlmMessageText, type LlmRequestOptions } from "../types";
import { addQueryParam, buildHeaders, joinUrl } from "../utils/http";
import { getNestedValue } from "../utils/object";
import { createProviderStrategy } from "./factory";

export const geminiStrategy = createProviderStrategy({
  provider: "gemini",
  defaultBaseUrl: "https://generativelanguage.googleapis.com",
  requiresApiKey: true,
  modes: ["json_schema", "json_object", "none"],
  validationPaths: ["/v1beta/models"],
  buildRequest: ({ mode, baseUrl, apiKey, model, messages, jsonSchema }) => {
    const { systemInstruction, contents } = toGeminiContents(messages);
    const body: Record<string, unknown> = {
      contents,
    };

    if (systemInstruction) {
      body.systemInstruction = systemInstruction;
    }

    if (mode === "json_schema") {
      body.generationConfig = {
        responseMimeType: "application/json",
        responseSchema: toGeminiJsonSchema(jsonSchema.schema),
      };
    } else if (mode === "json_object") {
      body.generationConfig = {
        responseMimeType: "application/json",
      };
    }

    const url = joinUrl(baseUrl, `/v1beta/models/${encodeURIComponent(model)}:generateContent`);
    const urlWithKey = addQueryParam(url, "key", apiKey ?? "");

    return {
      url: urlWithKey,
      headers: buildHeaders({ apiKey: null, provider: "gemini" }),
      body,
    };
  },
  extractText: (response) => {
    const parts = getNestedValue(response, ["candidates", 0, "content", "parts"]);
    if (!Array.isArray(parts)) return null;
    const text = parts
      .map((part) => getNestedValue(part, ["text"]))
      .filter((part) => typeof part === "string")
      .join("");
    return text || null;
  },
  getValidationUrls: ({ baseUrl, apiKey }) => {
    const url = joinUrl(baseUrl, "/v1beta/models");
    return [addQueryParam(url, "key", apiKey ?? "")];
  },
});

// Gemini's Schema proto stores these as int64; the JSON mapping for int64
// is a decimal string, not a JSON number (e.g. "maxLength": "200").
const GEMINI_INT64_SCHEMA_KEYS = new Set([
  "minLength",
  "maxLength",
  "minProperties",
  "maxProperties",
]);

function toGeminiJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map((item) => toGeminiJsonSchema(item));
  }
  if (!schema || typeof schema !== "object") {
    return schema;
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "additionalProperties" || key === "maxItems" || key === "minItems") {
      // Gemini enforces an opaque, undocumented cap on the *sum* of every
      // maxItems/minItems value across the whole request schema (confirmed
      // empirically against the live API: a single field passes up to ~400
      // but fails above ~450, and splitting the same total across several
      // fields fails identically once the sum crosses that line) — rejecting
      // the entire request with a generic "Request contains an invalid
      // argument." once crossed, regardless of how the total is distributed.
      // It's only a soft safety net for generation, so drop it for Gemini
      // rather than risk resume generation silently breaking as the schema
      // (or candidate library) grows.
      continue;
    }
    out[key] =
      GEMINI_INT64_SCHEMA_KEYS.has(key) && typeof value === "number"
        ? String(value)
        : toGeminiJsonSchema(value);
  }

  // Gemini's responseSchema is an OpenAPI-style Schema object: `type` is a single
  // enum value with a separate `nullable` flag, not JSON Schema's `type: [T, "null"]`.
  if (Array.isArray(out.type)) {
    const rawTypes = out.type;
    const types = rawTypes.filter((value) => value !== "null");
    out.type = types[0] ?? "string";
    if (types.length !== rawTypes.length) out.nullable = true;
  }

  const properties = out.properties;
  if (
    properties &&
    typeof properties === "object" &&
    !Array.isArray(properties) &&
    !Object.hasOwn(out, "propertyOrdering")
  ) {
    out.propertyOrdering = Object.keys(properties);
  }

  return out;
}

function toGeminiContents(messages: LlmRequestOptions<unknown>["messages"]): {
  systemInstruction: { parts: Array<{ text: string }> } | null;
  contents: Array<{
    role: "user" | "model";
    parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }>;
  }>;
} {
  const systemParts: string[] = [];
  const contents = messages
    .filter((message) => {
      if (message.role === "system") {
        systemParts.push(getLlmMessageText(message.content));
        return false;
      }
      return true;
    })
    .map((message) => {
      const role: "user" | "model" = message.role === "assistant" ? "model" : "user";
      if (typeof message.content === "string") {
        return { role, parts: [{ text: message.content }] };
      }
      const parts = message.content.map((part) => {
        if (part.type === "text") return { text: part.text };
        const data = part.imageUrl.replace(/^data:[^;]+;base64,/, "");
        return {
          inlineData: {
            mimeType: part.mediaType,
            data,
          },
        };
      });
      return { role, parts };
    });

  const systemInstruction = systemParts.length
    ? { parts: [{ text: systemParts.join("\n") }] }
    : null;

  return { systemInstruction, contents };
}
