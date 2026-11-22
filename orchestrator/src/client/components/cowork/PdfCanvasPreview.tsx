import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";

export function PdfCanvasPreview({ url }: { url: string }) {
  return <PdfCanvasDocument key={url} url={url} />;
}

function PdfCanvasDocument({ url }: { url: string }) {
  const container = useRef<HTMLDivElement>(null);
  const canvases = useRef(new Map<number, HTMLCanvasElement>());
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [width, setWidth] = useState(0);
  const [rendering, setRendering] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | undefined;
    void (async () => {
      try {
        const { GlobalWorkerOptions, getDocument } = await import("pdfjs-dist");
        if (cancelled) return;
        GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.mjs",
          import.meta.url,
        ).toString();
        task = getDocument(url);
        const pdf = await task.promise;
        if (!cancelled) setDocument(pdf);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      // Destroying the loading task also destroys its document and worker.
      void task?.destroy().catch(() => {});
    };
  }, [url]);

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
    if (!document || width <= 0) return;
    let cancelled = false;
    const tasks = new Set<RenderTask>();
    setRendering(true);
    void (async () => {
      const outputScale = Math.max(1, window.devicePixelRatio || 1);
      for (let number = 1; number <= document.numPages; number += 1) {
        const page = await document.getPage(number);
        if (cancelled) return;
        const canvas = canvases.current.get(number);
        const context = canvas?.getContext("2d");
        if (!canvas || !context) throw new Error("Canvas unavailable");
        const viewport = page.getViewport({
          scale: width / page.getViewport({ scale: 1 }).width,
        });
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        context.setTransform(outputScale, 0, 0, outputScale, 0, 0);
        const task = page.render({ canvas, canvasContext: context, viewport });
        tasks.add(task);
        await task.promise;
        tasks.delete(task);
        if (cancelled) return;
      }
      setRendering(false);
    })().catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
      for (const task of tasks) task.cancel();
    };
  }, [document, width]);

  return (
    <div ref={container} className="min-h-[600px] w-full">
      {failed ? (
        <div role="alert" className="p-4 text-sm">
          <p>Could not render the PDF preview.</p>
          <a href={url} download="resume.pdf" className="underline">
            Download PDF
          </a>
        </div>
      ) : (
        <>
          {rendering && <output>Loading PDF preview…</output>}
          <div className="flex flex-col items-center gap-4">
            {Array.from({ length: document?.numPages ?? 0 }, (_, index) => index + 1).map(
              (pageNumber) => (
                <canvas
                  key={pageNumber}
                  ref={(canvas) => {
                    if (canvas) canvases.current.set(pageNumber, canvas);
                    else canvases.current.delete(pageNumber);
                  }}
                  aria-label={`Resume PDF page ${pageNumber}`}
                  className="block bg-white shadow-sm"
                />
              ),
            )}
          </div>
        </>
      )}
    </div>
  );
}
