"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { accountsCol, emailsCol, getEmail, listAccounts } from "@/lib/db";
import { forgetSender, learnFromChoice } from "@/lib/senders";
import { getSettings, saveSettings } from "@/lib/settings";
import { destroySession, requireUser } from "@/lib/session";
import { clientFor, runSync } from "@/lib/sync";
import { BUCKETS, type Account, type Bucket, type Settings } from "@/lib/types";

const isBucket = (v: unknown): v is Bucket => BUCKETS.includes(v as Bucket);

/** Moves an email to another bucket (or confirms the current one) and records it as feedback. */
export async function setBucket(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id"));
  const bucket = formData.get("bucket");
  if (!isBucket(bucket)) return;
  const email = await getEmail(id);
  if (!email) return;

  await emailsCol().doc(id).update({ userBucket: bucket, bucket });
  // Remember the sender so their next email lands in the same place without asking Jev.
  await learnFromChoice(email.fromEmail, email.fromName, bucket);

  const settings = await getSettings();
  if (settings.applyLabels && bucket !== email.bucket) {
    const account = (await accountsCol().doc(email.accountId).get()).data() as Account | undefined;
    if (account) {
      await clientFor(account)
        .applyBucket(email.messageId, bucket, email.labeled ? email.bucket : null)
        .then(() => emailsCol().doc(id).update({ labeled: true }))
        .catch(() => undefined);
    }
  }
  revalidatePath("/", "layout");
}

export async function forgetLearnedSender(formData: FormData) {
  await requireUser();
  await forgetSender(String(formData.get("id")));
  revalidatePath("/settings");
}

const FRESH_MS = 60 * 1000;

/**
 * Runs when you open the app: syncs unless every inbox was synced in the last minute.
 * Returns how many new emails were sorted so the page knows whether to refresh.
 */
export async function syncIfStale(): Promise<{ ran: boolean; processed: number }> {
  await requireUser();
  const accounts = await listAccounts();
  const stale = accounts.some((a) => Date.now() - (a.lastSyncAt ?? 0) > FRESH_MS);
  if (!stale) return { ran: false, processed: 0 };
  const result = await runSync();
  return { ran: !result.skipped, processed: result.accounts.reduce((n, a) => n + a.processed, 0) };
}

export async function syncNow() {
  await requireUser();
  await runSync();
  revalidatePath("/", "layout");
}

export async function backfill(formData: FormData) {
  await requireUser();
  const days = Math.min(90, Math.max(1, Number(formData.get("days")) || 14));
  const max = Math.min(500, Math.max(1, Number(formData.get("max")) || 200));
  await runSync({ backfillDays: days, backfillMax: max });
  revalidatePath("/", "layout");
  redirect("/");
}

const lines = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);

const clamp01 = (v: FormDataEntryValue | null, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
};

export async function updateSettings(formData: FormData) {
  await requireUser();
  const current = await getSettings();
  const patch: Settings = {
    vipSenders: lines(formData.get("vipSenders")),
    blockedSenders: lines(formData.get("blockedSenders")),
    companyDomains: lines(formData.get("companyDomains")),
    atsDomains: lines(formData.get("atsDomains")),
    keywords: lines(formData.get("keywords")),
    importantThreshold: clamp01(formData.get("importantThreshold"), current.importantThreshold),
    jobThreshold: clamp01(formData.get("jobThreshold"), current.jobThreshold),
    junkThreshold: clamp01(formData.get("junkThreshold"), current.junkThreshold),
    checkSentHistory: formData.get("checkSentHistory") === "on",
    applyLabels: formData.get("applyLabels") === "on",
  };
  await saveSettings(patch);
  revalidatePath("/settings");
  redirect("/settings?saved=1");
}

export async function disconnectAccount(formData: FormData) {
  await requireUser();
  await accountsCol().doc(String(formData.get("id"))).delete();
  revalidatePath("/settings");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
