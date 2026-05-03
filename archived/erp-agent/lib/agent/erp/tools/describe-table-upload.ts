import { z } from "zod";
import { buildTool } from "@/lib/agent/core/Tool";
import { inferColumnType, readSessionTable } from "@/lib/agent/erp/table-utils";

const describeTableUploadInputSchema = z.strictObject({
  uploadId: z
    .string()
    .uuid()
    .optional()
    .describe("Optional session upload id. When omitted, the first tabular upload is used."),
});

type DescribeTableUploadInput = z.infer<typeof describeTableUploadInputSchema>;

export const describeTableUploadTool = buildTool({
  name: "DescribeTableUpload",
  description:
    "Describe a normalized CSV upload with headers, inferred column types, row count, and sample rows.",
  inputSchema: describeTableUploadInputSchema,
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  async call(input: DescribeTableUploadInput, ctx) {
    const table = await readSessionTable({
      uploads: ctx.uploads,
      fileStore: ctx.fileStore,
      uploadId: input.uploadId,
    });

    const inferredTypes = Object.fromEntries(
      table.headers.map((header) => [
        header,
        inferColumnType(table.rows.slice(0, 25).map((row) => row.values[header] ?? "")),
      ])
    );

    return {
      uploadId: table.upload.id,
      filename: table.upload.sourceFilename,
      rowCount: table.rows.length,
      headers: table.headers,
      inferredTypes,
      sampleRows: table.rows.slice(0, 5),
    };
  },
});
