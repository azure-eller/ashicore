import { z } from "zod";
import { buildTool } from "@/lib/agent/core/Tool";
import { previewRows, readSessionTable } from "@/lib/agent/erp/table-utils";

const previewTableRowsInputSchema = z.strictObject({
  uploadId: z.string().uuid().optional().describe("Optional upload id. Defaults to the first tabular upload."),
  offset: z.number().int().min(0).default(0).describe("Zero-based row offset."),
  limit: z.number().int().min(1).max(50).default(20).describe("Preview row limit. Maximum 50."),
});

type PreviewTableRowsInput = z.infer<typeof previewTableRowsInputSchema>;

export const previewTableRowsTool = buildTool({
  name: "PreviewTableRows",
  description: "Return a bounded page of rows from a normalized table upload.",
  inputSchema: previewTableRowsInputSchema,
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  async call(input: PreviewTableRowsInput, ctx) {
    const table = await readSessionTable({
      uploads: ctx.uploads,
      fileStore: ctx.fileStore,
      uploadId: input.uploadId,
    });

    return {
      uploadId: table.upload.id,
      filename: table.upload.sourceFilename,
      totalRows: table.rows.length,
      rows: previewRows(table.rows, table.headers, input.offset, input.limit),
    };
  },
});
