import { z } from "zod";
import { defineAgentTask } from "@/lib/agent/core";
import { getUomOptions } from "@/lib/units-of-measure";
import {
  buildOnboardingImportDocumentTools,
  type OnboardingImportAgentFile,
} from "./agent-tools";

export type OnboardingImportPromptFile = {
  id: string;
  filename: string;
};

export const allowedImportUoms = getUomOptions().flatMap((group) =>
  group.options.map((option) => option.value),
);
export const allowedImportUomSet = new Set(allowedImportUoms);

export const onboardingImportContractText = [
  "Import contract:",
  "- units create inventory.unit_definitions: name is the business package/display name; size is numeric; uom is the measurable base unit.",
  `- unit.uom must be one of: ${allowedImportUoms.join(", ")}.`,
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

export function buildOnboardingImportPrompt(file: OnboardingImportPromptFile) {
  return (
    "Extract ERP onboarding data from this file into the requested JSON schema. " +
    "This is an import compiler, not an autonomous database agent. Do not invent missing values. " +
    "Use unresolvedQuestions for ambiguity. Use temp IDs for cross references. " +
    `Use fileId \"${file.id}\" in every provenance entry. Include provenance/confidence on records. ` +
    "For customer-facing price lists, map MSRP/default customer prices to defaultSellingPrice and leave defaultPurchasePrice null unless the sheet explicitly identifies vendor cost, landed cost, or purchase cost. " +
    "For spreadsheets, treat Inventory signal index entries as high-priority opening-stock candidates when they identify an item, package/unit, and count. " +
    "Prefer generic manufacturing ERP concepts: " +
    "units, suppliers, customers, materials, products, opening stock, and BOMs.\n\n" +
    onboardingImportContractText
  );
}

export const onboardingModelProvenanceSchema = z.object({
  fileId: z.string(),
  location: z.string().nullable(),
  sheet: z.string().nullable(),
  row: z.string().nullable(),
  page: z.string().nullable(),
});

export const onboardingModelPackageSchema = z.object({
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
      provenance: z.array(onboardingModelProvenanceSchema),
      confidence: z.number(),
    }),
  ),
  customers: z.array(
    z.object({
      tempId: z.string(),
      name: z.string(),
      email: z.string().nullable(),
      phone: z.string().nullable(),
      provenance: z.array(onboardingModelProvenanceSchema),
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
      provenance: z.array(onboardingModelProvenanceSchema),
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
      provenance: z.array(onboardingModelProvenanceSchema),
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
      provenance: z.array(onboardingModelProvenanceSchema),
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

export const onboardingImportAgentTask = defineAgentTask({
  id: "onboarding.import.extract",
  purpose: "Extract reviewable ERP import data from onboarding documents.",
  promptSections: [
    {
      id: "onboarding-import-contract",
      tier: "task",
      text: onboardingImportContractText,
    },
  ],
  tools: [],
});

export function createOnboardingImportAgentTask(files: OnboardingImportAgentFile[]) {
  return defineAgentTask({
    id: "onboarding.import.extract",
    purpose: "Extract reviewable ERP import data from onboarding documents.",
    promptSections: [
      {
        id: "onboarding-import-contract",
        tier: "task",
        text: onboardingImportContractText,
      },
      {
        id: "onboarding-import-correction",
        tier: "task",
        text: "When deterministic validation rejects your package, correct only the named issues and return the full corrected package. Preserve valid units, items, partners, BOMs, and openingStock rows; do not fix one issue by deleting unrelated valid records. Keep every item/unit/reference pair internally consistent. When current inventory signals exist, do not solve unit/name validation errors by deleting all openingStock; repair the unit definitions and keep reviewable openingStock rows with unitCost null when cost is missing. If a row is ambiguous, keep the best reviewable record and add an unresolvedQuestion rather than dropping the whole entity type.",
      },
    ],
    tools: buildOnboardingImportDocumentTools(files),
  });
}
