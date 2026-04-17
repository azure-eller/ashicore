import type { AgentProvider } from "@/lib/agent/core/api/provider";
import { buildUploadAttachmentMessages } from "@/lib/agent/core/attachments";
import { query, type QueryEvent, type QueryOutcome } from "@/lib/agent/core/query";
import type { AnyAgentTool, ToolUseContext } from "@/lib/agent/core/Tool";
import type { PromptSection } from "@/lib/agent/core/promptSections";
import type { AgentUploadRecord } from "@/lib/agent/erp/types";
import type { ToolAuditHooks } from "@/lib/agent/core/toolExecution";

export class QueryEngine {
  constructor(
    private readonly provider: AgentProvider,
    private readonly model: string
  ) {}

  run(args: {
    systemSections: PromptSection[];
    uploads: AgentUploadRecord[];
    messages: Parameters<typeof query>[0]["messages"];
    tools: AnyAgentTool[];
    ctx: ToolUseContext;
    audit?: ToolAuditHooks;
  }) {
    const attachmentMessages = buildUploadAttachmentMessages({
      uploads: args.uploads,
      createdAt: args.ctx.now,
    });

    return query({
      provider: this.provider,
      model: this.model,
      systemSections: args.systemSections,
      attachmentMessages,
      messages: args.messages,
      tools: args.tools,
      ctx: args.ctx,
      audit: args.audit,
    }) as AsyncGenerator<QueryEvent, QueryOutcome, void>;
  }
}
