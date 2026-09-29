"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { syncIfStale } from "./actions";

export function SubmitButton({
  children,
  pending,
  className,
  title,
}: {
  children: React.ReactNode;
  pending?: React.ReactNode;
  className?: string;
  title?: string;
}) {
  const status = useFormStatus();
  return (
    <button type="submit" className={className} disabled={status.pending} title={title} aria-busy={status.pending}>
      {status.pending && pending ? pending : children}
    </button>
  );
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

/** Formats in the viewer's timezone rather than the server's. */
export function TimeAgo({ ms, short }: { ms: number; short?: boolean }) {
  const [now] = useState(() => Date.now());
  const diff = (ms - now) / 1000;
  const abs = Math.abs(diff);
  const date = new Date(ms);
  let text: string;
  if (short) {
    text =
      abs < 86400 && date.getDate() === new Date(now).getDate()
        ? date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
        : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } else if (abs < 60) text = "just now";
  else if (abs < 3600) text = rtf.format(Math.round(diff / 60), "minute");
  else if (abs < 86400) text = rtf.format(Math.round(diff / 3600), "hour");
  else if (abs < 7 * 86400) text = rtf.format(Math.round(diff / 86400), "day");
  else text = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return (
    <time dateTime={date.toISOString()} title={date.toLocaleString()} suppressHydrationWarning>
      {text}
    </time>
  );
}

/** "Today", "Yesterday", weekday, or date, in the viewer's timezone. */
export function DayLabel({ ms }: { ms: number }) {
  const [now] = useState(() => new Date());
  const d = new Date(ms);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86400000);
  const text =
    days === 0
      ? "Today"
      : days === 1
        ? "Yesterday"
        : days < 7
          ? d.toLocaleDateString(undefined, { weekday: "long" })
          : d.toLocaleDateString(undefined, { month: "long", day: "numeric" });
  return <span suppressHydrationWarning>{text}</span>;
}

const NAV = [
  { href: "/", label: "Inbox", icon: InboxIcon },
  { href: "/stats", label: "Accuracy", icon: ChartIcon },
  { href: "/settings", label: "Settings", icon: GearIcon },
];

export function NavLinks() {
  const path = usePathname();
  return (
    <nav className="nav">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? path === "/" : path.startsWith(href);
        return (
          <Link key={href} href={href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
            <Icon />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function InboxIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 13.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4.5M4 13.5 6.2 6.3A2 2 0 0 1 8.1 5h7.8a2 2 0 0 1 1.9 1.3l2.2 7.2M4 13.5h4.5l1.2 2h4.6l1.2-2H20" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 19V11M12 19V5M19 19v-5" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </svg>
  );
}

const REFRESH_MS = 2 * 60 * 1000;
const RESYNC_AFTER_MS = 60 * 1000;

/**
 * Keeps the inbox fresh without a manual reload:
 * - when you open the app, or come back to it after a minute away, it checks Gmail right away;
 * - while it's on screen, it re-reads the sorted list every 2 minutes (the 5-minute timer does the syncing).
 * Everything pauses while the page is hidden so a forgotten tab doesn't use up free quotas.
 */
export function AutoRefresh() {
  const router = useRouter();
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let lastSync = 0;
    let lastRefresh = Date.now();
    let busy = false;

    const syncNow = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      lastSync = Date.now();
      setChecking(true);
      try {
        await syncIfStale();
      } catch {
        // Errors are stored on the account and shown in the banner after refresh.
      } finally {
        busy = false;
        setChecking(false);
        lastRefresh = Date.now();
        router.refresh();
      }
    };
    const refresh = () => {
      if (document.visibilityState !== "visible" || busy) return;
      lastRefresh = Date.now();
      router.refresh();
    };
    const onReturn = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastSync > RESYNC_AFTER_MS) void syncNow();
      else if (Date.now() - lastRefresh > 15_000) refresh();
    };

    void syncNow();
    const timer = setInterval(refresh, REFRESH_MS);
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
    };
  }, [router]);

  return checking ? (
    <p className="checking" role="status">
      <span className="spin">↻</span> Checking for new mail…
    </p>
  ) : null;
}
