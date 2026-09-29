import { metaDoc } from "./db";
import type { Settings } from "./types";

export const DEFAULT_SETTINGS: Settings = {
  vipSenders: [],
  blockedSenders: [],
  companyDomains: [],
  atsDomains: [
    "greenhouse.io",
    "greenhouse-mail.io",
    "lever.co",
    "myworkday.com",
    "myworkdayjobs.com",
    "ashbyhq.com",
    "icims.com",
    "smartrecruiters.com",
    "jobvite.com",
    "workable.com",
    "workablemail.com",
    "bamboohr.com",
    "recruitee.com",
    "taleo.net",
    "successfactors.com",
    "hirevue.com",
    "codesignal.com",
    "hackerrank.com",
    "calendly.com",
    "goodtime.io",
  ],
  keywords: [
    "interview",
    "offer letter",
    "job offer",
    "next steps",
    "your availability",
    "schedule a call",
    "phone screen",
    "recruiter",
    "background check",
    "onboarding",
    "your application",
    "technical assessment",
    "coding challenge",
  ],
  importantThreshold: 0.25,
  jobThreshold: 0.15,
  junkThreshold: 0.9,
  checkSentHistory: true,
  applyLabels: false,
};

export async function getSettings(): Promise<Settings> {
  const doc = await metaDoc("settings").get();
  return { ...DEFAULT_SETTINGS, ...((doc.data() as Partial<Settings>) ?? {}) };
}

export async function saveSettings(patch: Partial<Settings>) {
  await metaDoc("settings").set(patch, { merge: true });
}
