import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { loadWorktreeEnv } from "./load-worktree-env";
import type { ImportExtractionFile } from "@/lib/onboarding/import/extraction/extractor";
import { workbookToStructuredText } from "@/lib/onboarding/import/extraction/workbook-reader";
import {
  importPackageSchema,
  type ImportPackage,
  type PartialImportPackage,
  type PreviewReport,
} from "@/lib/onboarding/import/types";

type Expectations = {
  description?: string;
  minItems?: number;
  minCustomers?: number;
  minSuppliers?: number;
  minOpeningStock?: number;
  minPositiveOpeningStock?: number;
  maxOpeningStock?: number;
  minBoms?: number;
  requiredItemNames?: string[];
  requiredCustomerNames?: string[];
  requiredSupplierNames?: string[];
  forbiddenCustomerPhoneMatches?: string[];
  forbiddenCustomerPhoneByName?: Record<string, string[]>;
  forbiddenSupplierPhoneMatches?: string[];
  requiredOpeningStockItemNames?: string[];
  forbiddenOpeningStockItemNames?: string[];
  requiredOpeningStockItemUnitUoms?: Record<string, string[]>;
  forbiddenCustomerEmailMatches?: string[];
  maxBlockingIssues?: number;
  forbiddenUoms?: string[];
  forbiddenUnitNameMatches?: string[];
  requiredUoms?: string[];
  requiredUomAnyOf?: string[][];
  requiredTextMatches?: string[];
  forbiddenTextMatches?: string[];
  forbiddenQuestionMatches?: string[];
  forbiddenBlockingQuestionMatches?: string[];
  openingStockAllowedSheetMatches?: string[];
  openingStockForbiddenSheetMatches?: string[];
  forbidDuplicateOpeningStockItemRefs?: boolean;
  forbidDuplicateUnitDefinitions?: boolean;
  requireProvenance?: boolean;
  maxMissingReferenceIssues?: number;
};

type EvalFailure = {
  check: string;
  message: string;
};

function usage() {
  return [
    "Usage: pnpm eval:onboarding-import -- <file> [--expect <expect.json>] [--org <slug>] [--out <dir>] [--reader-only]",
    "",
    "Examples:",
    "  pnpm eval:onboarding-import -- ~/Downloads/paonia-sheets/Working\\ Orders_Expanded.xlsx --expect test/scenarios/onboarding-import-eval/working-orders-expanded.expect.json",
  ].join("\n");
}

function parseArgs(argv: string[]) {
  const args = {
    file: "",
    expectPath: "",
    orgSlug: "test-paonia-soil-co",
    outDir: ".tmp/onboarding-import-eval",
    readerOnly: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    } else if (arg === "--expect") {
      args.expectPath = argv[++index] ?? "";
    } else if (arg === "--org") {
      args.orgSlug = argv[++index] ?? "";
    } else if (arg === "--out") {
      args.outDir = argv[++index] ?? "";
    } else if (arg === "--reader-only") {
      args.readerOnly = true;
    } else if (!args.file) {
      args.file = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.file) throw new Error(usage());
  return args;
}

function contentTypeFor(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".xlsx") {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (ext === ".xls") return "application/vnd.ms-excel";
  if (ext === ".csv") return "text/csv";
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return "application/octet-stream";
}

function toImportPackage(partial: PartialImportPackage): ImportPackage {
  return importPackageSchema.parse({
    version: "1",
    openingStockAsOf: partial.openingStockAsOf ?? new Date().toISOString().slice(0, 10),
    units: partial.units ?? [],
    suppliers: partial.suppliers ?? [],
    customers: partial.customers ?? [],
    items: partial.items ?? [],
    openingStock: partial.openingStock ?? [],
    boms: partial.boms ?? [],
    unresolvedQuestions: partial.unresolvedQuestions ?? [],
  });
}

async function resolveOrgId(
  db: typeof import("@/lib/db").db,
  organization: typeof import("@/lib/db/schema").organization,
  slug: string,
) {
  const [row] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(and(eq(organization.slug, slug)));
  if (!row) throw new Error(`Organization not found: ${slug}`);
  return row.id;
}

function readExpectations(expectPath: string): Expectations | null {
  if (!expectPath) return null;
  return JSON.parse(fs.readFileSync(path.resolve(expectPath), "utf8")) as Expectations;
}

function packageText(pkg: ImportPackage) {
  return JSON.stringify(pkg).toLowerCase();
}

function matchesAny(value: string, patterns: string[]) {
  return patterns.some((pattern) => new RegExp(pattern, "i").test(value));
}

function provenanceSheets(record: { provenance: Array<{ sheet?: string }> }) {
  return record.provenance.map((entry) => entry.sheet).filter((sheet): sheet is string => Boolean(sheet));
}

function isPositiveNumeric(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function unitDefinitionKey(unit: { name: string; size: string; uom: string }) {
  return `${unit.name.trim().toLowerCase()}|${unit.size}|${unit.uom}`;
}

function hasNameMatch(records: Array<{ name: string }>, expectedName: string) {
  const expected = expectedName.trim().toLowerCase();
  return records.some((record) => record.name.trim().toLowerCase() === expected);
}

function hasUsableProvenance(record: { provenance: Array<{ location?: string; sheet?: string; row?: string | number; page?: string | number }> }) {
  return record.provenance.some((entry) =>
    Boolean(entry.location || entry.sheet || entry.row != null || entry.page != null),
  );
}

function hasUsableConfidence(record: { confidence: number }) {
  return Number.isFinite(record.confidence) && record.confidence >= 0 && record.confidence <= 1;
}

function recordLabel(kind: string, record: { name?: string; tempId?: string; itemRef?: string; productRef?: string }) {
  return `${kind} ${record.name ?? record.tempId ?? record.itemRef ?? record.productRef ?? "record"}`;
}

function scorePackage(
  pkg: ImportPackage,
  preview: PreviewReport,
  expectations: Expectations | null,
) {
  const failures: EvalFailure[] = [];
  if (!expectations) return failures;

  if (expectations.minItems != null && pkg.items.length < expectations.minItems) {
    failures.push({
      check: "minItems",
      message: `Expected at least ${expectations.minItems} items, got ${pkg.items.length}.`,
    });
  }

  if (expectations.minCustomers != null && pkg.customers.length < expectations.minCustomers) {
    failures.push({
      check: "minCustomers",
      message: `Expected at least ${expectations.minCustomers} customers, got ${pkg.customers.length}.`,
    });
  }

  if (expectations.minSuppliers != null && pkg.suppliers.length < expectations.minSuppliers) {
    failures.push({
      check: "minSuppliers",
      message: `Expected at least ${expectations.minSuppliers} suppliers, got ${pkg.suppliers.length}.`,
    });
  }

  for (const name of expectations.requiredItemNames ?? []) {
    if (!hasNameMatch(pkg.items, name)) {
      failures.push({
        check: "requiredItemNames",
        message: `Expected item named "${name}".`,
      });
    }
  }

  for (const name of expectations.requiredCustomerNames ?? []) {
    if (!hasNameMatch(pkg.customers, name)) {
      failures.push({
        check: "requiredCustomerNames",
        message: `Expected customer named "${name}".`,
      });
    }
  }

  for (const pattern of expectations.forbiddenCustomerEmailMatches ?? []) {
    const regex = new RegExp(pattern, "i");
    for (const customer of pkg.customers) {
      if (customer.email && regex.test(customer.email)) {
        failures.push({
          check: "forbiddenCustomerEmailMatches",
          message: `Customer ${customer.name} email ${customer.email} matched forbidden pattern ${pattern}.`,
        });
      }
    }
  }

  for (const pattern of expectations.forbiddenCustomerPhoneMatches ?? []) {
    const regex = new RegExp(pattern, "i");
    for (const customer of pkg.customers) {
      if (customer.phone && regex.test(customer.phone)) {
        failures.push({
          check: "forbiddenCustomerPhoneMatches",
          message: `Customer ${customer.name} phone ${customer.phone} matched forbidden pattern ${pattern}.`,
        });
      }
    }
  }

  for (const [customerName, patterns] of Object.entries(expectations.forbiddenCustomerPhoneByName ?? {})) {
    const customer = pkg.customers.find((candidate) => candidate.name.trim().toLowerCase() === customerName.trim().toLowerCase());
    if (!customer?.phone) continue;
    for (const pattern of patterns) {
      if (new RegExp(pattern, "i").test(customer.phone)) {
        failures.push({
          check: "forbiddenCustomerPhoneByName",
          message: `Customer ${customer.name} phone ${customer.phone} matched forbidden pattern ${pattern}.`,
        });
      }
    }
  }

  for (const name of expectations.requiredSupplierNames ?? []) {
    if (!hasNameMatch(pkg.suppliers, name)) {
      failures.push({
        check: "requiredSupplierNames",
        message: `Expected supplier named "${name}".`,
      });
    }
  }

  for (const pattern of expectations.forbiddenSupplierPhoneMatches ?? []) {
    const regex = new RegExp(pattern, "i");
    for (const supplier of pkg.suppliers) {
      if (supplier.phone && regex.test(supplier.phone)) {
        failures.push({
          check: "forbiddenSupplierPhoneMatches",
          message: `Supplier ${supplier.name} phone ${supplier.phone} matched forbidden pattern ${pattern}.`,
        });
      }
    }
  }

  if (
    expectations.minOpeningStock != null &&
    pkg.openingStock.length < expectations.minOpeningStock
  ) {
    failures.push({
      check: "minOpeningStock",
      message: `Expected at least ${expectations.minOpeningStock} opening stock rows, got ${pkg.openingStock.length}.`,
    });
  }

  if (expectations.maxOpeningStock != null && pkg.openingStock.length > expectations.maxOpeningStock) {
    failures.push({
      check: "maxOpeningStock",
      message: `Expected at most ${expectations.maxOpeningStock} opening stock rows, got ${pkg.openingStock.length}.`,
    });
  }

  if (expectations.minPositiveOpeningStock != null) {
    const positiveCount = pkg.openingStock.filter((stock) => isPositiveNumeric(stock.quantity)).length;
    if (positiveCount < expectations.minPositiveOpeningStock) {
      failures.push({
        check: "minPositiveOpeningStock",
        message: `Expected at least ${expectations.minPositiveOpeningStock} positive opening stock rows, got ${positiveCount}.`,
      });
    }
  }

  const itemNameByRef = new Map(pkg.items.map((item) => [item.tempId, item.name]));
  for (const name of expectations.requiredOpeningStockItemNames ?? []) {
    if (!pkg.openingStock.some((stock) => itemNameByRef.get(stock.itemRef) === name)) {
      failures.push({
        check: "requiredOpeningStockItemNames",
        message: `Expected opening stock for item "${name}".`,
      });
    }
  }

  for (const name of expectations.forbiddenOpeningStockItemNames ?? []) {
    if (pkg.openingStock.some((stock) => itemNameByRef.get(stock.itemRef) === name)) {
      failures.push({
        check: "forbiddenOpeningStockItemNames",
        message: `Did not expect opening stock for item "${name}".`,
      });
    }
  }

  const itemByRef = new Map(pkg.items.map((item) => [item.tempId, item]));
  const unitByRef = new Map(pkg.units.map((unit) => [unit.tempId, unit]));
  for (const [itemName, allowedUoms] of Object.entries(
    expectations.requiredOpeningStockItemUnitUoms ?? {},
  )) {
    const stock = pkg.openingStock.find((candidate) => itemNameByRef.get(candidate.itemRef) === itemName);
    if (!stock) continue;
    const item = itemByRef.get(stock.itemRef);
    const unit = item ? unitByRef.get(item.unitRef) : undefined;
    if (!unit || !allowedUoms.includes(unit.uom)) {
      failures.push({
        check: "requiredOpeningStockItemUnitUoms",
        message: `Opening stock for "${itemName}" used item unit ${unit?.uom ?? "missing"}; expected one of ${allowedUoms.join(", ")}.`,
      });
    }
  }

  if (expectations.minBoms != null && pkg.boms.length < expectations.minBoms) {
    failures.push({
      check: "minBoms",
      message: `Expected at least ${expectations.minBoms} BOMs, got ${pkg.boms.length}.`,
    });
  }

  if (
    expectations.maxBlockingIssues != null &&
    preview.blockingIssueCount > expectations.maxBlockingIssues
  ) {
    failures.push({
      check: "maxBlockingIssues",
      message: `Expected at most ${expectations.maxBlockingIssues} blocking issues, got ${preview.blockingIssueCount}.`,
    });
  }

  const forbiddenUoms = new Set(expectations.forbiddenUoms ?? []);
  for (const unit of pkg.units) {
    if (forbiddenUoms.has(unit.uom)) {
      failures.push({
        check: "forbiddenUoms",
        message: `Unit ${unit.name} used forbidden UOM ${unit.uom}.`,
      });
    }
  }

  for (const pattern of expectations.forbiddenUnitNameMatches ?? []) {
    const regex = new RegExp(pattern, "i");
    for (const unit of pkg.units) {
      if (regex.test(unit.name)) {
        failures.push({
          check: "forbiddenUnitNameMatches",
          message: `Unit ${unit.name} matched forbidden pattern ${pattern}.`,
        });
      }
    }
  }

  for (const uom of expectations.requiredUoms ?? []) {
    if (!pkg.units.some((unit) => unit.uom === uom)) {
      failures.push({
        check: "requiredUoms",
        message: `Expected at least one unit with UOM ${uom}.`,
      });
    }
  }

  for (const options of expectations.requiredUomAnyOf ?? []) {
    if (!pkg.units.some((unit) => options.includes(unit.uom))) {
      failures.push({
        check: "requiredUomAnyOf",
        message: `Expected at least one unit with one of these UOMs: ${options.join(", ")}.`,
      });
    }
  }

  const text = packageText(pkg);
  for (const match of expectations.requiredTextMatches ?? []) {
    if (!text.includes(match.toLowerCase())) {
      failures.push({
        check: "requiredTextMatches",
        message: `Expected package text to include "${match}".`,
      });
    }
  }
  for (const pattern of expectations.forbiddenTextMatches ?? []) {
    if (new RegExp(pattern, "i").test(text)) {
      failures.push({
        check: "forbiddenTextMatches",
        message: `Package text matched forbidden pattern "${pattern}".`,
      });
    }
  }

  for (const pattern of expectations.forbiddenQuestionMatches ?? []) {
    const regex = new RegExp(pattern, "i");
    for (const question of pkg.unresolvedQuestions) {
      if (regex.test(question.question)) {
        failures.push({
          check: "forbiddenQuestionMatches",
          message: `Question ${question.id} matched forbidden pattern "${pattern}".`,
        });
      }
    }
  }

  for (const pattern of expectations.forbiddenBlockingQuestionMatches ?? []) {
    const regex = new RegExp(pattern, "i");
    for (const question of pkg.unresolvedQuestions) {
      if (question.severity === "blocking" && regex.test(question.question)) {
        failures.push({
          check: "forbiddenBlockingQuestionMatches",
          message: `Blocking question ${question.id} matched forbidden pattern "${pattern}".`,
        });
      }
    }
  }

  const allowedStockSheetMatches = expectations.openingStockAllowedSheetMatches ?? [];
  if (allowedStockSheetMatches.length > 0) {
    for (const stock of pkg.openingStock) {
      const sheets = provenanceSheets(stock);
      if (sheets.length === 0 || !sheets.some((sheet) => matchesAny(sheet, allowedStockSheetMatches))) {
        failures.push({
          check: "openingStockAllowedSheetMatches",
          message: `Opening stock for ${stock.itemRef} came from ${sheets.join(", ") || "unknown sheet"}; expected one of ${allowedStockSheetMatches.join(", ")}.`,
        });
      }
    }
  }

  const forbiddenStockSheetMatches = expectations.openingStockForbiddenSheetMatches ?? [];
  if (forbiddenStockSheetMatches.length > 0) {
    for (const stock of pkg.openingStock) {
      const forbiddenSheet = provenanceSheets(stock).find((sheet) =>
        matchesAny(sheet, forbiddenStockSheetMatches),
      );
      if (forbiddenSheet) {
        failures.push({
          check: "openingStockForbiddenSheetMatches",
          message: `Opening stock for ${stock.itemRef} came from forbidden sheet ${forbiddenSheet}.`,
        });
      }
    }
  }

  if (expectations.forbidDuplicateOpeningStockItemRefs) {
    const seenItemRefs = new Set<string>();
    for (const stock of pkg.openingStock) {
      if (seenItemRefs.has(stock.itemRef)) {
        failures.push({
          check: "forbidDuplicateOpeningStockItemRefs",
          message: `Opening stock contains duplicate itemRef ${stock.itemRef}.`,
        });
      }
      seenItemRefs.add(stock.itemRef);
    }
  }

  if (expectations.forbidDuplicateUnitDefinitions) {
    const seenUnitKeys = new Set<string>();
    for (const unit of pkg.units) {
      const unitKey = unitDefinitionKey(unit);
      if (seenUnitKeys.has(unitKey)) {
        failures.push({
          check: "forbidDuplicateUnitDefinitions",
          message: `Duplicate unit definition ${unit.name} (${unit.size} ${unit.uom}).`,
        });
      }
      seenUnitKeys.add(unitKey);
    }
  }

  if (expectations.requireProvenance) {
    const records = [
      ...pkg.suppliers.map((record) => ({ kind: "supplier", record })),
      ...pkg.customers.map((record) => ({ kind: "customer", record })),
      ...pkg.items.map((record) => ({ kind: "item", record })),
      ...pkg.openingStock.map((record) => ({ kind: "openingStock", record })),
      ...pkg.boms.map((record) => ({ kind: "bom", record })),
    ];
    for (const { kind, record } of records) {
      if (!hasUsableProvenance(record)) {
        failures.push({
          check: "requireProvenance",
          message: `${recordLabel(kind, record)} has no usable provenance location.`,
        });
      }
      if (!hasUsableConfidence(record)) {
        failures.push({
          check: "requireProvenance",
          message: `${recordLabel(kind, record)} has invalid confidence ${record.confidence}.`,
        });
      }
    }
  }

  if (expectations.maxMissingReferenceIssues != null) {
    const missingReferenceIssues = preview.issues.filter((issue) =>
      /\breference .*does not exist\b|\bmissing\b/i.test(issue.message),
    );
    if (missingReferenceIssues.length > expectations.maxMissingReferenceIssues) {
      failures.push({
        check: "maxMissingReferenceIssues",
        message: `Expected at most ${expectations.maxMissingReferenceIssues} missing-reference issues, got ${missingReferenceIssues.length}.`,
      });
    }
  }

  return failures;
}

function writeJson(filePath: string, value: unknown) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  loadWorktreeEnv();
  const args = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(args.file.replace(/^~/, process.env.HOME ?? "~"));
  const bytes = fs.readFileSync(inputPath);
  const evalId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${path.basename(inputPath).replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
  const outDir = path.resolve(args.outDir, evalId);
  fs.mkdirSync(outDir, { recursive: true });

  const input: ImportExtractionFile = {
    id: path.basename(inputPath),
    filename: path.basename(inputPath),
    contentType: contentTypeFor(inputPath),
    bytes,
  };

  if (/\.xlsx?$/i.test(input.filename)) {
    fs.writeFileSync(path.join(outDir, "reader.txt"), workbookToStructuredText(bytes));
  }

  if (args.readerOnly) {
    console.log(`Reader output written to ${path.join(outDir, "reader.txt")}`);
    return;
  }

  const { db } = await import("@/lib/db");
  const { organization } = await import("@/lib/db/schema");
  const { withOrgContext } = await import("@/lib/db/with-org-context");
  const { extractImportPackage } = await import("@/lib/onboarding/import/extraction/extractor");
  const { normalizeImportPackageInTx, validateImportPackageInTx } = await import(
    "@/lib/onboarding/import/review"
  );

  const attemptsDir = path.join(outDir, "attempts");
  fs.mkdirSync(attemptsDir, { recursive: true });
  let rawPackage: PartialImportPackage;
  try {
    rawPackage = await extractImportPackage(input, {
      onAttempt: (attempt) => {
        writeJson(
          path.join(attemptsDir, `attempt-${String(attempt.attempt).padStart(2, "0")}.json`),
          attempt,
        );
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const summary = {
      input: inputPath,
      expectation: args.expectPath ? path.resolve(args.expectPath) : null,
      orgSlug: args.orgSlug,
      stage: "extraction",
      error: errorMessage,
      artifacts: outDir,
    };
    writeJson(path.join(outDir, "extraction-error.json"), {
      message: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    });
    writeJson(path.join(outDir, "summary.json"), summary);
    console.log(JSON.stringify(summary, null, 2));
    process.exitCode = 1;
    return;
  }
  writeJson(path.join(outDir, "raw-package.json"), rawPackage);

  const orgId = await resolveOrgId(db, organization, args.orgSlug);
  const normalizedPackage = await withOrgContext(orgId, async (tx) =>
    normalizeImportPackageInTx(tx, toImportPackage(rawPackage)),
  );
  writeJson(path.join(outDir, "normalized-package.json"), normalizedPackage);

  const preview = await withOrgContext(orgId, async (tx) =>
    validateImportPackageInTx(tx, orgId, normalizedPackage),
  );
  writeJson(path.join(outDir, "preview.json"), preview);

  const expectations = readExpectations(args.expectPath);
  const failures = scorePackage(normalizedPackage, preview, expectations);
  const summary = {
    input: inputPath,
    expectation: args.expectPath ? path.resolve(args.expectPath) : null,
    orgSlug: args.orgSlug,
    counts: {
      units: normalizedPackage.units.length,
      suppliers: normalizedPackage.suppliers.length,
      customers: normalizedPackage.customers.length,
      items: normalizedPackage.items.length,
      openingStock: normalizedPackage.openingStock.length,
      boms: normalizedPackage.boms.length,
      unresolvedQuestions: normalizedPackage.unresolvedQuestions.length,
      blockingIssues: preview.blockingIssueCount,
      warningIssues: preview.warningIssueCount,
    },
    failures,
    artifacts: outDir,
  };
  writeJson(path.join(outDir, "summary.json"), summary);
  console.log(JSON.stringify(summary, null, 2));

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exit(1);
});
