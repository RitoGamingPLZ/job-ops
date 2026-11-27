export function makePdfParseResult(text: string) {
  return {
    numpages: 1,
    numrender: 1,
    info: {},
    metadata: null,
    version: "default" as const,
    text,
  };
}
