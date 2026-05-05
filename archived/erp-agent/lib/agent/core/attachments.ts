import { randomUUID } from "node:crypto";
import {
  createAgentMessage,
  type AgentAttachmentContent,
  type AgentMessage,
  type SupportedAgentImageMediaType,
} from "@/lib/agent/core/messages";
import type { AgentUploadRecord } from "@/lib/agent/erp/types";

const SUPPORTED_IMAGE_MEDIA_TYPES = new Set<SupportedAgentImageMediaType>([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

function formatManifestLine(upload: AgentUploadRecord) {
  const parts = [`- ${upload.sourceFilename} (${upload.mediaType})`];

  if (upload.manifest.table) {
    parts.push(
      `${upload.manifest.table.rowCount} rows`,
      `${upload.manifest.table.headers.length} columns`
    );
  }

  if (upload.manifest.pageCount != null) {
    parts.push(`${upload.manifest.pageCount} pages`);
  }

  if (upload.manifest.image) {
    parts.push(`${upload.manifest.image.width}x${upload.manifest.image.height}`);
  }

  return parts.join(" • ");
}

function toAttachmentContent(upload: AgentUploadRecord): AgentAttachmentContent | null {
  if (upload.normalizedKind === "image") {
    if (!SUPPORTED_IMAGE_MEDIA_TYPES.has(upload.mediaType as SupportedAgentImageMediaType)) {
      return null;
    }

    return {
      kind: "image",
      storageKey: upload.storageKey,
      mediaType: upload.mediaType as SupportedAgentImageMediaType,
    };
  }

  if (upload.normalizedKind === "pdf" && upload.mediaType === "application/pdf") {
    return {
      kind: "document",
      storageKey: upload.storageKey,
      mediaType: "application/pdf",
    };
  }

  return null;
}

export function buildUploadAttachmentMessages(args: {
  uploads: AgentUploadRecord[];
  createdAt: string;
}) {
  if (args.uploads.length === 0) {
    return [] satisfies AgentMessage[];
  }

  const manifestText = [
    "Session uploads:",
    ...args.uploads.map(formatManifestLine),
    "Use the tabular tools for CSV/XLSX-derived tables. Use Read for raw text or generated artifacts. Use direct multimodal inspection only for images and PDFs.",
  ].join("\n");

  return [
    createAgentMessage({
      id: randomUUID(),
      role: "user",
      createdAt: args.createdAt,
      parts: [
        {
          type: "attachment",
          attachmentId: randomUUID(),
          label: "Session upload manifest",
          content: {
            kind: "manifest",
            text: manifestText,
          },
        },
        ...args.uploads
          .map((upload) => {
            const content = toAttachmentContent(upload);
            if (!content) {
              return null;
            }

            return {
              type: "attachment" as const,
              attachmentId: upload.id,
              label: upload.sourceFilename,
              content,
            };
          })
          .filter((part): part is Extract<AgentMessage["parts"][number], { type: "attachment" }> => part != null),
      ],
    }),
  ] satisfies AgentMessage[];
}
