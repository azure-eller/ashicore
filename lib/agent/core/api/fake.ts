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

function getLatestUserText(request: ProviderRequest) {
  const latestUserMessage = [...request.transcript]
    .reverse()
    .find((message) => message.role === "user" && getMessageText(message).trim().length > 0);

  return latestUserMessage ? getMessageText(latestUserMessage).toLowerCase() : "";
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
        text: "No ERP tools are currently available for this user.",
      };
      return { stopReason: "end_turn" };
    }

    const latestText = getLatestUserText(request);
    const latestGet = findLatestToolResult(request, "erp.get");
    const latestSearch = findLatestToolResult(request, "erp.search");
    const latestList = findLatestToolResult(request, "erp.list");

    if (latestText.includes("list") && latestText.includes("order")) {
      if (latestList) {
        yield {
          type: "text_delta",
          text: "I listed the matching orders.",
        };
        return { stopReason: "end_turn" };
      }

      yield {
        type: "tool_use",
        id: randomUUID(),
        name: "erp.list",
        input: {
          entityType: latestText.includes("purchase") ? "purchase_order" : "sales_order",
          limit: 25,
          offset: 0,
        },
      };
      return { stopReason: "tool_use" };
    }

    if (
      latestText.includes("find") ||
      latestText.includes("search") ||
      latestText.includes("look up")
    ) {
      if (latestSearch) {
        yield {
          type: "text_delta",
          text: "I found matching ERP records.",
        };
        return { stopReason: "end_turn" };
      }

      yield {
        type: "tool_use",
        id: randomUUID(),
        name: "erp.search",
        input: {
          query: latestText.replace(/\b(find|search|look up|for|the)\b/g, " ").trim() || latestText,
          limit: 10,
          offset: 0,
        },
      };
      return { stopReason: "tool_use" };
    }

    if (latestText.includes("show") || latestText.includes("open") || latestText.includes("inspect")) {
      if (latestGet) {
        yield {
          type: "text_delta",
          text: "I loaded the requested ERP record.",
        };
        return { stopReason: "end_turn" };
      }

      const searchOutput =
        latestSearch &&
        "output" in latestSearch &&
        latestSearch.output &&
        typeof latestSearch.output === "object"
          ? (latestSearch.output as Record<string, unknown>)
          : null;
      const firstItem =
        searchOutput &&
        "items" in searchOutput &&
        Array.isArray(searchOutput.items) &&
        searchOutput.items.length > 0 &&
        typeof searchOutput.items[0] === "object"
          ? (searchOutput.items[0] as Record<string, unknown>)
          : null;

      if (firstItem && typeof firstItem.entityType === "string" && typeof firstItem.id === "string") {
        yield {
          type: "tool_use",
          id: randomUUID(),
          name: "erp.get",
          input: {
            entityType: firstItem.entityType,
            id: firstItem.id,
          },
        };
        return { stopReason: "tool_use" };
      }
    }

    if (latestText.includes("create customer")) {
      yield {
        type: "tool_use",
        id: randomUUID(),
        name: "erp.create",
        input: {
          entityType: "customer",
          values: {
            name: "Fake Customer",
            customerCategoryId: null,
            email: null,
            phone: null,
            billingLine1: null,
            billingLine2: null,
            billingCity: null,
            billingRegion: null,
            billingPostcode: null,
            billingCountry: null,
            shipLine1: null,
            shipLine2: null,
            shipCity: null,
            shipRegion: null,
            shipPostcode: null,
            shipCountry: null,
            notes: null,
          },
        },
      };
      return { stopReason: "tool_use" };
    }

    if (latestText.includes("update") && latestGet) {
      const output =
        "output" in latestGet && latestGet.output && typeof latestGet.output === "object"
          ? (latestGet.output as Record<string, unknown>)
          : null;
      const record =
        output &&
        "record" in output &&
        output.record &&
        typeof output.record === "object"
          ? (output.record as Record<string, unknown>)
          : null;

      if (
        output &&
        typeof output.entityType === "string" &&
        record &&
        typeof record.id === "string"
      ) {
        const fields =
          "fields" in record && record.fields && typeof record.fields === "object"
            ? (record.fields as Record<string, unknown>)
            : {};

        yield {
          type: "tool_use",
          id: randomUUID(),
          name: "erp.update",
          input: {
            entityType: output.entityType,
            id: record.id,
            values: {
              ...fields,
            },
          },
        };
        return { stopReason: "tool_use" };
      }
    }

    yield {
      type: "text_delta",
      text: "I’m ready. Ask me to search, list, inspect, create, or update ERP records.",
    };
    return { stopReason: "end_turn" };
  }
}
