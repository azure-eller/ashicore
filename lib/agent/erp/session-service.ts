import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import {
  agentPendingRequests,
  agentSessions,
  agentToolCalls,
  agentTurns,
  agentUploads,
} from "@/lib/db/schema/agent";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import { createUserTurnMessage } from "@/lib/agent/core/processUserInput";
import { QueryEngine } from "@/lib/agent/core/QueryEngine";
import { AnthropicProvider } from "@/lib/agent/core/api/anthropic";
import { FakeAgentProvider } from "@/lib/agent/core/api/fake";
import { compactTranscriptIfNeeded } from "@/lib/agent/core/compact";
import { executeToolUse, type ToolAuditHooks, type ToolExecutionResult } from "@/lib/agent/core/toolExecution";
import type { AgentMessage } from "@/lib/agent/core/messages";
import type { AgentActor, ToolUseContext } from "@/lib/agent/core/Tool";
import { invalidateSessionPromptSectionCache } from "@/lib/agent/core/promptSections";
import { buildAgentPromptSections } from "@/lib/agent/erp/context";
import { erpAgentTools, getVisibleErpAgentTools } from "@/lib/agent/erp/tools";
import type {
  AgentPendingRequestPayload,
  AgentPendingRequestRecord,
  AgentPendingRequestResponse,
  AgentSessionRecord,
  AgentSessionSnapshot,
  AgentTurnRecord,
  AgentUploadManifest,
  AgentUploadRecord,
  CreateAgentTurnRequest,
} from "@/lib/agent/erp/types";
import { normalizeUpload } from "@/lib/agent/erp/upload-normalization";
import { getUploadStore } from "@/lib/agent/erp/upload-store";

export type AgentTurnStreamEvent =
  | { event: "turn_start"; payload: { sessionId: string; turnId: string } }
  | { event: "assistant_delta"; payload: { text: string } }
  | {
      event: "tool_start";
      payload: { toolCallId: string; toolName: string; input: unknown };
    }
  | {
      event: "tool_result";
      payload: {
        toolCallId: string;
        toolName: string;
        summary: string;
        output?: unknown;
        isError?: boolean;
      };
    }
  | {
      event: "pending_request";
      payload: {
        requestId: string;
        kind: "question" | "permission";
        toolName: string;
        requestIdForClient: string;
        data: AgentPendingRequestPayload;
      };
    }
  | { event: "turn_complete"; payload: { turnId: string; status: "completed" | "awaiting_user" | "failed" } }
  | { event: "error"; payload: { message: string } };

type AgentProviderOverride = "fake" | "anthropic";

function getAgentProvider(providerOverride?: AgentProviderOverride | null) {
  if (
    providerOverride === "fake" ||
    process.env.AGENT_PROVIDER === "fake" ||
    process.env.NODE_ENV === "test" ||
    (process.env.NODE_ENV !== "production" && !process.env.ANTHROPIC_API_KEY)
  ) {
    return new FakeAgentProvider();
  }

  return new AnthropicProvider();
}

function getAgentModel(modelOverride?: string | null) {
  return modelOverride ?? process.env.AGENT_MODEL ?? process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
}

function summarizeAssistantMessage(messages: AgentMessage[]) {
  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  if (!lastAssistant) {
    return null;
  }

  const text = lastAssistant.parts
    .filter((part): part is Extract<AgentMessage["parts"][number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join(" ")
    .trim();

  return text.length > 0 ? text.slice(0, 240) : null;
}

function toAgentSessionRecord(row: typeof agentSessions.$inferSelect): AgentSessionRecord {
  return {
    ...row,
    status: row.status as AgentSessionRecord["status"],
    messages: (row.messages as AgentMessage[]) ?? [],
  };
}

function toAgentTurnRecord(row: typeof agentTurns.$inferSelect): AgentTurnRecord {
  return {
    ...row,
    status: row.status as AgentTurnRecord["status"],
  };
}

function toAgentPendingRequestRecord(
  row: typeof agentPendingRequests.$inferSelect
): AgentPendingRequestRecord {
  return {
    ...row,
    kind: row.kind as AgentPendingRequestRecord["kind"],
    payload: row.payload as AgentPendingRequestPayload,
    resolution: (row.resolution as AgentPendingRequestResponse | null) ?? null,
  };
}

function toAgentUploadRecord(row: typeof agentUploads.$inferSelect): AgentUploadRecord {
  return {
    ...row,
    manifest: row.manifest as AgentUploadManifest,
  };
}

function toPendingPayload(result: Extract<ToolExecutionResult, { type: "pending" }>): AgentPendingRequestPayload {
  if (result.kind === "question") {
    return {
      toolUseId: result.toolCallId,
      input: result.input,
      summary: result.payload.summary,
      questions: result.payload.questions,
    };
  }

  return {
    toolUseId: result.toolCallId,
    input: result.input,
    summary: result.payload.summary,
    confirmationLabel: result.payload.confirmationLabel,
    preview: result.payload.preview,
  };
}

async function recordToolCallStart(args: {
  actor: AgentActor;
  sessionId: string;
  turnId: string;
  id: string;
  toolName: string;
  input: unknown;
}) {
  await withAuthedOrgContext(async (tx) => {
    await tx.insert(agentToolCalls).values({
      id: args.id,
      sessionId: args.sessionId,
      turnId: args.turnId,
      organizationId: args.actor.orgId,
      toolName: args.toolName,
      status: "running",
      input: args.input,
    });
  });
}

async function recordToolCallFinish(args: {
  id: string;
  toolName: string;
  status: "completed" | "failed" | "awaiting_user";
  input: unknown;
  outputSummary?: string;
  outputArtifactKey?: string | null;
}) {
  await withAuthedOrgContext(async (tx) => {
    await tx
      .update(agentToolCalls)
      .set({
        status: args.status,
        input: args.input,
        outputSummary: args.outputSummary ?? null,
        outputArtifactKey: args.outputArtifactKey ?? null,
        finishedAt: new Date(),
      })
      .where(eq(agentToolCalls.id, args.id));
  });
}

function buildToolAuditHooks(args: {
  actor: AgentActor;
  sessionId: string;
  turnId: string;
}): ToolAuditHooks {
  return {
    onStart: async ({ id, toolName, input }) =>
      recordToolCallStart({
        actor: args.actor,
        sessionId: args.sessionId,
        turnId: args.turnId,
        id,
        toolName,
        input,
      }),
    onFinish: async ({ id, toolName, status, input, outputSummary, outputArtifactKey }) =>
      recordToolCallFinish({
        id,
        toolName,
        status,
        input,
        outputSummary,
        outputArtifactKey,
      }),
  };
}

function buildToolUseContext(args: {
  actor: AgentActor;
  sessionId: string;
  turnId: string;
  uploads: AgentUploadRecord[];
  transcript: AgentMessage[];
  signal: AbortSignal;
}) {
  const uploadStore = getUploadStore();

  return {
    actor: args.actor,
    sessionId: args.sessionId,
    turnId: args.turnId,
    transcript: args.transcript,
    abortSignal: args.signal,
    uploads: args.uploads.map((upload) => ({
      id: upload.id,
      storageKey: upload.storageKey,
      absolutePath: uploadStore.getAbsolutePath(upload.storageKey),
      sourceFilename: upload.sourceFilename,
      mediaType: upload.mediaType,
      normalizedKind: upload.normalizedKind,
      manifest: upload.manifest,
    })),
    fileStore: uploadStore,
    now: new Date().toISOString(),
  } satisfies ToolUseContext;
}

async function persistSessionState(args: {
  sessionId: string;
  messages: AgentMessage[];
  status: AgentSessionRecord["status"];
  lastError?: string | null;
}) {
  await withAuthedOrgContext(async (tx) => {
    await tx
      .update(agentSessions)
      .set({
        messages: args.messages,
        status: args.status,
        lastError: args.lastError ?? null,
        updatedAt: new Date(),
      })
      .where(eq(agentSessions.id, args.sessionId));
  });
}

async function finishTurn(args: {
  turnId: string;
  status: AgentTurnRecord["status"];
  messages: AgentMessage[];
}) {
  await withAuthedOrgContext(async (tx) => {
    await tx
      .update(agentTurns)
      .set({
        status: args.status,
        finishedAt: new Date(),
        summary: summarizeAssistantMessage(args.messages),
      })
      .where(eq(agentTurns.id, args.turnId));
  });
}

async function createPendingRequest(args: {
  sessionId: string;
  turnId: string;
  actor: AgentActor;
  toolName: string;
  kind: "question" | "permission";
  payload: AgentPendingRequestPayload;
}) {
  return withAuthedOrgContext(async (tx) => {
    const [request] = await tx
      .insert(agentPendingRequests)
      .values({
        sessionId: args.sessionId,
        turnId: args.turnId,
        organizationId: args.actor.orgId,
        kind: args.kind,
        toolName: args.toolName,
        payload: args.payload,
      })
      .returning();

    return request;
  });
}

async function resolvePendingRequest(args: {
  requestId: string;
  response: AgentPendingRequestResponse;
}) {
  await withAuthedOrgContext(async (tx) => {
    await tx
      .update(agentPendingRequests)
      .set({
        resolution: args.response,
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(agentPendingRequests.id, args.requestId));
  });
}

async function getSessionByIdForActor(sessionId: string, actor: AgentActor) {
  return withAuthedOrgContext(async (tx) => {
    const [session] = await tx
      .select()
      .from(agentSessions)
      .where(
        and(eq(agentSessions.id, sessionId), eq(agentSessions.createdByUserId, actor.userId))
      )
      .limit(1);

    if (!session) {
      throw new Error("Agent session not found.");
    }

    return session;
  });
}

export async function createAgentSession(actor: AgentActor) {
  return withAuthedOrgContext(async (tx) => {
    const [session] = await tx
      .insert(agentSessions)
      .values({
        organizationId: actor.orgId,
        createdByUserId: actor.userId,
        status: "idle",
        messages: [],
      })
      .returning();

    return {
      session: toAgentSessionRecord(session),
      uploads: [],
      pendingRequest: null,
      turns: [],
    } satisfies AgentSessionSnapshot;
  });
}

export type AgentSessionSummary = {
  id: string;
  title: string | null;
  preview: string | null;
  status: AgentSessionRecord["status"];
  updatedAt: Date;
};

export async function listAgentSessionsForUser(
  actor: AgentActor,
  options: { limit?: number } = {}
): Promise<AgentSessionSummary[]> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
  return withAuthedOrgContext(async (tx) => {
    const rows = await tx
      .select({
        id: agentSessions.id,
        title: agentSessions.title,
        status: agentSessions.status,
        messages: agentSessions.messages,
        updatedAt: agentSessions.updatedAt,
      })
      .from(agentSessions)
      .where(eq(agentSessions.createdByUserId, actor.userId))
      .orderBy(desc(agentSessions.updatedAt))
      .limit(limit);

    return rows.map((row) => {
      const messages = (row.messages as AgentMessage[] | null) ?? [];
      const firstUserText = firstUserMessageText(messages);
      return {
        id: row.id,
        title: row.title,
        preview: firstUserText,
        status: row.status as AgentSessionRecord["status"],
        updatedAt: row.updatedAt,
      };
    });
  });
}

function firstUserMessageText(messages: AgentMessage[]): string | null {
  for (const message of messages) {
    if (message.role !== "user") continue;
    for (const part of message.parts) {
      if (part.type === "text" && part.text.trim()) return part.text.trim();
    }
  }
  return null;
}

export async function getAgentSessionSnapshot(sessionId: string, actor: AgentActor) {
  return withAuthedOrgContext(async (tx) => {
    const [session] = await tx
      .select()
      .from(agentSessions)
      .where(
        and(eq(agentSessions.id, sessionId), eq(agentSessions.createdByUserId, actor.userId))
      )
      .limit(1);

    if (!session) {
      throw new Error("Agent session not found.");
    }

    const [uploads, pendingRequestRows, turns] = await Promise.all([
      tx
        .select()
        .from(agentUploads)
        .where(eq(agentUploads.sessionId, sessionId))
        .orderBy(asc(agentUploads.createdAt)),
      tx
        .select()
        .from(agentPendingRequests)
        .where(and(eq(agentPendingRequests.sessionId, sessionId), isNull(agentPendingRequests.resolvedAt)))
        .orderBy(desc(agentPendingRequests.createdAt))
        .limit(1),
      tx
        .select()
        .from(agentTurns)
        .where(eq(agentTurns.sessionId, sessionId))
        .orderBy(desc(agentTurns.startedAt))
        .limit(20),
    ]);

    return {
      session: toAgentSessionRecord(session),
      uploads: uploads.map(toAgentUploadRecord),
      pendingRequest: pendingRequestRows[0] ? toAgentPendingRequestRecord(pendingRequestRows[0]) : null,
      turns: turns.map(toAgentTurnRecord),
    } satisfies AgentSessionSnapshot;
  });
}

export async function createAgentUploads(args: {
  sessionId: string;
  actor: AgentActor;
  files: File[];
}) {
  await getSessionByIdForActor(args.sessionId, args.actor);
  const store = getUploadStore();
  const createdUploads: AgentUploadRecord[] = [];

  for (const file of args.files) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const artifacts = await normalizeUpload({
      sessionId: args.sessionId,
      filename: file.name,
      mediaType: file.type,
      buffer,
      store,
    });

    const fileUploads = await withAuthedOrgContext(async (tx) => {
      const inserted: Array<typeof agentUploads.$inferSelect> = [];
      let rawUploadId: string | null = null;

      for (const [index, artifact] of artifacts.entries()) {
        const manifest: AgentUploadManifest =
          index > 0 && rawUploadId
            ? {
                ...artifact.manifest,
                derivedFromUploadId: rawUploadId,
              }
            : artifact.manifest;

        const [row] = await tx
          .insert(agentUploads)
          .values({
            sessionId: args.sessionId,
            organizationId: args.actor.orgId,
            uploadedByUserId: args.actor.userId,
            storageKey: artifact.storageKey,
            sourceFilename: artifact.sourceFilename,
            mediaType: artifact.mediaType,
            normalizedKind: artifact.normalizedKind,
            manifest,
          })
          .returning();

        if (index === 0) {
          rawUploadId = row.id;
        }

        inserted.push(row);
      }

      return inserted;
    });

    for (const upload of fileUploads) {
      createdUploads.push({
        ...toAgentUploadRecord(upload),
      });
    }
  }

  invalidateSessionPromptSectionCache(args.sessionId);

  return createdUploads;
}

async function createTurnRecord(args: {
  sessionId: string;
  actor: AgentActor;
  userInput: CreateAgentTurnRequest;
}) {
  return withAuthedOrgContext(async (tx) => {
    const [turn] = await tx
      .insert(agentTurns)
      .values({
        sessionId: args.sessionId,
        organizationId: args.actor.orgId,
        createdByUserId: args.actor.userId,
        status: "running",
        userInput: args.userInput,
      })
      .returning();

    return turn;
  });
}

async function executeApprovedPendingTool(args: {
  actor: AgentActor;
  sessionId: string;
  turnId: string;
  pendingRequest: AgentPendingRequestRecord;
  uploads: AgentUploadRecord[];
  transcript: AgentMessage[];
  signal: AbortSignal;
}) {
  const tool = erpAgentTools.find((candidate) => candidate.name === args.pendingRequest.toolName);
  if (!tool) {
    throw new Error(`Pending tool '${args.pendingRequest.toolName}' is no longer registered.`);
  }

  const ctx = buildToolUseContext({
    actor: args.actor,
    sessionId: args.sessionId,
    turnId: args.turnId,
    uploads: args.uploads,
    transcript: args.transcript,
    signal: args.signal,
  });

  const audit = buildToolAuditHooks({
    actor: args.actor,
    sessionId: args.sessionId,
    turnId: args.turnId,
  });

  return executeToolUse({
    tool,
    input: args.pendingRequest.payload.input,
    ctx,
    audit,
    toolCallId: args.pendingRequest.payload.toolUseId,
    permissionOverride: {
      updatedInput: args.pendingRequest.payload.input,
    },
  });
}

export async function* runAgentTurn(args: {
  sessionId: string;
  actor: AgentActor;
  input: CreateAgentTurnRequest;
  signal: AbortSignal;
  providerOverride?: AgentProviderOverride | null;
  modelOverride?: string | null;
}): AsyncGenerator<AgentTurnStreamEvent, void, void> {
  const snapshot = await getAgentSessionSnapshot(args.sessionId, args.actor);
  const provider = getAgentProvider(args.providerOverride);
  const model = getAgentModel(args.modelOverride);
  const turn = await createTurnRecord({
    sessionId: args.sessionId,
    actor: args.actor,
    userInput: args.input,
  });

  yield {
    event: "turn_start",
    payload: {
      sessionId: args.sessionId,
      turnId: turn.id,
    },
  };

  let currentMessages = [...snapshot.session.messages];

  try {
    if (snapshot.pendingRequest) {
      if (!args.input.pendingRequestResponse) {
        throw new Error("This session is waiting for a pending request response.");
      }

      if (snapshot.pendingRequest.id !== args.input.pendingRequestResponse.requestId) {
        throw new Error("Pending request response does not match the current session request.");
      }

      await resolvePendingRequest({
        requestId: snapshot.pendingRequest.id,
        response: args.input.pendingRequestResponse.response,
      });

      if (snapshot.pendingRequest.kind === "question") {
        currentMessages.push(
          createUserTurnMessage({
            text: "",
            createdAt: new Date().toISOString(),
            pendingToolResult: {
              toolUseId: snapshot.pendingRequest.payload.toolUseId,
              content: {
                toolName: snapshot.pendingRequest.toolName,
                answers:
                  "answers" in args.input.pendingRequestResponse.response
                    ? args.input.pendingRequestResponse.response.answers
                    : {},
              },
            },
          })
        );
      } else if (
        "approved" in args.input.pendingRequestResponse.response &&
        args.input.pendingRequestResponse.response.approved
      ) {
        yield {
          event: "tool_start",
          payload: {
            toolCallId: snapshot.pendingRequest.payload.toolUseId,
            toolName: snapshot.pendingRequest.toolName,
            input: snapshot.pendingRequest.payload.input,
          },
        };

        const resumedTool = await executeApprovedPendingTool({
          actor: args.actor,
          sessionId: args.sessionId,
          turnId: turn.id,
          pendingRequest: snapshot.pendingRequest,
          uploads: snapshot.uploads,
          transcript: currentMessages,
          signal: args.signal,
        });

        if (resumedTool.type === "result") {
          yield {
            event: "tool_result",
            payload: {
              toolCallId: resumedTool.toolCallId,
              toolName: resumedTool.toolName,
              summary: resumedTool.summary,
              output: resumedTool.inlineOutput,
              isError: resumedTool.isError,
            },
          };

          currentMessages.push({
            id: randomUUID(),
            role: "user",
            createdAt: new Date().toISOString(),
            parts: [
              {
                type: "tool_result",
                toolUseId: resumedTool.toolCallId,
                isError: resumedTool.isError,
                content: {
                  toolName: resumedTool.toolName,
                  summary: resumedTool.summary,
                  output: resumedTool.inlineOutput,
                },
              },
            ],
          });

          if (resumedTool.newMessages && resumedTool.newMessages.length > 0) {
            currentMessages.push(...resumedTool.newMessages);
          }
        }
      } else {
        currentMessages.push(
          createUserTurnMessage({
            text: "",
            createdAt: new Date().toISOString(),
            pendingToolResult: {
              toolUseId: snapshot.pendingRequest.payload.toolUseId,
              isError: true,
              content: {
                toolName: snapshot.pendingRequest.toolName,
                error: {
                  code: "user_denied",
                  message: "User denied the requested action.",
                },
              },
            },
          })
        );
      }
    } else if (args.input.pendingRequestResponse) {
      throw new Error("This session does not have a pending request to resolve.");
    }

    const userMessage = createUserTurnMessage({
      text: args.input.text,
      createdAt: new Date().toISOString(),
    });

    if (userMessage.parts.length > 0) {
      currentMessages.push(userMessage);
    }

    const uploadStore = getUploadStore();
    currentMessages = await compactTranscriptIfNeeded({
      provider,
      model,
      sessionId: args.sessionId,
      messages: currentMessages,
      signal: args.signal,
      fileStore: uploadStore,
      createdAt: new Date().toISOString(),
    });

    await persistSessionState({
      sessionId: args.sessionId,
      messages: currentMessages,
      status: "running",
    });

    const ctx = buildToolUseContext({
      actor: args.actor,
      sessionId: args.sessionId,
      turnId: turn.id,
      uploads: snapshot.uploads,
      transcript: currentMessages,
      signal: args.signal,
    });
    const audit = buildToolAuditHooks({
      actor: args.actor,
      sessionId: args.sessionId,
      turnId: turn.id,
    });
    const promptSections = await buildAgentPromptSections({
      orgId: args.actor.orgId,
      sessionId: args.sessionId,
      uploads: snapshot.uploads,
    });
    const engine = new QueryEngine(provider, model);
    const visibleTools = getVisibleErpAgentTools(args.actor);
    const stream = engine.run({
      systemSections: promptSections,
      uploads: snapshot.uploads,
      messages: currentMessages,
      tools: visibleTools,
      ctx,
      audit,
    });

    while (true) {
      const next = await stream.next();
      if (next.done) {
        if (next.value.status === "awaiting_user") {
          const pendingPayload = toPendingPayload(next.value.pendingRequest);
          const pendingRequest = await createPendingRequest({
            sessionId: args.sessionId,
            turnId: turn.id,
            actor: args.actor,
            toolName: next.value.pendingRequest.toolName,
            kind: next.value.pendingRequest.kind,
            payload: pendingPayload,
          });

          await persistSessionState({
            sessionId: args.sessionId,
            messages: next.value.messages,
            status: "awaiting_user",
          });
          await finishTurn({
            turnId: turn.id,
            status: "awaiting_user",
            messages: next.value.messages,
          });

          yield {
            event: "pending_request",
            payload: {
              requestId: pendingRequest.id,
              requestIdForClient: pendingRequest.id,
              kind: next.value.pendingRequest.kind,
              toolName: next.value.pendingRequest.toolName,
              data: pendingPayload,
            },
          };
          yield {
            event: "turn_complete",
            payload: {
              turnId: turn.id,
              status: "awaiting_user",
            },
          };
          return;
        }

        await persistSessionState({
          sessionId: args.sessionId,
          messages: next.value.messages,
          status: "completed",
        });
        await finishTurn({
          turnId: turn.id,
          status: "completed",
          messages: next.value.messages,
        });
        yield {
          event: "turn_complete",
          payload: {
            turnId: turn.id,
            status: "completed",
          },
        };
        return;
      }

      const event = next.value;

      switch (event.type) {
        case "assistant_delta":
          yield {
            event: "assistant_delta",
            payload: {
              text: event.text,
            },
          };
          break;
        case "tool_start":
          yield {
            event: "tool_start",
            payload: {
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              input: event.input,
            },
          };
          break;
        case "tool_result":
          yield {
            event: "tool_result",
            payload: {
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              summary: event.summary,
              output: event.output,
              isError: event.isError,
            },
          };
          break;
      }
    }
  } catch (error) {
    console.error("Agent turn failed:", error);
    const internalMessage = error instanceof Error ? error.message : "Agent turn failed.";
    await persistSessionState({
      sessionId: args.sessionId,
      messages: currentMessages,
      status: "failed",
      lastError: internalMessage,
    });
    await finishTurn({
      turnId: turn.id,
      status: "failed",
      messages: currentMessages,
    });
    yield {
      event: "error",
      payload: {
        message: "The agent turn failed. Please try again.",
      },
    };
    yield {
      event: "turn_complete",
      payload: {
        turnId: turn.id,
        status: "failed",
      },
    };
  }
}
