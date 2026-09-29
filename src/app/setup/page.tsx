import Link from "next/link";
import { ENV_NAMES, fromEnv, getConfig, hasSetupKey, type AppConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { REQUIRED_VARS, configProblems, configState, env } from "@/lib/env";
import { currentUser } from "@/lib/session";
import { CopyField, SubmitButton } from "../components";
import { BrandMark } from "../ui";
import { saveAllowedEmails, saveGoogleClient, saveJevKey, saveOutlook } from "./actions";

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

const SAVED: Record<string, string> = {
  google: "Google sign-in saved.",
  jev: "Jev key works and is saved.",
  outlook: "Outlook settings saved.",
  access: "Saved who can sign in.",
};

// Public on purpose. Signed-out visitors only ever see whether the server is configured, never a value;
// the forms need the owner's session or, before anyone owns this copy, the setup key from the setup script.
export default async function SetupPage({ searchParams }: PageProps<"/setup">) {
  const { error, saved } = await searchParams;
  const problems = configProblems();
  const dbProblem = await checkFirestore();
  if (problems.length || dbProblem) return <ServerChecklist problems={problems} dbProblem={dbProblem} />;

  const [user, config, unlocked] = await Promise.all([currentUser(), getConfig({ fresh: true }), hasSetupKey()]);
  const unclaimed = config.allowedEmails.length === 0;

  if (!unclaimed && !user) {
    return (
      <div className="login">
        <BrandMark size={56} />
        <h1>Mirah is set up</h1>
        <p className="tagline">Sign in, then connect an inbox under Settings.</p>
        {error && <p className="alert">{String(error)}</p>}
        <Link className="button primary large" href="/login">
          Sign in
        </Link>
      </div>
    );
  }
  if (unclaimed && !unlocked) return <Locked error={error ? String(error) : null} />;

  const googleDone = Boolean(config.googleClientId && config.googleClientSecret);
  const jevDone = Boolean(config.jevApiKey);
  const outlookDone = Boolean(config.msClientId && config.msClientSecret);
  const project = env.googleProject;
  const gc = (path: string) => `https://console.cloud.google.com/${path}${project ? `?project=${project}` : ""}`;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{unclaimed ? "Set up your Mirah" : "Keys & access"}</h1>
          <p className="subtle">
            {unclaimed
              ? "Three steps, about 10 minutes. What you enter is stored encrypted in your own database."
              : "The keys Mirah uses and who can sign in. Secrets are stored encrypted and never shown again."}
          </p>
        </div>
      </div>

      {error && <p className="alert">{String(error)}</p>}
      {saved && SAVED[String(saved)] && <p className="notice">{SAVED[String(saved)]}</p>}

      <Step n={1} title="Google sign-in" done={googleDone}>
        <p className="subtle small">
          Mirah signs you in and reads Gmail through your own Google OAuth client. Google doesn&apos;t let apps create one
          for you, so it&apos;s a few clicks. Each link opens the right page{project ? " in your project" : ""}.
        </p>
        <ol className="howto">
          <li>
            <a href={gc("auth/overview")} target="_blank" rel="noreferrer">
              Open Google Auth Platform
            </a>{" "}
            and click <b>Get started</b>. App name <b>Mirah</b>, your email as support email, audience <b>External</b>,
            then <b>Create</b>.
          </li>
          <li>
            <a href={gc("auth/audience")} target="_blank" rel="noreferrer">
              Audience
            </a>
            : under Test users, <b>Add users</b> with your Gmail address. Then click <b>Publish app</b>. Otherwise Google
            disconnects Gmail every 7 days.
          </li>
          <li>
            <a href={gc("auth/scopes")} target="_blank" rel="noreferrer">
              Data access
            </a>
            : <b>Add or remove scopes</b>, paste this under &ldquo;Manually add scopes&rdquo;, then{" "}
            <b>Add to table → Update → Save</b>:
            <CopyField value="https://www.googleapis.com/auth/gmail.modify" />
          </li>
          <li>
            <a href={gc("auth/clients/create")} target="_blank" rel="noreferrer">
              Create a client
            </a>
            : type <b>Web application</b>. Under Authorized redirect URIs, click <b>Add URI</b> and paste:
            <CopyField value={`${env.appUrl}/api/auth/google/callback`} />
            Click <b>Create</b>, then copy the client ID and secret into the boxes below.
          </li>
        </ol>
        {fromEnv("googleClientId") ? (
          <EnvNote field="googleClientId" />
        ) : (
          <form action={saveGoogleClient}>
            <Input name="googleClientId" label="Client ID" defaultValue={config.googleClientId} placeholder="1234…apps.googleusercontent.com" />
            <SecretInput name="googleClientSecret" label="Client secret" isSet={Boolean(config.googleClientSecret)} placeholder="GOCSPX-…" />
            <SubmitButton pending="Saving…" className="button primary">
              Save
            </SubmitButton>
          </form>
        )}
        <p className="subtle small">
          Not working? Make sure the{" "}
          <a href={gc("apis/library/gmail.googleapis.com")} target="_blank" rel="noreferrer">
            Gmail API is enabled
          </a>
          . The setup script does this for you.
        </p>
      </Step>

      <Step n={2} title="Jev API key" done={jevDone}>
        <p className="subtle small">
          Jev is the classifier that sorts whatever your rules don&apos;t. Get a key from{" "}
          <a href="https://docs.typesafe.ai/api" target="_blank" rel="noreferrer">
            TypeSafe
          </a>
          . Mirah checks the key works before saving it.
        </p>
        {fromEnv("jevApiKey") ? (
          <EnvNote field="jevApiKey" />
        ) : (
          <form action={saveJevKey}>
            <SecretInput name="jevApiKey" label="API key" isSet={jevDone} required />
            <SubmitButton pending="Checking…" className="button primary">
              Save
            </SubmitButton>
          </form>
        )}
      </Step>

      <Step n={3} title="Outlook (optional)" done={outlookDone} optional>
        <details>
          <summary className="subtle small">Only if you want to sort an Outlook or Microsoft 365 inbox too</summary>
          <ol className="howto">
            <li>
              <a href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noreferrer">
                Open App registrations
              </a>{" "}
              → <b>New registration</b>. Account types: <b>any organizational directory and personal Microsoft accounts</b>.
              Redirect URI, type Web:
              <CopyField value={`${env.appUrl}/api/auth/microsoft/callback`} />
            </li>
            <li>
              <b>API permissions → Microsoft Graph → Delegated</b>: add <code>Mail.ReadWrite</code>, <code>User.Read</code>,{" "}
              <code>offline_access</code>, <code>openid</code>, <code>email</code>.
            </li>
            <li>
              <b>Certificates &amp; secrets → New client secret</b>. Copy its <b>Value</b>. It expires in up to 24 months.
            </li>
          </ol>
          {fromEnv("msClientId") ? (
            <EnvNote field="msClientId" />
          ) : (
            <form action={saveOutlook}>
              <Input
                name="msClientId"
                label="Application (client) ID"
                defaultValue={config.msClientId}
                placeholder="1a2b3c4d-…"
                hint="Clear it and save to turn Outlook off."
              />
              <SecretInput name="msClientSecret" label="Client secret value" isSet={Boolean(config.msClientSecret)} />
              <SubmitButton pending="Saving…" className="button">
                Save
              </SubmitButton>
            </form>
          )}
        </details>
      </Step>

      {unclaimed ? (
        <Step n={4} title="Sign in and connect Gmail" done={false}>
          <p className="subtle small">
            The Google account you sign in with becomes this Mirah&apos;s owner, and its Gmail gets connected. You can add
            more inboxes later in Settings.
          </p>
          <ul className="howto">
            <li>
              Google warns that it <b>hasn&apos;t verified this app</b>. That&apos;s expected, since it&apos;s your own app.
              Click <b>Advanced → Go to Mirah</b>.
            </li>
            <li>
              Tick the box that lets Mirah <b>read, compose and send… your email</b>. Mirah only reads and labels. It never
              sends or deletes.
            </li>
          </ul>
          {googleDone && jevDone ? (
            <a className="button primary large" href="/api/auth/google/start?mode=setup">
              Sign in with Google
            </a>
          ) : (
            <p className="subtle small">Finish steps 1 and 2 first.</p>
          )}
        </Step>
      ) : (
        <section className="panel">
          <h2>Who can sign in</h2>
          {fromEnv("allowedEmails") ? (
            <EnvNote field="allowedEmails" />
          ) : (
            <form action={saveAllowedEmails}>
              <label className="field">
                <span className="subtle small">One Google address per line. Keep your own.</span>
                <textarea name="allowedEmails" defaultValue={config.allowedEmails.join("\n")} rows={3} spellCheck={false} />
              </label>
              <SubmitButton pending="Saving…" className="button">
                Save
              </SubmitButton>
            </form>
          )}
        </section>
      )}
    </>
  );
}

function Step({
  n,
  title,
  done,
  optional,
  children,
}: {
  n: number;
  title: string;
  done: boolean;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={`panel step${done ? " step-done" : ""}`}>
      <h2 className="step-title">
        <span className="step-badge" aria-hidden="true">
          {done ? "✓" : n}
        </span>
        {title}
        {done && <span className="pill pill-important">Done</span>}
        {!done && optional && <span className="pill">Optional</span>}
      </h2>
      {children}
    </section>
  );
}

function Input({
  name,
  label,
  defaultValue,
  placeholder,
  hint,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {hint && <span className="subtle small">{hint}</span>}
      <input name={name} defaultValue={defaultValue} placeholder={placeholder} autoComplete="off" spellCheck={false} />
    </label>
  );
}

function SecretInput({
  name,
  label,
  isSet,
  placeholder,
  required,
}: {
  name: string;
  label: string;
  isSet: boolean;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        name={name}
        type="password"
        placeholder={isSet ? "Saved. Leave blank to keep it." : placeholder}
        required={required && !isSet}
        autoComplete="off"
        spellCheck={false}
      />
    </label>
  );
}

function EnvNote({ field }: { field: keyof AppConfig }) {
  return (
    <p className="subtle small">
      <span className="ok-dot" /> Set by the <code>{ENV_NAMES[field]}</code> environment variable. Change it there.
    </p>
  );
}

function Locked({ error }: { error: string | null }) {
  return (
    <div className="login">
      <BrandMark size={56} />
      <h1>Almost there</h1>
      <p className="tagline">Open the setup link the setup script printed, or paste its key here.</p>
      {error && <p className="alert">{error}</p>}
      <form action="/setup/unlock" method="get" className="unlock">
        <input name="key" placeholder="Setup key" autoComplete="off" spellCheck={false} required />
        <button type="submit" className="button primary">
          Continue
        </button>
      </form>
      <p className="subtle small">
        Set things up by hand? The key is derived from <code>SESSION_SECRET</code>; see SETUP.md.
      </p>
    </div>
  );
}

function ServerChecklist({ problems, dbProblem }: { problems: string[]; dbProblem: string | null }) {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Finish setting up Mirah</h1>
          <p className="subtle">
            The server is missing a few settings. Re-running <code>bash scripts/setup.sh</code> fixes these. Or add them as
            environment variables, redeploy, and reload this page.
          </p>
        </div>
      </div>

      <section className="panel">
        <h2>Server settings</h2>
        <ul className="checklist">
          {REQUIRED_VARS.map((v) => {
            const state = configState(v.name);
            const ok = state === "ok";
            return (
              <li key={v.name} className={ok ? "ok" : "todo"}>
                <span className="check" aria-label={ok ? "Set" : state === "missing" ? "Missing" : "Looks wrong"}>
                  {ok ? "✓" : "✗"}
                </span>
                <div>
                  <code>{v.name}</code>
                  {state === "invalid" && <span className="subtle small"> is set, but doesn&apos;t look right</span>}
                  {!ok && <div className="subtle small">{v.hint}</div>}
                </div>
              </li>
            );
          })}
        </ul>
        {problems.some((p) => p !== "APP_URL") && (
          <p className="subtle small">
            Generate each secret with:{" "}
            <code>node -e &quot;console.log(require(&apos;crypto&apos;).randomBytes(32).toString(&apos;base64&apos;))&quot;</code>
          </p>
        )}
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
    </>
  );
}
