import { askJev, JevConfigError, type JevQuestion } from "./jev";
import type { Bucket, RawEmail, Settings } from "./types";

/**
 * Categories Jev chooses between. The descriptions are the main tuning knob:
 * when something lands in the wrong bucket, sharpen the description first.
 */
export const CATEGORIES = {
  interview:
    "Invitation to, scheduling of, rescheduling of, or confirmation of a job interview, phone screen, or recruiter call",
  job_offer: "A job offer, offer letter, compensation details, or onboarding for a new job",
  job_process:
    "Other hiring-process email from a real employer or recruiter: application status, assessment or coding test, recruiter outreach, rejection",
  personal: "Written personally to the recipient by a real person they know (friend, family, classmate, colleague)",
  work_school: "Work or school matters: classes, assignments, grades, professors, managers, coworkers, deadlines",
  finance: "Bills or payments due, bank or card alerts, taxes, payroll, rent, insurance",
  security: "Account security: login codes, password resets, new sign-in alerts, identity verification",
  appointments: "Appointments, reservations, travel, tickets, or deliveries that need the recipient to do something",
  notification: "Automated notification, receipt, or shipping update that is informational only",
  newsletter: "Newsletter, digest, blog post, or content subscription",
  promotion: "Marketing, sales, discounts, ads, or product announcements",
  spam: "Unsolicited junk, scam, phishing, or irrelevant bulk mail",
  other: null,
} as const;

export type Category = keyof typeof CATEGORIES;

const JOB: Category[] = ["interview", "job_offer", "job_process"];
const IMPORTANT: Category[] = [...JOB, "personal", "work_school", "finance", "security", "appointments"];
const JUNK: Category[] = ["newsletter", "promotion", "spam"];

const QUESTIONS: Record<string, JevQuestion> = {
  category: {
    type: "choice",
    instructions: "What kind of email is this, from the recipient's point of view?",
    criteria: CATEGORIES,
  },
  needs_action: {
    type: "noul",
    instructions: "Does the recipient personally need to reply, decide, pay, or do something?",
    criteria: {
      true: "A specific action is expected from this recipient",
      false: "Informational, or a generic call-to-action sent to many people",
    },
  },
  urgency: {
    type: "score",
    instructions: "How time-sensitive is this for the recipient?",
    criteria: ["Not time-sensitive", "Within a week or two", "Within a day or two", "Today / immediately"],
  },
  suspicious: {
    type: "noul",
    instructions:
      "Is this likely a scam or phishing attempt, such as a fake job offer, a request for money, gift cards, or credentials, or impersonation of a company?",
    criteria: { true: "Likely scam or phishing", false: "Looks legitimate" },
  },
};

export interface Classification {
  bucket: Bucket;
  reasons: string[];
  category: string | null;
  categoryConfidence: number | null;
  pImportant: number | null;
  pJunk: number | null;
  needsAction: number | null;
  urgency: number | null;
  suspicious: number | null;
}

export interface RuleContext {
  settings: Settings;
  /** Resolves whether the user has emailed this address before. */
  hasEmailedBefore?: (address: string) => Promise<boolean>;
  /** Where the user has put this sender's mail before, if anywhere. */
  learnedBucket?: (address: string) => Promise<"important" | "junk" | null>;
}

const domainOf = (address: string) => address.split("@")[1]?.toLowerCase() ?? "";

/** "a@b.com" matches "a@b.com"; "@b.com" or "b.com" matches b.com and its subdomains. */
function matchesSender(address: string, patterns: string[]): string | null {
  const addr = address.toLowerCase();
  const domain = domainOf(addr);
  for (const raw of patterns) {
    const p = raw.trim().toLowerCase();
    if (!p) continue;
    if (p.includes("@") && !p.startsWith("@")) {
      if (addr === p) return p;
      continue;
    }
    const d = p.replace(/^@/, "");
    if (domain === d || domain.endsWith(`.${d}`)) return p;
  }
  return null;
}

/** Rules that force a bucket. Checked before Jev and always win. */
async function applyRules(email: RawEmail, ctx: RuleContext): Promise<{ bucket: Bucket; reason: string } | null> {
  const { settings } = ctx;
  const from = email.fromEmail;

  const vip = matchesSender(from, settings.vipSenders);
  if (vip) return { bucket: "important", reason: `VIP sender (${vip})` };

  const blocked = matchesSender(from, settings.blockedSenders);
  if (blocked) return { bucket: "junk", reason: `Blocked sender (${blocked})` };

  const learned = ctx.learnedBucket ? await ctx.learnedBucket(from) : null;
  if (learned === "important") return { bucket: "important", reason: "You marked this sender Important before" };

  const company = matchesSender(from, settings.companyDomains);
  if (company) return { bucket: "important", reason: `Company you applied to (${company})` };

  const ats = matchesSender(from, settings.atsDomains);
  if (ats) return { bucket: "important", reason: `Hiring system (${ats})` };

  const haystack = `${email.subject}\n${email.body.slice(0, 3000)}`.toLowerCase();
  const keyword = settings.keywords.find((k) => k.trim() && haystack.includes(k.trim().toLowerCase()));
  if (keyword) return { bucket: "important", reason: `Keyword "${keyword}"` };

  // Learned junk sits below the job rules on purpose: an interview never loses to an old Junk click.
  if (learned === "junk") return { bucket: "junk", reason: "You marked this sender Junk before" };

  if (settings.checkSentHistory && ctx.hasEmailedBefore && (await ctx.hasEmailedBefore(from))) {
    return { bucket: "important", reason: "You've emailed this person before" };
  }
  return null;
}

export function jevState(email: RawEmail): string {
  const body = email.body.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 2500);
  return [
    `From: ${email.fromName ? `${email.fromName} <${email.fromEmail}>` : email.fromEmail}`,
    `To: ${email.to}`,
    `Subject: ${email.subject}`,
    `Has unsubscribe link: ${email.hasUnsubscribe ? "yes" : "no"}`,
    "",
    body,
  ].join("\n");
}

const sum = (probs: Record<string, number>, keys: string[]) => keys.reduce((s, k) => s + (probs[k] ?? 0), 0);

export async function classify(email: RawEmail, ctx: RuleContext): Promise<Classification> {
  const rule = await applyRules(email, ctx);
  const reasons: string[] = rule ? [rule.reason] : [];

  let answers;
  try {
    ({ answers } = await askJev(jevState(email), QUESTIONS));
  } catch (err) {
    // A bad key would put every email in Review forever; stop the sync instead so it retries once fixed.
    if (err instanceof JevConfigError) throw err;
    // Otherwise fail safe: never junk something we couldn't classify.
    return {
      bucket: rule?.bucket ?? "review",
      reasons: [...reasons, `Jev failed: ${(err as Error).message}`],
      category: null,
      categoryConfidence: null,
      pImportant: null,
      pJunk: null,
      needsAction: null,
      urgency: null,
      suspicious: null,
    };
  }

  const cat = answers.category?.type === "choice" ? answers.category : null;
  const probs = cat?.probabilities ?? {};
  const pImportant = sum(probs, IMPORTANT);
  const pJob = sum(probs, JOB);
  const pJunk = sum(probs, JUNK);
  const needsAction = answers.needs_action?.type === "noul" ? answers.needs_action.noul : null;
  const urgency = answers.urgency?.type === "score" ? answers.urgency.score : null;
  const suspicious = answers.suspicious?.type === "noul" ? answers.suspicious.noul : null;
  const { settings } = ctx;

  let bucket: Bucket;
  if (rule) {
    bucket = rule.bucket;
  } else if (pJob >= settings.jobThreshold) {
    bucket = "important";
    reasons.push(`Job-related (${pct(pJob)})`);
  } else if (pImportant >= settings.importantThreshold) {
    bucket = "important";
    reasons.push(`Likely important (${pct(pImportant)})`);
  } else if (pJunk >= settings.junkThreshold && (needsAction ?? 0) < 0.5) {
    bucket = "junk";
    reasons.push(`Confident junk (${pct(pJunk)})`);
  } else if ((needsAction ?? 0) >= 0.8 && pJunk < 0.5) {
    bucket = "important";
    reasons.push(`Needs your action (${pct(needsAction ?? 0)})`);
  } else {
    bucket = "review";
    reasons.push("Not sure. Please take a look");
  }

  if ((suspicious ?? 0) >= 0.7) reasons.push(`⚠ Possible scam or phishing (${pct(suspicious ?? 0)})`);

  return {
    bucket,
    reasons,
    category: cat?.choice ?? null,
    categoryConfidence: cat?.confidence ?? null,
    pImportant,
    pJunk,
    needsAction,
    urgency,
    suspicious,
  };
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
