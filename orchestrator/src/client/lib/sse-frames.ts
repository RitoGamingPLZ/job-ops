const frameDelimiter = /\r?\n\r?\n/;

function parseFrame<T>(frame: string): { event: T } | null {
  const data = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return null;

  try {
    return { event: JSON.parse(data) as T };
  } catch {
    return null;
  }
}

export async function readSseFrames<T>(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: T) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (!signal?.aborted) {
      const { done, value } = await reader.read();
      if (signal?.aborted) return;

      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let delimiter = frameDelimiter.exec(buffer);
      while (delimiter && !signal?.aborted) {
        const parsed = parseFrame<T>(buffer.slice(0, delimiter.index));
        buffer = buffer.slice(delimiter.index + delimiter[0].length);
        if (parsed) onEvent(parsed.event);
        delimiter = frameDelimiter.exec(buffer);
      }

      if (done) {
        const parsed = parseFrame<T>(buffer);
        if (parsed && !signal?.aborted) onEvent(parsed.event);
        return;
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The stream may already be closed or errored.
    } finally {
      reader.releaseLock();
    }
  }
}
