import "server-only";

import OpenAI from "openai";
import type { ResponseInputContent } from "openai/resources/responses/responses";
import { zodTextFormat } from "openai/helpers/zod";
import * as XLSX from "xlsx";
import { z } from "zod";
import { partialImportPackageSchema, type PartialImportPackage } from "../types";

export type ImportExtractionFile = {
  id: string;
  filename: string;
  contentType: string;
  bytes: Buffer;
};

function textFromBytes(file: ImportExtractionFile) {
  if (
    file.contentType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    file.contentType === "application/vnd.ms-excel" ||
    /\.xlsx?$/i.test(file.filename)
  ) {
    const workbook = XLSX.read(file.bytes, { type: "buffer" });
    return workbook.SheetNames.map((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      return `Sheet: ${sheetName}\n${XLSX.utils.sheet_to_csv(sheet, { blankrows: false })}`;
    }).join("\n\n");
  }

  return file.bytes.toString("utf8");
}

function assertExtractorConfigured() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required for onboarding import extraction.");
  }
}

function dataUrl(contentType: string, bytes: Buffer) {
  return `data:${contentType};base64,${bytes.toString("base64")}`;
}

function buildUserContent(file: ImportExtractionFile): ResponseInputContent[] {
  const prompt =
    "Extract ERP onboarding data from this file into the requested JSON schema. " +
    "This is an import compiler, not an autonomous database agent. Do not invent missing values. " +
    "Use unresolvedQuestions for ambiguity. Use temp IDs for cross references. " +
    `Use fileId \"${file.id}\" in every provenance entry. Include provenance/confidence on records. ` +
    "For customer-facing price lists, map MSRP/default customer prices to defaultSellingPrice and leave defaultPurchasePrice null unless the sheet explicitly identifies vendor cost, landed cost, or purchase cost. " +
    "Prefer generic manufacturing ERP concepts: " +
    "units, suppliers, customers, materials, products, opening stock, and BOMs.";

  if (file.contentType.startsWith("image/")) {
    return [
      { type: "input_text", text: prompt },
      {
        type: "input_image",
        detail: "high",
        image_url: dataUrl(file.contentType, file.bytes),
      },
    ];
  }

  if (file.contentType === "application/pdf") {
    return [
      { type: "input_text", text: prompt },
      {
        type: "input_file",
        filename: file.filename,
        file_data: dataUrl(file.contentType, file.bytes),
      },
    ];
  }

  return [
    { type: "input_text", text: `${prompt}\n\nFilename: ${file.filename}\n\n${textFromBytes(file)}` },
  ];
}

const modelProvenanceSchema = z.object({
  fileId: z.string(),
  location: z.string().nullable(),
  sheet: z.string().nullable(),
  row: z.string().nullable(),
  page: z.string().nullable(),
});

const modelPackageSchema = z.object({
  version: z.literal("1"),
  openingStockAsOf: z.string().nullable(),
  units: z.array(
    z.object({
      tempId: z.string(),
      name: z.string(),
      size: z.string(),
      uom: z.string(),
    }),
  ),
  suppliers: z.array(
    z.object({
      tempId: z.string(),
      name: z.string(),
      code: z.string().nullable(),
      contactName: z.string().nullable(),
      email: z.string().nullable(),
      phone: z.string().nullable(),
      provenance: z.array(modelProvenanceSchema),
      confidence: z.number(),
    }),
  ),
  customers: z.array(
    z.object({
      tempId: z.string(),
      name: z.string(),
      email: z.string().nullable(),
      phone: z.string().nullable(),
      provenance: z.array(modelProvenanceSchema),
      confidence: z.number(),
    }),
  ),
  items: z.array(
    z.object({
      tempId: z.string(),
      itemType: z.enum(["material", "product"]),
      name: z.string(),
      sku: z.string().nullable(),
      unitRef: z.string(),
      sellable: z.boolean().nullable(),
      defaultSupplierRef: z.string().nullable(),
      purchaseUnitRef: z.string().nullable(),
      purchaseToStockFactor: z.string().nullable(),
      defaultPurchasePrice: z.string().nullable(),
      defaultSellingPrice: z.string().nullable(),
      lotTrackingMode: z.enum(["tracked", "untracked"]).nullable(),
      provenance: z.array(modelProvenanceSchema),
      confidence: z.number(),
    }),
  ),
  openingStock: z.array(
    z.object({
      itemRef: z.string(),
      quantity: z.string(),
      unitCost: z.string().nullable(),
      lotNumber: z.string().nullable(),
      receivedAt: z.string().nullable(),
      provenance: z.array(modelProvenanceSchema),
      confidence: z.number(),
    }),
  ),
  boms: z.array(
    z.object({
      productRef: z.string(),
      outputQuantity: z.string(),
      outputUnitRef: z.string(),
      components: z.array(
        z.object({
          itemRef: z.string(),
          quantity: z.string(),
          unitRef: z.string().nullable(),
          basis: z.enum(["per_unit", "per_batch"]),
        }),
      ),
      provenance: z.array(modelProvenanceSchema),
      confidence: z.number(),
    }),
  ),
  unresolvedQuestions: z.array(
    z.object({
      id: z.string(),
      entityRef: z.string().nullable(),
      question: z.string(),
      options: z.array(z.string()),
      severity: z.enum(["warning", "blocking"]),
    }),
  ),
});

function optional<T>(value: T | null): T | undefined {
  return value == null ? undefined : value;
}

function numericOrNull(value: string | null) {
  if (value == null) return null;
  const trimmed = value.trim();
  return /^\d+(\.\d+)?$/.test(trimmed) ? trimmed : null;
}

function unitSize(value: string) {
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  return trimmed.match(/\d+(\.\d+)?/)?.[0] ?? "1";
}

function cleanProvenance(
  provenance: z.infer<typeof modelProvenanceSchema>[],
) {
  return provenance.map((entry) => ({
    fileId: entry.fileId,
    location: optional(entry.location),
    sheet: optional(entry.sheet),
    row: optional(entry.row),
    page: optional(entry.page),
  }));
}

function toPartialImportPackage(
  parsed: z.infer<typeof modelPackageSchema>,
): PartialImportPackage {
  return partialImportPackageSchema.parse({
    version: parsed.version,
    openingStockAsOf: optional(parsed.openingStockAsOf),
    units: parsed.units.map((unit) => ({
      ...unit,
      size: unitSize(unit.size),
    })),
    suppliers: parsed.suppliers.map((supplier) => ({
      ...supplier,
      code: optional(supplier.code),
      contactName: optional(supplier.contactName),
      email: optional(supplier.email),
      phone: optional(supplier.phone),
      provenance: cleanProvenance(supplier.provenance),
    })),
    customers: parsed.customers.map((customer) => ({
      ...customer,
      email: optional(customer.email),
      phone: optional(customer.phone),
      provenance: cleanProvenance(customer.provenance),
    })),
    items: parsed.items.map((item) => ({
      ...item,
      sellable: optional(item.sellable),
      sku: optional(item.sku),
      defaultSupplierRef: optional(item.defaultSupplierRef),
      purchaseUnitRef: optional(item.purchaseUnitRef),
      purchaseToStockFactor: optional(item.purchaseToStockFactor),
      defaultPurchasePrice: optional(item.defaultPurchasePrice),
      defaultSellingPrice: optional(item.defaultSellingPrice),
      lotTrackingMode: optional(item.lotTrackingMode),
      provenance: cleanProvenance(item.provenance),
    })),
    openingStock: parsed.openingStock.map((stock) => ({
      ...stock,
      unitCost: numericOrNull(stock.unitCost),
      lotNumber: optional(stock.lotNumber),
      receivedAt: optional(stock.receivedAt),
      provenance: cleanProvenance(stock.provenance),
    })),
    boms: parsed.boms.map((bom) => ({
      ...bom,
      components: bom.components.map((component) => ({
        ...component,
        unitRef: optional(component.unitRef),
      })),
      provenance: cleanProvenance(bom.provenance),
    })),
    unresolvedQuestions: parsed.unresolvedQuestions.map((question) => ({
      ...question,
      entityRef: optional(question.entityRef),
    })),
  });
}

export async function extractImportPackage(
  file: ImportExtractionFile,
): Promise<PartialImportPackage> {
  assertExtractorConfigured();

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.responses.parse({
    model: process.env.OPENAI_IMPORT_MODEL ?? "gpt-5.4-mini",
    input: [
      {
        role: "user",
        content: buildUserContent(file),
      },
    ],
    text: {
      format: zodTextFormat(modelPackageSchema, "onboarding_import_package"),
    },
  });

  if (!response.output_parsed) {
    throw new Error("Extractor did not return an import package.");
  }

  return toPartialImportPackage(response.output_parsed);
}
