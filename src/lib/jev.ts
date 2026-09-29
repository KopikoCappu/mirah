import { env } from "./env";

// Docs: https://docs.typesafe.ai/api
// Also works through Vercel AI Gateway, which speaks the same API:
//   JEV_BASE_URL=https://ai-gateway.vercel.sh/typesafe  JEV_MODEL=typesafe-ai/jev
const baseUrl = () => (process.env.JEV_BASE_URL || "https://api.typesafe.ai").replace(/\/$/, "");
const model = () => process.env.JEV_MODEL || "jev-latest";

export type JevQuestion =
  | { type: "noul"; instructions: string; criteria?: { true: string; false: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string | null> }
  | { type: "score"; instructions: string; criteria: string[] };

export type JevAnswer =
  | { type: "noul"; noul: number }
  | {
      type: "choice";
      choice: string;
      probabilities: Record<string, number>;
      confidence: number;
    }
  | {
      type: "score";
      score: number;
      legend: Record<string, string>;
      probabilities: Record<string, number>;
      confidence: number;
    };

export interface JevResponse {
  model: string;
  answers: Record<string, JevAnswer>;
  usage: { input_tokens: number; output_tokens: number };
}

const RETRYABLE = new Set([429, 500, 502, 503, 529]);

/** The key is missing or rejected: sorting can't work at all, so syncing should stop rather than guess. */
export class JevConfigError extends Error {}

export async function askJev(
  state: string,
  questions: Record<string, JevQuestion>,
  attempts = 4,
): Promise<JevResponse> {
  if (!process.env.JEV_API_KEY) throw new JevConfigError("JEV_API_KEY is not set");
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${baseUrl()}/v1/systemone`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.jevApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: model(), state, questions }),
    });
    if (res.ok) return (await res.json()) as JevResponse;
    if (res.status === 401 || res.status === 403) {
      throw new JevConfigError(`Jev rejected the API key (${res.status}): ${(await res.text()).slice(0, 200)}`);
    }
    if (!RETRYABLE.has(res.status) || attempt >= attempts) {
      throw new Error(`Jev ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    // Exponential backoff with jitter, as the docs ask for 429/529.
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt + Math.random() * 250));
  }
}
