import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openJobPdf } from "./private-pdf";

const mocks = vi.hoisted(() => ({ blob: vi.fn() }));
vi.mock("@/client/api", () => ({ getJobPdfBlob: mocks.blob }));
beforeEach(() => {
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:pdf"),
    revokeObjectURL: vi.fn(),
  });
  mocks.blob.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("opens the tab before loading and navigates it when ready", async () => {
  let finish!: (blob: Blob) => void;
  mocks.blob.mockImplementation(
    () =>
      new Promise<Blob>((resolve) => {
        finish = resolve;
      }),
  );
  const tab = {
    opener: {},
    location: { href: "about:blank" },
    closed: false,
    close: vi.fn(),
  };
  const open = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
  const operation = openJobPdf("job");
  expect(open).toHaveBeenCalledWith("about:blank", "_blank");
  expect(tab.location.href).toBe("about:blank");
  finish(new Blob(["fake"]));
  await operation;
  expect(tab.location.href).toBe("blob:pdf");
  expect(tab.opener).toBeNull();
});
it("downloads if the tab is blocked", async () => {
  vi.spyOn(window, "open").mockReturnValue(null);
  mocks.blob.mockResolvedValue(new Blob(["fake"]));
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    expect(this.download).toBe("resume.pdf");
  });
  await openJobPdf("job");
  expect(click).toHaveBeenCalledOnce();
});
it("closes the empty tab when loading fails", async () => {
  const tab = { opener: null, close: vi.fn() };
  vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
  mocks.blob.mockRejectedValue(new Error("Offline"));
  await expect(openJobPdf("job")).rejects.toThrow("Offline");
  expect(tab.close).toHaveBeenCalledOnce();
});

it("reserves a tab before generation and fetches only after generation succeeds", async () => {
  let finish!: () => void;
  const generate = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const tab = {
    opener: {},
    location: { href: "about:blank" },
    closed: false,
    close: vi.fn(),
  };
  const open = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
  mocks.blob.mockResolvedValue(new Blob(["generated"]));
  const operation = openJobPdf("job", generate);
  expect(open).toHaveBeenCalledOnce();
  expect(generate).toHaveBeenCalledOnce();
  expect(mocks.blob).not.toHaveBeenCalled();
  finish();
  await operation;
  expect(mocks.blob).toHaveBeenCalledWith("job");
  expect(tab.location.href).toBe("blob:pdf");
});
it("closes the reserved tab and skips fetching when generation fails", async () => {
  const tab = { opener: null, close: vi.fn() };
  vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
  await expect(
    openJobPdf("job", async () => {
      throw new Error("Render failed");
    }),
  ).rejects.toThrow("Render failed");
  expect(tab.close).toHaveBeenCalledOnce();
  expect(mocks.blob).not.toHaveBeenCalled();
});
