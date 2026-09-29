import { Firestore } from "@google-cloud/firestore";
import type { Account, EmailRecord } from "./types";

const globalForDb = globalThis as unknown as { firestore?: Firestore };

/**
 * On Google Cloud or locally (after `gcloud auth application-default login`) credentials are found automatically.
 * Elsewhere (Vercel) they come from a service account key in GOOGLE_SERVICE_ACCOUNT_JSON.
 */
function credentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return undefined;
  const key = JSON.parse(raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8"));
  return { client_email: key.client_email as string, private_key: key.private_key as string };
}

export const db =
  globalForDb.firestore ??
  new Firestore({
    projectId: process.env.GOOGLE_CLOUD_PROJECT || undefined,
    credentials: credentials(),
    ignoreUndefinedProperties: true,
  });
globalForDb.firestore = db;

export const accountsCol = () => db.collection("accounts");
export const emailsCol = () => db.collection("emails");
export const contactsCol = () => db.collection("contacts");
export const metaDoc = (id: string) => db.collection("meta").doc(id);

export async function listAccounts(): Promise<Account[]> {
  const snap = await accountsCol().get();
  return snap.docs.map((d) => d.data() as Account);
}

export async function saveAccount(account: Account) {
  await accountsCol().doc(account.id).set(account);
}

export async function updateAccount(id: string, patch: Partial<Account>) {
  await accountsCol().doc(id).set(patch, { merge: true });
}

export async function getEmail(id: string): Promise<EmailRecord | null> {
  const doc = await emailsCol().doc(id).get();
  return doc.exists ? (doc.data() as EmailRecord) : null;
}
