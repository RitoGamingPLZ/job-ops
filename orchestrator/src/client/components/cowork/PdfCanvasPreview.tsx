import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";

type LoadedPdf = { url: string; task: PDFDocumentLoadingTask; document: PDFDocumentProxy };

/**
 * Shows a PDF as canvases. A new URL or width renders into fresh off-screen canvases and swaps
 * them in only once every page is drawn, so the previous pages stay on screen until the new ones
 * are ready (no blank frame, no layout jump) and a refresh only shows a small badge.
 */
export function PdfCanvasPreview({ url, updating = false }: { url: string; updating?: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const loaded = useRef<LoadedPdf | null>(null);
  const [shown, setShown] = useState<HTMLCanvasElement[] | null>(null);
  const [width, setWidth] = useState(0);
  const [rendering, setRendering] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => setWidth(Math.floor(element.clientWidth));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (width <= 0) return;
    let cancelled = false;
    let loading: PDFDocumentLoadingTask | undefined;
    const tasks = new Set<RenderTask>();
    setRendering(true);
    setFailed(false);

    void (async () => {
      let source = loaded.current?.url === url ? loaded.current : null;
      if (!source) {
        const { GlobalWorkerOptions, getDocument } = await import("pdfjs-dist");
        if (cancelled) return;
        GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.mjs",
          import.meta.url,
        ).toString();
        loading = getDocument({ url });
        const pdf = await loading.promise;
        if (cancelled) return;
        // Pages already on screen are bitmaps, so the previous document is no longer needed.
        const previous = loaded.current;
        source = { url, task: loading, document: pdf };
        loaded.current = source;
        loading = undefined;
        void previous?.task.destroy().catch(() => {});
      }

      const outputScale = Math.max(1, window.devicePixelRatio || 1);
      const pages: HTMLCanvasElement[] = [];
      for (let number = 1; number <= source.document.numPages; number += 1) {
        const page = await source.document.getPage(number);
        if (cancelled) return;
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas unavailable");
        const viewport = page.getViewport({
          scale: width / page.getViewport({ scale: 1 }).width,
        });
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        canvas.className = "block bg-white shadow-sm";
        canvas.setAttribute("aria-label", `Resume PDF page ${number}`);
        context.setTransform(outputScale, 0, 0, outputScale, 0, 0);
        const task = page.render({ canvas, canvasContext: context, viewport });
        tasks.add(task);
        await task.promise;
        tasks.delete(task);
        if (cancelled) return;
        pages.push(canvas);
      }
      setShown(pages);
      setRendering(false);
    })().catch(() => {
      if (!cancelled) setFailed(true);
    });

    return () => {
      cancelled = true;
      for (const task of tasks) task.cancel();
      // A document that finished loading belongs to `loaded`; one still loading is discarded.
      void loading?.destroy().catch(() => {});
    };
  }, [url, width]);

  useEffect(
    () => () => {
      // Destroying the loading task also destroys its document and worker.
      void loaded.current?.task.destroy().catch(() => {});
      loaded.current = null;
    },
    [],
  );

  // The canvases are created outside React, so attach them to the page in one step.
  useEffect(() => {
    host.current?.replaceChildren(...(shown ?? []));
  }, [shown]);

  return (
    <div ref={container} className="relative min-h-[600px] w-full">
      {failed ? (
        <div role="alert" className="p-4 text-sm">
          <p>Could not render the PDF preview.</p>
          <a href={url} download="resume.pdf" className="underline">
            Download PDF
          </a>
        </div>
      ) : (
        <>
          {rendering || updating ? (
            shown ? (
              <output className="absolute right-2 top-2 z-10 rounded-md bg-background/90 px-2 py-1 text-xs text-muted-foreground shadow-sm">
                Updating preview…
              </output>
            ) : (
              <output className="block animate-pulse p-4 text-sm text-muted-foreground">
                Loading PDF preview…
              </output>
            )
          ) : null}
          <div ref={host} className="flex flex-col items-center gap-4" />
        </>
      )}
    </div>
  );
}
