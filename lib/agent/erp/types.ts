import { z } from "zod";
import type { AgentMessage } from "@/lib/agent/core/messages";

export type AgentSessionStatus =
  | "idle"
  | "running"
  | "awaiting_user"
  | "completed"
  | "failed";

export type AgentTurnStatus =
  | "running"
  | "awaiting_user"
  | "completed"
  | "failed";

export type AgentPendingRequestKind = "question" | "permission";

export type AgentQuestionOption = {
  label: string;
  description: string;
  preview?: string;
};

export type AgentQuestion = {
  header: string;
  question: string;
  options: AgentQuestionOption[];
  multiSelect?: boolean;
};

export type AgentQuestionResponse = {
  answers: Record<string, string | string[]>;
};

export type AgentPermissionResponse = {
  approved: boolean;
};

export type AgentPendingRequestResponse =
  | AgentQuestionResponse
  | AgentPermissionResponse;

export const agentQuestionResponseSchema = z.strictObject({
  answers: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
});

export const agentPermissionResponseSchema = z.strictObject({
  approved: z.boolean(),
});

export const agentPendingRequestResponseSchema = z.union([
  agentQuestionResponseSchema,
  agentPermissionResponseSchema,
]);

export const createAgentTurnRequestSchema = z.strictObject({
  text: z.string(),
  pendingRequestResponse: z
    .strictObject({
      requestId: z.string().uuid(),
      response: agentPendingRequestResponseSchema,
    })
    .optional(),
});

export type TableSampleRow = Record<string, string>;

export type TableManifest = {
  delimiter: string;
  rowCount: number;
  headers: string[];
  sampleRows: TableSampleRow[];
};

export type AgentUploadManifest = {
  byteSize: number;
  derivedFromUploadId?: string;
  pageCount?: number;
  image?: {
    width: number;
    height: number;
    format: string | undefined;
  };
  table?: TableManifest;
};

export type AgentUploadRecord = {
  id: string;
  sessionId: string;
  organizationId: string;
  uploadedByUserId: string;
  storageKey: string;
  sourceFilename: string;
  mediaType: string;
  normalizedKind: string;
  manifest: AgentUploadManifest;
  createdAt: Date;
};

export type AgentTurnRecord = {
  id: string;
  sessionId: string;
  status: AgentTurnStatus;
  userInput: unknown;
  startedAt: Date;
  finishedAt: Date | null;
  summary: string | null;
};

export type AgentPendingQuestionPayload = {
  toolUseId: string;
  input: unknown;
  questions: AgentQuestion[];
  summary: string;
};

export type AgentPendingPermissionPayload = {
  toolUseId: string;
  input: unknown;
  summary: string;
  confirmationLabel?: string;
};

export type AgentPendingRequestPayload =
  | AgentPendingQuestionPayload
  | AgentPendingPermissionPayload;

export type AgentPendingRequestRecord = {
  id: string;
  sessionId: string;
  turnId: string;
  kind: AgentPendingRequestKind;
  toolName: string;
  payload: AgentPendingRequestPayload;
  resolvedAt: Date | null;
  resolution: AgentPendingRequestResponse | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AgentSessionRecord = {
  id: string;
  organizationId: string;
  createdByUserId: string;
  status: AgentSessionStatus;
  title: string | null;
  messages: AgentMessage[];
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AgentSessionSnapshot = {
  session: AgentSessionRecord;
  uploads: AgentUploadRecord[];
  pendingRequest: AgentPendingRequestRecord | null;
  turns: AgentTurnRecord[];
};

export type CreateAgentTurnRequest = {
  text: string;
  pendingRequestResponse?: {
    requestId: string;
    response: AgentPendingRequestResponse;
  };
};
