export type Provider = "gmail" | "outlook";
export type Bucket = "important" | "review" | "junk";

export const BUCKETS: Bucket[] = ["important", "review", "junk"];

export interface Account {
  id: string;
  provider: Provider;
  email: string;
  refreshTokenEnc: string;
  /** Gmail: historyId. Outlook: delta link. */
  cursor: string | null;
  /** Gmail label ids we created, keyed by bucket. */
  labelIds?: Partial<Record<Bucket, string>>;
  lastSyncAt?: number;
  lastError?: string | null;
  createdAt: number;
}

/** A message pulled from a provider, normalized. */
export interface RawEmail {
  messageId: string;
  threadId?: string;
  fromName: string;
  fromEmail: string;
  to: string;
  subject: string;
  body: string;
  receivedAt: number;
  link: string;
  hasUnsubscribe: boolean;
}

export interface EmailRecord {
  id: string;
  accountId: string;
  accountEmail: string;
  provider: Provider;
  messageId: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  snippet: string;
  receivedAt: number;
  link: string;
  /** What the pipeline decided. */
  autoBucket: Bucket;
  /** What the feed shows: userBucket if corrected, else autoBucket. */
  bucket: Bucket;
  userBucket: Bucket | null;
  category: string | null;
  categoryConfidence: number | null;
  pImportant: number | null;
  pJunk: number | null;
  needsAction: number | null;
  urgency: number | null;
  suspicious: number | null;
  reasons: string[];
  labeled: boolean;
  createdAt: number;
}

export interface Settings {
  /** Senders or @domains that are always important. */
  vipSenders: string[];
  /** Senders or @domains that are always junk (unless VIP). */
  blockedSenders: string[];
  /** Domains of companies you've applied to. */
  companyDomains: string[];
  /** Hiring-system domains (Greenhouse, Lever, ...). */
  atsDomains: string[];
  /** Phrases in subject/body that force important. */
  keywords: string[];
  /** Summed probability of important categories needed for Important. */
  importantThreshold: number;
  /** Summed probability of job categories needed for Important. Kept low on purpose. */
  jobThreshold: number;
  /** Summed probability of junk categories needed for Junk. Kept high on purpose. */
  junkThreshold: number;
  /** Check whether you've emailed the sender before. */
  checkSentHistory: boolean;
  /** Write labels/categories back to Gmail/Outlook. */
  applyLabels: boolean;
}
