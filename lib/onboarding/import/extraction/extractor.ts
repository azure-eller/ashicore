import "server-only";

import OpenAI from "openai";
import type { ResponseInputContent } from "openai/resources/responses/responses";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { parse } from "csv-parse/sync";
import { partialImportPackageSchema, type PartialImportPackage } from "../types";
import { getUomOptions } from "@/lib/units-of-measure";
import { workbookCurrentInventoryHeaderCandidates, workbookRowText, workbookSheetRole, workbookToStructuredText } from "./workbook-reader";

export type ImportExtractionFile = {
  id: string;
  filename: string;
  contentType: string;
  bytes: Buffer;
};

export type ImportExtractionAttempt = {
  attempt: number;
  correctionErrors: string[];
  status: "invalid_response" | "schema_error" | "validation_error" | "accepted";
  parsedPackage: unknown;
  normalizedPackage?: PartialImportPackage;
  errors: string[];
};

export type ImportExtractionOptions = {
  onAttempt?: (attempt: ImportExtractionAttempt) => void | Promise<void>;
};

function textFromBytes(file: ImportExtractionFile) {
  if (
    file.contentType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    file.contentType === "application/vnd.ms-excel" ||
    /\.xlsx?$/i.test(file.filename)
  ) {
    return workbookToStructuredText(file.bytes);
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

const allowedUoms = getUomOptions().flatMap((group) => group.options.map((option) => option.value));
const allowedUomSet = new Set(allowedUoms);

const importContract = [
  "Import contract:",
  "- units create inventory.unit_definitions: name is the business package/display name; size is numeric; uom is the measurable base unit.",
  `- unit.uom must be one of: ${allowedUoms.join(", ")}.`,
  "- Do not use packaging words as uom. Bag, tote, pallet, yard, super sack, roll, case, drum, and similar labels belong in unit.name. If the base measure or size is not explicit, add a blocking unresolvedQuestion instead of guessing.",
  "- For structured rows with explicit unit_name, unit_size/size, and uom/base unit fields, create the unit directly and do not ask a confirmation question just because the display name is packaging-like.",
  "- Common spreadsheet shorthand: 1cfb/2cfb/3.5cfb means 1/2/3.5 cubic-foot bag (uom cu ft, name includes bag); cy/cyd/cyt/cy tote means cubic-yard tote (uom cu yd, name includes tote). These shorthand mappings are explicit import rules; do not ask an unresolvedQuestion just to confirm them.",
  "- Never create generic units named only bag, tote, pallet, or numbered pallet labels such as 1 pallet/26 pallets from order text. Create dimensional units such as 2cfb bag or 1 cu yd tote when the size is explicit; otherwise leave the order-only packaging detail out.",
  "- Count-prefixed order packaging such as 50ea 2cfb, 30ea 2cfb, or 3ea cyt is not the stock unit. Drop the count prefix and use the underlying dimensional unit: 2cfb bag is size 2 uom cu ft; cyt/cyd/cy tote is size 1 uom cu yd.",
  "- P/p/pallet counts are not UOMs; use them only when the comment gives an explicit conversion such as 3p=150.",
  "- Normalize obvious spelling variants to the canonical product name when the workbook contains the canonical spelling elsewhere, for example Lawngevity rather than Lawnggevity.",
  "- In workbooks, prefer full product names from visible current inventory headers over abbreviations from hidden/order-breakdown sheets. For example, if the visible current sheet says RAISED BED MIX, do not import only RBM.",
  "- suppliers create purchasing.suppliers: name, code, contactName, email, phone.",
  "- customers create sales.customers: name, email, phone. In order/work-order spreadsheets, treat distinct external account names in customer/order-name columns as customer candidates even when the sheet also contains transactional order details. Names from POC/phone/contact columns are contactName details for the account on that row, not customer names. Phone fields must contain phone numbers only; addresses, cities, names, and delivery notes should not be placed in phone. Import the customer master data only; do not invent sales orders. Do not treat spreadsheet comment authors, assignees, or internal staff email addresses as customers.",
  "- items create inventory.items: itemType, name, sku, stock unit, optional purchase unit/factor, default prices, sellable, lotTrackingMode.",
  "- openingStock creates opening_balance inventory events: itemRef, quantity, unitCost, lotNumber, receivedAt. Use current inventory/current orders sheets and current inventory comments; do not create opening stock from archive sheets, historical order rows, future advanced orders, BOM component quantities, or recipe quantities unless no current inventory sheet exists. Current inventory comments with quantities like yards, cy, cyt, available, aged, fresh, or explicit p=count conversions are sufficient to create reviewable stock rows. For CSV/table rows, create opening stock only when an inventory quantity/on-hand/opening-stock field is explicitly populated for that row. If a real count is present but cost is missing, include the stock row with unitCost null; deterministic validation will request cost before approval.",
  "- In current inventory/on-hand rows, a unit price/cost beside a stock quantity is openingStock.unitCost. Do not ask whether it is defaultPurchasePrice/defaultSellingPrice unless the source explicitly labels it vendor cost, landed cost, MSRP, list price, or selling price.",
  "- boms create inventory.bom_revisions/components: productRef, outputQuantity, outputUnitRef, components with itemRef and quantity. Only output a BOM when every component item exists in items and component unitRef matches that component item's stock unit. Do not output an empty or partially inferred BOM; use an unresolvedQuestion when recipe/component data is incomplete.",
  "- For structured BOM rows with product name, component name, component quantity, and component unit/package label, create the BOM. If component_unit is a packaging label that matches the component item's explicit package unit (for example Potting Soil has a 40 lb bag stock unit and BOM says 0.25 bag), use the component item's stock unitRef and do not ask a conversion question.",
].join("\n");

function basePrompt(file: ImportExtractionFile) {
  return (
    "Extract ERP onboarding data from this file into the requested JSON schema. " +
    "This is an import compiler, not an autonomous database agent. Do not invent missing values. " +
    "Use unresolvedQuestions for ambiguity. Use temp IDs for cross references. " +
    `Use fileId \"${file.id}\" in every provenance entry. Include provenance/confidence on records. ` +
    "For customer-facing price lists, map MSRP/default customer prices to defaultSellingPrice and leave defaultPurchasePrice null unless the sheet explicitly identifies vendor cost, landed cost, or purchase cost. " +
    "For spreadsheets, treat Inventory signal index entries as high-priority opening-stock candidates when they identify an item, package/unit, and count. " +
    "Prefer generic manufacturing ERP concepts: " +
    "units, suppliers, customers, materials, products, opening stock, and BOMs.\n\n" +
    importContract
  );
}

function buildUserContent(
  file: ImportExtractionFile,
  correctionErrors: string[] = [],
  previousPackage: unknown = null,
): ResponseInputContent[] {
  const previousPackageText =
    previousPackage == null
      ? ""
      : `\n\nPrevious invalid package JSON. Repair this package instead of starting over; preserve valid records and references unless a validation error names them:\n${JSON.stringify(previousPackage, null, 2)}`;
  const prompt =
    correctionErrors.length > 0
      ? `${basePrompt(file)}\n\nYour previous extraction failed deterministic validation. Correct only these issues and return the full corrected package. Preserve valid units, items, partners, BOMs, and openingStock rows; do not fix one issue by deleting unrelated valid records. Keep every item/unit/reference pair internally consistent. When current inventory signals exist, do not solve unit/name validation errors by deleting all openingStock; repair the unit definitions and keep reviewable openingStock rows with unitCost null when cost is missing. If a row is ambiguous, keep the best reviewable record and add an unresolvedQuestion rather than dropping the whole entity type:\n${correctionErrors.map((error) => `- ${error}`).join("\n")}${previousPackageText}`
      : basePrompt(file);

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

function businessDateOrUndefined(value: string | null) {
  if (value == null) return undefined;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : undefined;
}

function isPositiveNumeric(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function isPhoneLike(value: string | null | undefined) {
  if (!value) return true;
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15 && /^[+\d\s().\-xext]+$/i.test(trimmed);
}

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
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

function isGenericPackagingUnitName(name: string) {
  return (
    /^\d+(?:\.\d+)?\s+pallets?$/i.test(name) ||
    /^(?:bags?|totes?|pallets?|yards?|cfb|cyt|cyd|cy)$/i.test(name.trim())
  );
}

function isCountPrefixedDimensionalUnit(unit: { name: string; uom: string }) {
  return /^\d+(?:\.\d+)?\s*ea\b/i.test(unit.name) && /\b(?:cfb|cf|cyt|cyd|cy)\b/i.test(unit.name);
}

function normalizedUnitName(unit: { name: string; size: string; uom: string }) {
  const name = unit.name.trim();
  const size = unitSize(unit.size);
  const uom = unit.uom.trim();
  if (/^bags?$/i.test(name) && !["ea", "pcs"].includes(uom)) {
    return `${size} ${uom} bag`;
  }
  if (/^totes?$/i.test(name) && uom === "cu yd") {
    return `${size} cu yd tote`;
  }
  if (/^yards?$/i.test(name) && uom === "cu yd") {
    return `${size} cu yd`;
  }
  return name;
}

function normalizedItemName(name: string) {
  const trimmed = name.trim();
  if (/^law(?:n)?g{1,2}evity$/i.test(trimmed)) {
    return "Lawngevity";
  }
  return trimmed;
}

function toPartialImportPackage(
  parsed: z.infer<typeof modelPackageSchema>,
): PartialImportPackage {
  const referencedUnitRefs = new Set<string>();
  for (const item of parsed.items) {
    referencedUnitRefs.add(item.unitRef);
    if (item.purchaseUnitRef) referencedUnitRefs.add(item.purchaseUnitRef);
  }
  for (const bom of parsed.boms) {
    referencedUnitRefs.add(bom.outputUnitRef);
    for (const component of bom.components) {
      if (component.unitRef) referencedUnitRefs.add(component.unitRef);
    }
  }

  return partialImportPackageSchema.parse({
    version: parsed.version,
    openingStockAsOf: businessDateOrUndefined(parsed.openingStockAsOf),
    units: parsed.units
      .filter((unit) => referencedUnitRefs.has(unit.tempId) || !isGenericPackagingUnitName(unit.name))
      .map((unit) => ({
        ...unit,
        name: normalizedUnitName(unit),
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
      name: normalizedItemName(item.name),
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

function hasCurrentInventorySignal(file: ImportExtractionFile) {
  if (!isWorkbookFile(file)) {
    const text = file.bytes.toString("utf8");
    return (
      /\b(quantity|qty|on hand|opening stock|stock|inventory)\b/i.test(text) &&
      /\b(unit_cost|unit cost|cost)\b/i.test(text) &&
      /(?:^|,|\n)\s*\d+(?:\.\d+)?\s*(?:,|\n|$)/.test(text)
    );
  }

  const text = workbookToStructuredText(file.bytes, {
    maxRowsPerSheet: 40,
    maxCellsPerSheet: 200,
    maxCommentCellsPerSheet: 20,
    maxInventorySignalsPerSheet: 20,
  });
  return (
    text.includes("Sheet role: current_candidate") &&
    text.includes("Inventory signal index:") &&
    /\b(available as stock|current inventory|aged|fresh|p\s*=|yards?)\b/i.test(text)
  );
}

function sourceSignalText(file: ImportExtractionFile) {
  if (isWorkbookFile(file)) {
    return workbookToStructuredText(file.bytes, {
      maxRowsPerSheet: 80,
      maxCellsPerSheet: 500,
      maxCommentCellsPerSheet: 40,
      maxInventorySignalsPerSheet: 40,
    });
  }
  if (file.contentType === "application/pdf" || file.contentType.startsWith("image/")) {
    return "";
  }
  return file.bytes.toString("utf8");
}

function workbookCurrentItemCandidates(file: ImportExtractionFile) {
  if (!isWorkbookFile(file)) return [];
  return workbookCurrentInventoryHeaderCandidates(file.bytes);
}

function hasBomSignal(file: ImportExtractionFile) {
  if (isWorkbookFile(file) || file.contentType === "application/pdf" || file.contentType.startsWith("image/")) {
    return false;
  }
  const text = file.bytes.toString("utf8");
  return /\bbom\b/i.test(text) && /\bcomponent\b/i.test(text) && /\bcomponent_?qty\b/i.test(text);
}

function explicitCsvStockItemNames(file: ImportExtractionFile) {
  if (!/\.csv$/i.test(file.filename) && file.contentType !== "text/csv") return null;
  try {
    const rows = parse(file.bytes.toString("utf8"), {
      columns: true,
      relax_column_count: true,
      skip_empty_lines: true,
      trim: true,
    }) as Array<Record<string, string | undefined>>;
    const expected = new Set<string>();
    const forbidden = new Set<string>();
    for (const row of rows) {
      if ((row.section ?? "").toLowerCase() !== "item") continue;
      const name = row.name?.trim();
      if (!name) continue;
      const quantity = Number(row.quantity);
      if (Number.isFinite(quantity) && quantity > 0) {
        expected.add(name.toLowerCase());
      } else {
        forbidden.add(name.toLowerCase());
      }
    }
    return { expected, forbidden };
  } catch {
    return null;
  }
}

function explicitCsvStockRows(file: ImportExtractionFile) {
  if (!/\.csv$/i.test(file.filename) && file.contentType !== "text/csv") return null;
  try {
    const rows = parse(file.bytes.toString("utf8"), {
      columns: true,
      relax_column_count: true,
      skip_empty_lines: true,
      trim: true,
    }) as Array<Record<string, string | undefined>>;
    return rows
      .map((row, index) => {
        if ((row.section ?? "").toLowerCase() !== "item") return null;
        const name = row.name?.trim();
        const quantity = Number(row.quantity);
        if (!name || !Number.isFinite(quantity) || quantity <= 0) return null;
        return {
          name,
          quantity: String(row.quantity).trim(),
          unitCost: row.unit_cost?.trim() || null,
          rowNumber: String(index + 2),
        };
      })
      .filter((row): row is { name: string; quantity: string; unitCost: string | null; rowNumber: string } => row != null);
  } catch {
    return null;
  }
}

function alignCsvOpeningStock(pkg: PartialImportPackage, file: ImportExtractionFile) {
  const stockRows = explicitCsvStockRows(file);
  if (!stockRows || stockRows.length === 0) return pkg;

  const itemByName = new Map(
    (pkg.items ?? []).map((item) => [item.name.trim().toLowerCase(), item]),
  );
  const openingStock = stockRows.flatMap((row) => {
    const item = itemByName.get(row.name.trim().toLowerCase());
    if (!item) return [];
    return [
      {
        itemRef: item.tempId,
        quantity: row.quantity,
        unitCost: row.unitCost,
        provenance: [
          {
            fileId: file.id,
            location: `section=item,name=${row.name},quantity=${row.quantity}`,
            row: row.rowNumber,
          },
        ],
        confidence: 1,
        review: { selected: true },
      },
    ];
  });

  if (openingStock.length === 0) return pkg;

  return {
    ...pkg,
    openingStock,
    unresolvedQuestions: (pkg.unresolvedQuestions ?? []).filter(
      (question) => !/\bquantity\b/i.test(question.question) || !/\brow\b/i.test(question.question) || !/\bopening stock\b/i.test(question.question),
    ),
  };
}

function isWorkbookFile(file: ImportExtractionFile) {
  return (
    file.contentType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    file.contentType === "application/vnd.ms-excel" ||
    /\.xlsx?$/i.test(file.filename)
  );
}

function missingOpeningStockCorrection(file: ImportExtractionFile) {
  if (isWorkbookFile(file)) {
    return "The workbook contains a current_candidate Inventory signal index with current inventory counts. Return reviewable openingStock rows from current sheets only, with unitCost null when cost is missing.";
  }
  return "The table contains explicit inventory quantity/on-hand/opening-stock fields. Return reviewable openingStock rows for rows with populated stock quantities, using unitCost when present and null when cost is missing.";
}

function hasCustomerOrderSignal(file: ImportExtractionFile) {
  if (isWorkbookFile(file)) {
    const text = workbookToStructuredText(file.bytes, {
      maxRowsPerSheet: 80,
      maxCellsPerSheet: 400,
      maxCommentCellsPerSheet: 10,
      maxInventorySignalsPerSheet: 10,
    });
    return (
      text.includes("Sheet role: current_candidate") &&
      /\b(customer|current orders|order date|invoice|ship|pickup|address|poc)\b/i.test(text)
    );
  }

  const text = file.bytes.toString("utf8");
  return /\b(customer|customer_name|account|ship_to|email)\b/i.test(text);
}

function validateExtractedPackage(pkg: PartialImportPackage, file: ImportExtractionFile) {
  const errors: string[] = [];
  const unitRefs = new Set((pkg.units ?? []).map((unit) => unit.tempId));
  const itemRefs = new Set((pkg.items ?? []).map((item) => item.tempId));
  const supplierRefs = new Set((pkg.suppliers ?? []).map((supplier) => supplier.tempId));
  const sourceText = sourceSignalText(file);
  const itemNameByRef = new Map((pkg.items ?? []).map((item) => [item.tempId, item.name.trim().toLowerCase()]));
  const itemNames = new Set((pkg.items ?? []).map((item) => item.name.trim().toLowerCase()));

  for (const unit of pkg.units ?? []) {
    const duplicateUnit = (pkg.units ?? []).find(
      (candidate) =>
        candidate.tempId !== unit.tempId &&
        candidate.name.trim().toLowerCase() === unit.name.trim().toLowerCase() &&
        candidate.size === unit.size &&
        candidate.uom === unit.uom,
    );
    if (duplicateUnit && unit.tempId < duplicateUnit.tempId) {
      errors.push(
        `Units "${unit.tempId}" and "${duplicateUnit.tempId}" are duplicate definitions for "${unit.name}" (${unit.size} ${unit.uom}). Keep one unit and update all item/BOM references to that single tempId.`,
      );
    }
    if (!allowedUomSet.has(unit.uom)) {
      errors.push(
        `Unit "${unit.name}" uses invalid uom "${unit.uom}". Use a supported base uom (${allowedUoms.join(", ")}), or add a blocking unresolvedQuestion if the source does not state a measurable base unit and size.`,
      );
    }
    if (isGenericPackagingUnitName(unit.name)) {
      errors.push(
        `Unit "${unit.name}" is generic packaging shorthand, not a stock unit definition. Remove it or replace it with a dimensional package unit such as 2cfb bag, 1cfb bag, or 1 cu yd tote when the source gives explicit size and base measure.`,
      );
    }
    if (isCountPrefixedDimensionalUnit(unit)) {
      errors.push(
        `Unit "${unit.name}" includes an order quantity/count prefix. Replace it with the underlying dimensional stock unit: 2cfb/2cf means size 2 uom cu ft, and cyt/cyd/cy tote means size 1 uom cu yd.`,
      );
    }
  }
  if (/\b(?:\d+(?:\.\d+)?\s*)?(?:cfb|cf)\b/i.test(sourceText) && !(pkg.units ?? []).some((unit) => unit.uom === "cu ft")) {
    errors.push(
      "The source contains cfb/cf cubic-foot package shorthand, but the package has no cu ft unit. Add dimensional units such as 1cfb bag or 2cfb bag instead of dropping cubic-foot evidence.",
    );
  }
  if (/\b(?:cyt|cyd|cy)\b/i.test(sourceText) && !(pkg.units ?? []).some((unit) => unit.uom === "cu yd")) {
    errors.push(
      "The source contains cy/cyd/cyt cubic-yard shorthand, but the package has no cu yd unit. Add a dimensional unit such as 1 cu yd tote instead of dropping cubic-yard evidence.",
    );
  }
  for (const candidate of workbookCurrentItemCandidates(file)) {
    if (!itemNames.has(candidate.name.trim().toLowerCase())) {
      errors.push(
        `Visible current inventory header "${candidate.name}" at ${candidate.sheet}!${candidate.cell} is missing from items. Add the full product name from the visible current sheet; do not replace it with hidden-sheet abbreviations.`,
      );
    }
  }
  for (const item of pkg.items ?? []) {
    if (/^law(?:n)?g{1,2}evity$/i.test(item.name) && item.name !== "Lawngevity") {
      errors.push(`Item "${item.tempId}" has misspelled name "${item.name}". Normalize it to "Lawngevity" when referring to that product.`);
    }
    if (!unitRefs.has(item.unitRef)) {
      errors.push(`Item "${item.tempId}" references missing unitRef "${item.unitRef}". Add the unit definition or change the item to an existing unitRef.`);
    }
    if (item.purchaseUnitRef && !unitRefs.has(item.purchaseUnitRef)) {
      errors.push(`Item "${item.tempId}" references missing purchaseUnitRef "${item.purchaseUnitRef}". Add the unit definition, change the reference, or omit purchaseUnitRef.`);
    }
    if (item.defaultSupplierRef && !supplierRefs.has(item.defaultSupplierRef)) {
      errors.push(`Item "${item.tempId}" references missing defaultSupplierRef "${item.defaultSupplierRef}". Add the supplier, change the reference, or omit defaultSupplierRef.`);
    }
  }
  for (const supplier of pkg.suppliers ?? []) {
    if (!isPhoneLike(supplier.phone)) {
      errors.push(
        `Supplier "${supplier.name}" has non-phone value "${supplier.phone}" in phone. Put only phone numbers in phone; leave phone blank if the source value is an address, name, or note.`,
      );
    }
  }
  for (const customer of pkg.customers ?? []) {
    const provenanceText = customer.provenance
      .map((entry) => [entry.location, entry.row, entry.sheet].filter(Boolean).join(" "))
      .join(" ");
    const commenterLike =
      /assigned|author/i.test(provenanceText) ||
      /@(?:[^,\s]+)?paonia(?:soilco)?/i.test([customer.email, provenanceText].filter(Boolean).join(" "));
    if (commenterLike) {
      errors.push(
        `Customer "${customer.name}" appears to come from spreadsheet authors/assignees or internal staff email context. Remove internal commenters from customers; customer records should come from customer/order-name cells or explicit external account rows.`,
      );
    }
    const fromContactColumn = isWorkbookFile(file) && customer.provenance.some((entry) => {
      const text = [entry.location, entry.row].filter(Boolean).join(" ");
      return (
        /\b(poc|contact)\b/i.test(text) ||
        (/\bphone\b/i.test(text) && !/\b(customer|account|order|name|ship[-_\s]?to)\b/i.test(text))
      );
    });
    if (fromContactColumn) {
      errors.push(
        `Customer "${customer.name}" appears to come from a POC/contact/phone column. Use the external account/customer name from the same row as customer.name and put POC details in contactName/phone when available.`,
      );
    }
    if (customer.email && /paonia.*soil|paoniasoilco/i.test(customer.email)) {
      errors.push(
        `Customer "${customer.name}" uses an internal Paonia email "${customer.email}". Do not create customers from internal staff/commenter emails; use external account rows instead.`,
      );
    }
    if (!isPhoneLike(customer.phone)) {
      errors.push(
        `Customer "${customer.name}" has non-phone value "${customer.phone}" in phone. Put only phone numbers in phone; leave phone blank if the source value is an address, name, or delivery note.`,
      );
    }
    if (isWorkbookFile(file) && customer.phone) {
      const phoneDigits = digitsOnly(customer.phone);
      const customerName = customer.name.trim().toLowerCase();
      for (const provenance of customer.provenance) {
        if (!provenance.sheet || !provenance.row) continue;
        const rowNumbers = String(provenance.row).match(/\d+/g) ?? [];
        for (const rowNumberText of rowNumbers) {
          const rowText = workbookRowText(file.bytes, provenance.sheet, Number(rowNumberText));
          if (!rowText || !digitsOnly(rowText).includes(phoneDigits)) continue;
          if (!rowText.toLowerCase().includes(customerName)) {
            errors.push(
              `Customer "${customer.name}" phone "${customer.phone}" appears on ${provenance.sheet} row ${rowNumberText}, but that row does not contain the customer name. Do not borrow phone numbers from other customer rows; leave phone blank unless the phone is on the same customer row or an explicit customer master row.`,
            );
          }
        }
      }
    }
  }
  const stockItemRefs = new Set<string>();
  for (const stock of pkg.openingStock ?? []) {
    if (stockItemRefs.has(stock.itemRef)) {
      errors.push(
        `Opening stock contains duplicate rows for itemRef "${stock.itemRef}". Return at most one openingStock row per item unless the source explicitly gives distinct lot numbers; otherwise choose the clearest current-sheet count and put ambiguity in unresolvedQuestions.`,
      );
    }
    stockItemRefs.add(stock.itemRef);
    if (!itemRefs.has(stock.itemRef)) {
      errors.push(`Opening stock references missing itemRef "${stock.itemRef}". Add the item or remove the stock row.`);
    }
    if (!isPositiveNumeric(stock.quantity)) {
      errors.push(
        `Opening stock for "${stock.itemRef}" has nonpositive quantity "${stock.quantity}". Replace it with a positive current-sheet count, or remove the row and add an unresolvedQuestion if no positive count is explicit.`,
      );
    }
    for (const provenance of stock.provenance) {
      if (!provenance.sheet) continue;
      const role = workbookSheetRole(provenance.sheet);
      if (isWorkbookFile(file) && role !== "current_candidate") {
        errors.push(
          `Opening stock for "${stock.itemRef}" uses non-current sheet "${provenance.sheet}" (${role}). Remove this openingStock row and, when current_candidate inventory signals are present, replace it with current-sheet openingStock rows instead of dropping openingStock entirely.`,
        );
      }
    }
  }
  for (const bom of pkg.boms ?? []) {
    if (!itemRefs.has(bom.productRef)) {
      errors.push(`BOM references missing productRef "${bom.productRef}". Add the product item or remove the BOM.`);
    }
    if (!unitRefs.has(bom.outputUnitRef)) {
      errors.push(`BOM for "${bom.productRef}" references missing outputUnitRef "${bom.outputUnitRef}". Add the unit definition or remove the BOM.`);
    }
    for (const component of bom.components) {
      if (!itemRefs.has(component.itemRef)) {
        errors.push(`BOM for "${bom.productRef}" references missing component itemRef "${component.itemRef}". Add the component item or remove the BOM.`);
      }
      if (component.unitRef && !unitRefs.has(component.unitRef)) {
        errors.push(`BOM for "${bom.productRef}" references missing component unitRef "${component.unitRef}". Add the unit definition or omit component.unitRef.`);
      }
    }
  }
  if ((pkg.openingStock?.length ?? 0) === 0 && hasCurrentInventorySignal(file)) {
    errors.push(missingOpeningStockCorrection(file));
  }
  const csvStockNames = explicitCsvStockItemNames(file);
  if (csvStockNames) {
    const stockNames = new Set((pkg.openingStock ?? []).map((stock) => itemNameByRef.get(stock.itemRef)).filter((name): name is string => Boolean(name)));
    for (const expectedName of csvStockNames.expected) {
      if (!stockNames.has(expectedName)) {
        errors.push(
          `CSV row for item "${expectedName}" has an explicit positive quantity. Return an openingStock row for that item; do not substitute another item row.`,
        );
      }
    }
    for (const forbiddenName of csvStockNames.forbidden) {
      if (stockNames.has(forbiddenName)) {
        errors.push(
          `CSV row for item "${forbiddenName}" does not have an explicit positive quantity. Remove openingStock for that item.`,
        );
      }
    }
  }
  if ((pkg.customers?.length ?? 0) === 0 && hasCustomerOrderSignal(file)) {
    errors.push(
      "The source contains customer/order/account signals. Return customer master records for clearly named external accounts, with provenance and confidence; do not create transactional sales orders.",
    );
  }
  if ((pkg.boms?.length ?? 0) === 0 && hasBomSignal(file)) {
    errors.push(
      "The source contains explicit structured BOM rows with component quantities. Return a BOM instead of converting explicit component rows into unresolvedQuestions; use each component item's stock unitRef when the component_unit label refers to that item's explicit package unit.",
    );
  }
  for (const question of pkg.unresolvedQuestions ?? []) {
    if (/lawnggevity/i.test(question.question)) {
      errors.push(
        `Unresolved question "${question.id}" contains misspelled "Lawnggevity". Normalize it to "Lawngevity" or remove the question if it only asks about obvious spelling variants.`,
      );
    }
    if (/\bconfirm\b/i.test(question.question) && /\b(?:unit_name|package unit|intended package)\b/i.test(question.question)) {
      errors.push(
        `Unresolved question "${question.id}" asks for confirmation of an explicit package unit. If the source row has unit_name plus size and supported uom/base unit, create the unit directly and remove this question.`,
      );
    }
    if (/\b(?:unit size|package\/display unit|stock\/base unit|unit definition)\b/i.test(question.question) && /\b(?:40 lb bag|40 lb|package)\b/i.test(question.question)) {
      errors.push(
        `Unresolved question "${question.id}" asks for confirmation of an explicit size/uom package unit. If the source row has size and supported uom/base unit, create the unit directly and remove this question.`,
      );
    }
    if (/\bunit[_\s-]?cost\b/i.test(sourceText) && /\bunit cost\b/i.test(question.question) && /\b(?:selling price|msrp|defaultpurchaseprice|default purchase price)\b/i.test(question.question)) {
      errors.push(
        `Unresolved question "${question.id}" asks whether an explicit unit_cost value is cost or selling price. The source has a unit_cost field, so use it as cost/unitCost and remove this question.`,
      );
    }
    if (/\bunit price\b/i.test(question.question) && /\bdefaultPurchasePrice\b/i.test(question.question) && /\bdefaultSellingPrice\b/i.test(question.question) && /\bunitCost\b/i.test(question.question)) {
      errors.push(
        `Unresolved question "${question.id}" asks how to classify a current inventory unit price. When the price is beside an inventory quantity/on-hand row, use openingStock.unitCost and remove this question unless the source explicitly labels the price as selling/list/vendor cost.`,
      );
    }
    if (/\bbom\b/i.test(question.question) && /\bcomponent\b/i.test(question.question) && /\b(?:stock unit|conversion|unitRef)\b/i.test(question.question)) {
      errors.push(
        `Unresolved question "${question.id}" asks for clarification of explicit BOM component units. If the component_unit label matches the component item's explicit package unit, create the BOM using that component item stock unitRef and remove this question.`,
      );
    }
    if (/\b(?:cyt|cyd|cy)\b/i.test(question.question) && /\bbase measure|canonical unit|what is\b/i.test(question.question)) {
      errors.push(
        `Unresolved question "${question.id}" asks about cy/cyd/cyt shorthand, but the import contract defines it as cubic-yard tote (uom cu yd). Remove that question and use a cu yd unit when the source says cy/cyd/cyt.`,
      );
    }
    if (question.severity === "blocking" && /\b(?:cyt|cyd|cy)\b/i.test(question.question) && /\b(?:2cfb|cfb|2cf)\b/i.test(question.question) && /\b(?:stock unit|separate variants|required)\b/i.test(question.question)) {
      errors.push(
        `Unresolved question "${question.id}" asks whether mixed cy/cyt and cfb order contexts require separate variants. Do not ask that as a blocking question during extraction; create reviewable dimensional units and choose the stock unit supported by the opening-stock evidence, leaving order-only packaging out.`,
      );
    }
  }
  return errors;
}

function zodIssuesToCorrectionErrors(error: z.ZodError) {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "package";
    return `${path}: ${issue.message}`;
  });
}

export async function extractImportPackage(
  file: ImportExtractionFile,
  options: ImportExtractionOptions = {},
): Promise<PartialImportPackage> {
  assertExtractorConfigured();

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  let correctionErrors: string[] = [];
  let previousPackage: unknown = null;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await client.responses.parse({
      model: process.env.OPENAI_IMPORT_MODEL ?? "gpt-5.4-mini",
      input: [
        {
          role: "user",
          content: buildUserContent(file, correctionErrors, previousPackage),
        },
      ],
      text: {
        format: zodTextFormat(modelPackageSchema, "onboarding_import_package"),
      },
    });

    if (!response.output_parsed) {
      correctionErrors = ["Return a complete import package matching the requested schema."];
      await options.onAttempt?.({
        attempt: attempt + 1,
        correctionErrors,
        status: "invalid_response",
        parsedPackage: null,
        errors: correctionErrors,
      });
      continue;
    }

    previousPackage = response.output_parsed;

    let extracted: PartialImportPackage;
    try {
      extracted = alignCsvOpeningStock(toPartialImportPackage(response.output_parsed), file);
    } catch (error) {
      if (error instanceof z.ZodError) {
        correctionErrors = zodIssuesToCorrectionErrors(error);
        await options.onAttempt?.({
          attempt: attempt + 1,
          correctionErrors,
          status: "schema_error",
          parsedPackage: response.output_parsed,
          errors: correctionErrors,
        });
        continue;
      }
      throw error;
    }

    correctionErrors = validateExtractedPackage(extracted, file);
    if (correctionErrors.length === 0) {
      await options.onAttempt?.({
        attempt: attempt + 1,
        correctionErrors: [],
        status: "accepted",
        parsedPackage: response.output_parsed,
        normalizedPackage: extracted,
        errors: [],
      });
      return extracted;
    }
    await options.onAttempt?.({
      attempt: attempt + 1,
      correctionErrors,
      status: "validation_error",
      parsedPackage: response.output_parsed,
      normalizedPackage: extracted,
      errors: correctionErrors,
    });
  }

  throw new Error(`Extractor returned invalid import data: ${correctionErrors.join(" ")}`);
}
