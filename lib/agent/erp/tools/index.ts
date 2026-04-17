import { askUserQuestionTool } from "@/lib/agent/erp/tools/ask-user-question";
import { commitCustomerImportTool } from "@/lib/agent/erp/tools/commit-customer-import";
import { describeTableUploadTool } from "@/lib/agent/erp/tools/describe-table-upload";
import { listSessionUploadsTool } from "@/lib/agent/erp/tools/list-session-uploads";
import { lookupCustomerCategoriesTool } from "@/lib/agent/erp/tools/lookup-customer-categories";
import { lookupCustomersTool } from "@/lib/agent/erp/tools/lookup-customers";
import { previewTableRowsTool } from "@/lib/agent/erp/tools/preview-table-rows";
import { readFileTool } from "@/lib/agent/erp/tools/read-file";
import { searchTableRowsTool } from "@/lib/agent/erp/tools/search-table-rows";
import { stageCustomerImportTool } from "@/lib/agent/erp/tools/stage-customer-import";
import { upsertCustomerCategoryTool } from "@/lib/agent/erp/tools/upsert-customer-category";

export const erpAgentTools = [
  askUserQuestionTool,
  listSessionUploadsTool,
  readFileTool,
  describeTableUploadTool,
  previewTableRowsTool,
  searchTableRowsTool,
  lookupCustomersTool,
  lookupCustomerCategoriesTool,
  upsertCustomerCategoryTool,
  stageCustomerImportTool,
  commitCustomerImportTool,
] as const;
