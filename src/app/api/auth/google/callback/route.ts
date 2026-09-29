import { encrypt, hashId } from "@/lib/crypto";
import { accountsCol } from "@/lib/db";
import { env } from "@/lib/env";
import { GMAIL_SCOPE, googleExchangeCode } from "@/lib/oauth";
import { consumeOAuthState, redirectTo } from "@/lib/oauth-state";
import { createSession, currentUser } from "@/lib/session";
import type { Account } from "@/lib/types";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const mode = await consumeOAuthState(params.get("state"));
  const code = params.get("code");
  if (!mode || !code) return redirectTo("/login", { error: params.get("error") ?? "Sign-in expired, try again" });

  try {
    const { email, refreshToken, scope } = await googleExchangeCode(code);

    if (mode === "login") {
      if (!env.allowedEmails.includes(email)) return redirectTo("/login", { error: `${email} is not allowed` });
      await createSession(email);
      return redirectTo("/");
    }

    if (!(await currentUser())) return redirectTo("/login");
    if (!scope.includes(GMAIL_SCOPE)) {
      return redirectTo("/settings", { error: "Gmail access wasn't granted. Tick the Gmail checkbox when connecting." });
    }
    if (!refreshToken) return redirectTo("/settings", { error: "Google didn't return a refresh token, try again" });

    const id = `gmail_${hashId(email)}`;
    const account: Partial<Account> = {
      id,
      provider: "gmail",
      email,
      refreshTokenEnc: encrypt(refreshToken),
    };
    const existing = await accountsCol().doc(id).get();
    if (!existing.exists) Object.assign(account, { cursor: null, createdAt: Date.now() });
    await accountsCol().doc(id).set(account, { merge: true });
    return redirectTo("/settings", { connected: email });
  } catch (err) {
    return redirectTo(mode === "login" ? "/login" : "/settings", { error: (err as Error).message.slice(0, 200) });
  }
}
