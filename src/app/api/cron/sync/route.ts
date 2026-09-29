import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { runSync } from "@/lib/sync";

export const dynamic = "force-dynamic";
// Vercel Hobby allows up to 300s; Gmail pacing can make a big batch slow.
export const maxDuration = 300;

function authorized(request: Request) {
  const given = Buffer.from(request.headers.get("x-cron-secret") ?? "");
  const expected = Buffer.from(env.cronSecret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// Called by Cloud Scheduler every few minutes.
export async function POST(request: Request) {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
  const result = await runSync();
  return Response.json(result);
}
