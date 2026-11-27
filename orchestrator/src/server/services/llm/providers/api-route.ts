import { createChatCompletionsStrategy } from "./factory";

export const apiRouteStrategy = createChatCompletionsStrategy({
  provider: "api_route",
  defaultBaseUrl: "https://global.api-route.com/v1",
});
