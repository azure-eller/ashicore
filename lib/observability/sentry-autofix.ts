import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_WEB_REPO = "azure-eller/erp";
const DEFAULT_ANDROID_REPO = "azure-eller/erp-android";
const BASE_BRANCH = "main";
const SENTRY_API_BASE_URL = "https://sentry.io/api/0";
const GITHUB_API_BASE_URL = "https://api.github.com";
const MAX_SAFE_CONTEXT_DEPTH = 4;

const SAFE_TAG_KEYS = [
  "error.kind",
  "error.domain",
  "module",
  "operation",
  "source",
  "request_id",
  "release_sha",
  "environment",
  "route",
  "method",
  "runtime",
  "vercel_env",
  "screen",
  "api_path",
  "http_status",
  "build_type",
  "app_version",
  "device_class",
] as const;

const SAFE_CONTEXT_KEYS = [
  "app_debug",
  "network",
  "db",
  "validation",
  "external_service",
  "next_render",
  "mobile",
  "api_error",
] as const;

const SENSITIVE_KEY_PATTERNS = [
  /authorization/i,
  /cookie/i,
  /password/i,
  /token/i,
  /secret/i,
  /\bbody\b/i,
  /request_body/i,
  /response_body/i,
  /payload/i,
  /\bsql\b/i,
  /query/i,
  /parameters?/i,
  /notes?/i,
  /comments?/i,
  /customer/i,
  /address/i,
  /\bsku\b/i,
  /quantity/i,
  /\bqty\b/i,
] as const;

const SENSITIVE_TEXT_PATTERNS = [
  /authorization/i,
  /cookie/i,
  /password/i,
  /token/i,
  /request body/i,
  /response body/i,
  /customer/i,
  /address/i,
  /\bsku\b/i,
  /quantity/i,
] as const;

type JsonRecord = Record<string, unknown>;
type Platform = "web" | "android" | "unknown";

export type AgentDebugPacket = {
  sentry: {
    issueId: string;
    eventId?: string;
    issueUrl?: string;
    project?: string;
    title?: string;
    culprit?: string;
  };
  repo: {
    fullName: string;
    baseBranch: "main";
    branchName: string;
  };
  app: {
    platform: Platform;
    environment?: string;
    releaseSha?: string;
    requestId?: string;
    module?: string;
    operation?: string;
    source?: string;
    route?: string;
    method?: string;
    apiPath?: string;
    screen?: string;
    runtime?: string;
    httpStatus?: string | number;
  };
  classification: {
    domain?: string;
    kind?: string;
    safeSummary?: string;
  };
  safeContexts: Record<string, unknown>;
};

export type AutofixConfig = {
  sentryWebhookSecret: string;
  sentryAuthToken: string;
  sentryOrg: string;
  sentryWebProject?: string;
  sentryAndroidProject?: string;
  githubToken: string;
  githubWebRepo: string;
  githubAndroidRepo: string;
};

export type ParsedSentryWebhook = {
  issueId: string;
  eventId?: string;
  project?: string;
  issueUrl?: string;
};

type SentryDetails = {
  issue?: JsonRecord;
  event?: JsonRecord;
};

type GithubPr = {
  number: number;
  state: "open" | "closed";
  merged?: boolean;
  html_url: string;
  body?: string | null;
  comments_url?: string;
  head?: {
    ref?: string;
  };
};

type GithubSearchItem = {
  number: number;
  pull_request?: {
    url: string;
    html_url: string;
    merged_at?: string | null;
  };
  state: "open" | "closed";
  body?: string | null;
  html_url: string;
};

type GithubFile = {
  sha?: string;
};

type GithubRef = {
  object?: {
    sha?: string;
  };
};

type GithubComment = {
  body?: string | null;
};

export class SentryAutofixError extends Error {
  constructor(
    message: string,
    readonly status = 500
  ) {
    super(message);
    this.name = "SentryAutofixError";
  }
}

export function getSentryAutofixConfig(env: NodeJS.ProcessEnv = process.env): AutofixConfig {
  const config = {
    sentryWebhookSecret: env.SENTRY_AUTOFIX_WEBHOOK_SECRET,
    sentryAuthToken: env.SENTRY_AUTH_TOKEN,
    sentryOrg: env.SENTRY_ORG,
    sentryWebProject: env.SENTRY_WEB_PROJECT,
    sentryAndroidProject: env.SENTRY_ANDROID_PROJECT,
    githubToken: env.GITHUB_AUTOFIX_TOKEN,
    githubWebRepo: env.GITHUB_WEB_REPO ?? DEFAULT_WEB_REPO,
    githubAndroidRepo: env.GITHUB_ANDROID_REPO ?? DEFAULT_ANDROID_REPO,
  };

  const missing = Object.entries(config)
    .filter(([key, value]) => !value && !["sentryWebProject", "sentryAndroidProject"].includes(key))
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new SentryAutofixError(`Missing Sentry autofix configuration: ${missing.join(", ")}`);
  }

  return config as AutofixConfig;
}

export function verifySentryAutofixRequest(args: {
  body: string;
  headers: Headers;
  secret: string;
}) {
  const authorization = args.headers.get("authorization");
  if (authorization === `Bearer ${args.secret}`) return true;

  const signature =
    args.headers.get("sentry-hook-signature") ??
    args.headers.get("x-sentry-hook-signature");
  if (!signature) return false;

  const expected = createHmac("sha256", args.secret).update(args.body).digest("hex");
  return safeEqual(signature, expected);
}

export function parseSentryWebhookPayload(payload: unknown): ParsedSentryWebhook {
  const root = asRecord(payload) ?? {};
  const data = asRecord(root.data) ?? {};
  const issue = asRecord(data.issue) ?? asRecord(root.issue) ?? asRecord(data.group) ?? asRecord(root.group);
  const event = asRecord(data.event) ?? asRecord(root.event);

  const issueId =
    firstString(
      issue?.id,
      issue?.issueId,
      issue?.issue_id,
      data.issueId,
      data.issue_id,
      data.groupId,
      data.group_id,
      event?.groupID,
      event?.groupId,
      event?.group_id,
      root.issueId,
      root.issue_id
    ) ?? "";

  if (!issueId) {
    throw new SentryAutofixError("Sentry autofix payload did not include an issue ID.", 400);
  }

  return {
    issueId,
    eventId: firstString(event?.event_id, event?.eventId, event?.id, data.eventId, data.event_id, root.eventId, root.event_id),
    project: firstString(
      asRecord(issue?.project)?.slug,
      asRecord(issue?.project)?.name,
      asRecord(event?.project)?.slug,
      asRecord(event?.project)?.name,
      data.project,
      data.project_slug,
      root.project,
      root.project_slug
    ),
    issueUrl: sanitizePath(
      firstString(issue?.permalink, issue?.web_url, issue?.url, data.issueUrl, data.issue_url, root.issueUrl, root.issue_url)
    ),
  };
}

export function normalizeAgentDebugPacket(args: {
  parsed: ParsedSentryWebhook;
  details?: SentryDetails;
  config: Pick<AutofixConfig, "githubWebRepo" | "githubAndroidRepo" | "sentryWebProject" | "sentryAndroidProject">;
  attempt?: number;
}): AgentDebugPacket {
  const issue = args.details?.issue;
  const event = args.details?.event;
  const tags = normalizeTags(event?.tags ?? issue?.tags);
  const contexts = normalizeSafeContexts(asRecord(event?.contexts) ?? asRecord(issue?.contexts));
  const project = firstString(args.parsed.project, getProjectSlug(issue), getProjectSlug(event));
  const platform = inferPlatform({
    project,
    tags,
    webProject: args.config.sentryWebProject,
    androidProject: args.config.sentryAndroidProject,
  });
  const branchName = buildAutofixBranchName({
    issueId: args.parsed.issueId,
    slugSource: firstString(tags.operation, tags.module, issue?.title, event?.title, args.parsed.issueId),
    attempt: args.attempt,
  });

  const route = firstString(tags.route, getNestedString(contexts, "app_debug", "route"));
  const apiPath = firstString(tags.api_path, getNestedString(contexts, "api_error", "api_path"));
  const httpStatus = tags.http_status ?? getNestedString(contexts, "api_error", "http_status");

  return {
    sentry: {
      issueId: args.parsed.issueId,
      eventId: args.parsed.eventId ?? firstString(event?.event_id, event?.id),
      issueUrl: args.parsed.issueUrl ?? sanitizePath(firstString(issue?.permalink, issue?.web_url, issue?.url)),
      project,
      title: sanitizeSummary(firstString(issue?.title, event?.title, event?.message)),
      culprit: sanitizeSummary(firstString(issue?.culprit, event?.culprit)),
    },
    repo: {
      fullName: platform === "android" ? args.config.githubAndroidRepo : args.config.githubWebRepo,
      baseBranch: BASE_BRANCH,
      branchName,
    },
    app: {
      platform,
      environment: tags.environment,
      releaseSha: tags.release_sha,
      requestId: tags.request_id,
      module: tags.module,
      operation: tags.operation,
      source: tags.source,
      route: route ? sanitizePath(route) : undefined,
      method: tags.method,
      apiPath: apiPath ? sanitizePath(apiPath) : undefined,
      screen: tags.screen,
      runtime: tags.runtime,
      httpStatus,
    },
    classification: {
      domain: tags["error.domain"],
      kind: tags["error.kind"],
      safeSummary: sanitizeSummary(firstString(issue?.metadata, event?.metadata, issue?.title, event?.title)),
    },
    safeContexts: contexts,
  };
}

export function buildAutofixBranchName(args: {
  issueId: string;
  slugSource?: string;
  attempt?: number;
}) {
  const slug = slugify(args.slugSource ?? "sentry-issue");
  const attempt = args.attempt && args.attempt > 1 ? `-attempt-${args.attempt}` : "";
  return `agent/sentry-${args.issueId}${attempt}-${slug}`.slice(0, 120).replace(/-+$/, "");
}

export function buildAutofixPrTitle(packet: AgentDebugPacket) {
  const owner = packet.app.operation ?? packet.app.module ?? packet.app.screen ?? packet.sentry.project ?? packet.app.platform;
  const issue = packet.classification.kind ?? packet.sentry.title ?? "production error";
  return `[Sentry Autofix] ${owner}: ${sanitizeSummary(issue) ?? "production error"}`;
}

export function buildAutofixPrBody(packet: AgentDebugPacket) {
  const path = packet.app.route ?? packet.app.apiPath;
  const safeContextJson = JSON.stringify(packet.safeContexts, null, 2);
  const suggestedChecks =
    packet.app.platform === "android"
      ? "- `./gradlew test`\n- `./gradlew assembleDebug`"
      : "- `pnpm lint`\n- `pnpm build`\n- targeted tests if identifiable";

  return `## Sentry Autofix Packet

Sentry issue: ${formatValue(packet.sentry.issueUrl)}
Sentry issue ID: ${packet.sentry.issueId}
Event ID: ${formatValue(packet.sentry.eventId)}
Project: ${formatValue(packet.sentry.project)}
Environment: ${formatValue(packet.app.environment)}
Release SHA: ${formatValue(packet.app.releaseSha)}
Request ID: ${formatValue(packet.app.requestId)}

Platform: ${packet.app.platform}
Source: ${formatValue(packet.app.source)}
Module: ${formatValue(packet.app.module)}
Operation: ${formatValue(packet.app.operation)}
Route/API path: ${formatValue(path)}
Method: ${formatValue(packet.app.method)}
Screen: ${formatValue(packet.app.screen)}
HTTP status: ${formatValue(packet.app.httpStatus)}

Error domain: ${formatValue(packet.classification.domain)}
Error kind: ${formatValue(packet.classification.kind)}

## Safe Context

\`\`\`json
${safeContextJson}
\`\`\`

## Codex Task

@codex please investigate and fix this production Sentry issue on this existing PR branch.

Requirements:

1. Use this PR's Sentry Autofix Packet as the source of truth.
2. Investigate the likely root cause in the repo.
3. Implement the smallest correct production fix on this branch.
4. Add or update a regression test when practical.
5. Run the relevant checks.
6. Update this PR body with:
   - root cause
   - fix summary
   - tests run
   - risk notes
7. Leave a PR comment summarizing what changed.

Privacy and safety rules:

- Do not request raw customer data.
- Do not include request bodies or response bodies.
- Do not include customer names, addresses, notes, comments, SKUs, quantities, cookies, tokens, passwords, or auth headers.
- Preserve auth, org context, RLS, idempotency, and validation behavior.
- Do not auto-merge.

Suggested checks:

${suggestedChecks}
`;
}

export function buildAutofixMarker(packet: AgentDebugPacket) {
  return `# Sentry Autofix

Sentry issue: ${formatValue(packet.sentry.issueUrl)}
Sentry issue ID: ${packet.sentry.issueId}
Created by Sentry autofix intake.

Codex should update this branch with the actual fix.
`;
}

export function buildCodexAutofixComment() {
  return `@codex please fix this production Sentry issue on this existing PR branch.

Use the Sentry Autofix Packet in the PR body. Push your changes to this PR branch, update the PR body with root cause/fix/tests/risk notes, and leave a summary comment.

Do not open a second PR unless this PR branch is unusable.`;
}

export function buildLatestOccurrenceComment(packet: AgentDebugPacket) {
  return `Latest Sentry occurrence received by autofix intake.

- Sentry issue ID: ${packet.sentry.issueId}
- Event ID: ${formatValue(packet.sentry.eventId)}
- Request ID: ${formatValue(packet.app.requestId)}
- Release SHA: ${formatValue(packet.app.releaseSha)}`;
}

export function buildAutofixLabels(packet: AgentDebugPacket) {
  return [
    "sentry-autofix",
    "agent:auto",
    "codex",
    "production-bug",
    `platform:${packet.app.platform}`,
    packet.app.module ? `module:${packet.app.module}` : undefined,
    packet.classification.domain ? `error:${packet.classification.domain}` : undefined,
  ].filter(Boolean) as string[];
}

export async function processSentryAutofix(args: {
  payload: unknown;
  config: AutofixConfig;
  fetchImpl?: typeof fetch;
}) {
  const fetchImpl = args.fetchImpl ?? fetch;
  const parsed = parseSentryWebhookPayload(args.payload);
  const details = await fetchSentryDetails({
    parsed,
    config: args.config,
    fetchImpl,
  });
  const initialPacket = normalizeAgentDebugPacket({
    parsed,
    details,
    config: args.config,
  });
  const existing = await findExistingAutofixPr({
    packet: initialPacket,
    githubToken: args.config.githubToken,
    fetchImpl,
  });
  const attempt = existing?.state === "open" ? 1 : existing ? existing.attempt + 1 : 1;
  const packet =
    attempt === 1
      ? initialPacket
      : normalizeAgentDebugPacket({
          parsed,
          details,
          config: args.config,
          attempt,
        });

  const result = await createOrUpdateAutofixPr({
    packet,
    existing,
    githubToken: args.config.githubToken,
    fetchImpl,
  });

  return {
    ok: true,
    action: result.action,
    pr: result.pr,
    packet,
  };
}

async function fetchSentryDetails(args: {
  parsed: ParsedSentryWebhook;
  config: AutofixConfig;
  fetchImpl: typeof fetch;
}): Promise<SentryDetails> {
  const issue = await sentryGet<JsonRecord>({
    path: `/organizations/${encodeURIComponent(args.config.sentryOrg)}/issues/${encodeURIComponent(args.parsed.issueId)}/`,
    token: args.config.sentryAuthToken,
    fetchImpl: args.fetchImpl,
  });

  let event: JsonRecord | undefined;
  if (args.parsed.eventId) {
    event = await sentryGet<JsonRecord>({
      path: `/organizations/${encodeURIComponent(args.config.sentryOrg)}/issues/${encodeURIComponent(args.parsed.issueId)}/events/${encodeURIComponent(args.parsed.eventId)}/`,
      token: args.config.sentryAuthToken,
      fetchImpl: args.fetchImpl,
      optional: true,
    });
  }

  if (!event) {
    const events = await sentryGet<JsonRecord[]>({
      path: `/organizations/${encodeURIComponent(args.config.sentryOrg)}/issues/${encodeURIComponent(args.parsed.issueId)}/events/`,
      token: args.config.sentryAuthToken,
      fetchImpl: args.fetchImpl,
      optional: true,
    });
    event = Array.isArray(events) ? events[0] : asRecord(events);
  }

  return { issue, event };
}

async function createOrUpdateAutofixPr(args: {
  packet: AgentDebugPacket;
  existing?: { pr: GithubSearchItem; attempt: number; state: "open" | "closed" };
  githubToken: string;
  fetchImpl: typeof fetch;
}) {
  const [owner, repo] = splitRepo(args.packet.repo.fullName);

  if (args.existing?.state === "open") {
    const openPr = await githubGet<GithubPr>({
      path: `/repos/${owner}/${repo}/pulls/${args.existing.pr.number}`,
      token: args.githubToken,
      fetchImpl: args.fetchImpl,
    });
    const packet = openPr.head?.ref
      ? {
          ...args.packet,
          repo: {
            ...args.packet.repo,
            branchName: openPr.head.ref,
          },
        }
      : args.packet;
    const comments = await githubGet<GithubComment[]>({
      path: `/repos/${owner}/${repo}/issues/${args.existing.pr.number}/comments`,
      token: args.githubToken,
      fetchImpl: args.fetchImpl,
    });
    await upsertAutofixMarker({
      owner,
      repo,
      branch: packet.repo.branchName,
      token: args.githubToken,
      issueId: packet.sentry.issueId,
      content: buildAutofixMarker(packet),
      fetchImpl: args.fetchImpl,
    });
    const updatedPr = await githubPatch<GithubPr>({
      path: `/repos/${owner}/${repo}/pulls/${args.existing.pr.number}`,
      token: args.githubToken,
      body: {
        title: buildAutofixPrTitle(packet),
        body: buildAutofixPrBody(packet),
      },
      fetchImpl: args.fetchImpl,
    });
    await githubPost({
      path: `/repos/${owner}/${repo}/issues/${args.existing.pr.number}/comments`,
      token: args.githubToken,
      body: { body: buildLatestOccurrenceComment(packet) },
      fetchImpl: args.fetchImpl,
    });
    if (!comments.some((comment) => comment.body?.includes("@codex"))) {
      await githubPost({
        path: `/repos/${owner}/${repo}/issues/${args.existing.pr.number}/comments`,
        token: args.githubToken,
        body: { body: buildCodexAutofixComment() },
        fetchImpl: args.fetchImpl,
      });
    }
    return { action: "updated" as const, pr: updatedPr };
  }

  await ensureAutofixBranch({
    owner,
    repo,
    branch: args.packet.repo.branchName,
    baseBranch: args.packet.repo.baseBranch,
    token: args.githubToken,
    fetchImpl: args.fetchImpl,
  });
  await upsertAutofixMarker({
    owner,
    repo,
    branch: args.packet.repo.branchName,
    token: args.githubToken,
    issueId: args.packet.sentry.issueId,
    content: buildAutofixMarker(args.packet),
    fetchImpl: args.fetchImpl,
  });
  const pr = await githubPost<GithubPr>({
    path: `/repos/${owner}/${repo}/pulls`,
    token: args.githubToken,
    body: {
      title: buildAutofixPrTitle(args.packet),
      head: args.packet.repo.branchName,
      base: args.packet.repo.baseBranch,
      body: buildAutofixPrBody(args.packet),
      draft: true,
    },
    fetchImpl: args.fetchImpl,
  });
  await applyLabels({
    owner,
    repo,
    issueNumber: pr.number,
    labels: buildAutofixLabels(args.packet),
    token: args.githubToken,
    fetchImpl: args.fetchImpl,
  });
  await githubPost({
    path: `/repos/${owner}/${repo}/issues/${pr.number}/comments`,
    token: args.githubToken,
    body: { body: buildCodexAutofixComment() },
    fetchImpl: args.fetchImpl,
  });

  return { action: "created" as const, pr };
}

async function findExistingAutofixPr(args: {
  packet: AgentDebugPacket;
  githubToken: string;
  fetchImpl: typeof fetch;
}) {
  const query = `repo:${args.packet.repo.fullName} type:pr "Sentry issue ID: ${args.packet.sentry.issueId}" in:body`;
  const results = await githubGet<{ items?: GithubSearchItem[] }>({
    path: `/search/issues?q=${encodeURIComponent(query)}&sort=created&order=desc`,
    token: args.githubToken,
    fetchImpl: args.fetchImpl,
  });
  const items = results.items ?? [];
  const open = items.find((item) => item.state === "open");
  if (open) return { pr: open, attempt: extractAttempt(open), state: "open" as const };
  const latest = items[0];
  return latest ? { pr: latest, attempt: extractAttempt(latest), state: "closed" as const } : undefined;
}

async function ensureAutofixBranch(args: {
  owner: string;
  repo: string;
  branch: string;
  baseBranch: string;
  token: string;
  fetchImpl: typeof fetch;
}) {
  const existing = await githubGet<GithubRef>({
    path: `/repos/${args.owner}/${args.repo}/git/ref/heads/${encodeGitPath(args.branch)}`,
    token: args.token,
    fetchImpl: args.fetchImpl,
    optional: true,
  });
  if (existing?.object?.sha) return;

  const base = await githubGet<GithubRef>({
    path: `/repos/${args.owner}/${args.repo}/git/ref/heads/${encodeGitPath(args.baseBranch)}`,
    token: args.token,
    fetchImpl: args.fetchImpl,
  });
  const sha = base.object?.sha;
  if (!sha) throw new SentryAutofixError("Could not resolve GitHub base branch SHA.");

  await githubPost({
    path: `/repos/${args.owner}/${args.repo}/git/refs`,
    token: args.token,
    body: {
      ref: `refs/heads/${args.branch}`,
      sha,
    },
    fetchImpl: args.fetchImpl,
  });
}

async function upsertAutofixMarker(args: {
  owner: string;
  repo: string;
  branch: string;
  token: string;
  issueId: string;
  content: string;
  fetchImpl: typeof fetch;
}) {
  const path = `.autofix/sentry/${encodeURIComponent(args.issueId)}.md`;
  const existing = await githubGet<GithubFile>({
    path: `/repos/${args.owner}/${args.repo}/contents/${path}?ref=${encodeURIComponent(args.branch)}`,
    token: args.token,
    fetchImpl: args.fetchImpl,
    optional: true,
  });

  await githubPut({
    path: `/repos/${args.owner}/${args.repo}/contents/${path}`,
    token: args.token,
    body: {
      message: `Add Sentry autofix marker for ${path.split("/").pop()?.replace(".md", "")}`,
      content: Buffer.from(args.content).toString("base64"),
      branch: args.branch,
      sha: existing?.sha,
    },
    fetchImpl: args.fetchImpl,
  });
}

async function applyLabels(args: {
  owner: string;
  repo: string;
  issueNumber: number;
  labels: string[];
  token: string;
  fetchImpl: typeof fetch;
}) {
  for (const label of args.labels) {
    try {
      await githubPost({
        path: `/repos/${args.owner}/${args.repo}/labels`,
        token: args.token,
        body: {
          name: label,
          color: label.startsWith("platform:") ? "0E8A16" : "5319E7",
        },
        fetchImpl: args.fetchImpl,
        optionalStatuses: [422],
      });
    } catch {
      // Label creation is best-effort; the PR packet/comment are the durable handoff.
    }
  }

  try {
    await githubPost({
      path: `/repos/${args.owner}/${args.repo}/issues/${args.issueNumber}/labels`,
      token: args.token,
      body: { labels: args.labels },
      fetchImpl: args.fetchImpl,
    });
  } catch {
    // Missing label or token label permissions should not block autofix PR creation.
  }
}

function normalizeTags(value: unknown) {
  const raw: Record<string, unknown> = {};
  if (Array.isArray(value)) {
    for (const tag of value) {
      const record = asRecord(tag);
      const key = firstString(record?.key, record?.name);
      const tagValue = firstString(record?.value);
      if (key && tagValue) raw[key] = tagValue;
    }
  } else if (isPlainObject(value)) {
    Object.assign(raw, value);
  }

  const tags: Partial<Record<(typeof SAFE_TAG_KEYS)[number], string>> = {};
  for (const key of SAFE_TAG_KEYS) {
    const tagValue = firstString(raw[key]);
    if (!tagValue) continue;
    tags[key] = key === "route" || key === "api_path" ? sanitizePath(tagValue) : tagValue;
  }
  return tags;
}

function normalizeSafeContexts(value: JsonRecord | undefined) {
  const contexts: Record<string, unknown> = {};
  for (const key of SAFE_CONTEXT_KEYS) {
    if (value?.[key] == null) continue;
    contexts[key] = scrubAutofixValue(value[key]);
  }
  return contexts;
}

function scrubAutofixValue(value: unknown, depth = 0): unknown {
  if (value == null || depth > MAX_SAFE_CONTEXT_DEPTH) return value;
  if (Array.isArray(value)) return value.map((item) => scrubAutofixValue(item, depth + 1));
  if (typeof value === "string") return sanitizePath(value);
  if (!isPlainObject(value)) return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !shouldRedactKey(key))
      .map(([key, nested]) => [key, scrubAutofixValue(nested, depth + 1)])
  );
}

function inferPlatform(args: {
  project?: string;
  tags: Partial<Record<(typeof SAFE_TAG_KEYS)[number], string>>;
  webProject?: string;
  androidProject?: string;
}): Platform {
  if (args.project && args.androidProject && args.project === args.androidProject) return "android";
  if (args.project && args.webProject && args.project === args.webProject) return "web";
  if (args.tags.source?.startsWith("android") || args.tags.api_path || args.tags.screen) return "android";
  if (args.tags.route || args.tags.runtime || args.tags.source?.includes("next")) return "web";
  return "unknown";
}

function safeEqual(value: string, expected: string) {
  const valueBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);
  return valueBuffer.length === expectedBuffer.length && timingSafeEqual(valueBuffer, expectedBuffer);
}

function sanitizePath(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value.split("?")[0];
  }
}

function sanitizeSummary(value: unknown) {
  const text = firstString(value);
  if (!text) return undefined;
  if (SENSITIVE_TEXT_PATTERNS.some((pattern) => pattern.test(text))) return undefined;
  return sanitizePath(text)?.slice(0, 160);
}

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 56) || "sentry-issue"
  );
}

function formatValue(value: unknown) {
  return value == null || value === "" ? "unknown" : String(value);
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function getNestedString(record: Record<string, unknown>, context: string, key: string) {
  return firstString(asRecord(record[context])?.[key]);
}

function getProjectSlug(value: unknown) {
  const record = asRecord(value);
  return firstString(asRecord(record?.project)?.slug, asRecord(record?.project)?.name, record?.projectSlug, record?.project);
}

function asRecord(value: unknown): JsonRecord | undefined {
  return isPlainObject(value) ? value : undefined;
}

function isPlainObject(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function shouldRedactKey(key: string) {
  if (key === "query_kind") return false;
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

function splitRepo(fullName: string) {
  const [owner, repo] = fullName.split("/");
  if (!owner || !repo) throw new SentryAutofixError(`Invalid GitHub repo: ${fullName}`);
  return [owner, repo] as const;
}

function encodeGitPath(value: string) {
  return value.split("/").map(encodeURIComponent).join("/");
}

function extractAttempt(item: GithubSearchItem) {
  const text = `${item.body ?? ""}\n${item.html_url ?? ""}`;
  const match = text.match(/attempt-(\d+)/i);
  return match ? Number(match[1]) : 1;
}

async function sentryGet<T>(args: {
  path: string;
  token: string;
  fetchImpl: typeof fetch;
  optional?: boolean;
}) {
  return fetchJson<T>({
    url: `${SENTRY_API_BASE_URL}${args.path}`,
    token: args.token,
    fetchImpl: args.fetchImpl,
    optionalStatuses: args.optional ? [404] : undefined,
  });
}

async function githubGet<T>(args: {
  path: string;
  token: string;
  fetchImpl: typeof fetch;
  optional?: boolean;
}) {
  return fetchJson<T>({
    url: `${GITHUB_API_BASE_URL}${args.path}`,
    token: args.token,
    fetchImpl: args.fetchImpl,
    optionalStatuses: args.optional ? [404] : undefined,
  });
}

async function githubPost<T = unknown>(args: {
  path: string;
  token: string;
  body: unknown;
  fetchImpl: typeof fetch;
  optionalStatuses?: number[];
}) {
  return fetchJson<T>({
    url: `${GITHUB_API_BASE_URL}${args.path}`,
    token: args.token,
    method: "POST",
    body: args.body,
    fetchImpl: args.fetchImpl,
    optionalStatuses: args.optionalStatuses,
  });
}

async function githubPatch<T = unknown>(args: {
  path: string;
  token: string;
  body: unknown;
  fetchImpl: typeof fetch;
}) {
  return fetchJson<T>({
    url: `${GITHUB_API_BASE_URL}${args.path}`,
    token: args.token,
    method: "PATCH",
    body: args.body,
    fetchImpl: args.fetchImpl,
  });
}

async function githubPut<T = unknown>(args: {
  path: string;
  token: string;
  body: unknown;
  fetchImpl: typeof fetch;
}) {
  return fetchJson<T>({
    url: `${GITHUB_API_BASE_URL}${args.path}`,
    token: args.token,
    method: "PUT",
    body: args.body,
    fetchImpl: args.fetchImpl,
  });
}

async function fetchJson<T>(args: {
  url: string;
  token: string;
  fetchImpl: typeof fetch;
  method?: string;
  body?: unknown;
  optionalStatuses?: number[];
}) {
  const response = await args.fetchImpl(args.url, {
    method: args.method ?? "GET",
    headers: {
      Accept: "application/vnd.github+json, application/json",
      Authorization: `Bearer ${args.token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: args.body == null ? undefined : JSON.stringify(args.body),
  });

  if (args.optionalStatuses?.includes(response.status)) return undefined as T;
  if (!response.ok) {
    throw new SentryAutofixError(`External API request failed: ${response.status}`, response.status);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
