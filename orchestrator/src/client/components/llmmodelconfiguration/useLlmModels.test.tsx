import * as api from "@client/api";
import { render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LlmModelConfiguration } from "./LlmModelConfiguration";
import PurposeOverrideCard from "./PurposeOverrideCard";

vi.mock("@client/api", () => ({
  disconnectCodexAuth: vi.fn(),
  getCodexAuthStatus: vi.fn().mockResolvedValue({ authenticated: false }),
  getLlmModels: vi.fn(),
  startCodexAuth: vi.fn(),
}));

const getLlmModels = vi.mocked(api.getLlmModels);
// Wire payload as JSON.stringify sends it (undefined fields dropped).
const sentPayloads = () =>
  getLlmModels.mock.calls.map(([input]) => JSON.parse(JSON.stringify(input)));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  getLlmModels.mockReset();
});

const field = (value = "") => ({ value, onChange: vi.fn() });

type DefaultProps = ComponentProps<typeof LlmModelConfiguration>;
const defaultProps = (overrides: Partial<DefaultProps> = {}): DefaultProps => ({
  mode: "compact",
  disabled: false,
  selectedProvider: "litellm",
  provider: field(),
  baseUrl: field(),
  apiKey: field(),
  model: field(),
  ...overrides,
});

type CardProps = ComponentProps<typeof PurposeOverrideCard>;
const cardProps = (overrides: Partial<CardProps> = {}): CardProps => ({
  purpose: "scoring",
  defaultProvider: "openrouter",
  defaultModel: "",
  defaultBaseUrl: "",
  defaultApiKeyHint: null,
  value: { provider: "litellm" },
  apiKeyValue: "",
  apiKeyHint: null,
  currentModel: "",
  disabled: false,
  onChange: vi.fn(),
  onApiKeyChange: vi.fn(),
  ...overrides,
});

describe("default model list lifecycle", () => {
  it("sends trimmed base URL and key without a purpose", async () => {
    getLlmModels.mockResolvedValue(["m1"]);
    render(
      <LlmModelConfiguration
        {...defaultProps({
          baseUrl: field("  http://proxy:4000  "),
          apiKey: field(" key "),
        })}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByText("Choose from the available text-generation models."),
      ).toBeInTheDocument(),
    );
    expect(sentPayloads()).toEqual([
      { provider: "litellm", baseUrl: "http://proxy:4000", apiKey: "key" },
    ]);
  });

  it("skips required-key providers without a key or hint", () => {
    render(<LlmModelConfiguration {...defaultProps({ selectedProvider: "openai" })} />);
    expect(getLlmModels).not.toHaveBeenCalled();
  });

  it("uses the saved key hint and omits a blank key", async () => {
    getLlmModels.mockResolvedValue([]);
    render(
      <LlmModelConfiguration
        {...defaultProps({ selectedProvider: "openai", apiKeyHint: "sk-1" })}
      />,
    );
    await waitFor(() => expect(getLlmModels).toHaveBeenCalled());
    expect(sentPayloads()).toEqual([{ provider: "openai" }]);
  });

  it("shows loading, then the error message", async () => {
    const request = deferred<string[]>();
    getLlmModels.mockReturnValue(request.promise);
    render(<LlmModelConfiguration {...defaultProps()} />);
    expect(screen.getByText("Loading available models...")).toBeInTheDocument();
    request.reject(new Error("boom"));
    expect(await screen.findByText("boom")).toBeInTheDocument();
  });

  it("falls back to generic error text for non-Error rejections", async () => {
    getLlmModels.mockRejectedValue("nope");
    render(<LlmModelConfiguration {...defaultProps()} />);
    expect(await screen.findByText("Failed to load models.")).toBeInTheDocument();
  });

  it("ignores a stale request after the provider changes", async () => {
    const stale = deferred<string[]>();
    getLlmModels.mockReturnValueOnce(stale.promise).mockResolvedValue([]);
    const { rerender } = render(<LlmModelConfiguration {...defaultProps()} />);
    rerender(<LlmModelConfiguration {...defaultProps({ selectedProvider: "ollama" })} />);
    await waitFor(() => expect(getLlmModels).toHaveBeenCalledTimes(2));
    stale.reject(new Error("stale failure"));
    await waitFor(() =>
      expect(screen.getByText(/No Ollama models were returned/)).toBeInTheDocument(),
    );
    expect(screen.queryByText("stale failure")).not.toBeInTheDocument();
  });
});

describe("purpose override model list lifecycle", () => {
  it("sends trimmed raw values with the purpose", async () => {
    getLlmModels.mockResolvedValue(["m1"]);
    render(
      <PurposeOverrideCard
        {...cardProps({
          value: { provider: "litellm", baseUrl: " http://b:4000 " },
          apiKeyValue: " key ",
        })}
      />,
    );
    await waitFor(() => expect(getLlmModels).toHaveBeenCalled());
    expect(sentPayloads()).toEqual([
      {
        provider: "litellm",
        baseUrl: "http://b:4000",
        apiKey: "key",
        purpose: "scoring",
      },
    ]);
  });

  it("skips required-key providers without a key or any hint", () => {
    render(<PurposeOverrideCard {...cardProps({ value: { provider: "openai" } })} />);
    expect(getLlmModels).not.toHaveBeenCalled();
  });

  it("inherits the default key hint", async () => {
    getLlmModels.mockResolvedValue([]);
    render(
      <PurposeOverrideCard
        {...cardProps({
          value: { provider: "openai" },
          defaultApiKeyHint: "sk-1",
        })}
      />,
    );
    await waitFor(() => expect(getLlmModels).toHaveBeenCalled());
    expect(sentPayloads()).toEqual([{ provider: "openai", purpose: "scoring" }]);
  });

  it("shows loading, then error text with a non-Error fallback", async () => {
    const request = deferred<string[]>();
    getLlmModels.mockReturnValue(request.promise);
    render(<PurposeOverrideCard {...cardProps()} />);
    expect(screen.getByText("Loading available models...")).toBeInTheDocument();
    request.reject("nope");
    expect(await screen.findByText("Failed to load models.")).toBeInTheDocument();
  });
});
