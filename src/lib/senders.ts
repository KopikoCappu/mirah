import { hashId } from "./crypto";
import { db } from "./db";
import type { Bucket } from "./types";

/** What Mirah learned from your corrections: "mail from this sender belongs in X". */
export interface LearnedSender {
  id: string;
  email: string;
  name: string;
  bucket: "important" | "junk";
  updatedAt: number;
}

const sendersCol = () => db.collection("senders");
const idFor = (address: string) => hashId("sender", address.toLowerCase());

/**
 * Called when you confirm or move an email. Important and Junk are remembered for the sender;
 * Review means "it depends", so it clears anything learned.
 */
export async function learnFromChoice(address: string, name: string, bucket: Bucket) {
  if (!address) return;
  const ref = sendersCol().doc(idFor(address));
  if (bucket === "review") {
    await ref.delete();
    return;
  }
  const entry: LearnedSender = { id: ref.id, email: address.toLowerCase(), name, bucket, updatedAt: Date.now() };
  await ref.set(entry);
}

export async function learnedBucketFor(address: string): Promise<"important" | "junk" | null> {
  if (!address) return null;
  const doc = await sendersCol().doc(idFor(address)).get();
  return doc.exists ? (doc.data() as LearnedSender).bucket : null;
}

export async function listLearnedSenders(): Promise<LearnedSender[]> {
  const snap = await sendersCol().orderBy("updatedAt", "desc").limit(200).get();
  return snap.docs.map((d) => d.data() as LearnedSender);
}

export async function forgetSender(id: string) {
  await sendersCol().doc(id).delete();
}
