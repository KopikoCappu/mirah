import { listAccounts } from "@/lib/db";
import { env } from "@/lib/env";
import { listLearnedSenders } from "@/lib/senders";
import { getSettings } from "@/lib/settings";
import { requireUser } from "@/lib/session";
import { backfill, disconnectAccount, forgetLearnedSender, logout, updateSettings } from "../actions";
import { SubmitButton, TimeAgo } from "../components";
import { Avatar, friendlyError } from "../ui";

// Server actions on this page (Sync, Sort past mail) run in this function on Vercel.
export const maxDuration = 300;

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const user = await requireUser();
  const { error, connected, saved } = await searchParams;
  const [accounts, settings, learned] = await Promise.all([listAccounts(), getSettings(), listLearnedSenders()]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="subtle">Inboxes, rules, and how cautious Mirah should be.</p>
        </div>
      </div>

      {error && <p className="alert">{String(error)}</p>}
      {connected && <p className="notice">Connected {String(connected)}.</p>}
      {saved && <p className="notice">Settings saved.</p>}

      <section className="panel">
        <h2>Inboxes</h2>
        {accounts.length === 0 && <p className="subtle">No inbox connected yet.</p>}
        <ul className="accounts">
          {accounts.map((a) => (
            <li key={a.id}>
              <Avatar name="" email={a.email} />
              <div className="account-info">
                <div className="account-email">{a.email}</div>
                <div className="subtle small">
                  {a.provider === "gmail" ? "Gmail" : "Outlook"} ·{" "}
                  {a.lastSyncAt ? (
                    <>
                      synced <TimeAgo ms={a.lastSyncAt} />
                    </>
                  ) : (
                    "not synced yet"
                  )}
                  {!a.lastError && a.lastSyncAt ? <span className="ok-dot" title="Healthy" /> : null}
                </div>
              </div>
              <form action={disconnectAccount}>
                <input type="hidden" name="id" value={a.id} />
                <SubmitButton className="chip-btn">Disconnect</SubmitButton>
              </form>
              {a.lastError && (
                <details className="account-error">
                  <summary>{friendlyError(a.lastError)}</summary>
                  <pre>{a.lastError}</pre>
                </details>
              )}
            </li>
          ))}
        </ul>
        <div className="row">
          <a className="button" href="/api/auth/google/start?mode=gmail">
            + Gmail
          </a>
          {env.hasMicrosoft ? (
            <a className="button" href="/api/auth/microsoft/start">
              + Outlook
            </a>
          ) : (
            <span className="subtle small">Outlook isn&apos;t set up yet.</span>
          )}
        </div>
      </section>

      <section className="panel">
        <h2>Test on past mail</h2>
        <p className="subtle small">
          Sorts recent inbox mail so you can check Mirah&apos;s accuracy before trusting it. Already-sorted emails are
          skipped.
        </p>
        <form action={backfill} className="row">
          <label className="inline">
            Last <input name="days" type="number" defaultValue={14} min={1} max={90} className="num" /> days
          </label>
          <label className="inline">
            up to <input name="max" type="number" defaultValue={200} min={1} max={500} className="num" /> each
          </label>
          <SubmitButton pending="Sorting… (can take a minute)" className="button primary">
            Sort past mail
          </SubmitButton>
        </form>
      </section>

      <section className="panel">
        <h2>Learned from you</h2>
        <p className="subtle small">
          When you mark an email Important or Junk, Mirah remembers the sender and sorts their next emails the same way.
          Moving one to Review, or tapping Forget, undoes it. Job keywords and hiring systems still beat a learned Junk.
        </p>
        {learned.length === 0 ? (
          <p className="subtle small">Nothing yet. Use ✓ Looks right and Move to in your inbox.</p>
        ) : (
          <ul className="learned">
            {learned.map((s) => (
              <li key={s.id}>
                <span className={`dot dot-${s.bucket}`} />
                <span className="learned-who">
                  <span className="learned-name">{s.name || s.email}</span>
                  {s.name && <span className="subtle small">{s.email}</span>}
                </span>
                <span className={`pill pill-${s.bucket}`}>{s.bucket === "important" ? "Important" : "Junk"}</span>
                <form action={forgetLearnedSender}>
                  <input type="hidden" name="id" value={s.id} />
                  <SubmitButton className="chip-btn">Forget</SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form action={updateSettings}>
        <section className="panel">
          <h2>Always important</h2>
          <p className="subtle small">
            These rules run before Jev and always win. One per line: a full address like <code>boss@work.com</code>{" "}
            or a domain like <code>stripe.com</code>.
          </p>
          <ListField
            name="companyDomains"
            label="Companies you've applied to"
            hint="Any mail from these domains is Important."
            values={settings.companyDomains}
            placeholder={"stripe.com\nairbnb.com"}
          />
          <ListField name="vipSenders" label="VIP senders" values={settings.vipSenders} placeholder="mom@gmail.com" />
          <ListField
            name="keywords"
            label="Keywords"
            hint="Checked in the subject and body."
            values={settings.keywords}
          />
          <ListField
            name="atsDomains"
            label="Hiring systems"
            hint="Greenhouse, Lever, Workday and similar."
            values={settings.atsDomains}
          />
          <Toggle
            name="checkSentHistory"
            label="People I've emailed before"
            hint="Anyone you've sent mail to counts as Important."
            checked={settings.checkSentHistory}
          />
        </section>

        <section className="panel">
          <h2>Always junk</h2>
          <ListField
            name="blockedSenders"
            label="Blocked senders"
            hint="VIP senders still win over this."
            values={settings.blockedSenders}
            placeholder="deals@store.com"
          />
        </section>

        <section className="panel">
          <h2>How cautious</h2>
          <p className="subtle small">
            Jev gives each email a probability. Lower numbers on the left catch more; a higher Junk number is safer.
          </p>
          <div className="thresholds">
            <NumField name="jobThreshold" label="Job-related → Important at" value={settings.jobThreshold} />
            <NumField name="importantThreshold" label="Other → Important at" value={settings.importantThreshold} />
            <NumField name="junkThreshold" label="Junk only above" value={settings.junkThreshold} />
          </div>
        </section>

        <section className="panel">
          <h2>Show in Gmail &amp; Outlook</h2>
          <Toggle
            name="applyLabels"
            label="Add Mirah labels to my inbox"
            hint="Adds Mirah/Important, Mirah/Review, Mirah/Junk labels in Gmail and categories in Outlook. Mirah never deletes or archives anything."
            checked={settings.applyLabels}
          />
        </section>

        <div className="save-bar">
          <SubmitButton pending="Saving…" className="button primary">
            Save settings
          </SubmitButton>
        </div>
      </form>

      <section className="panel row spread">
        <span className="subtle small">Signed in as {user}</span>
        <form action={logout}>
          <SubmitButton className="chip-btn">Sign out</SubmitButton>
        </form>
      </section>
    </>
  );
}

function ListField({
  name,
  label,
  hint,
  values,
  placeholder,
}: {
  name: string;
  label: string;
  hint?: string;
  values: string[];
  placeholder?: string;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {hint && <span className="subtle small">{hint}</span>}
      <textarea
        name={name}
        defaultValue={values.join("\n")}
        placeholder={placeholder}
        rows={Math.min(7, Math.max(2, values.length + 1))}
        spellCheck={false}
      />
    </label>
  );
}

function NumField({ name, label, value }: { name: string; label: string; value: number }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input name={name} type="number" step="0.05" min={0} max={1} defaultValue={value} className="num" />
    </label>
  );
}

function Toggle({ name, label, hint, checked }: { name: string; label: string; hint?: string; checked: boolean }) {
  return (
    <label className="toggle">
      <input type="checkbox" name={name} defaultChecked={checked} />
      <span className="switch" aria-hidden="true" />
      <span>
        <span className="field-label">{label}</span>
        {hint && <span className="subtle small block">{hint}</span>}
      </span>
    </label>
  );
}
