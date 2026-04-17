import type { ToolArtifactSummary } from "@/lib/agent/core/Tool";

function summarizeText(content: string) {
  return content.replace(/\s+/g, " ").trim().slice(0, 240);
}

export async function persistLargeResult(args: {
  content: unknown;
  maxResultSizeChars: number;
  sessionId: string;
  filename: string;
  fileStore: {
    getAbsolutePath?(storageKey: string): string;
    writeJson(args: {
      sessionId: string;
      filename: string;
      mediaType?: string;
      data: unknown;
    }): Promise<ToolArtifactSummary>;
    writeText(args: {
      sessionId: string;
      filename: string;
      mediaType: string;
      content: string;
    }): Promise<ToolArtifactSummary>;
  };
}) {
  const serialized =
    typeof args.content === "string"
      ? args.content
      : JSON.stringify(args.content, null, 2);

  if (serialized.length <= args.maxResultSizeChars) {
    return {
      inlineContent: args.content,
      artifact: null,
      summary: summarizeText(serialized),
    };
  }

  const artifact =
    typeof args.content === "string"
      ? await args.fileStore.writeText({
          sessionId: args.sessionId,
          filename: args.filename,
          mediaType: "text/plain",
          content: args.content,
        })
      : await args.fileStore.writeJson({
          sessionId: args.sessionId,
          filename: args.filename,
          data: args.content,
        });

  return {
    inlineContent: {
      summary: summarizeText(serialized),
      artifact: {
        key: artifact.key,
        absolutePath: args.fileStore.getAbsolutePath?.(artifact.key),
        label: artifact.label,
        mediaType: artifact.mediaType,
        byteSize: artifact.byteSize,
      },
    },
    artifact,
    summary: summarizeText(serialized),
  };
}
