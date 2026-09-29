function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

/** APP_URL if set; on Vercel, the production domain Vercel provides automatically. */
function appUrl(): string | null {
  const explicit = process.env.APP_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return vercel ? `https://${vercel}` : null;
}

/**
 * The few values the server needs before the /setup wizard can run. The setup script generates all of them.
 * Everything a person types (OAuth client, Jev key, who can sign in) is entered in the wizard; see config.ts.
 */
export const REQUIRED_VARS: { name: string; hint: string; value: () => string | null; valid?: (v: string) => boolean }[] = [
  {
    name: "APP_URL",
    hint: "This site's public address with no path, e.g. https://your-mirah.example.com. Set automatically on Vercel.",
    value: appUrl,
    valid: (v) => /^https?:\/\/[^\s/]+$/.test(v),
  },
  { name: "SESSION_SECRET", hint: "Random 32 bytes, base64", value: () => process.env.SESSION_SECRET?.trim() || null },
  {
    name: "TOKEN_ENCRYPTION_KEY",
    hint: "Random 32 bytes, base64 (must decode to exactly 32 bytes)",
    value: () => process.env.TOKEN_ENCRYPTION_KEY?.trim() || null,
    valid: (v) => Buffer.from(v, "base64").length === 32,
  },
  { name: "CRON_SECRET", hint: "Random 32 bytes, base64", value: () => process.env.CRON_SECRET?.trim() || null },
];

export type ConfigState = "ok" | "missing" | "invalid";

export function configState(name: string): ConfigState {
  const spec = REQUIRED_VARS.find((v) => v.name === name);
  const value = spec?.value();
  if (!value) return "missing";
  return !spec?.valid || spec.valid(value) ? "ok" : "invalid";
}

/** Names of required server settings that are missing or clearly wrong. */
export function configProblems(): string[] {
  return REQUIRED_VARS.map((v) => v.name).filter((name) => configState(name) !== "ok");
}

export const env = {
  get appUrl() {
    const url = appUrl();
    if (!url) throw new Error("Missing environment variable APP_URL");
    return url;
  },
  get sessionSecret() {
    return required("SESSION_SECRET");
  },
  get tokenKey() {
    return required("TOKEN_ENCRYPTION_KEY");
  },
  get cronSecret() {
    return required("CRON_SECRET");
  },
  /** For deep links into the Google Cloud console. */
  get googleProject(): string | null {
    const explicit = process.env.GOOGLE_CLOUD_PROJECT?.trim();
    if (explicit) return explicit;
    try {
      const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
      if (!raw) return null;
      const key = JSON.parse(raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8"));
      return typeof key.project_id === "string" ? key.project_id : null;
    } catch {
      return null;
    }
  },
};
