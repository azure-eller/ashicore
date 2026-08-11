import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { defineAgentTask, runAgentTask } from "@/lib/agent/core";
import { createOpenAIResponsesAgentProvider } from "@/lib/agent/providers/openai-responses";
import { env } from "@/lib/env";
import type { MarketingEmailCorpus } from "@/lib/schemas/marketing";

const draftSchema = z.object({
  subject: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(2_000),
  evidence: z.array(z.string().trim().min(1)).min(1).max(5),
});

const evaluationSchema = z.object({
  verdict: z.enum(["pass", "rewrite"]),
  reasons: z.array(z.string()),
  offendingPhrases: z.array(z.string()),
});

const replyClassificationSchema = z.object({
  outcome: z.enum([
    "positive",
    "neutral",
    "negative",
    "opt_out",
    "complaint",
    "automated",
    "unknown",
  ]),
  reason: z.string(),
});

const learningSchema = z.object({
  learning: z.string().trim().min(1).max(1_000),
  nextChange: z.string().trim().min(1).max(500),
});

type Draft = z.infer<typeof draftSchema>;
export type DraftEvaluation = z.infer<typeof evaluationSchema>;

function modelName() {
  return env.MARKETING_AGENT_MODEL ?? env.OPENAI_AGENT_MODEL ?? "gpt-5.4-mini";
}

async function runFreshStructured<T>(args: {
  taskId: string;
  purpose: string;
  instructions: string;
  input: string;
  schema: z.ZodType<T>;
}): Promise<T> {
  const task = defineAgentTask({
    id: args.taskId,
    purpose: args.purpose,
    promptSections: [{ id: `${args.taskId}.v1`, tier: "task", text: args.instructions }],
    tools: [],
  });
  const runId = randomUUID();
  const controller = new AbortController();
  let output: unknown;
  let failure: string | null = null;
  for await (const event of runAgentTask({
    task,
    provider: createOpenAIResponsesAgentProvider({
      model: modelName(),
      reasoning: { effort: "medium", summary: "auto" },
    }),
    input: args.input,
    run: {
      runId,
      now: new Date().toISOString(),
      abortSignal: controller.signal,
    },
    maxTurns: 1,
    outputSchema: args.schema,
    parallelToolCalls: false,
  })) {
    if (event.type === "run_completed") output = event.output;
    if (event.type === "run_failed") failure = event.error;
  }
  if (failure) throw new Error(failure);
  return args.schema.parse(output);
}

function corpusText(corpus: MarketingEmailCorpus) {
  return corpus.examples
    .map(
      (example) =>
        `EXAMPLE ${example.id}\nSituation: ${example.situation}\nSubject: ${example.subject}\n${example.body}`,
    )
    .join("\n\n");
}

export async function generateMarketingDraft(args: {
  company: string;
  recipient: string;
  evidence: string[];
  hypothesis: string;
  segment: string;
  painAngle: string;
  cta: string;
  allowedClaims: string[];
  corpus: MarketingEmailCorpus;
  rewriteFeedback?: DraftEvaluation;
}): Promise<Draft> {
  return runFreshStructured({
    taskId: args.rewriteFeedback ? "marketing.email.rewrite" : "marketing.email.generate",
    purpose: "Write a plain founder email grounded only in supplied CRM research.",
    schema: draftSchema,
    instructions: `Write the kind of plain email a technical founder would personally send. The canonical examples are the authority on voice and rhythm. Do not sound professional, polished, persuasive, or salesy. Do not praise the company, dramatize a problem, invent facts, or use a fact not present in EVIDENCE. Make one point and one modest CTA. Return only the structured result.`,
    input: JSON.stringify({
      company: args.company,
      recipient: args.recipient,
      evidence: args.evidence,
      experiment: {
        hypothesis: args.hypothesis,
        segment: args.segment,
        painAngle: args.painAngle,
        cta: args.cta,
      },
      allowedClaims: args.allowedClaims,
      blacklist: args.corpus.blacklist,
      canonicalExamples: corpusText(args.corpus),
      rewriteFeedback: args.rewriteFeedback,
    }),
  });
}

export async function evaluateMarketingDraft(args: {
  draft: Draft;
  company: string;
  evidence: string[];
  allowedClaims: string[];
  corpus: MarketingEmailCorpus;
}): Promise<DraftEvaluation> {
  return runFreshStructured({
    taskId: "marketing.email.evaluate",
    purpose: "Skeptically compare a proposed email with founder-written examples.",
    schema: evaluationSchema,
    instructions: `Act as a skeptical gate, not a copywriter. Return rewrite if any factual statement is unsupported by EVIDENCE or APPROVED CLAIMS, the company is not genuinely relevant, the message could be sent to any manufacturer, it makes multiple pitches or CTAs, or it does not plausibly match the supplied founder examples. Name every offending phrase. Never improve or rewrite the email yourself.`,
    input: JSON.stringify({
      company: args.company,
      evidence: args.evidence,
      approvedClaims: args.allowedClaims,
      blacklist: args.corpus.blacklist,
      canonicalExamples: corpusText(args.corpus),
      draft: args.draft,
    }),
  });
}

export async function generateMarketingFollowUp(args: {
  recipient: string;
  originalSubject: string;
  originalBody: string;
  cta: string;
  corpus: MarketingEmailCorpus;
}): Promise<Draft> {
  return runFreshStructured({
    taskId: "marketing.email.follow_up",
    purpose: "Write one restrained follow-up to a founder's unanswered email.",
    schema: draftSchema,
    instructions: `Write a very short plain-text follow-up in the voice of the supplied founder examples. Do not introduce a new claim, pain, pitch, or CTA. Do not imply the recipient saw the first message. One or two sentences is enough.`,
    input: JSON.stringify({
      recipient: args.recipient,
      originalSubject: args.originalSubject,
      originalBody: args.originalBody,
      cta: args.cta,
      canonicalExamples: corpusText(args.corpus),
    }),
  });
}

export async function classifyMarketingReply(args: {
  subject: string;
  text: string;
}) {
  const normalized = `${args.subject}\n${args.text}`.toLowerCase();
  if (/unsubscribe|remove me|do not contact|don't contact|stop emailing/.test(normalized)) {
    return { outcome: "opt_out" as const, reason: "Explicit opt-out language." };
  }
  if (/mailer-daemon|delivery status notification|undeliverable/.test(normalized)) {
    return { outcome: "automated" as const, reason: "Automated delivery response." };
  }
  return runFreshStructured({
    taskId: "marketing.reply.classify",
    purpose: "Classify a reply without drafting a response.",
    schema: replyClassificationSchema,
    instructions: `Classify the reply conservatively. Positive means genuine interest or a request to continue. Complaint means anger, spam accusation, or reputational concern. Opt-out means a request for no further contact. Unknown is preferred over guessing. Do not draft a response.`,
    input: JSON.stringify(args),
  });
}

export async function analyzeMarketingExperiment(input: Record<string, unknown>) {
  return runFreshStructured({
    taskId: "marketing.experiment.analyze",
    purpose: "State one bounded learning from externally observed outcomes.",
    schema: learningSchema,
    instructions: `Use only the supplied measured outcomes. State one concise learning with appropriate uncertainty, then propose exactly one variable to change. Do not claim causality from a small sample and do not launch anything.`,
    input: JSON.stringify(input),
  });
}

export const MARKETING_PROMPT_VERSION = "marketing-v1";
export { modelName as marketingModelName };
