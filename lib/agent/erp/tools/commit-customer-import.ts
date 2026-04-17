import { z } from "zod";
import { buildTool } from "@/lib/agent/core/Tool";
import { commitCustomerImportForAgent } from "@/app/(dashboard)/sales/agent-queries";
import { insertCustomerSchema } from "@/lib/schemas/customers";

const stagedImportArtifactSchema = z.strictObject({
  uploadId: z.string().uuid(),
  rows: z.array(
    z.strictObject({
      rowNumber: z.number().int(),
      action: z.enum(["create", "update"]),
      matchedBy: z.enum(["email", "phone", "name"]).nullable(),
      existingCustomerId: z.string().uuid().nullable(),
      existingCustomerName: z.string().nullable(),
      values: insertCustomerSchema,
    })
  ),
  errors: z.array(
    z.strictObject({
      rowNumber: z.number().int(),
      field: z.string(),
      message: z.string(),
    })
  ),
});

const commitCustomerImportInputSchema = z.strictObject({
  stagedImportId: z.string().min(1).describe("Artifact key returned by StageCustomerImport."),
});

type CommitCustomerImportInput = z.infer<typeof commitCustomerImportInputSchema>;

export const commitCustomerImportTool = buildTool({
  name: "CommitCustomerImport",
  description: "Create or update staged customers after explicit confirmation when required.",
  inputSchema: commitCustomerImportInputSchema,
  async validateInput(input: CommitCustomerImportInput, ctx) {
    if (!input.stagedImportId.startsWith(`${ctx.sessionId}/`)) {
      return {
        result: false,
        message: "The staged import artifact must belong to the current session.",
      };
    }

    return {
      result: true,
    };
  },
  async canUse(input: CommitCustomerImportInput, ctx) {
    const content = await ctx.fileStore.readText(input.stagedImportId);
    const artifact = stagedImportArtifactSchema.parse(JSON.parse(content));

    if (artifact.rows.length === 0) {
      return {
        behavior: "deny",
        message: "There are no staged customer rows to commit.",
      };
    }

    if (artifact.rows.length > 1) {
      return {
        behavior: "ask",
        updatedInput: input,
        kind: "permission",
        message: `Commit ${artifact.rows.length} staged customer rows?`,
        payload: {
          summary: {
            rowCount: artifact.rows.length,
            createCount: artifact.rows.filter((row) => row.action === "create").length,
            updateCount: artifact.rows.filter((row) => row.action === "update").length,
          },
        },
      };
    }

    return {
      behavior: "allow",
      updatedInput: input,
    };
  },
  async call(input: CommitCustomerImportInput, ctx) {
    const content = await ctx.fileStore.readText(input.stagedImportId);
    const artifact = stagedImportArtifactSchema.parse(JSON.parse(content));
    const result = await commitCustomerImportForAgent(
      artifact.rows.map((row) => ({
        existingCustomerId: row.existingCustomerId,
        values: row.values,
      }))
    );

    return {
      toolName: "CommitCustomerImport",
      stagedImportId: input.stagedImportId,
      ...result,
    };
  },
});
