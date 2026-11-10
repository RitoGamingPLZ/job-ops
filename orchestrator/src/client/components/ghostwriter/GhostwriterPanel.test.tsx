import { ApiClientError } from "@client/api/core";
import { createJob } from "@shared/testing/factories.js";
import type { CoworkChatContext, JobChatMessage } from "@shared/types";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GhostwriterPanel } from "./GhostwriterPanel";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  send: vi.fn(),
  regenerate: vi.fn(),
  edit: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("@client/api", () => ({
  listJobGhostwriterMessages: mocks.list,
  streamJobGhostwriterMessage: mocks.send,
  streamRegenerateJobGhostwriterMessage: mocks.regenerate,
  editJobGhostwriterMessage: mocks.edit,
  getJobNotes: async () => [],
  getJobEmails: async () => ({ items: [] }),
  getJobDocuments: async () => [],
}));
vi.mock("sonner", () => ({ toast: { message: mocks.toast } }));
vi.mock("@/lib/analytics", () => ({
  bucketQueryLength: vi.fn(),
  trackProductEvent: vi.fn(),
}));
vi.mock("./GhostwriterContextSelector", () => ({
  GhostwriterContextSelector: () => null,
}));
vi.mock("./Composer", () => ({
  Composer: ({
    onSend,
    disabled,
  }: {
    onSend: (text: string) => void;
    disabled: boolean;
  }) => (
    <button type="button" disabled={disabled} onClick={() => onSend("Prompt")}>
      Send
    </button>
  ),
}));
vi.mock("./MessageList", () => ({
  MessageList: ({
    onRegenerate,
    onEdit,
  }: {
    onRegenerate: (id: string) => void;
    onEdit: (id: string, content: string) => void;
  }) => (
    <div>
      <button type="button" onClick={() => onRegenerate("assistant")}>
        Regenerate
      </button>
      <button type="button" onClick={() => onEdit("user", "Edited")}>
        Edit message
      </button>
    </div>
  ),
}));
afterEach(cleanup);
const context = {
  document: { basics: { headline: "Current" } },
  referencedBulletIds: ["ref"],
} as CoworkChatContext;
const result = (messages: JobChatMessage[] = []) => ({
  messages,
  branches: [],
  selectedNoteIds: [],
  selectedEmailIds: [],
  selectedDocumentIds: [],
});
// The panel delegates message rendering; only an id is needed in this fixture.
const message = { id: "assistant" } as JobChatMessage;
function mount() {
  render(
    <MemoryRouter>
      <GhostwriterPanel
        job={createJob()}
        cowork={() => context}
        referenceChips={<button type="button">Remove reference</button>}
      />
    </MemoryRouter>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue(result([message]));
  mocks.send.mockResolvedValue(undefined);
  mocks.regenerate.mockResolvedValue(undefined);
  mocks.edit.mockResolvedValue(undefined);
});
describe("co-work chat context", () => {
  it("keeps reference chips visible in empty and populated conversations", async () => {
    mocks.list
      .mockResolvedValueOnce(result())
      .mockResolvedValue(result([message]));
    mount();
    await waitFor(() => expect(screen.getByText("Send")).toBeEnabled());
    expect(screen.getByText("Remove reference")).toBeVisible();
    fireEvent.click(screen.getByText("Send"));
    await screen.findByText("Regenerate");
    expect(screen.getByText("Remove reference")).toBeVisible();
    expect(mocks.send.mock.calls[0][1].cowork).toEqual(context);
  });
  it.each([
    "Regenerate",
    "Edit message",
  ])("sends fresh co-work context on %s", async (action) => {
    mount();
    await screen.findByText("Regenerate");
    fireEvent.click(screen.getByText(action));
    const request = action === "Regenerate" ? mocks.regenerate : mocks.edit;
    await waitFor(() => expect(request).toHaveBeenCalled());
    expect(request.mock.calls[0][2].cowork).toEqual(context);
  });
  it.each([
    "Regenerate",
    "Edit message",
  ])("handles an unavailable co-work endpoint on %s", async (action) => {
    const request = action === "Regenerate" ? mocks.regenerate : mocks.edit;
    request.mockRejectedValueOnce(
      new ApiClientError("Unavailable", { status: 501 }),
    );
    mount();
    await screen.findByText("Regenerate");
    fireEvent.click(screen.getByText(action));
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith("Co-work is not available yet."),
    );
  });
});

describe("initial prompt", () => {
  function Host() {
    const [prompt, setPrompt] = useState<string | null>(null);
    return (
      <MemoryRouter>
        <button type="button" onClick={() => setPrompt("Close the gap")}>
          Ask
        </button>
        <GhostwriterPanel
          job={createJob()}
          initialPrompt={prompt}
          onInitialPromptConsumed={() => setPrompt(null)}
        />
      </MemoryRouter>
    );
  }
  it("sends the same prompt again after it was consumed", async () => {
    render(<Host />);
    await screen.findByText("Regenerate");
    fireEvent.click(screen.getByText("Ask"));
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("Send")).toBeEnabled());
    fireEvent.click(screen.getByText("Ask"));
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(2));
    expect(mocks.send.mock.calls[1][1].content).toBe("Close the gap");
  });
});
