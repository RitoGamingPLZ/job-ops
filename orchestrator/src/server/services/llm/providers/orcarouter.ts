import { createChatCompletionsStrategy } from "./factory";

export const orcaRouterStrategy = createChatCompletionsStrategy({
  provider: "orcarouter",
  defaultBaseUrl: "https://api.orcarouter.ai/v1",
});
