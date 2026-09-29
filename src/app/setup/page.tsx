import Link from "next/link";
import { db } from "@/lib/db";
import { REQUIRED_VARS, missingConfig } from "@/lib/env";
import { BrandMark } from "../ui";

export const dynamic = "force-dynamic";

/** Reads one document so a missing database, project id, or credential shows up here instead of on the inbox. */
async function checkFirestore(): Promise<string | null> {
  try {
    await Promise.race([
      db.collection("meta").doc("syncLock").get(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timed out after 8s")), 8000)),
    ]);
    return null;
  } catch (err) {
    return (err as Error).message.slice(0, 400);
  }
}

function tokenKeyProblem(): string | null {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) return null;
  return Buffer.from(raw, "base64").length === 32 ? null : "TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes";
}

// Public on purpose: it runs before anyone can sign in, and never shows a value, only whether one is set.
export default async function SetupPage() {
  const missing = missingConfig();
  const keyProblem = tokenKeyProblem();
  const dbProblem = await checkFirestore();
  const ready = missing.length === 0 && !keyProblem && !dbProblem;
  const appUrl = process.env.APP_URL?.replace(/\/$/, "");
  const hasMicrosoft = Boolean(process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET);

  if (ready) {
    return (
      <div className="login">
        <BrandMark size={56} />
        <h1>Mirah is set up</h1>
        <p className="tagline">Sign in, then connect an inbox under Settings.</p>
        <Link className="button primary large" href="/login">
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Finish setting up Mirah</h1>
          <p className="subtle">
            Add the missing values as environment variables, redeploy, then reload this page. The step-by-step guide is <code>SETUP.md</code> in the repo.
          </p>
        </div>
      </div>

      <section className="panel">
        <h2>Environment variables</h2>
        <ul className="checklist">
          {REQUIRED_VARS.map((v) => {
            const ok = !missing.includes(v.name) && !(v.name === "TOKEN_ENCRYPTION_KEY" && keyProblem);
            return (
              <li key={v.name} className={ok ? "ok" : "todo"}>
                <span className="check" aria-label={ok ? "Set" : "Missing"}>
                  {ok ? "✓" : "✗"}
                </span>
                <div>
                  <code>{v.name}</code>
                  {!ok && <div className="subtle small">{v.hint}</div>}
                </div>
              </li>
            );
          })}
          <li className="ok">
            <span className="check">{hasMicrosoft ? "✓" : "–"}</span>
            <div>
              <code>MS_CLIENT_ID</code>, <code>MS_CLIENT_SECRET</code>
              <div className="subtle small">Optional. Only needed for Outlook.</div>
            </div>
          </li>
        </ul>
        {keyProblem && <p className="alert small">{keyProblem}</p>}
        <p className="subtle small">
          Generate each secret with:{" "}
          <code>node -e &quot;console.log(require(&apos;crypto&apos;).randomBytes(32).toString(&apos;base64&apos;))&quot;</code>
        </p>
      </section>

      <section className="panel">
        <h2>Database (Firestore)</h2>
        {dbProblem ? (
          <>
            <p className="alert small">Couldn&apos;t reach Firestore: {dbProblem}</p>
            <p className="subtle small">
              Check <code>GOOGLE_CLOUD_PROJECT</code>, that the <code>(default)</code> database exists, and, outside
              Google Cloud (e.g. Vercel), that <code>GOOGLE_SERVICE_ACCOUNT_JSON</code> holds a key with the Cloud
              Datastore User role.
            </p>
          </>
        ) : (
          <p className="subtle">
            <span className="ok-dot" /> Connected.
          </p>
        )}
      </section>

      {appUrl && (
        <section className="panel">
          <h2>OAuth redirect URIs</h2>
          <p className="subtle small">Add these to your OAuth clients exactly as shown.</p>
          <p>
            Google: <code>{appUrl}/api/auth/google/callback</code>
          </p>
          <p>
            Microsoft (optional): <code>{appUrl}/api/auth/microsoft/callback</code>
          </p>
        </section>
      )}
    </>
  );
}
