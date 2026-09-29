import Link from "next/link";
import { emailsCol, listAccounts } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { BUCKETS, type Bucket, type EmailRecord } from "@/lib/types";
import { syncNow } from "./actions";
import { AutoRefresh, SubmitButton, TimeAgo } from "./components";
import { EmailList } from "./email-list";
import { BUCKET_LABELS, EmptyState, friendlyError } from "./ui";

// Server actions on this page (Sync, Sort past mail) run in this function on Vercel.
export const maxDuration = 300;

const PAGE_SIZE = 50;

const EMPTY: Record<Bucket, { title: string; body: string }> = {
  important: { title: "Nothing important right now", body: "When something needs you, it'll show up here." },
  review: { title: "Nothing to review", body: "Emails Mirah isn't sure about land here." },
  junk: { title: "No junk", body: "Only emails Mirah is very sure about go here." },
};

export default async function InboxPage({ searchParams }: PageProps<"/">) {
  await requireUser();
  const { b } = await searchParams;
  const bucket: Bucket = BUCKETS.includes(b as Bucket) ? (b as Bucket) : "important";

  const [counts, snap, accounts] = await Promise.all([
    Promise.all(BUCKETS.map((k) => emailsCol().where("bucket", "==", k).count().get())),
    emailsCol().where("bucket", "==", bucket).orderBy("receivedAt", "desc").limit(PAGE_SIZE).get(),
    listAccounts(),
  ]);
  const emails = snap.docs.map((d) => d.data() as EmailRecord);
  const lastSync = Math.max(0, ...accounts.map((a) => a.lastSyncAt ?? 0));
  const failing = accounts.filter((a) => a.lastError);

  if (accounts.length === 0) {
    return (
      <EmptyState title="Connect your inbox">
        <p className="muted">Mirah sorts new mail into Important, Review, and Junk, so nothing that matters slips by.</p>
        <Link className="button primary" href="/settings">
          Connect Gmail or Outlook
        </Link>
      </EmptyState>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Inbox</h1>
          <p className="subtle">
            {lastSync ? (
              <>
                Synced <TimeAgo ms={lastSync} />
              </>
            ) : (
              "Not synced yet"
            )}
            {" · "}
            {accounts.length} {accounts.length === 1 ? "inbox" : "inboxes"}
          </p>
        </div>
        <form action={syncNow}>
          <SubmitButton className="button" pending={<span className="spin">↻</span>} title="Sync now">
            ↻ Sync
          </SubmitButton>
        </form>
      </div>

      <AutoRefresh />

      {failing.length > 0 && (
        <Link href="/settings" className="banner">
          {failing.length === 1
            ? `${failing[0].email}: ${friendlyError(failing[0].lastError!)}`
            : `${failing.length} inboxes couldn't sync. See Settings.`}
        </Link>
      )}

      <div className="segmented" role="tablist">
        {BUCKETS.map((k, i) => (
          <Link
            key={k}
            href={k === "important" ? "/" : `/?b=${k}`}
            role="tab"
            aria-selected={k === bucket}
            className={`seg seg-${k} ${k === bucket ? "active" : ""}`}
          >
            <span className="dot" />
            {BUCKET_LABELS[k]}
            <span className="count">{counts[i].data().count}</span>
          </Link>
        ))}
      </div>

      {emails.length === 0 ? (
        <EmptyState title={EMPTY[bucket].title}>
          <p className="muted">{EMPTY[bucket].body}</p>
        </EmptyState>
      ) : (
        <EmailList key={bucket} emails={emails} />
      )}
    </>
  );
}
