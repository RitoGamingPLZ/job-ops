import { getLlmMessageText, type LlmRequestOptions } from "../types";

export function needsWindowsShell(command: string): boolean {
  if (process.platform !== "win32") return false;
  const lower = command.trim().toLowerCase();
  return lower.endsWith(".cmd") || lower.endsWith(".bat");
}

export function formatTranscript(messages: LlmRequestOptions<unknown>["messages"]): string {
  return messages
    .map((message, index) => {
      return `Message ${index + 1} (${message.role.toUpperCase()}):\n${getLlmMessageText(message.content).trim()}`;
    })
    .join("\n\n");
}
