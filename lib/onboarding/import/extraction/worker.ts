import "server-only";

import { and, asc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { importFiles, importSessions, organization } from "@/lib/db/schema";
import { withOrgContext, type Tx } from "@/lib/db/with-org-context";
import { getPrivateBlobForDownload } from "@/lib/blob-storage";
import { readLocalAttachment } from "@/lib/attachments/local-file-storage";
import { extractImportPackage } from "./extractor";
import { importPackageSchema, type ImportPackage, type PartialImportPackage } from "../types";
import { normalizeImportPackageInTx, validateImportPackageInTx } from "../sessions";
import { env } from "@/lib/env";

const DEFAULT_FILES_PER_TICK = 3;
const LEASE_MS = 4 * 60 * 1000;
const MAX_EXTRACTION_ATTEMPTS = 3;

async function listOrgIds() {
  const rows = await db.select({ id: organization.id }).from(organization);
  return rows.map((row) => row.id);
}

function normalizePartial(partial: PartialImportPackage): ImportPackage {
  return importPackageSchema.parse({
    version: "1",
    openingStockAsOf:
      partial.openingStockAsOf ?? new Date().toISOString().slice(0, 10),
    units: partial.units ?? [],
    suppliers: partial.suppliers ?? [],
    customers: partial.customers ?? [],
    items: partial.items ?? [],
    openingStock: partial.openingStock ?? [],
    boms: partial.boms ?? [],
    unresolvedQuestions: partial.unresolvedQuestions ?? [],
  });
}

type FilePartial = { fileId: string; partial: PartialImportPackage };

function scopedRef(fileId: string, ref: string | null | undefined) {
  return ref ? `${fileId}:${ref}` : ref;
}

function canonicalUnit(unit: ImportPackage["units"][number]) {
  const raw = `${unit.name} ${unit.uom}`.trim().toLowerCase();
  if (["lb", "lbs", "pound", "pounds", "#"].some((alias) => raw === alias || raw.includes(alias))) {
    return { ...unit, name: "Pound", size: unit.size || "1", uom: "lb" };
  }
  if (["ea", "each", "eaches"].some((alias) => raw === alias || raw.includes(alias))) {
    return { ...unit, name: "Each", size: unit.size || "1", uom: "ea" };
  }
  return unit;
}

function scopePartial({ fileId, partial }: FilePartial): ImportPackage {
  const normalized = normalizePartial(partial);
  return importPackageSchema.parse({
    ...normalized,
    units: normalized.units.map((unit) => ({
      ...canonicalUnit(unit),
      tempId: scopedRef(fileId, unit.tempId),
    })),
    suppliers: normalized.suppliers.map((supplier) => ({
      ...supplier,
      tempId: scopedRef(fileId, supplier.tempId),
    })),
    customers: normalized.customers.map((customer) => ({
      ...customer,
      tempId: scopedRef(fileId, customer.tempId),
    })),
    items: normalized.items.map((item) => ({
      ...item,
      tempId: scopedRef(fileId, item.tempId),
      unitRef: scopedRef(fileId, item.unitRef),
      defaultSupplierRef: scopedRef(fileId, item.defaultSupplierRef),
      purchaseUnitRef: scopedRef(fileId, item.purchaseUnitRef),
    })),
    openingStock: normalized.openingStock.map((stock) => ({
      ...stock,
      itemRef: scopedRef(fileId, stock.itemRef),
    })),
    boms: normalized.boms.map((bom) => ({
      ...bom,
      productRef: scopedRef(fileId, bom.productRef),
      outputUnitRef: scopedRef(fileId, bom.outputUnitRef),
      components: bom.components.map((component) => ({
        ...component,
        itemRef: scopedRef(fileId, component.itemRef),
        unitRef: scopedRef(fileId, component.unitRef),
      })),
    })),
    unresolvedQuestions: normalized.unresolvedQuestions.map((question) => ({
      ...question,
      entityRef: scopedRef(fileId, question.entityRef),
    })),
  });
}

function consolidateUnits(pkg: ImportPackage): ImportPackage {
  const unitByKey = new Map<string, ImportPackage["units"][number]>();
  const refMap = new Map<string, string>();

  for (const unit of pkg.units) {
    const canonical = canonicalUnit(unit);
    const unitKey = `${canonical.name.trim().toLowerCase()}|${canonical.size}|${canonical.uom.trim().toLowerCase()}`;
    const existing = unitByKey.get(unitKey);
    if (existing) {
      refMap.set(unit.tempId, existing.tempId);
    } else {
      unitByKey.set(unitKey, canonical);
      refMap.set(unit.tempId, canonical.tempId);
    }
  }

  const mapUnitRef = (ref: string | null | undefined) => (ref ? refMap.get(ref) ?? ref : ref);
  return importPackageSchema.parse({
    ...pkg,
    units: [...unitByKey.values()],
    items: pkg.items.map((item) => ({
      ...item,
      unitRef: mapUnitRef(item.unitRef),
      purchaseUnitRef: mapUnitRef(item.purchaseUnitRef),
    })),
    boms: pkg.boms.map((bom) => ({
      ...bom,
      outputUnitRef: mapUnitRef(bom.outputUnitRef),
      components: bom.components.map((component) => ({
        ...component,
        unitRef: mapUnitRef(component.unitRef),
      })),
    })),
  });
}

function mergePartials(partials: FilePartial[]): ImportPackage {
  const merged = partials.map(scopePartial).reduce<ImportPackage>(
    (current, partial) => ({
      version: "1",
      openingStockAsOf: current.openingStockAsOf,
      units: [...current.units, ...partial.units],
      suppliers: [...current.suppliers, ...partial.suppliers],
      customers: [...current.customers, ...partial.customers],
      items: [...current.items, ...partial.items],
      openingStock: [...current.openingStock, ...partial.openingStock],
      boms: [...current.boms, ...partial.boms],
      unresolvedQuestions: [...current.unresolvedQuestions, ...partial.unresolvedQuestions],
    }),
    {
      version: "1",
      openingStockAsOf: new Date().toISOString().slice(0, 10),
      units: [],
      suppliers: [],
      customers: [],
      items: [],
      openingStock: [],
      boms: [],
      unresolvedQuestions: [],
    },
  );

  return consolidateUnits(merged);
}

function applyInitialReviewDefaults(pkg: ImportPackage): ImportPackage {
  const reviewForConfidence = (confidence: number | undefined, review?: { selected?: boolean }) => ({
    ...review,
    selected: review?.selected === false ? false : (confidence ?? 0.5) >= 0.7,
  });

  return importPackageSchema.parse({
    ...pkg,
    suppliers: pkg.suppliers.map((supplier) => ({
      ...supplier,
      review: reviewForConfidence(supplier.confidence, supplier.review),
    })),
    customers: pkg.customers.map((customer) => ({
      ...customer,
      review: reviewForConfidence(customer.confidence, customer.review),
    })),
    items: pkg.items.map((item) => ({
      ...item,
      review: reviewForConfidence(item.confidence, item.review),
    })),
    openingStock: pkg.openingStock.map((stock) => ({
      ...stock,
      review: reviewForConfidence(stock.confidence, stock.review),
    })),
    boms: pkg.boms.map((bom) => ({
      ...bom,
      review: reviewForConfidence(bom.confidence, bom.review),
    })),
  });
}

async function claimSessionInTx(tx: Tx) {
  const now = new Date();
  const [session] = await tx
    .select({ id: importSessions.id, attemptCount: importSessions.attemptCount })
    .from(importSessions)
    .where(
      and(
        inArray(importSessions.status, ["uploaded", "extracting"]),
        isNull(importSessions.deletedAt),
        or(
          isNull(importSessions.processingLeaseUntil),
          lt(importSessions.processingLeaseUntil, now),
        ),
      ),
    )
    .orderBy(asc(importSessions.createdAt))
    .for("update", { skipLocked: true })
    .limit(1);

  if (!session) return null;

  const nextAttemptCount = session.attemptCount + 1;
  const [claimed] = await tx
    .update(importSessions)
    .set({
      status: "extracting",
      processingStartedAt: now,
      processingLeaseUntil: new Date(now.getTime() + LEASE_MS),
      attemptCount: nextAttemptCount,
      lastError: null,
      updatedAt: now,
    })
    .where(eq(importSessions.id, session.id))
    .returning({ id: importSessions.id });

  return claimed ? { ...claimed, attemptCount: nextAttemptCount } : null;
}

async function bufferBlob(storageKey: string) {
  const local = await readLocalAttachment(`local://${storageKey}`).catch((error) => {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  });
  if (local) return local;

  const blob = await getPrivateBlobForDownload(storageKey);
  if (!blob?.stream) throw new Error("Import file could not be read from private storage.");
  const chunks: Buffer[] = [];
  const reader = blob.stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

async function failSessionInTx(tx: Tx, sessionId: string, message: string) {
  await tx
    .update(importSessions)
    .set({
      status: "failed",
      error: message,
      lastError: message,
      processingLeaseUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(importSessions.id, sessionId));
}

async function processSessionFiles(
  orgId: string,
  sessionId: string,
  filesPerTick: number,
  attemptCount: number,
) {
  let processed = 0;
  let failed = false;

  const pendingFiles = await withOrgContext(orgId, async (tx) =>
    tx
      .select({
        id: importFiles.id,
        filename: importFiles.filename,
        contentType: importFiles.contentType,
        storageKey: importFiles.storageKey,
      })
      .from(importFiles)
      .where(
        and(
          eq(importFiles.sessionId, sessionId),
          eq(importFiles.extractionStatus, "pending"),
          isNull(importFiles.deletedAt),
        ),
      )
      .orderBy(asc(importFiles.createdAt))
      .limit(filesPerTick),
  );

  for (const file of pendingFiles) {
    try {
      const bytes = await bufferBlob(file.storageKey);
      const extractedPackage = await extractImportPackage({ ...file, bytes });
      await withOrgContext(orgId, async (tx) => {
        await tx
          .update(importFiles)
          .set({
            extractionStatus: "extracted",
            extractedPackage,
            extractedAt: new Date(),
            extractionError: null,
            updatedAt: new Date(),
          })
          .where(eq(importFiles.id, file.id));
      });
      processed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await withOrgContext(orgId, async (tx) => {
        await tx
          .update(importFiles)
          .set({
            extractionStatus: attemptCount >= MAX_EXTRACTION_ATTEMPTS ? "failed" : "pending",
            extractionError: message,
            updatedAt: new Date(),
          })
          .where(eq(importFiles.id, file.id));
        if (attemptCount >= MAX_EXTRACTION_ATTEMPTS) {
          await failSessionInTx(tx, sessionId, message);
        }
      });
      failed = attemptCount >= MAX_EXTRACTION_ATTEMPTS;
      if (failed) break;
    }
  }

  return { processed, failed };
}

async function finishSessionIfReady(orgId: string, sessionId: string) {
  return withOrgContext(orgId, async (tx) => {
    const rows = await tx
      .select({
        id: importFiles.id,
        extractionStatus: importFiles.extractionStatus,
        extractedPackage: importFiles.extractedPackage,
      })
      .from(importFiles)
      .where(and(eq(importFiles.sessionId, sessionId), isNull(importFiles.deletedAt)));

    if (rows.length === 0 || rows.some((row) => row.extractionStatus !== "extracted")) {
      return false;
    }

    const partials = rows.flatMap((row) =>
      row.extractedPackage
        ? [{ fileId: row.id, partial: row.extractedPackage as PartialImportPackage }]
        : [],
    );
    const merged = applyInitialReviewDefaults(
      await normalizeImportPackageInTx(tx, mergePartials(partials)),
    );
    const preview = await validateImportPackageInTx(tx, orgId, merged);
    await tx
      .update(importSessions)
      .set({
        status: preview.status,
        draftPackage: merged,
        normalizedPackage: merged,
        openingStockAsOf: merged.openingStockAsOf,
        processingLeaseUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(importSessions.id, sessionId));
    return true;
  });
}

export async function processOnboardingImports(options: { filesPerTick?: number } = {}) {
  const filesPerTick = options.filesPerTick ?? Number(env.IMPORT_EXTRACTION_FILES_PER_TICK ?? DEFAULT_FILES_PER_TICK);
  const orgIds = await listOrgIds();
  const summary = { claimed: 0, processedFiles: 0, completedSessions: 0 };

  for (const orgId of orgIds) {
    const claimed = await withOrgContext(orgId, claimSessionInTx);
    if (!claimed) continue;

    summary.claimed += 1;
    const result = await processSessionFiles(
      orgId,
      claimed.id,
      filesPerTick,
      claimed.attemptCount,
    );
    summary.processedFiles += result.processed;
    if (result.failed) break;
    if (await finishSessionIfReady(orgId, claimed.id)) {
      summary.completedSessions += 1;
    } else {
      await withOrgContext(orgId, async (tx) => {
        await tx
          .update(importSessions)
          .set({ processingLeaseUntil: null, updatedAt: new Date() })
          .where(eq(importSessions.id, claimed.id));
      });
    }

    break;
  }

  return summary;
}
