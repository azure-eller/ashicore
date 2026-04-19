import { hasModuleAccess } from "@/lib/authz";
import type { AgentActor } from "@/lib/agent/core/Tool";
import { askUserQuestionTool } from "@/lib/agent/erp/tools/ask-user-question";
import { describeTableUploadTool } from "@/lib/agent/erp/tools/describe-table-upload";
import { erpCreateTool } from "@/lib/agent/erp/tools/erp-create";
import { erpGetTool } from "@/lib/agent/erp/tools/erp-get";
import { erpListTool } from "@/lib/agent/erp/tools/erp-list";
import { erpSearchTool } from "@/lib/agent/erp/tools/erp-search";
import { erpUpdateTool } from "@/lib/agent/erp/tools/erp-update";
import { listSessionUploadsTool } from "@/lib/agent/erp/tools/list-session-uploads";
import { previewTableRowsTool } from "@/lib/agent/erp/tools/preview-table-rows";
import { readFileTool } from "@/lib/agent/erp/tools/read-file";
import { searchTableRowsTool } from "@/lib/agent/erp/tools/search-table-rows";

export const erpPrimaryAgentTools = [
  erpCreateTool,
  erpGetTool,
  erpListTool,
  erpSearchTool,
  erpUpdateTool,
] as const;

export const erpHelperAgentTools = [
  askUserQuestionTool,
  describeTableUploadTool,
  listSessionUploadsTool,
  previewTableRowsTool,
  readFileTool,
  searchTableRowsTool,
] as const;

export const erpAgentTools = [
  ...erpPrimaryAgentTools,
  ...erpHelperAgentTools,
] as const;

export function getVisibleErpAgentTools(actor: Pick<AgentActor, "assignedRoles">) {
  const visiblePrimaryTools = [...erpPrimaryAgentTools]
    .filter((tool) => {
      const supportedModules =
        "supportedModules" in tool ? tool.supportedModules : undefined;

      if (!tool.accessLevel) {
        return true;
      }

      if (tool.module && tool.module !== "multiple") {
        return hasModuleAccess(actor.assignedRoles, tool.module, tool.accessLevel);
      }

      if (supportedModules && supportedModules.length > 0) {
        return supportedModules.some((module) =>
          hasModuleAccess(actor.assignedRoles, module, tool.accessLevel!)
        );
      }

      return true;
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  if (visiblePrimaryTools.length === 0) {
    return [];
  }

  return [...visiblePrimaryTools, ...erpHelperAgentTools].sort((left, right) =>
    left.name.localeCompare(right.name)
  );
}
