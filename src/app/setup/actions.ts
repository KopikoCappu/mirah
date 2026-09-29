"use server";

import { redirect } from "next/navigation";
import { getConfig, hasSetupKey, isUnclaimed, saveConfig } from "@/lib/config";
import { checkJevKey } from "@/lib/jev";
import { currentUser } from "@/lib/session";

/** The owner can always edit; before anyone owns this copy, whoever opened the setup link can. */
async function requireSetupAccess() {
  const user = await currentUser();
  if (user) return user;
  if ((await isUnclaimed()) && (await hasSetupKey())) return null;
  redirect("/setup");
}

const field = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();

function back(params: Record<string, string>): never {
  redirect(`/setup?${new URLSearchParams(params)}`);
}

export async function saveGoogleClient(formData: FormData) {
  await requireSetupAccess();
  const id = field(formData, "googleClientId");
  const secret = field(formData, "googleClientSecret");
  if (!/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(id)) {
    back({ error: "That isn't a Google client ID. It ends in .apps.googleusercontent.com.", step: "google" });
  }
  if (!secret && !(await getConfig({ fresh: true })).googleClientSecret) {
    back({ error: "Paste the client secret too. It's next to the client ID in Google Cloud.", step: "google" });
  }
  await saveConfig({ googleClientId: id, googleClientSecret: secret });
  back({ saved: "google" });
}

export async function saveJevKey(formData: FormData) {
  await requireSetupAccess();
  const key = field(formData, "jevApiKey");
  if (!key) back({ error: "Paste your Jev API key.", step: "jev" });
  const problem = await checkJevKey(key);
  if (problem) back({ error: problem, step: "jev" });
  await saveConfig({ jevApiKey: key });
  back({ saved: "jev" });
}

export async function saveOutlook(formData: FormData) {
  await requireSetupAccess();
  const id = field(formData, "msClientId");
  const secret = field(formData, "msClientSecret");
  if (id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    back({ error: "That isn't a Microsoft client ID. It looks like 1a2b3c4d-…, 36 characters.", step: "outlook" });
  }
  if (id && !secret && !(await getConfig({ fresh: true })).msClientSecret) {
    back({ error: "Paste the client secret's Value too.", step: "outlook" });
  }
  // An empty ID turns Outlook off.
  await saveConfig({ msClientId: id, msClientSecret: secret });
  back({ saved: "outlook" });
}

export async function saveAllowedEmails(formData: FormData) {
  const user = await requireSetupAccess();
  if (!user) redirect("/setup"); // Only the owner decides who else can sign in.
  const emails = [
    ...new Set(
      field(formData, "allowedEmails")
        .split(/[\n,]/)
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  const bad = emails.find((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  if (bad) back({ error: `${bad} isn't an email address.`, step: "access" });
  if (!emails.includes(user)) back({ error: "Keep your own address in the list, or you'd lock yourself out.", step: "access" });
  await saveConfig({ allowedEmails: emails });
  back({ saved: "access" });
}
