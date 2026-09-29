import { cookies } from "next/headers";
import { randomToken } from "./crypto";
import { env } from "./env";

const COOKIE = "mirah_oauth_state";

/** Creates a one-time state value that ties the OAuth callback to this browser. */
export async function newOAuthState(purpose: string): Promise<string> {
  const state = `${purpose}.${randomToken()}`;
  (await cookies()).set(COOKIE, state, {
    httpOnly: true,
    secure: env.appUrl.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return state;
}

/** Returns the purpose if the state matches the cookie, otherwise null. */
export async function consumeOAuthState(state: string | null): Promise<string | null> {
  const store = await cookies();
  const expected = store.get(COOKIE)?.value;
  store.delete(COOKIE);
  if (!state || !expected || state !== expected) return null;
  return state.split(".")[0];
}

/** A redirect with mutable headers, so cookies set via cookies() get attached. */
export function redirectTo(pathOrUrl: string, params?: Record<string, string>) {
  const url = new URL(pathOrUrl, env.appUrl);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
  return new Response(null, { status: 302, headers: { Location: url.toString() } });
}
