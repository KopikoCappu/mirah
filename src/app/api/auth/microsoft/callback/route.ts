import { encrypt, hashId } from "@/lib/crypto";
import { accountsCol } from "@/lib/db";
import { msExchangeCode } from "@/lib/oauth";
import { consumeOAuthState, redirectTo } from "@/lib/oauth-state";
import { currentUser } from "@/lib/session";
import type { Account } from "@/lib/types";

export async function GET(request: Request) {
  if (!(await currentUser())) return redirectTo("/login");
  const params = new URL(request.url).searchParams;
  const purpose = await consumeOAuthState(params.get("state"));
  const code = params.get("code");
  if (purpose !== "outlook" || !code) {
    return redirectTo("/settings", {
      error: params.get("error_description") ?? params.get("error") ?? "Sign-in expired, try again",
    });
  }

  try {
    const { email, refreshToken } = await msExchangeCode(code);
    const id = `outlook_${hashId(email)}`;
    const account: Partial<Account> = { id, provider: "outlook", email, refreshTokenEnc: encrypt(refreshToken) };
    const existing = await accountsCol().doc(id).get();
    if (!existing.exists) Object.assign(account, { cursor: null, createdAt: Date.now() });
    await accountsCol().doc(id).set(account, { merge: true });
    return redirectTo("/settings", { connected: email });
  } catch (err) {
    return redirectTo("/settings", { error: (err as Error).message.slice(0, 200) });
  }
}
