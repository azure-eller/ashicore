import { randomUUID } from "node:crypto";
import type {
  AgentProvider,
  ProviderRequest,
  ProviderRunResult,
  ProviderStreamEvent,
} from "@/lib/agent/core/api/provider";
import { buildAnthropicRequestShape } from "@/lib/agent/core/api/anthropicRequest";
import { getMessageText } from "@/lib/agent/core/messages";

function findLatestToolResult(request: ProviderRequest, toolName: string) {
  for (const message of [...request.transcript].reverse()) {
    const toolResult = message.parts.find(
      (part) =>
        part.type === "tool_result" &&
        typeof part.content === "object" &&
        part.content != null &&
        "toolName" in (part.content as Record<string, unknown>) &&
        (part.content as Record<string, unknown>).toolName === toolName
    );

    if (toolResult?.type === "tool_result") {
      return toolResult.content as Record<string, unknown>;
    }
  }

  return null;
}

export class FakeAgentProvider implements AgentProvider {
  async *stream(request: ProviderRequest): AsyncGenerator<ProviderStreamEvent, ProviderRunResult, void> {
    await buildAnthropicRequestShape({
      source: "fake",
      request,
    });

    if (request.tools.length === 0) {
      yield {
        type: "text_delta",
        text: [
          "<summary>",
          "- The user is working on customer onboarding.",
          "- Preserve any confirmed mappings, uploads, and pending approvals from earlier turns.",
          "</summary>",
        ].join("\n"),
      };
      return { stopReason: "end_turn" };
    }

    const latestUserMessage = [...request.transcript]
      .reverse()
      .find((message) => message.role === "user" && getMessageText(message).trim().length > 0);
    const latestText = latestUserMessage ? getMessageText(latestUserMessage).toLowerCase() : "";

    if (
      latestText.includes("summary") ||
      latestText.includes("summarize") ||
      latestText.includes("review") ||
      latestText.includes("inspect") ||
      latestText.includes("look good") ||
      latestText.includes("looks good") ||
      latestText.includes("check the data") ||
      latestText.includes("does this data")
    ) {
      if (!findLatestToolResult(request, "DescribeTableUpload")) {
        yield {
          type: "tool_use",
          id: randomUUID(),
          name: "DescribeTableUpload",
          input: {
            uploadId: request.attachmentMessages.length > 0 ? undefined : undefined,
          },
        };
        return { stopReason: "tool_use" };
      }

      yield {
        type: "text_delta",
        text: "I reviewed the uploaded table and summarized the main columns and row count.",
      };
      return { stopReason: "end_turn" };
    }

    if (latestText.includes("clarify") || latestText.includes("ambiguous")) {
      yield {
        type: "tool_use",
        id: randomUUID(),
        name: "AskUserQuestion",
        input: {
          questions: [
            {
              header: "name col",
              question: "Column 'customer_name' should map to which ERP field?",
              options: [
                {
                  label: "Customer Name (Recommended)",
                  description: "Maps directly to the customer name field.",
                  preview: [
                    "name -> customer.name",
                    "email -> customer.email",
                    "phone -> customer.phone",
                  ].join("\n"),
                },
                {
                  label: "Category",
                  description: "Use only if the file stores segmentation here.",
                  preview: [
                    "customer_name -> customer.category",
                    "category -> customer.name",
                    "This likely swaps the intended fields.",
                  ].join("\n"),
                },
              ],
            },
          ],
        },
      };
      return { stopReason: "tool_use" };
    }

    const stagedImport = findLatestToolResult(request, "StageCustomerImport");
    if (latestText.includes("import") && stagedImport == null) {
      yield {
        type: "tool_use",
        id: randomUUID(),
        name: "StageCustomerImport",
        input: {
          uploadId: undefined,
          mapping: {
            name: { source: "column", column: "Name" },
            email: { source: "column", column: "Email" },
            phone: { source: "column", column: "Phone" },
          },
        },
      };
      return { stopReason: "tool_use" };
    }

    if (stagedImport && latestText.includes("import")) {
      yield {
        type: "tool_use",
        id: randomUUID(),
        name: "CommitCustomerImport",
        input: {
          stagedImportId: stagedImport.stagedImportId,
        },
      };
      return { stopReason: "tool_use" };
    }

    yield {
      type: "text_delta",
      text: "I’m ready. Upload an export, spreadsheet, PDF, or image, then ask me to review the current session data.",
    };
    return { stopReason: "end_turn" };
  }
}
