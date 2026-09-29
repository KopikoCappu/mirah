import { decrypt, encrypt } from "../crypto";
import { updateAccount } from "../db";
import { msAccessToken } from "../oauth";
import type { Account, RawEmail } from "../types";
import { htmlToText, LABEL_NAMES, type MailClient } from "./types";

const API = "https://graph.microsoft.com/v1.0/me";
const SELECT = "id,conversationId,subject,from,toRecipients,receivedDateTime,body,bodyPreview,webLink,isDraft";
/** Delta also reports old messages that changed (e.g. marked read); ignore anything older than this. */
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

interface GraphMessage {
  id: string;
  conversationId?: string;
  subject?: string;
  from?: { emailAddress: { name?: string; address?: string } };
  toRecipients?: { emailAddress: { address?: string } }[];
  receivedDateTime?: string;
  body?: { contentType: "text" | "html"; content: string };
  bodyPreview?: string;
  webLink?: string;
  isDraft?: boolean;
  "@removed"?: unknown;
}

interface GraphPage {
  value: GraphMessage[];
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function toRaw(m: GraphMessage): RawEmail | null {
  if (m["@removed"] || m.isDraft || !m.receivedDateTime) return null;
  const body = m.body?.content ?? m.bodyPreview ?? "";
  return {
    messageId: m.id,
    threadId: m.conversationId,
    fromName: m.from?.emailAddress.name ?? "",
    fromEmail: (m.from?.emailAddress.address ?? "").toLowerCase(),
    to: (m.toRecipients ?? []).map((r) => r.emailAddress.address).join(", "),
    subject: m.subject || "(no subject)",
    body: m.body?.contentType === "html" ? htmlToText(body) : body,
    receivedAt: Date.parse(m.receivedDateTime),
    link: m.webLink ?? "https://outlook.live.com/mail/",
    // Graph only exposes headers on single-message reads; not worth the extra call.
    hasUnsubscribe: false,
  };
}

export function createOutlookClient(account: Account): MailClient {
  let accessToken: string | null = null;

  async function token() {
    if (!accessToken) {
      const fresh = await msAccessToken(decrypt(account.refreshTokenEnc));
      accessToken = fresh.accessToken;
      if (fresh.refreshToken) await updateAccount(account.id, { refreshTokenEnc: encrypt(fresh.refreshToken) });
    }
    return accessToken;
  }

  async function call<T>(urlOrPath: string, init?: RequestInit): Promise<T> {
    const url = urlOrPath.startsWith("https://") ? urlOrPath : `${API}${urlOrPath}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${await token()}`,
        "Content-Type": "application/json",
        Prefer: 'outlook.body-content-type="text", odata.maxpagesize=50',
        ...init?.headers,
      },
    });
    if (!res.ok) throw new HttpError(res.status, `Graph ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  }

  async function runDelta(startUrl: string) {
    const emails: RawEmail[] = [];
    let url: string | undefined = startUrl;
    let deltaLink = "";
    while (url) {
      const page: GraphPage = await call<GraphPage>(url);
      for (const m of page.value) {
        const raw = toRaw(m);
        if (raw && Date.now() - raw.receivedAt < MAX_AGE_MS) emails.push(raw);
      }
      url = page["@odata.nextLink"];
      if (page["@odata.deltaLink"]) deltaLink = page["@odata.deltaLink"];
    }
    return { emails, nextCursor: deltaLink };
  }

  return {
    async fetchNew(cursor) {
      if (cursor) {
        try {
          return await runDelta(cursor);
        } catch (err) {
          // Expired or invalid delta token: start a fresh sync.
          if (!(err instanceof HttpError && [400, 404, 410].includes(err.status))) throw err;
        }
      }
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const filtered = new URLSearchParams({ $select: SELECT, $filter: `receivedDateTime ge ${since}` });
      try {
        return await runDelta(`${API}/mailFolders/inbox/messages/delta?${filtered}`);
      } catch (err) {
        if (!(err instanceof HttpError && err.status === 400)) throw err;
        // Some mailboxes reject the date filter on delta. Walk the whole inbox once; MAX_AGE_MS drops old mail.
        return runDelta(`${API}/mailFolders/inbox/messages/delta?${new URLSearchParams({ $select: SELECT })}`);
      }
    },

    async fetchRecent(days, max) {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const emails: RawEmail[] = [];
      let url: string | undefined =
        `${API}/mailFolders/inbox/messages?` +
        new URLSearchParams({
          $select: SELECT,
          $filter: `receivedDateTime ge ${since}`,
          $orderby: "receivedDateTime desc",
          $top: "50",
        });
      while (url && emails.length < max) {
        const page: GraphPage = await call<GraphPage>(url);
        emails.push(...page.value.map(toRaw).filter((m): m is RawEmail => m !== null));
        url = page["@odata.nextLink"];
      }
      return emails.slice(0, max);
    },

    async hasEmailedBefore(address) {
      const params = new URLSearchParams({ $search: `"to:${address}"`, $top: "1", $select: "id" });
      const res = await call<GraphPage>(`/mailFolders/sentitems/messages?${params}`);
      return res.value.length > 0;
    },

    async applyBucket(messageId, bucket) {
      const { categories = [] } = await call<{ categories?: string[] }>(
        `/messages/${encodeURIComponent(messageId)}?$select=categories`,
      );
      const ours = new Set(Object.values(LABEL_NAMES));
      await call(`/messages/${encodeURIComponent(messageId)}`, {
        method: "PATCH",
        body: JSON.stringify({ categories: [...categories.filter((c) => !ours.has(c)), LABEL_NAMES[bucket]] }),
      });
    },
  };
}
