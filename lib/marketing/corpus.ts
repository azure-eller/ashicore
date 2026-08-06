import "server-only";

import fs from "node:fs/promises";
import rawCorpus from "./email-corpus.json";
import { marketingEmailCorpusSchema, type MarketingEmailCorpus } from "@/lib/schemas/marketing";
import { MARKETING_TEST_MODE_FLAG } from "./test-mode";

const TEST_CORPUS: MarketingEmailCorpus = {
  version: "test-v1",
  blacklist: ["streamline", "I was impressed by"],
  examples: Array.from({ length: 5 }, (_, index) => ({
    id: `test-${index + 1}`,
    situation: "A technical founder asks a researched operator one honest question.",
    subject: `how are you handling this ${index + 1}`,
    body: "Hey — I came across your company while looking at smaller soil manufacturers. Not sure how you handle production planning today, but I’d be curious to hear what holds it together.",
  })),
};

async function isTestMode() {
  try {
    await fs.access(MARKETING_TEST_MODE_FLAG);
    return true;
  } catch {
    return false;
  }
}

export async function getMarketingEmailCorpus() {
  if (await isTestMode()) return TEST_CORPUS;
  return marketingEmailCorpusSchema.parse(rawCorpus);
}

export async function assertMarketingCorpusReady() {
  const corpus = await getMarketingEmailCorpus();
  if (corpus.examples.length < 5) {
    throw new Error(
      "The founder email corpus must contain at least five canonical examples before activation.",
    );
  }
  return corpus;
}
