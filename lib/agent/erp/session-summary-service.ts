import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { agentPendingRequests, agentSessions, agentTurns, agentUploads } from "@/lib/db/schema";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import type { AgentMessage } from "@/lib/agent/core/messages";
import type { AgentActor } from "@/lib/agent/core/Tool";
import type {
  AgentPendingRequestPayload,
  AgentPendingRequestRecord,
  AgentPendingRequestResponse,
  AgentSessionRecord,
  AgentSessionSnapshot,
  AgentTurnRecord,
  AgentUploadManifest,
  AgentUploadRecord,
} from "@/lib/agent/erp/types";

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

function firstUserMessageText(messages: AgentMessage[]): string | null {
  for (const message of messages) {
    if (message.role !== "user") continue;
    for (const part of message.parts) {
      if (part.type === "text" && part.text.trim()) return part.text.trim();
    }
  }
  return null;
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
      return {
        id: row.id,
        title: row.title,
        preview: firstUserMessageText(messages),
        status: row.status as AgentSessionRecord["status"],
        updatedAt: row.updatedAt,
      };
    });
  });
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
        .where(
          and(
            eq(agentPendingRequests.sessionId, sessionId),
            isNull(agentPendingRequests.resolvedAt)
          )
        )
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
      pendingRequest: pendingRequestRows[0]
        ? toAgentPendingRequestRecord(pendingRequestRows[0])
        : null,
      turns: turns.map(toAgentTurnRecord),
    } satisfies AgentSessionSnapshot;
  });
}
