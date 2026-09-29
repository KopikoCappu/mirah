import { googleAuthUrl } from "@/lib/oauth";
import { newOAuthState, redirectTo } from "@/lib/oauth-state";
import { currentUser } from "@/lib/session";

// ?mode=login signs you in; ?mode=gmail connects a Gmail inbox.
export async function GET(request: Request) {
  const mode = new URL(request.url).searchParams.get("mode") === "gmail" ? "gmail" : "login";
  if (mode === "gmail" && !(await currentUser())) return redirectTo("/login");
  return redirectTo(googleAuthUrl(await newOAuthState(mode), mode === "gmail"));
}
