import type { ReactNode } from "react";
import { z } from "zod";
import type { ModuleAccessLevel, ModuleKey } from "@/lib/authz";
import type { AgentMessage } from "@/lib/agent/core/messages";

export type ValidationResult =
  | { result: true }
  | {
      result: false;
      message: string;
      code?: string;
      field?: string;
      suggestion?: string;
    };

export type ToolAccessLevel = Exclude<ModuleAccessLevel, "none">;
export type ToolModule = ModuleKey | "multiple";
export type ToolRiskClass = "read" | "low_risk_write" | "high_risk_write";

export type ToolQuestionPayload = {
  questions: Array<{
    header: string;
    question: string;
    options: Array<{
      label: string;
      description: string;
      preview?: string;
    }>;
    multiSelect?: boolean;
  }>;
  summary: string;
};

export type ToolPermissionPreview = {
  kind: "diff" | "create" | "delete";
  fields?: Array<{
    name: string;
    before: unknown;
    after: unknown;
  }>;
};

export type ToolPermissionConfirmPayload = {
  summary: string;
  confirmationLabel?: string;
  preview?: ToolPermissionPreview;
};

export type ToolPermissionDecision<TInput = unknown> =
  | {
      behavior: "allow";
      updatedInput: TInput;
      message?: string;
    }
  | {
      behavior: "ask";
      updatedInput: TInput;
      kind: "question";
      payload: ToolQuestionPayload;
      message: string;
    }
  | {
      behavior: "ask";
      updatedInput: TInput;
      kind: "permission";
      payload: ToolPermissionConfirmPayload;
      message: string;
    }
  | {
      behavior: "deny";
      message: string;
      payload?: {
        code?: string;
        suggestion?: string;
      };
    };

export type AgentActor = {
  userId: string;
  orgId: string;
  assignedRoles: string[];
};

export type ToolArtifactSummary = {
  key: string;
  label: string;
  mediaType: string;
  byteSize: number;
};

export type ToolRuntimeUpload = {
  id: string;
  storageKey: string;
  absolutePath: string;
  sourceFilename: string;
  mediaType: string;
  normalizedKind: string;
  manifest: unknown;
};

export interface ToolFileStore {
  readText(storageKey: string): Promise<string>;
  readBuffer(storageKey: string): Promise<Buffer>;
  getAbsolutePath?(storageKey: string): string;
  writeText(args: {
    sessionId: string;
    filename: string;
    mediaType: string;
    content: string;
  }): Promise<ToolArtifactSummary>;
  writeJson(args: {
    sessionId: string;
    filename: string;
    mediaType?: string;
    data: unknown;
  }): Promise<ToolArtifactSummary>;
}

export type ToolProgress = {
  message: string;
  completed?: number;
  total?: number;
};

export type ToolUseContext = {
  actor: AgentActor;
  sessionId: string;
  turnId: string;
  transcript: AgentMessage[];
  abortSignal: AbortSignal;
  onProgress?: (progress: ToolProgress) => void;
  uploads: ToolRuntimeUpload[];
  fileStore: ToolFileStore;
  now: string;
};

export type ToolPermissionContext = ToolUseContext;

export type ToolAccessRequirement = {
  match: "any" | "all";
  entries: Array<{
    module: ModuleKey;
    level: ToolAccessLevel;
  }>;
};

export type ToolResult<TOutput = unknown> = {
  data: TOutput;
  newMessages?: AgentMessage[];
};

export type ToolErrorOutput = {
  error: {
    code: string;
    message: string;
    field?: string;
    suggestion?: string;
  };
};

export class ToolExecutionError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly options?: {
      field?: string;
      suggestion?: string;
    }
  ) {
    super(message);
    this.name = "ToolExecutionError";
  }
}

export type AgentTool<TInput = unknown, TOutput = unknown, TResult = unknown> = {
  name: string;
  description: string;
  prompt?: string | (() => string | Promise<string>);
  searchHint?: string;
  shouldDefer?: boolean;
  module?: ToolModule;
  supportedModules?: ModuleKey[];
  accessLevel?: ToolAccessLevel;
  riskClass?: ToolRiskClass;
  inputSchema: z.ZodType<TInput>;
  outputSchema?: z.ZodType<TOutput>;
  isReadOnly?: (input: TInput) => boolean;
  requiresConfirmation?: (input: TInput) => boolean;
  isConcurrencySafe?: (input: TInput) => boolean;
  getAccessRequirement?: (input: TInput) => ToolAccessRequirement | null;
  validateInput?: (input: TInput, ctx: ToolUseContext) => Promise<ValidationResult>;
  canUse?: (
    input: TInput,
    ctx: ToolPermissionContext
  ) => Promise<ToolPermissionDecision<TInput>>;
  call: (input: TInput, ctx: ToolUseContext) => Promise<TResult>;
  toToolResult?: (result: TResult, ctx: ToolUseContext) => Promise<ToolResult<TOutput>>;
  renderForUser?: (output: TOutput) => ReactNode;
  maxResultSizeChars?: number;
};

// Heterogeneous tool registries need an erased wrapper type at the orchestration boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyAgentTool = AgentTool<any, any, any>;

type ToolDefaults<TInput> = {
  isReadOnly: (input: TInput) => boolean;
  requiresConfirmation: (input: TInput) => boolean;
  isConcurrencySafe: (input: TInput) => boolean;
  getAccessRequirement: (input: TInput) => ToolAccessRequirement | null;
  canUse: (
    input: TInput,
    _ctx: ToolPermissionContext
  ) => Promise<ToolPermissionDecision<TInput>>;
  maxResultSizeChars: number;
};

const TOOL_DEFAULTS: ToolDefaults<unknown> = {
  isReadOnly: () => false,
  requiresConfirmation: () => false,
  isConcurrencySafe: () => false,
  getAccessRequirement: () => null,
  canUse: async (input) => ({
    behavior: "allow",
    updatedInput: input,
  }),
  maxResultSizeChars: 20_000,
};

type DefaultableToolKeys =
  | "isReadOnly"
  | "requiresConfirmation"
  | "isConcurrencySafe"
  | "getAccessRequirement"
  | "canUse"
  | "maxResultSizeChars";

export type AgentToolDef<TInput = unknown, TOutput = unknown, TResult = unknown> = Omit<
  AgentTool<TInput, TOutput, TResult>,
  DefaultableToolKeys
> &
  Partial<Pick<AgentTool<TInput, TOutput, TResult>, DefaultableToolKeys>>;

export async function resolveToolPrompt(tool: Pick<AgentTool, "description" | "prompt">) {
  if (!tool.prompt) {
    return tool.description;
  }

  return typeof tool.prompt === "function" ? await tool.prompt() : tool.prompt;
}

export function buildTool<TInput, TOutput, TResult, D extends AgentToolDef<TInput, TOutput, TResult>>(
  definition: D
): D & ToolDefaults<TInput> {
  return {
    ...TOOL_DEFAULTS,
    ...definition,
  } as D & ToolDefaults<TInput>;
}
