import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getConfig } from "./config";
import { env } from "./env";

const COOKIE = "mirah_session";
const MAX_AGE = 60 * 60 * 24 * 30;

const secret = () => new TextEncoder().encode(env.sessionSecret);

export async function createSession(email: string) {
  const token = await new SignJWT({ email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: env.appUrl.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

export async function currentUser(): Promise<string | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const email = typeof payload.email === "string" ? payload.email : null;
    // Re-check the allowlist so removing an address revokes access.
    return email && (await getConfig()).allowedEmails.includes(email) ? email : null;
  } catch {
    return null;
  }
}

/** For pages and server actions: redirect to /login when signed out. */
export async function requireUser(): Promise<string> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}
