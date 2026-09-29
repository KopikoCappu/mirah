import { msAuthUrl } from "@/lib/oauth";
import { newOAuthState, redirectTo } from "@/lib/oauth-state";
import { currentUser } from "@/lib/session";

export async function GET() {
  if (!(await currentUser())) return redirectTo("/login");
  return redirectTo(msAuthUrl(await newOAuthState("outlook")));
}
