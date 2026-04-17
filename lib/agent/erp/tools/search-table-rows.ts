import { z } from "zod";
import { buildTool } from "@/lib/agent/core/Tool";
import { readSessionTable, searchRows } from "@/lib/agent/erp/table-utils";

const searchTableRowsInputSchema = z.strictObject({
  uploadId: z.string().uuid().optional().describe("Optional upload id. Defaults to the first tabular upload."),
  query: z.string().trim().min(1).describe("Case-insensitive text query."),
  column: z.string().optional().describe("Optional exact header name to search inside."),
  limit: z.number().int().min(1).max(20).default(20).describe("Maximum number of matching rows to return."),
});

type SearchTableRowsInput = z.infer<typeof searchTableRowsInputSchema>;

export const searchTableRowsTool = buildTool({
  name: "SearchTableRows",
  description: "Search rows in a normalized table upload by query text and optional column name.",
  inputSchema: searchTableRowsInputSchema,
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  async call(input: SearchTableRowsInput, ctx) {
    const table = await readSessionTable({
      uploads: ctx.uploads,
      fileStore: ctx.fileStore,
      uploadId: input.uploadId,
    });

    return {
      uploadId: table.upload.id,
      filename: table.upload.sourceFilename,
      matches: searchRows({
        rows: table.rows,
        query: input.query,
        column: input.column,
        limit: input.limit,
      }),
    };
  },
});
