import { decrypt } from "../crypto";
import { updateAccount } from "../db";
import { googleAccessToken } from "../oauth";
import type { Account, Bucket, RawEmail } from "../types";
import { htmlToText, LABEL_NAMES, parseAddress, type MailClient } from "./types";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

/** authuser picks the right Google account when several are signed in; /u/<email>/ 404s on some setups. */
export function gmailLink(accountEmail: string, messageId: string) {
  return `https://mail.google.com/mail/?authuser=${accountEmail}#all/${messageId}`;
}
/** At most ~4 Gmail requests per second per inbox. */
const MIN_GAP_MS = 250;

interface GmailPart {
  mimeType: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size: number };
  parts?: GmailPart[];
}

interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  internalDate: string;
  snippet: string;
  payload: GmailPart;
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function findBody(part: GmailPart, mime: string): string | null {
  if (part.mimeType === mime && part.body?.data) {
    return Buffer.from(part.body.data, "base64url").toString("utf8");
  }
  for (const child of part.parts ?? []) {
    const found = findBody(child, mime);
    if (found) return found;
  }
  return null;
}

export function createGmailClient(account: Account): MailClient {
  let accessToken: string | null = null;
  let labelIds = { ...(account.labelIds ?? {}) };

  // Gmail allows each user a limited "query cost" per minute, and full message reads are expensive.
  // Spacing requests out keeps a large backfill under that limit instead of bursting into it.
  let nextSlot = 0;
  async function pace() {
    const wait = nextSlot - Date.now();
    nextSlot = Math.max(Date.now(), nextSlot) + MIN_GAP_MS;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }

  async function call<T>(path: string, init?: RequestInit, attempt = 1): Promise<T> {
    accessToken ??= await googleAccessToken(decrypt(account.refreshTokenEnc));
    await pace();
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...init?.headers },
    });
    if (res.ok) return (await res.json()) as T;
    const text = await res.text();
    // Gmail signals per-user rate limits as 429, or 403 with a quota/rate reason.
    // The quota is per minute, so after a short retry, wait out the rest of the minute.
    const rateLimited = res.status === 429 || (res.status === 403 && /quota|rate ?limit/i.test(text));
    if ((rateLimited || res.status >= 500) && attempt < 4) {
      const delay = rateLimited && attempt > 1 ? 61_000 : 2000 * attempt;
      nextSlot = Math.max(nextSlot, Date.now() + delay);
      await new Promise((r) => setTimeout(r, delay + Math.random() * 500));
      return call<T>(path, init, attempt + 1);
    }
    throw new HttpError(res.status, `Gmail ${res.status} on ${path}: ${text.slice(0, 300)}`);
  }

  async function getMessage(id: string): Promise<RawEmail | null> {
    const msg = await call<GmailMessage>(`/messages/${id}?format=full`);
    const labels = msg.labelIds ?? [];
    if (!labels.includes("INBOX") || labels.includes("SENT") || labels.includes("DRAFT")) return null;

    const header = (name: string) =>
      msg.payload.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
    const from = parseAddress(header("From"));
    const plain = findBody(msg.payload, "text/plain");
    const html = plain ? null : findBody(msg.payload, "text/html");

    return {
      messageId: msg.id,
      threadId: msg.threadId,
      fromName: from.name,
      fromEmail: from.email,
      to: header("To"),
      subject: header("Subject") || "(no subject)",
      body: plain ?? (html ? htmlToText(html) : msg.snippet),
      receivedAt: Number(msg.internalDate),
      link: gmailLink(account.email, msg.id),
      hasUnsubscribe: Boolean(header("List-Unsubscribe")),
    };
  }

  async function getMessages(ids: string[]): Promise<RawEmail[]> {
    const out: RawEmail[] = [];
    // Small batches keep us under Gmail's per-user rate limit; call() backs off if we hit it anyway.
    for (let i = 0; i < ids.length; i += 3) {
      const batch = await Promise.all(ids.slice(i, i + 3).map(getMessage));
      out.push(...batch.filter((m): m is RawEmail => m !== null));
    }
    return out;
  }

  async function listIds(q: string, max: number): Promise<string[]> {
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({ q, maxResults: String(Math.min(100, max - ids.length)) });
      if (pageToken) params.set("pageToken", pageToken);
      const res = await call<{ messages?: { id: string }[]; nextPageToken?: string }>(`/messages?${params}`);
      ids.push(...(res.messages ?? []).map((m) => m.id));
      pageToken = res.nextPageToken;
    } while (pageToken && ids.length < max);
    return ids;
  }

  async function ensureLabel(bucket: Bucket): Promise<string> {
    if (labelIds[bucket]) return labelIds[bucket]!;
    const name = LABEL_NAMES[bucket];
    const { labels = [] } = await call<{ labels?: { id: string; name: string }[] }>("/labels");
    let id = labels.find((l) => l.name === name)?.id;
    if (!id) {
      const created = await call<{ id: string }>("/labels", {
        method: "POST",
        body: JSON.stringify({ name, labelListVisibility: "labelShow", messageListVisibility: "show" }),
      });
      id = created.id;
    }
    labelIds = { ...labelIds, [bucket]: id };
    await updateAccount(account.id, { labelIds });
    return id;
  }

  return {
    async fetchNew(cursor) {
      if (cursor) {
        try {
          const ids = new Set<string>();
          let pageToken: string | undefined;
          let latest = cursor;
          do {
            const params = new URLSearchParams({
              startHistoryId: cursor,
              historyTypes: "messageAdded",
              labelId: "INBOX",
            });
            if (pageToken) params.set("pageToken", pageToken);
            const res = await call<{
              history?: { messagesAdded?: { message: { id: string } }[] }[];
              nextPageToken?: string;
              historyId: string;
            }>(`/history?${params}`);
            for (const h of res.history ?? []) for (const added of h.messagesAdded ?? []) ids.add(added.message.id);
            latest = res.historyId;
            pageToken = res.nextPageToken;
          } while (pageToken);
          return { emails: await getMessages([...ids]), nextCursor: latest };
        } catch (err) {
          // History ids expire after about a week; fall through and start fresh.
          if (!(err instanceof HttpError && err.status === 404)) throw err;
        }
      }
      const profile = await call<{ historyId: string }>("/profile");
      const emails = await getMessages(await listIds("in:inbox newer_than:1d", 50));
      return { emails, nextCursor: profile.historyId };
    },

    async fetchRecent(days, max) {
      return getMessages(await listIds(`in:inbox newer_than:${days}d`, max));
    },

    async hasEmailedBefore(address) {
      const ids = await listIds(`in:sent to:${address}`, 1);
      return ids.length > 0;
    },

    async applyBucket(messageId, bucket, previous) {
      const add = await ensureLabel(bucket);
      const remove = previous && previous !== bucket ? [await ensureLabel(previous)] : [];
      await call(`/messages/${messageId}/modify`, {
        method: "POST",
        body: JSON.stringify({ addLabelIds: [add], removeLabelIds: remove }),
      });
    },
  };
}
