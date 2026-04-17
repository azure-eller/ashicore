import { getCustomerCategoryOptions } from "@/app/(dashboard)/sales/queries";
import {
  resolvePromptSections,
  type PromptSection,
  type PromptSectionDefinition,
} from "@/lib/agent/core/promptSections";
import type { AgentUploadRecord } from "@/lib/agent/erp/types";
import { getStaticPromptSections } from "@/lib/agent/erp/prompt";
import { getUploadStore } from "@/lib/agent/erp/upload-store";

function formatCategories(categories: Array<{ id: string; name: string }>) {
  if (categories.length === 0) {
    return "Current customer categories: none yet.";
  }

  return `Current customer categories: ${categories
    .map((category) => `${category.name} (${category.id})`)
    .join(", ")}.`;
}

function formatSessionUploads(uploads: AgentUploadRecord[]) {
  if (uploads.length === 0) {
    return "No uploads are attached to this session yet.";
  }

  const store = getUploadStore();

  return [
    "Session upload summaries:",
    ...uploads.map((upload) => {
      const parts = [`- ${upload.sourceFilename} (${upload.mediaType})`];
      parts.push(`path: ${store.getAbsolutePath(upload.storageKey)}`);
      if (upload.manifest.table) {
        parts.push(
          `${upload.manifest.table.rowCount} rows`,
          `${upload.manifest.table.headers.join(", ")}`
        );
      }
      if (upload.manifest.pageCount != null) {
        parts.push(`${upload.manifest.pageCount} pages`);
      }
      return parts.join(" • ");
    }),
  ].join("\n");
}

export async function buildAgentPromptSections(args: {
  orgId: string;
  sessionId: string;
  uploads: AgentUploadRecord[];
}): Promise<PromptSection[]> {
  const dynamicSections = [
    {
      id: "erp-customer-schema",
      tier: "org",
      scopeKey: args.orgId,
      compute: async () => `
Current v1 writable customer schema:
- name: required text
- customerCategoryId: optional existing category
- email: optional
- phone: optional
- billingLine1: optional (street / line 1 of billing address)
- notes: optional
If a category does not exist yet, confirm whether it should be created or mapped to an existing category first. Even when the user asks broader ERP questions, do not imply writes outside this scope.
      `.trim(),
    },
    {
      id: "erp-customer-categories",
      tier: "org",
      scopeKey: args.orgId,
      compute: async () => formatCategories(await getCustomerCategoryOptions()),
    },
    {
      id: "erp-session-uploads",
      tier: "session",
      scopeKey: args.sessionId,
      compute: async () => formatSessionUploads(args.uploads),
    },
  ] satisfies PromptSectionDefinition[];

  return resolvePromptSections([...getStaticPromptSections(), ...dynamicSections]);
}
