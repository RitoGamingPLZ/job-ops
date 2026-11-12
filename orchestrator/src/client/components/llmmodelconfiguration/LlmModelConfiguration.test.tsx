import { getDefaultModelForProvider } from "@shared/settings-registry";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LlmModelConfiguration } from "./LlmModelConfiguration";

vi.mock("@client/api", () => ({
  disconnectCodexAuth: vi.fn(),
  getCodexAuthStatus: vi.fn().mockResolvedValue({
    authenticated: false,
    username: null,
    validationMessage:
      "Codex is not authenticated in this container. Run `codex login` and try again.",
    flowStatus: "idle",
    loginInProgress: false,
    verificationUrl: null,
    userCode: null,
    startedAt: null,
    expiresAt: null,
    flowMessage: null,
  }),
  getLlmModels: vi.fn().mockResolvedValue([]),
  startCodexAuth: vi.fn(),
}));

type Props = ComponentProps<typeof LlmModelConfiguration>;
const field = (value = "") => ({ value, onChange: vi.fn() });
function props(): Props & {
  purposeOverrides: NonNullable<Props["purposeOverrides"]>;
} {
  return {
    mode: "settings",
    disabled: false,
    selectedProvider: "openrouter",
    savedProvider: "openrouter",
    effectiveModel: "google/gemini-3-flash-preview",
    provider: field("openrouter"),
    baseUrl: field(),
    apiKey: field(),
    model: field("google/gemini-3-flash-preview"),
    modelScorer: field(),
    purposeOverrides: {
      values: { scoring: { provider: "openai" } },
      apiKeys: {},
      apiKeyHints: {},
      // Saved resolved values must never override edits to the purpose form.
      models: {
        scoring: "stale-saved",
        tailoring: "stale-saved",
        projectSelection: "stale-saved",
      },
      onChange: vi.fn(),
      onApiKeyChange: vi.fn(),
    },
  };
}
function previewValue(label: string) {
  return screen.getByText(label, { exact: true }).nextElementSibling;
}

afterEach(cleanup);

describe("LLM form configuration preview", () => {
  it("shows the scoring provider and its default for a provider-only override", () => {
    render(<LlmModelConfiguration {...props()} />);
    expect(screen.getByText("Configuration preview")).toBeInTheDocument();
    expect(previewValue("Scoring provider")).toHaveTextContent("openai");
    expect(previewValue("Scoring model")).toHaveTextContent(
      getDefaultModelForProvider("openai"),
    );
  });

  it("inherits the draft default for a same-provider or unset provider", () => {
    const input = props();
    input.purposeOverrides.values = { scoring: { provider: "openrouter" } };
    input.model = field("draft-global-model");
    const { rerender } = render(<LlmModelConfiguration {...input} />);
    expect(previewValue("Scoring provider")).toHaveTextContent("openrouter");
    expect(previewValue("Scoring model")).toHaveTextContent(
      "draft-global-model",
    );
    input.purposeOverrides.values = {};
    rerender(<LlmModelConfiguration {...input} />);
    expect(previewValue("Scoring model")).toHaveTextContent(
      "draft-global-model",
    );
  });

  it("updates explicit models and provider-only drafts without using stale legacy or saved pairs", () => {
    const input = props();
    input.modelScorer = field("stale-legacy-model");
    input.purposeOverrides.values = {
      scoring: { provider: "openai", model: "gpt-draft" },
    };
    const { rerender } = render(<LlmModelConfiguration {...input} />);
    expect(previewValue("Scoring model")).toHaveTextContent("gpt-draft");
    input.purposeOverrides.values = { scoring: { provider: "anthropic" } };
    rerender(<LlmModelConfiguration {...input} />);
    expect(previewValue("Scoring provider")).toHaveTextContent("anthropic");
    expect(previewValue("Scoring model")).toHaveTextContent(
      getDefaultModelForProvider("anthropic"),
    );
    input.purposeOverrides.values = { scoring: {} };
    input.model = field("new-global-draft");
    rerender(<LlmModelConfiguration {...input} />);
    expect(previewValue("Scoring model")).toHaveTextContent("new-global-draft");
  });

  it("uses the new default provider model when the default provider draft changes", () => {
    const input = props();
    input.purposeOverrides.values = {};
    const { rerender } = render(<LlmModelConfiguration {...input} />);
    input.selectedProvider = "anthropic";
    input.model = field();
    rerender(<LlmModelConfiguration {...input} />);
    expect(previewValue("Scoring provider")).toHaveTextContent("anthropic");
    expect(previewValue("Scoring model")).toHaveTextContent(
      getDefaultModelForProvider("anthropic"),
    );
  });

  it("previews the inherited default after clearing a saved global model", () => {
    const input = props();
    input.purposeOverrides.values = {};
    input.defaultModel = "provider-default-model";
    input.effectiveModel = "saved-custom-model";
    input.model = field("saved-custom-model");
    const { rerender } = render(<LlmModelConfiguration {...input} />);
    expect(previewValue("Scoring model")).toHaveTextContent(
      "saved-custom-model",
    );
    input.model = field();
    rerender(<LlmModelConfiguration {...input} />);
    expect(previewValue("Scoring model")).toHaveTextContent(
      "provider-default-model",
    );
  });

  it("keeps legacy model overrides and inheritance for callers without purpose bindings", () => {
    const input: Props = props();
    input.purposeOverrides = undefined;
    input.modelScorer = field("legacy-explicit-model");
    const { rerender } = render(<LlmModelConfiguration {...input} />);
    expect(previewValue("Scoring model")).toHaveTextContent(
      "legacy-explicit-model",
    );
    input.modelScorer = field();
    rerender(<LlmModelConfiguration {...input} />);
    expect(previewValue("Scoring model")).toHaveTextContent("inherits");
  });
});

const textField = {
  value: "",
  onChange: vi.fn(),
};

describe("LlmModelConfiguration", () => {
  it("does not render an LLM API key affordance for Codex in compact mode", async () => {
    render(
      <LlmModelConfiguration
        mode="compact"
        disabled={false}
        selectedProvider="codex"
        provider={textField}
        baseUrl={textField}
        apiKey={textField}
        model={textField}
      />,
    );

    expect(screen.getByText("Codex Sign-In")).toBeInTheDocument();
    expect(screen.queryByLabelText(/api key/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText("No API key is required for this provider."),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "find out what model name to use" }),
    ).toHaveAttribute("href", "https://developers.openai.com/codex/models");
  });

  it("asks Ollama users to choose an installed model instead of using a default", async () => {
    render(
      <LlmModelConfiguration
        mode="compact"
        disabled={false}
        selectedProvider="ollama"
        provider={textField}
        baseUrl={textField}
        apiKey={textField}
        model={textField}
      />,
    );

    expect(screen.getByLabelText("API key (optional)")).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.getByText(
          "No Ollama models were returned. Pull a model in Ollama, then choose it here before continuing.",
        ),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("Current:")).toBeInTheDocument();
    expect(screen.getByText("-")).toBeInTheDocument();
  });
});
