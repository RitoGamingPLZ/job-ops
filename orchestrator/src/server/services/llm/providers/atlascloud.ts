import { createChatCompletionsStrategy } from "./factory";

export const atlasCloudStrategy = createChatCompletionsStrategy({
  provider: "atlascloud",
  defaultBaseUrl: "https://api.atlascloud.ai",
  requestPath: "/v1/chat/completions",
  modelsPath: "/api/v1/models",
});
