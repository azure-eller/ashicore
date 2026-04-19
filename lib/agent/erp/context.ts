import {
  resolvePromptSections,
  type PromptSection,
  type PromptSectionDefinition,
} from "@/lib/agent/core/promptSections";
import type { AgentUploadRecord } from "@/lib/agent/erp/types";
import { getStaticPromptSections } from "@/lib/agent/erp/prompt";
import { getUploadStore } from "@/lib/agent/erp/upload-store";

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
      id: "erp-session-uploads",
      tier: "session",
      scopeKey: args.sessionId,
      compute: async () => formatSessionUploads(args.uploads),
    },
  ] satisfies PromptSectionDefinition[];

  return resolvePromptSections([...getStaticPromptSections(), ...dynamicSections]);
}
