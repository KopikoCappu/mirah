import { decodeJwt } from "jose";
import { env } from "./env";

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
const MS_SCOPES = "offline_access openid email User.Read Mail.ReadWrite";
const MS_BASE = "https://login.microsoftonline.com/common/oauth2/v2.0";

export const googleRedirectUri = () => `${env.appUrl}/api/auth/google/callback`;
export const msRedirectUri = () => `${env.appUrl}/api/auth/microsoft/callback`;

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in: number;
  scope?: string;
}

async function postForm(url: string, body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  if (!res.ok) throw new Error(`Token request failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as TokenResponse;
}

// ---------- Google ----------

export function googleAuthUrl(state: string, withGmail: boolean) {
  const params = new URLSearchParams({
    client_id: env.googleClientId,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: withGmail ? `openid email ${GMAIL_SCOPE}` : "openid email",
    state,
  });
  if (withGmail) {
    params.set("access_type", "offline");
    params.set("prompt", "consent"); // guarantees a refresh token
  } else {
    params.set("prompt", "select_account");
  }
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function googleExchangeCode(code: string) {
  const tokens = await postForm("https://oauth2.googleapis.com/token", {
    code,
    client_id: env.googleClientId,
    client_secret: env.googleClientSecret,
    redirect_uri: googleRedirectUri(),
    grant_type: "authorization_code",
  });
  // The id_token came straight from Google's token endpoint over TLS, so decoding is enough.
  const claims = tokens.id_token ? decodeJwt(tokens.id_token) : {};
  const email = typeof claims.email === "string" ? claims.email.toLowerCase() : null;
  if (!email || claims.email_verified !== true) throw new Error("Google did not return a verified email");
  return { email, refreshToken: tokens.refresh_token ?? null, scope: tokens.scope ?? "" };
}

export async function googleAccessToken(refreshToken: string) {
  const tokens = await postForm("https://oauth2.googleapis.com/token", {
    refresh_token: refreshToken,
    client_id: env.googleClientId,
    client_secret: env.googleClientSecret,
    grant_type: "refresh_token",
  });
  return tokens.access_token;
}

// ---------- Microsoft ----------

export function msAuthUrl(state: string) {
  const params = new URLSearchParams({
    client_id: env.msClientId,
    redirect_uri: msRedirectUri(),
    response_type: "code",
    response_mode: "query",
    scope: MS_SCOPES,
    state,
    prompt: "select_account",
  });
  return `${MS_BASE}/authorize?${params}`;
}

export async function msExchangeCode(code: string) {
  const tokens = await postForm(`${MS_BASE}/token`, {
    code,
    client_id: env.msClientId,
    client_secret: env.msClientSecret,
    redirect_uri: msRedirectUri(),
    grant_type: "authorization_code",
    scope: MS_SCOPES,
  });
  if (!tokens.refresh_token) throw new Error("Microsoft did not return a refresh token");
  const me = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  }).then((r) => r.json() as Promise<{ mail?: string; userPrincipalName?: string }>);
  const email = (me.mail || me.userPrincipalName || "").toLowerCase();
  if (!email) throw new Error("Could not read the Outlook account's address");
  return { email, refreshToken: tokens.refresh_token };
}

/** Microsoft rotates refresh tokens, so the caller must store the new one. */
export async function msAccessToken(refreshToken: string) {
  const tokens = await postForm(`${MS_BASE}/token`, {
    refresh_token: refreshToken,
    client_id: env.msClientId,
    client_secret: env.msClientSecret,
    grant_type: "refresh_token",
    scope: MS_SCOPES,
  });
  return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token ?? refreshToken };
}
