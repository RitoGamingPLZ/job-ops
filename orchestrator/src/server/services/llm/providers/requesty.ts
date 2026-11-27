import { createChatCompletionsStrategy } from "./factory";

export const requestyStrategy = createChatCompletionsStrategy({
  provider: "requesty",
  defaultBaseUrl: "https://router.requesty.ai/v1",
});
