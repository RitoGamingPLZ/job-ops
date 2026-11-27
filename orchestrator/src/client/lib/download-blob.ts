export function downloadBlob(blob: Blob, filename: string, revokeAfterMs = 60_000): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), revokeAfterMs);
  }
}
