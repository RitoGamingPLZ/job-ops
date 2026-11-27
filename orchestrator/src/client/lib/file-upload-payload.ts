export async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
}

export type FileUploadPayload = {
  fileName: string;
  mediaType: string | null;
  dataBase64: string;
};

export async function fileToUploadPayload(
  file: File,
  errorMessage: string,
): Promise<FileUploadPayload> {
  const dataUrl = await fileToDataUrl(file);
  const match = /^data:([^;]*);base64,(.+)$/s.exec(dataUrl.trim());

  if (!match) {
    throw new Error(errorMessage);
  }

  return {
    fileName: file.name,
    mediaType: file.type || match[1] || null,
    dataBase64: match[2],
  };
}
