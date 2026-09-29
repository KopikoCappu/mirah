function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

/** Everything the app needs before anyone can sign in, with where each value comes from. Shown on /setup. */
export const REQUIRED_VARS: { name: string; hint: string }[] = [
  { name: "APP_URL", hint: "This site's public URL, e.g. https://your-mirah.vercel.app" },
  { name: "ALLOWED_EMAILS", hint: "Your Google address (comma-separate to allow more)" },
  { name: "SESSION_SECRET", hint: "Random 32 bytes, base64" },
  { name: "TOKEN_ENCRYPTION_KEY", hint: "Random 32 bytes, base64" },
  { name: "CRON_SECRET", hint: "Random 32 bytes, base64" },
  { name: "JEV_API_KEY", hint: "From TypeSafe: https://docs.typesafe.ai/api" },
  { name: "GOOGLE_CLIENT_ID", hint: "Google Cloud console → Google Auth Platform → Clients" },
  { name: "GOOGLE_CLIENT_SECRET", hint: "Same OAuth client as above" },
];

export function missingConfig(): string[] {
  return REQUIRED_VARS.map((v) => v.name).filter((name) => !process.env[name]?.trim());
}

export const env = {
  get appUrl() {
    return required("APP_URL").replace(/\/$/, "");
  },
  get allowedEmails() {
    return required("ALLOWED_EMAILS")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
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
  get jevApiKey() {
    return required("JEV_API_KEY");
  },
  get googleClientId() {
    return required("GOOGLE_CLIENT_ID");
  },
  get googleClientSecret() {
    return required("GOOGLE_CLIENT_SECRET");
  },
  get msClientId() {
    return required("MS_CLIENT_ID");
  },
  get msClientSecret() {
    return required("MS_CLIENT_SECRET");
  },
  get hasMicrosoft() {
    return Boolean(process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET);
  },
};
