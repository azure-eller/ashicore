import "server-only";

import rawCorpus from "./email-corpus.json";
import { marketingEmailCorpusSchema } from "@/lib/schemas/marketing";

export async function getMarketingEmailCorpus() {
  return marketingEmailCorpusSchema.parse(rawCorpus);
}

export async function assertMarketingCorpusReady(exampleIds?: string[]) {
  const corpus = await getMarketingEmailCorpus();
  const standardExamples = corpus.examples.filter((example) => !example.experimental);
  if (standardExamples.length === 0) throw new Error("The email reference corpus is empty.");
  if (!exampleIds) return { ...corpus, examples: standardExamples };

  const selectedIds = new Set(exampleIds);
  const examples = corpus.examples.filter((example) => selectedIds.has(example.id));
  if (examples.length !== selectedIds.size) {
    throw new Error("The experiment references an unknown email corpus example.");
  }
  return { ...corpus, examples };
}
