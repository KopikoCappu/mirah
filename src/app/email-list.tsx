"use client";

import { useSyncExternalStore } from "react";
import { BUCKETS, type EmailRecord } from "@/lib/types";
import { setBucket } from "./actions";
import { DayLabel, SubmitButton, TimeAgo } from "./components";
import { Avatar, BUCKET_LABELS, openLink } from "./ui";

const noopSubscribe = () => () => {};

/** Groups by calendar day in the viewer's timezone. */
function groupByDay(emails: EmailRecord[]) {
  const groups: { key: string; first: number; items: EmailRecord[] }[] = [];
  for (const e of emails) {
    const d = new Date(e.receivedAt);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const last = groups.at(-1);
    if (last?.key === key) last.items.push(e);
    else groups.push({ key, first: e.receivedAt, items: [e] });
  }
  return groups;
}

export function EmailList({ emails }: { emails: EmailRecord[] }) {
  // Days depend on the viewer's timezone, which the server doesn't know: group only in the browser.
  const inBrowser = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const groups = inBrowser ? groupByDay(emails) : [{ key: "all", first: 0, items: emails }];
  return (
    <div className="days">
      {groups.map((g) => (
        <section key={g.key} className="day">
          {g.first > 0 && (
            <h3 className="day-label">
              <DayLabel ms={g.first} />
            </h3>
          )}
          <ul className="list">
            {g.items.map((e) => (
              <EmailCard key={e.id} email={e} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

const JUNK_CATEGORIES = ["spam", "promotion", "newsletter"];

const pct = (n: number | null) => (n == null ? "" : `${Math.round(n * 100)}%`);

function EmailCard({ email: e }: { email: EmailRecord }) {
  const scam = (e.suspicious ?? 0) >= 0.7;
  const needsAction = (e.needsAction ?? 0) >= 0.6;
  // Jev rates bulk mail as "urgent" too (sales, news), so only flag urgency on things you must act on.
  const urgent = (e.urgency ?? 0) >= 2 && needsAction && e.bucket !== "junk";
  const why = e.reasons.filter((r) => !r.startsWith("⚠"));
  // e.g. Jev leaned "spam" but not enough to junk it: a "spam" pill on an Important card only confuses.
  const contradicts = e.bucket !== "junk" && JUNK_CATEGORIES.includes(e.category ?? "");

  return (
    <li className={`card bucket-${e.bucket}`}>
      <Avatar name={e.fromName} email={e.fromEmail} />
      <div className="card-body">
        <div className="card-head">
          <span className="sender" title={e.fromEmail}>
            {e.fromName || e.fromEmail}
          </span>
          <span className="time">
            <TimeAgo ms={e.receivedAt} short />
          </span>
        </div>
        <a className="subject" href={openLink(e)} target="_blank" rel="noreferrer">
          {e.subject}
        </a>
        <p className="snippet">{e.snippet}</p>

        {scam && (
          <p className="scam">
            <b>Possible scam.</b> Don&apos;t share passwords, pay fees, or buy gift cards. Verify the sender first.
          </p>
        )}

        <div className="meta">
          {e.category && !contradicts && (
            <span className="pill pill-category" title={`Jev confidence ${pct(e.categoryConfidence)}`}>
              {e.category.replaceAll("_", " ")}
            </span>
          )}
          {needsAction && <span className="pill pill-action">Needs action</span>}
          {urgent && <span className="pill pill-urgent">Urgent</span>}
          {e.userBucket && <span className="pill pill-reviewed">✓ Reviewed</span>}
          {why.length > 0 && <span className="why">{why.join(" · ")}</span>}
        </div>

        <div className="card-actions">
          {!e.userBucket && (
            <form action={setBucket}>
              <input type="hidden" name="id" value={e.id} />
              <input type="hidden" name="bucket" value={e.bucket} />
              <SubmitButton className="chip-btn chip-confirm" pending="Saving…">
                ✓ Looks right
              </SubmitButton>
            </form>
          )}
          <span className="move-label">Move to</span>
          {BUCKETS.filter((k) => k !== e.bucket).map((k) => (
            <form key={k} action={setBucket}>
              <input type="hidden" name="id" value={e.id} />
              <input type="hidden" name="bucket" value={k} />
              <SubmitButton className={`chip-btn chip-${k}`} pending="…">
                → {BUCKET_LABELS[k]}
              </SubmitButton>
            </form>
          ))}
        </div>
      </div>
    </li>
  );
}
