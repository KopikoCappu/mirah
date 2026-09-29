import { emailsCol } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { BUCKETS, type Bucket, type EmailRecord } from "@/lib/types";
import { Avatar, BUCKET_LABELS, EmptyState, openLink } from "../ui";

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "–");

export default async function StatsPage() {
  await requireUser();
  const snap = await emailsCol().where("userBucket", "!=", null).get();
  const reviewed = snap.docs.map((d) => d.data() as EmailRecord);

  const matrix = Object.fromEntries(
    BUCKETS.map((a) => [a, Object.fromEntries(BUCKETS.map((u) => [u, 0]))]),
  ) as Record<Bucket, Record<Bucket, number>>;
  for (const e of reviewed) matrix[e.autoBucket][e.userBucket!]++;

  const trulyImportant = reviewed.filter((e) => e.userBucket === "important");
  const missed = trulyImportant.filter((e) => e.autoBucket !== "important");
  const wronglyJunked = reviewed.filter((e) => e.autoBucket === "junk" && e.userBucket !== "junk");
  const agree = reviewed.filter((e) => e.autoBucket === e.userBucket).length;
  const mistakes = [...new Map([...missed, ...wronglyJunked].map((e) => [e.id, e])).values()];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Accuracy</h1>
          <p className="subtle">From the {reviewed.length} emails you&apos;ve checked or moved.</p>
        </div>
      </div>

      {reviewed.length === 0 ? (
        <EmptyState title="Nothing reviewed yet">
          <p className="muted">
            Tap <b>✓ Looks right</b> or move emails in your inbox. Every one you check makes this page more
            trustworthy.
          </p>
        </EmptyState>
      ) : (
        <>
          <div className="stats">
            <Stat
              label="Important caught"
              value={pct(trulyImportant.length - missed.length, trulyImportant.length)}
              hint={missed.length ? `${missed.length} of ${trulyImportant.length} missed` : "none missed"}
              tone={missed.length ? "bad" : "good"}
            />
            <Stat
              label="Wrongly junked"
              value={String(wronglyJunked.length)}
              hint="must be 0 before trusting Junk"
              tone={wronglyJunked.length ? "bad" : "good"}
            />
            <Stat label="Agreement" value={pct(agree, reviewed.length)} hint="Mirah matched you" />
          </div>

          <section className="panel">
            <h2>Mirah said vs. you said</h2>
            <div className="table-wrap">
              <table className="matrix">
                <thead>
                  <tr>
                    <th />
                    {BUCKETS.map((u) => (
                      <th key={u} scope="col">
                        <span className={`dot dot-${u}`} /> {BUCKET_LABELS[u]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {BUCKETS.map((a) => (
                    <tr key={a}>
                      <th scope="row">
                        <span className={`dot dot-${a}`} /> {BUCKET_LABELS[a]}
                      </th>
                      {BUCKETS.map((u) => (
                        <td key={u} className={a === u ? "diag" : matrix[a][u] ? "off" : ""}>
                          {matrix[a][u]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="subtle small">Rows are what Mirah chose, columns are what you said. The diagonal is agreement.</p>
          </section>

          {mistakes.length > 0 && (
            <section>
              <h2>Mistakes to learn from</h2>
              <p className="subtle small">
                Add the sender as VIP or the company domain in Settings, or add a keyword, so these never slip again.
              </p>
              <ul className="list">
                {mistakes.map((e) => (
                  <li key={e.id} className="card">
                    <Avatar name={e.fromName} email={e.fromEmail} />
                    <div className="card-body">
                      <div className="card-head">
                        <span className="sender">{e.fromName || e.fromEmail}</span>
                        <span className="time">{e.fromEmail}</span>
                      </div>
                      <a className="subject" href={openLink(e)} target="_blank" rel="noreferrer">
                        {e.subject}
                      </a>
                      <p className="verdict">
                        <span className={`pill pill-${e.autoBucket}`}>{BUCKET_LABELS[e.autoBucket]}</span>
                        <span className="arrow">→</span>
                        <span className={`pill pill-${e.userBucket}`}>{BUCKET_LABELS[e.userBucket!]}</span>
                        <span className="why">Jev saw: {e.category?.replaceAll("_", " ") ?? "unclassified"}</span>
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: "good" | "bad" }) {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ""}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-hint">{hint}</div>
    </div>
  );
}
