import { z } from "zod";

export type ValidationResult =
  | { result: true }
  | {
      result: false;
      message: string;
      errorCode?: number;
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
      kind: "question" | "permission";
      payload: unknown;
      message: string;
    }
  | {
      behavior: "deny";
      message: string;
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

export type ToolUseContext = {
  actor: AgentActor;
  sessionId: string;
  turnId: string;
  signal: AbortSignal;
  uploads: ToolRuntimeUpload[];
  fileStore: ToolFileStore;
  now: string;
};

export type ToolPermissionContext = ToolUseContext;

export type AgentTool<TInput = unknown, TResult = unknown> = {
  name: string;
  description: string;
  prompt?: string | (() => string | Promise<string>);
  inputSchema: z.ZodType<TInput>;
  isReadOnly?: (input: TInput) => boolean;
  requiresConfirmation?: (input: TInput) => boolean;
  isConcurrencySafe?: (input: TInput) => boolean;
  validateInput?: (input: TInput, ctx: ToolUseContext) => Promise<ValidationResult>;
  canUse?: (
    input: TInput,
    ctx: ToolPermissionContext
  ) => Promise<ToolPermissionDecision<TInput>>;
  call: (input: TInput, ctx: ToolUseContext) => Promise<TResult>;
  toToolResult?: (result: TResult, ctx: ToolUseContext) => Promise<unknown>;
  maxResultSizeChars?: number;
};

// Heterogeneous tool registries need an erased wrapper type at the orchestration boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyAgentTool = AgentTool<any, any>;

type ToolDefaults<TInput> = {
  isReadOnly: (input: TInput) => boolean;
  requiresConfirmation: (input: TInput) => boolean;
  isConcurrencySafe: (input: TInput) => boolean;
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
  | "canUse"
  | "maxResultSizeChars";

export type AgentToolDef<TInput = unknown, TResult = unknown> = Omit<
  AgentTool<TInput, TResult>,
  DefaultableToolKeys
> &
  Partial<Pick<AgentTool<TInput, TResult>, DefaultableToolKeys>>;

export async function resolveToolPrompt(tool: Pick<AgentTool, "description" | "prompt">) {
  if (!tool.prompt) {
    return tool.description;
  }

  return typeof tool.prompt === "function" ? await tool.prompt() : tool.prompt;
}

export function buildTool<TInput, TResult, D extends AgentToolDef<TInput, TResult>>(
  definition: D
): D & ToolDefaults<TInput> {
  return {
    ...TOOL_DEFAULTS,
    ...definition,
  } as D & ToolDefaults<TInput>;
}
