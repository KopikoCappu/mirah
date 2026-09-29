import { isSetupKey, rememberSetupKey } from "@/lib/config";
import { redirectTo } from "@/lib/oauth-state";

// The setup script prints /setup/unlock?key=…; the key is kept in a cookie so the wizard's own links stay clean.
export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("key");
  if (!isSetupKey(key)) return redirectTo("/setup", { error: "That setup key doesn't match. Copy the link again." });
  await rememberSetupKey();
  return redirectTo("/setup");
}
