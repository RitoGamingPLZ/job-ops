import { formatDateTime } from "@/lib/utils";

export function formatEmailDate(value?: number | null, fallback = "n/a"): string {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return fallback;
  return formatDateTime(date.toISOString()) ?? fallback;
}

export function getEmailSenderLabel(senderName: string | null, fromAddress: string): string {
  return senderName?.trim() || fromAddress.trim() || "Unknown sender";
}
