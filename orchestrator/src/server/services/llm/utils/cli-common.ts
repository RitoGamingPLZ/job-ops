import { getErrorMessage } from "@infra/errors";
import { logger } from "@infra/logger";
import { getLlmMessageText, type LlmRequestOptions } from "../types";
import { truncate } from "./string";

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

export function buildCliErrorMessage(
  error: unknown,
  opts: { enoentMessage: string; einvalMessage?: string; maxLength?: number },
): string {
  const message = getErrorMessage(error);
  if (message.includes("ENOENT")) {
    return opts.enoentMessage;
  }
  if (opts.einvalMessage && message.includes("EINVAL")) {
    return opts.einvalMessage;
  }
  return truncate(message, opts.maxLength ?? 500);
}

export async function validateCliCredentials(args: {
  label: string;
  run: () => Promise<{ stdout: string }>;
  parse: (stdout: string) => void;
  formatError: (error: unknown) => string;
}): Promise<{
  valid: boolean;
  message: string | null;
  username: null;
}> {
  try {
    const { stdout } = await args.run();
    try {
      args.parse(stdout);
    } catch {
      return {
        valid: false,
        message: `${args.label} ran but the response was not in the expected format. Check CLI output or authentication.`,
        username: null,
      };
    }
    return { valid: true, message: null, username: null };
  } catch (error) {
    if (error instanceof Error && error.message.includes("aborted")) {
      return {
        valid: false,
        message: `${args.label} validation was cancelled.`,
        username: null,
      };
    }
    const message = args.formatError(error);
    logger.warn(`${args.label} credential validation failed`, {
      message: truncate(message, 200),
    });
    return {
      valid: false,
      message,
      username: null,
    };
  }
}
