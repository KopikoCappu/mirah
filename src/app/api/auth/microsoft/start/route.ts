import { msAuthUrl } from "@/lib/oauth";
import { newOAuthState, redirectTo } from "@/lib/oauth-state";
import { currentUser } from "@/lib/session";

export async function GET() {
  if (!(await currentUser())) return redirectTo("/login");
  try {
    return redirectTo(await msAuthUrl(await newOAuthState("outlook")));
  } catch (err) {
    return redirectTo("/settings", { error: (err as Error).message });
  }
}
