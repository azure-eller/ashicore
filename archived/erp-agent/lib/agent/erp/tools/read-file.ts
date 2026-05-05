import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { buildTool, type ToolUseContext } from "@/lib/agent/core/Tool";

const MAX_LINES_TO_READ = 2000;

const DESCRIPTION = "Read a file from the current session workspace.";

const PROMPT = `Reads a file from the current session workspace. You can access uploaded files and agent-generated artifacts directly by using this tool.
Assume this tool is able to read files that belong to the current session. If the user or a previous tool_result provides a path to a session file, assume that path is valid. Paths outside the current session workspace will return an error.

Usage:
- The file_path parameter must be an absolute path, not a relative path
- By default, it reads up to ${MAX_LINES_TO_READ} lines starting from the beginning of the file
- You can optionally specify a line offset and limit (especially handy for long files), but it's recommended to read the whole file by not providing these parameters
- Results are returned using cat -n format, with line numbers starting at 1
- Use this tool for text, JSON, CSV, and generated artifacts stored in the current session workspace
- For CSV/XLSX-derived tables, prefer the tabular tools when you need row-level previews, search, or structured summaries
- Images and PDFs are already attached to the session for multimodal inspection. If you pass one of those files here, the tool will return a note instead of rendering it.
- This tool can only read files, not directories.
- If you read a file that exists but has empty contents you will receive a warning in place of file contents.`;

const readFileInputSchema = z.strictObject({
  file_path: z
    .string()
    .trim()
    .min(1)
    .describe("The absolute path to a file in the current session workspace."),
  offset: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Optional 1-based line number to start reading from."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LINES_TO_READ)
    .optional()
    .describe(`Optional maximum number of lines to read. Maximum ${MAX_LINES_TO_READ}.`),
});

type ReadFileInput = z.infer<typeof readFileInputSchema>;

function getSessionRoot(ctx: ToolUseContext) {
  return ctx.fileStore.getAbsolutePath?.(ctx.sessionId);
}

function isAllowedPath(ctx: ToolUseContext, filePath: string) {
  const sessionRoot = getSessionRoot(ctx);
  if (!sessionRoot) {
    return false;
  }

  const normalizedRoot = path.resolve(sessionRoot);
  const normalizedPath = path.resolve(filePath);
  return (
    normalizedPath === normalizedRoot ||
    normalizedPath.startsWith(`${normalizedRoot}${path.sep}`)
  );
}

function formatWithLineNumbers(lines: string[], startLine: number) {
  return lines
    .map((line, index) => `${String(startLine + index).padStart(6, " ")}\t${line}`)
    .join("\n");
}

function isDirectInspectionAttachment(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  return [".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf"].includes(extension);
}

export const readFileTool = buildTool({
  name: "Read",
  description: DESCRIPTION,
  prompt: PROMPT,
  inputSchema: readFileInputSchema,
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  async validateInput(input: ReadFileInput, ctx) {
    if (!path.isAbsolute(input.file_path)) {
      return {
        result: false,
        message: "The file_path parameter must be an absolute path.",
      };
    }

    if (!isAllowedPath(ctx, input.file_path)) {
      return {
        result: false,
        message: "The requested file is outside the current session workspace.",
      };
    }

    return { result: true };
  },
  async call(input: ReadFileInput) {
    const resolvedPath = path.resolve(input.file_path);

    if (isDirectInspectionAttachment(resolvedPath)) {
      return {
        filePath: resolvedPath,
        note: "This file is already attached to the session for direct multimodal inspection. Use the attachment instead of Read for images and PDFs.",
      };
    }

    const fileStat = await stat(resolvedPath);
    if (!fileStat.isFile()) {
      throw new Error("This tool can only read files, not directories.");
    }

    const content = await readFile(resolvedPath, "utf8");
    if (content.length === 0) {
      return {
        filePath: resolvedPath,
        warning: "File exists but has empty contents.",
      };
    }

    const allLines = content.split(/\r?\n/);
    const startLine = input.offset ?? 1;
    const limit = input.limit ?? MAX_LINES_TO_READ;
    const sliceStart = startLine - 1;
    const selectedLines = allLines.slice(sliceStart, sliceStart + limit);
    const endLine = sliceStart + selectedLines.length;

    return {
      filePath: resolvedPath,
      startLine,
      endLine,
      totalLines: allLines.length,
      truncated: endLine < allLines.length,
      content: formatWithLineNumbers(selectedLines, startLine),
    };
  },
});
