import { z } from "zod";
import { buildTool } from "@/lib/agent/core/Tool";
import { insertCustomerSchema } from "@/lib/schemas/customers";
import {
  type AgentCustomerLookupRow,
  getActiveCustomersForAgentImport,
  lookupCustomerCategoriesForAgent,
} from "@/app/(dashboard)/sales/agent-queries";
import { readSessionTable } from "@/lib/agent/erp/table-utils";

const mappingSourceSchema = z.discriminatedUnion("source", [
  z.strictObject({
    source: z.literal("column"),
    column: z.string().trim().min(1).describe("Exact upload header name to map from."),
  }),
  z.strictObject({
    source: z.literal("literal"),
    value: z.string().nullable().optional().describe("Fixed literal value to use for every row."),
  }),
]);

const fieldMappingSchema = z.strictObject({
  name: mappingSourceSchema.describe("Required customer name mapping."),
  customerCategory: mappingSourceSchema.optional().describe("Optional customer category mapping."),
  email: mappingSourceSchema.optional().describe("Optional email mapping."),
  phone: mappingSourceSchema.optional().describe("Optional phone mapping."),
  billingLine1: mappingSourceSchema.optional().describe("Optional billing address line 1 mapping."),
  notes: mappingSourceSchema.optional().describe("Optional notes mapping."),
});

const stageCustomerImportInputSchema = z.strictObject({
  uploadId: z.string().uuid().optional().describe("Optional upload id. Defaults to the first tabular upload."),
  mapping: fieldMappingSchema.describe("How upload columns or literals map to ERP customer fields."),
  offset: z.number().int().min(0).default(0).describe("Zero-based data-row offset."),
  limit: z.number().int().min(1).max(250).default(250).describe("Maximum number of rows to stage in one batch."),
});

type StageCustomerImportInput = z.infer<typeof stageCustomerImportInputSchema>;
type StagedCustomerRow = {
  rowNumber: number;
  action: "create" | "update";
  matchedBy: CustomerMatchField | null;
  existingCustomerId: string | null;
  existingCustomerName: string | null;
  values: z.infer<typeof insertCustomerSchema>;
};
type CustomerMatchField = "email" | "phone" | "name";
type CustomerMatchCandidate = {
  matchedBy: CustomerMatchField;
  rows: AgentCustomerLookupRow[];
};
type CustomerMatchResult = {
  matchedBy: CustomerMatchField;
  customer: AgentCustomerLookupRow | null;
};
type ExistingCustomerMatch =
  | {
      error: string;
    }
  | {
      matchedBy: CustomerMatchField | null;
      customer: AgentCustomerLookupRow | null;
    };

function normalizeOptionalValue(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePhone(value: string | null | undefined) {
  const digits = (value ?? "").replace(/\D+/g, "");
  return digits.length > 0 ? digits : null;
}

function resolveMappedValue(
  mapping: z.infer<typeof mappingSourceSchema> | undefined,
  row: Record<string, string>
) {
  if (!mapping) {
    return null;
  }

  if (mapping.source === "literal") {
    return normalizeOptionalValue(mapping.value ?? null);
  }

  return normalizeOptionalValue(row[mapping.column] ?? null);
}

function buildCustomerLookupMaps(
  customers: Awaited<ReturnType<typeof getActiveCustomersForAgentImport>>
) {
  const emailMap = new Map<string, typeof customers>();
  const phoneMap = new Map<string, typeof customers>();
  const nameMap = new Map<string, typeof customers>();

  for (const customer of customers) {
    const email = customer.email?.trim().toLowerCase();
    if (email) {
      emailMap.set(email, [...(emailMap.get(email) ?? []), customer]);
    }

    const phone = normalizePhone(customer.phone);
    if (phone) {
      phoneMap.set(phone, [...(phoneMap.get(phone) ?? []), customer]);
    }

    const name = customer.name.trim().toLowerCase();
    nameMap.set(name, [...(nameMap.get(name) ?? []), customer]);
  }

  return { emailMap, phoneMap, nameMap };
}

function resolveExistingCustomerMatch(args: {
  name: string;
  email: string | null;
  phone: string | null;
  maps: ReturnType<typeof buildCustomerLookupMaps>;
}): ExistingCustomerMatch {
  const candidates = [
    args.email
      ? { matchedBy: "email" as const, rows: args.maps.emailMap.get(args.email.toLowerCase()) ?? [] }
      : null,
    args.phone
      ? { matchedBy: "phone" as const, rows: args.maps.phoneMap.get(normalizePhone(args.phone) ?? "") ?? [] }
      : null,
    {
      matchedBy: "name" as const,
      rows: args.maps.nameMap.get(args.name.toLowerCase()) ?? [],
    },
  ].filter((candidate): candidate is CustomerMatchCandidate => candidate != null);

  const uniqueMatches: CustomerMatchResult[] = candidates
    .map((candidate) =>
      candidate.rows.length === 1
        ? {
            matchedBy: candidate.matchedBy,
            customer: candidate.rows[0],
          }
        : candidate.rows.length > 1
          ? {
              matchedBy: candidate.matchedBy,
              customer: null,
            }
          : null
    )
    .filter((match): match is CustomerMatchResult => match != null);

  const ambiguous = uniqueMatches.find((match) => match?.customer == null);
  if (ambiguous) {
    return {
      error: `Multiple existing customers matched by ${ambiguous.matchedBy}.`,
    };
  }

  const matchedCustomers = uniqueMatches.filter(
    (match): match is CustomerMatchResult & { customer: AgentCustomerLookupRow } =>
      match.customer != null
  );

  if (matchedCustomers.length === 0) {
    return {
      matchedBy: null,
      customer: null,
    };
  }

  const uniqueCustomerIds = new Set(matchedCustomers.map((match) => match.customer.id));
  if (uniqueCustomerIds.size > 1) {
    return {
      error: "Conflicting existing customer matches were found across name, email, or phone.",
    };
  }

  return {
    matchedBy: matchedCustomers[0]?.matchedBy ?? null,
    customer: matchedCustomers[0]?.customer ?? null,
  };
}

export const stageCustomerImportTool = buildTool({
  name: "StageCustomerImport",
  description:
    "Validate and normalize customer rows from a tabular upload without writing to the database.",
  inputSchema: stageCustomerImportInputSchema,
  isReadOnly: () => true,
  async call(input: StageCustomerImportInput, ctx) {
    const [table, categories, existingCustomers] = await Promise.all([
      readSessionTable({
        uploads: ctx.uploads,
        fileStore: ctx.fileStore,
        uploadId: input.uploadId,
      }),
      lookupCustomerCategoriesForAgent(),
      getActiveCustomersForAgentImport(),
    ]);

    const categoryMap = new Map(categories.map((category) => [category.name.toLowerCase(), category]));
    const existingMaps = buildCustomerLookupMaps(existingCustomers);
    const errors: Array<{ rowNumber: number; field: string; message: string }> = [];
    const rows = table.rows.slice(input.offset, input.offset + input.limit);
    const stagedRows: StagedCustomerRow[] = [];

    for (const row of rows) {
      const rawName = resolveMappedValue(input.mapping.name, row.values);
      if (!rawName) {
        errors.push({
          rowNumber: row.rowNumber,
          field: "name",
          message: "Customer name is required.",
        });
        continue;
      }

      const rawCategory = resolveMappedValue(input.mapping.customerCategory, row.values);
      const category = rawCategory ? categoryMap.get(rawCategory.toLowerCase()) ?? null : null;
      if (rawCategory && !category) {
        errors.push({
          rowNumber: row.rowNumber,
          field: "customerCategory",
          message: `Unknown customer category '${rawCategory}'.`,
        });
        continue;
      }

      const values = {
        name: rawName,
        customerCategoryId: category?.id ?? null,
        email: resolveMappedValue(input.mapping.email, row.values),
        phone: resolveMappedValue(input.mapping.phone, row.values),
        billingLine1: resolveMappedValue(input.mapping.billingLine1, row.values),
        notes: resolveMappedValue(input.mapping.notes, row.values),
      };

      const validation = insertCustomerSchema.safeParse(values);
      if (!validation.success) {
        const flattened = validation.error.flatten().fieldErrors;
        for (const [field, fieldErrors] of Object.entries(flattened)) {
          for (const message of fieldErrors ?? []) {
            errors.push({
              rowNumber: row.rowNumber,
              field,
              message,
            });
          }
        }
        continue;
      }

      const match = resolveExistingCustomerMatch({
        name: validation.data.name,
        email: validation.data.email,
        phone: validation.data.phone,
        maps: existingMaps,
      });

      if ("error" in match) {
        errors.push({
          rowNumber: row.rowNumber,
          field: "match",
          message: match.error,
        });
        continue;
      }

      stagedRows.push({
        rowNumber: row.rowNumber,
        action: match.customer ? "update" : "create",
        matchedBy: match.matchedBy,
        existingCustomerId: match.customer?.id ?? null,
        existingCustomerName: match.customer?.name ?? null,
        values: validation.data,
      });
    }

    const artifact = await ctx.fileStore.writeJson({
      sessionId: ctx.sessionId,
      filename: `customer-import-stage-${ctx.turnId}.json`,
      data: {
        uploadId: table.upload.id,
        rows: stagedRows,
        errors,
      },
    });

    return {
      toolName: "StageCustomerImport",
      stagedImportId: artifact.key,
      uploadId: table.upload.id,
      counts: {
        scannedRows: rows.length,
        stagedRows: stagedRows.length,
        errorRows: errors.length,
        createCount: stagedRows.filter((row) => row.action === "create").length,
        updateCount: stagedRows.filter((row) => row.action === "update").length,
      },
      previewRows: stagedRows.slice(0, 25),
      errors: errors.slice(0, 25),
    };
  },
});
