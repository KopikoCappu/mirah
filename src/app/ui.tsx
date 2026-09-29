import type { Bucket, EmailRecord } from "@/lib/types";

export const BUCKET_LABELS: Record<Bucket, string> = { important: "Important", review: "Review", junk: "Junk" };

export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="brand-mark">
      <rect width="32" height="32" rx="9" fill="currentColor" />
      <rect x="7" y="9" width="18" height="14" rx="3" fill="none" stroke="var(--bg)" strokeWidth="2.4" />
      <path
        d="M8 11.5 16 17l8-5.5"
        fill="none"
        stroke="var(--bg)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="24.5" cy="8.5" r="4" fill="var(--important)" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

/** Stable per-sender color from the address. */
function hueFor(key: string) {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

export function Avatar({ name, email }: { name: string; email: string }) {
  const source = (name || email).replace(/["']/g, "").trim();
  const words = source.split(/[\s@._-]+/).filter(Boolean);
  const initials = ((words[0]?.[0] ?? "?") + (words.length > 1 && name ? words[1][0] : "")).toUpperCase();
  return (
    <span className="avatar" style={{ "--h": hueFor(email || name) } as React.CSSProperties} aria-hidden="true">
      {initials}
    </span>
  );
}

/** Turns a stored sync error into something a person can act on. */
export function friendlyError(raw: string): string {
  if (/quota|rate ?limit|429/i.test(raw)) return "Gmail asked Mirah to slow down. It will retry on the next sync.";
  if (/invalid_grant|Token request failed \(400\)|401/i.test(raw))
    return "Access expired or was removed. Reconnect this inbox.";
  if (/JEV_API_KEY is not set/.test(raw)) return "Waiting for a Jev API key. Nothing was sorted.";
  if (/Jev rejected/.test(raw)) return "Jev rejected the API key. Check JEV_API_KEY.";
  return "Sync failed. It will retry automatically.";
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <svg viewBox="0 0 64 64" width="56" height="56" aria-hidden="true">
        <circle cx="32" cy="32" r="26" fill="var(--important-tint)" />
        <path
          d="m22 33 7 7 14-15"
          fill="none"
          stroke="var(--important)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <h2>{title}</h2>
      {children}
    </div>
  );
}

/** Opens the email in Gmail or Outlook. Gmail links are rebuilt so older stored links keep working. */
export function openLink(e: Pick<EmailRecord, "provider" | "accountEmail" | "messageId" | "link">) {
  return e.provider === "gmail" ? `https://mail.google.com/mail/?authuser=${e.accountEmail}#all/${e.messageId}` : e.link;
}
