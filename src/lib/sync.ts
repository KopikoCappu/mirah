import { classify } from "./classify";
import { hashId } from "./crypto";
import { contactsCol, db, emailsCol, listAccounts, metaDoc, updateAccount } from "./db";
import { createGmailClient } from "./providers/gmail";
import { createOutlookClient } from "./providers/outlook";
import type { MailClient } from "./providers/types";
import { learnedBucketFor } from "./senders";
import { getSettings } from "./settings";
import type { Account, EmailRecord, RawEmail, Settings } from "./types";

const LOCK_MS = 4 * 60 * 1000;
const NEGATIVE_CONTACT_TTL = 7 * 24 * 60 * 60 * 1000;
const CONCURRENCY = 4;

export function clientFor(account: Account): MailClient {
  return account.provider === "gmail" ? createGmailClient(account) : createOutlookClient(account);
}

export interface SyncResult {
  skipped?: string;
  accounts: { email: string; processed: number; error?: string }[];
}

/** Prevents overlapping runs when the scheduler and the "Sync now" button collide. */
async function withLock<T>(fn: () => Promise<T>): Promise<T | null> {
  const ref = metaDoc("syncLock");
  const acquired = await db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    if ((doc.data()?.until ?? 0) > Date.now()) return false;
    tx.set(ref, { until: Date.now() + LOCK_MS });
    return true;
  });
  if (!acquired) return null;
  try {
    return await fn();
  } finally {
    await ref.set({ until: 0 });
  }
}

function sentHistoryChecker(account: Account, client: MailClient) {
  return async (address: string) => {
    if (!address) return false;
    const ref = contactsCol().doc(hashId(account.id, address));
    const cached = (await ref.get()).data() as { known: boolean; checkedAt: number } | undefined;
    if (cached && (cached.known || Date.now() - cached.checkedAt < NEGATIVE_CONTACT_TTL)) return cached.known;
    const known = await client.hasEmailedBefore(address).catch(() => false);
    await ref.set({ known, checkedAt: Date.now() });
    return known;
  };
}

async function processEmails(account: Account, client: MailClient, emails: RawEmail[], settings: Settings) {
  const hasEmailedBefore = sentHistoryChecker(account, client);
  let processed = 0;

  async function processOne(raw: RawEmail) {
    const id = hashId(account.id, raw.messageId);
    if ((await emailsCol().doc(id).get()).exists) return;

    const result = await classify(raw, { settings, hasEmailedBefore, learnedBucket: learnedBucketFor });
    let labeled = false;
    if (settings.applyLabels) {
      try {
        await client.applyBucket(raw.messageId, result.bucket);
        labeled = true;
      } catch (err) {
        result.reasons.push(`Could not apply label: ${(err as Error).message.slice(0, 120)}`);
      }
    }

    const record: EmailRecord = {
      id,
      accountId: account.id,
      accountEmail: account.email,
      provider: account.provider,
      messageId: raw.messageId,
      fromName: raw.fromName,
      fromEmail: raw.fromEmail,
      subject: raw.subject,
      snippet: raw.body.replace(/\s+/g, " ").trim().slice(0, 240),
      receivedAt: raw.receivedAt,
      link: raw.link,
      autoBucket: result.bucket,
      bucket: result.bucket,
      userBucket: null,
      category: result.category,
      categoryConfidence: result.categoryConfidence,
      pImportant: result.pImportant,
      pJunk: result.pJunk,
      needsAction: result.needsAction,
      urgency: result.urgency,
      suspicious: result.suspicious,
      reasons: result.reasons,
      labeled,
      createdAt: Date.now(),
    };
    await emailsCol().doc(id).set(record);
    processed++;
  }

  const queue = [...emails];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let raw = queue.shift(); raw; raw = queue.shift()) await processOne(raw);
    }),
  );
  return processed;
}

/** Pulls new mail from every connected account. With `backfillDays`, re-reads recent inbox mail instead. */
export async function runSync(opts: { backfillDays?: number; backfillMax?: number } = {}): Promise<SyncResult> {
  const result = await withLock(async () => {
    const settings = await getSettings();
    const accounts = await listAccounts();
    const out: SyncResult["accounts"] = [];

    for (const account of accounts) {
      const client = clientFor(account);
      try {
        let processed: number;
        if (opts.backfillDays) {
          const emails = await client.fetchRecent(opts.backfillDays, opts.backfillMax ?? 200);
          processed = await processEmails(account, client, emails, settings);
        } else {
          const { emails, nextCursor } = await client.fetchNew(account.cursor);
          processed = await processEmails(account, client, emails, settings);
          // Only advance the cursor after everything was stored, so a crash just retries.
          await updateAccount(account.id, { cursor: nextCursor });
        }
        await updateAccount(account.id, { lastSyncAt: Date.now(), lastError: null });
        out.push({ email: account.email, processed });
      } catch (err) {
        const message = (err as Error).message.slice(0, 500);
        await updateAccount(account.id, { lastSyncAt: Date.now(), lastError: message });
        out.push({ email: account.email, processed: 0, error: message });
      }
    }
    return { accounts: out };
  });
  return result ?? { skipped: "Another sync is already running", accounts: [] };
}
