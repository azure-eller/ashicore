import { z } from "zod";
import { buildAgentTool } from "@/lib/agent/core";
import type { AgentTool } from "@/lib/agent/core";
import { workbookToStructuredText } from "./workbook-reader";

export type OnboardingImportAgentFile = {
  id: string;
  filename: string;
  contentType: string;
  bytes: Buffer;
};

const DEFAULT_MAX_FILE_TEXT_CHARS = 80_000;

function isWorkbookFile(file: OnboardingImportAgentFile) {
  return (
    file.contentType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    file.contentType === "application/vnd.ms-excel" ||
    /\.xlsx?$/i.test(file.filename)
  );
}

function isTextFile(file: OnboardingImportAgentFile) {
  return (
    file.contentType.startsWith("text/") ||
    file.contentType === "application/json" ||
    /\.csv$/i.test(file.filename)
  );
}

function readableKind(file: OnboardingImportAgentFile) {
  if (isWorkbookFile(file)) return "workbook";
  if (isTextFile(file)) return "text";
  if (file.contentType === "application/pdf") return "pdf";
  if (file.contentType.startsWith("image/")) return "image";
  return "binary";
}

function fileText(file: OnboardingImportAgentFile) {
  if (isWorkbookFile(file)) return workbookToStructuredText(file.bytes);
  if (isTextFile(file)) return file.bytes.toString("utf8");

  return [
    `File ${file.filename} is ${readableKind(file)} content (${file.contentType}).`,
    "This tool can list the file but cannot inline-read its binary content yet.",
  ].join("\n");
}

function truncateText(text: string, maxChars: number) {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }

  return {
    text: `${text.slice(0, maxChars)}\n[truncated after ${maxChars} characters]`,
    truncated: true,
  };
}

export function buildOnboardingImportDocumentTools(files: OnboardingImportAgentFile[]): AgentTool[] {
  const filesById = new Map(files.map((file) => [file.id, file]));

  return [
    buildAgentTool({
      name: "list_uploaded_files",
      description:
        "List onboarding upload files available to this import task. Use this before reading file content.",
      inputSchema: z.object({}),
      outputSchema: z.array(
        z.object({
          fileId: z.string(),
          filename: z.string(),
          contentType: z.string(),
          byteSize: z.number(),
          readableKind: z.enum(["workbook", "text", "pdf", "image", "binary"]),
        }),
      ),
      isConcurrencySafe: () => true,
      execute: async () =>
        files.map((file) => ({
          fileId: file.id,
          filename: file.filename,
          contentType: file.contentType,
          byteSize: file.bytes.byteLength,
          readableKind: readableKind(file),
        })),
      summarize: (output) => `${output.length} uploaded file(s) available.`,
    }) as AgentTool,
    buildAgentTool({
      name: "read_uploaded_file_text",
      description:
        "Read text from an onboarding upload. For workbooks, this returns structured sheets, relevant cells, formulas, comments, and inventory signal indexes.",
      inputSchema: z.object({
        fileId: z.string(),
        maxChars: z.number().int().positive().max(200_000).optional(),
      }),
      outputSchema: z.object({
        fileId: z.string(),
        filename: z.string(),
        contentType: z.string(),
        readableKind: z.enum(["workbook", "text", "pdf", "image", "binary"]),
        text: z.string(),
        truncated: z.boolean(),
      }),
      maxInlineResultChars: 40_000,
      isConcurrencySafe: () => true,
      execute: async (input) => {
        const file = filesById.get(input.fileId);
        if (!file) {
          throw new Error(`Upload file '${input.fileId}' was not found in this task.`);
        }

        const { text, truncated } = truncateText(
          fileText(file),
          input.maxChars ?? DEFAULT_MAX_FILE_TEXT_CHARS,
        );

        return {
          fileId: file.id,
          filename: file.filename,
          contentType: file.contentType,
          readableKind: readableKind(file),
          text,
          truncated,
        };
      },
      summarize: (output) =>
        `${output.filename}: ${output.text.length} characters${output.truncated ? " (truncated)" : ""}.`,
    }) as AgentTool,
  ];
}
