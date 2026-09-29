import { hasSetupKey, isUnclaimed } from "@/lib/config";
import { googleAuthUrl } from "@/lib/oauth";
import { newOAuthState, redirectTo } from "@/lib/oauth-state";
import { currentUser } from "@/lib/session";

// ?mode=login signs you in; ?mode=gmail connects a Gmail inbox;
// ?mode=setup (last wizard step) makes you the owner, signs you in, and connects Gmail in one consent.
export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get("mode");
  const mode = requested === "gmail" || requested === "setup" ? requested : "login";
  if (mode === "gmail" && !(await currentUser())) return redirectTo("/login");
  if (mode === "setup" && !((await isUnclaimed()) && (await hasSetupKey()))) return redirectTo("/setup");
  try {
    return redirectTo(await googleAuthUrl(await newOAuthState(mode), mode !== "login"));
  } catch (err) {
    return redirectTo(mode === "setup" ? "/setup" : "/login", { error: (err as Error).message });
  }
}
