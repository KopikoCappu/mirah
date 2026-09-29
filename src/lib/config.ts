import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { decrypt, encrypt } from "./crypto";
import { metaDoc } from "./db";
import { env } from "./env";

/**
 * Keys a person enters in the /setup wizard. They live in Firestore (secrets encrypted with TOKEN_ENCRYPTION_KEY),
 * so nobody has to edit environment variables. An environment variable, when set, always wins.
 */
export interface AppConfig {
  googleClientId: string;
  googleClientSecret: string;
  jevApiKey: string;
  msClientId: string;
  msClientSecret: string;
  allowedEmails: string[];
}

interface StoredConfig {
  googleClientId?: string;
  googleClientSecretEnc?: string;
  jevApiKeyEnc?: string;
  msClientId?: string;
  msClientSecretEnc?: string;
  allowedEmails?: string[];
}

/** Which fields come from environment variables, so the wizard can show them as fixed. */
export const ENV_NAMES: Record<keyof AppConfig, string> = {
  googleClientId: "GOOGLE_CLIENT_ID",
  googleClientSecret: "GOOGLE_CLIENT_SECRET",
  jevApiKey: "JEV_API_KEY",
  msClientId: "MS_CLIENT_ID",
  msClientSecret: "MS_CLIENT_SECRET",
  allowedEmails: "ALLOWED_EMAILS",
};

export const fromEnv = (field: keyof AppConfig) => Boolean(process.env[ENV_NAMES[field]]?.trim());

const configDoc = () => metaDoc("config");
const TTL_MS = 15_000;
let cache: { at: number; value: AppConfig } | null = null;

const open = (enc?: string) => {
  if (!enc) return "";
  try {
    return decrypt(enc);
  } catch {
    return ""; // Encrypted with a different TOKEN_ENCRYPTION_KEY; treat as not set.
  }
};

const splitEmails = (raw: string) =>
  raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

/** Cached briefly: the layout checks the session on every request, and each Firestore read counts. */
export async function getConfig({ fresh = false } = {}): Promise<AppConfig> {
  if (!fresh && cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const stored = ((await configDoc().get()).data() ?? {}) as StoredConfig;
  const e = (name: string) => process.env[name]?.trim() ?? "";
  const value: AppConfig = {
    googleClientId: e("GOOGLE_CLIENT_ID") || stored.googleClientId || "",
    googleClientSecret: e("GOOGLE_CLIENT_SECRET") || open(stored.googleClientSecretEnc),
    jevApiKey: e("JEV_API_KEY") || open(stored.jevApiKeyEnc),
    msClientId: e("MS_CLIENT_ID") || stored.msClientId || "",
    msClientSecret: e("MS_CLIENT_SECRET") || open(stored.msClientSecretEnc),
    allowedEmails: e("ALLOWED_EMAILS") ? splitEmails(e("ALLOWED_EMAILS")) : (stored.allowedEmails ?? []),
  };
  cache = { at: Date.now(), value };
  return value;
}

/** Saves wizard fields. Empty strings are ignored, so a blank secret box keeps the current secret. */
export async function saveConfig(patch: Partial<AppConfig>) {
  const doc: StoredConfig = {};
  if (patch.googleClientId) doc.googleClientId = patch.googleClientId;
  if (patch.googleClientSecret) doc.googleClientSecretEnc = encrypt(patch.googleClientSecret);
  if (patch.jevApiKey) doc.jevApiKeyEnc = encrypt(patch.jevApiKey);
  if (patch.msClientId !== undefined) doc.msClientId = patch.msClientId;
  if (patch.msClientSecret) doc.msClientSecretEnc = encrypt(patch.msClientSecret);
  if (patch.allowedEmails) doc.allowedEmails = patch.allowedEmails;
  await configDoc().set(doc, { merge: true });
  cache = null;
}

export async function hasMicrosoft() {
  const c = await getConfig();
  return Boolean(c.msClientId && c.msClientSecret);
}

/** Makes this address the owner, unless someone already is. In a transaction so two sign-ins can't both win. */
export async function claimOwner(email: string): Promise<boolean> {
  const ref = configDoc();
  const claimed = await ref.firestore.runTransaction(async (tx) => {
    const current = ((await tx.get(ref)).data() ?? {}) as StoredConfig;
    if (current.allowedEmails?.length) return current.allowedEmails.includes(email);
    tx.set(ref, { allowedEmails: [email] }, { merge: true });
    return true;
  });
  cache = null;
  return claimed;
}

/** Nobody owns this copy yet: the wizard is open to whoever holds the setup key. */
export async function isUnclaimed() {
  return (await getConfig({ fresh: true })).allowedEmails.length === 0;
}

// ---------- Setup key ----------
// Derived from SESSION_SECRET, so it needs no storage and the setup script can print it.
// Only matters until someone signs in and becomes the owner.

const SETUP_COOKIE = "mirah_setup";

export function setupKey() {
  return createHmac("sha256", env.sessionSecret).update("mirah-setup").digest("base64url").slice(0, 22);
}

export function isSetupKey(given: string | null | undefined) {
  if (!given) return false;
  const a = Buffer.from(given.trim());
  const b = Buffer.from(setupKey());
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function rememberSetupKey() {
  (await cookies()).set(SETUP_COOKIE, setupKey(), {
    httpOnly: true,
    secure: env.appUrl.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24,
  });
}

export async function hasSetupKey() {
  return isSetupKey((await cookies()).get(SETUP_COOKIE)?.value);
}
