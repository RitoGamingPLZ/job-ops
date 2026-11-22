import { stripHtml } from "@/lib/utils";

export const looksLikeHtmlJobDescription = (jobDescription?: string | null) =>
  /<([a-z][\w:-]*)(?:\s[^>]*)?>/i.test(jobDescription ?? "");

export const getRenderableJobDescription = (jobDescription?: string | null) => {
  if (!jobDescription) return "No description available.";

  const plainText = looksLikeHtmlJobDescription(jobDescription)
    ? stripHtml(jobDescription)
    : jobDescription;

  const normalizedLineBreaks = plainText.replace(/\r\n/g, "\n");
  if (normalizedLineBreaks.includes("\\n") && !normalizedLineBreaks.includes("\n")) {
    return normalizedLineBreaks.replace(/\\n/g, "\n");
  }

  return normalizedLineBreaks;
};

const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/** Returns href unchanged if it is an absolute http(s)/mailto link, else undefined. */
export const getSafeJobDescriptionHref = (href?: string | null) => {
  if (!href) return undefined;

  try {
    const url = new URL(href, "https://job-ops.local");
    if (
      url.origin === "https://job-ops.local" &&
      !href.startsWith("http://") &&
      !href.startsWith("https://") &&
      !href.startsWith("mailto:")
    ) {
      return undefined;
    }

    return SAFE_PROTOCOLS.has(url.protocol) ? href : undefined;
  } catch {
    return undefined;
  }
};
