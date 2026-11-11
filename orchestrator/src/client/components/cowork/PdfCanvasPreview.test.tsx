import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PdfCanvasPreview } from "./PdfCanvasPreview";

const mocks = vi.hoisted(() => ({ getDocument: vi.fn() }));
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: mocks.getDocument,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

let resize: ResizeObserverCallback;
let containerWidth: number;
let disconnect: ReturnType<typeof vi.fn>;
let renderPage: ReturnType<typeof vi.fn>;
let getPage: ReturnType<typeof vi.fn>;
let destroy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  containerWidth = 600;
  disconnect = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
    () => containerWidth,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    setTransform: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  renderPage = vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }));
  getPage = vi.fn().mockResolvedValue({
    getViewport: ({ scale }: { scale: number }) => ({
      width: 300 * scale,
      height: 400 * scale,
    }),
    render: renderPage,
  });
  destroy = vi.fn().mockResolvedValue(undefined);
  mocks.getDocument.mockReturnValue({
    promise: Promise.resolve({ numPages: 2, getPage }),
    destroy,
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PdfCanvasPreview", () => {
  it("loads the blob URL and renders every page at the container width", async () => {
    render(<PdfCanvasPreview url="blob:resume" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading PDF preview");
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument(),
    );
    expect(mocks.getDocument).toHaveBeenCalledWith("blob:resume");
    expect(getPage.mock.calls).toEqual([[1], [2]]);
    expect(screen.getByLabelText("Resume PDF page 1")).toHaveStyle({
      width: "600px",
      height: "800px",
    });
    expect(screen.getByLabelText("Resume PDF page 2")).toBeInTheDocument();
  });

  it("renders again when the container width changes", async () => {
    render(<PdfCanvasPreview url="blob:resume" />);
    await waitFor(() => expect(renderPage).toHaveBeenCalledTimes(2));
    act(() => {
      containerWidth = 450;
      resize([], {} as ResizeObserver);
    });
    await waitFor(() => expect(renderPage).toHaveBeenCalledTimes(4));
    expect(screen.getByLabelText("Resume PDF page 2")).toHaveStyle({
      width: "450px",
      height: "600px",
    });
  });

  it("offers a download if loading fails", async () => {
    mocks.getDocument.mockReturnValue({
      promise: Promise.reject(new Error("Bad PDF")),
      destroy,
    });
    render(<PdfCanvasPreview url="blob:broken" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not render the PDF preview.",
    );
    expect(screen.getByRole("link", { name: "Download PDF" })).toHaveAttribute(
      "href",
      "blob:broken",
    );
    expect(screen.getByRole("link")).toHaveAttribute("download", "resume.pdf");
  });

  it("offers a download if page rendering fails", async () => {
    renderPage.mockImplementation(() => ({
      promise: Promise.reject(new Error("Render failed")),
      cancel: vi.fn(),
    }));
    render(<PdfCanvasPreview url="blob:resume" />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download PDF" })).toHaveAttribute(
      "href",
      "blob:resume",
    );
  });

  it("cancels active renders on resize and destroys the document on unmount", async () => {
    const pending = deferred<void>();
    const cancel = vi.fn(() => pending.reject(new Error("Cancelled")));
    renderPage.mockReturnValueOnce({ promise: pending.promise, cancel });
    const view = render(<PdfCanvasPreview url="blob:resume" />);
    await waitFor(() => expect(renderPage).toHaveBeenCalledOnce());
    act(() => {
      containerWidth = 450;
      resize([], {} as ResizeObserver);
    });
    await waitFor(() => expect(renderPage).toHaveBeenCalledTimes(3));
    expect(cancel).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    view.unmount();
    expect(destroy).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("cancels rendering and destroys the previous document when the URL changes", async () => {
    const pending = deferred<void>();
    const cancel = vi.fn(() => pending.reject(new Error("Cancelled")));
    renderPage.mockReturnValueOnce({ promise: pending.promise, cancel });
    const view = render(<PdfCanvasPreview url="blob:first" />);
    await waitFor(() => expect(renderPage).toHaveBeenCalledOnce());
    view.rerender(<PdfCanvasPreview url="blob:second" />);
    await waitFor(() => expect(renderPage).toHaveBeenCalledTimes(3));
    expect(cancel).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
    expect(mocks.getDocument).toHaveBeenLastCalledWith("blob:second");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("cancels an active page render on unmount", async () => {
    const pending = deferred<void>();
    const cancel = vi.fn(() => pending.reject(new Error("Cancelled")));
    renderPage.mockReturnValueOnce({ promise: pending.promise, cancel });
    const view = render(<PdfCanvasPreview url="blob:resume" />);
    await waitFor(() => expect(renderPage).toHaveBeenCalledOnce());
    view.unmount();
    expect(cancel).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
    await act(async () => {});
    expect(getPage).toHaveBeenCalledOnce();
  });

  it("destroys a pending load on unmount without rendering its late result", async () => {
    const pending = deferred<{ numPages: number; getPage: typeof getPage }>();
    mocks.getDocument.mockReturnValue({ promise: pending.promise, destroy });
    const view = render(<PdfCanvasPreview url="blob:resume" />);
    view.unmount();
    await act(async () => pending.resolve({ numPages: 2, getPage }));
    expect(destroy).toHaveBeenCalledOnce();
    expect(getPage).not.toHaveBeenCalled();
  });
});
