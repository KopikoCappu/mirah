import type { Bucket, RawEmail } from "../types";

export interface NewMessages {
  emails: RawEmail[];
  /** Cursor to store once these messages are processed. */
  nextCursor: string;
}

export interface MailClient {
  /** Messages that arrived in the inbox since the cursor (or recently, if there is none). */
  fetchNew(cursor: string | null): Promise<NewMessages>;
  /** Recent inbox messages, for backfilling and evaluation. */
  fetchRecent(days: number, max: number): Promise<RawEmail[]>;
  hasEmailedBefore(address: string): Promise<boolean>;
  applyBucket(messageId: string, bucket: Bucket, previous?: Bucket | null): Promise<void>;
}

export const LABEL_NAMES: Record<Bucket, string> = {
  important: "Mirah/Important",
  review: "Mirah/Review",
  junk: "Mirah/Junk",
};

export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*/g, "\n\n")
    .trim();
}

/** Parses `"Name" <a@b.com>` into its parts. */
export function parseAddress(value: string): { name: string; email: string } {
  const match = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (match) return { name: match[1].trim(), email: match[2].trim().toLowerCase() };
  return { name: "", email: value.trim().toLowerCase() };
}
