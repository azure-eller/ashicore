import "server-only";

import type { Tx } from "@/lib/db/with-org-context";
import { getAllocationWorkspaceInTx } from "@/lib/inventory/allocation/read-model";
import type { AllocationWorkspace } from "@/lib/inventory/allocation/types";
import { normalizeNumeric, roundQuantity } from "@/lib/format";
import type {
  SalesAllocationDemandRow,
  SalesAllocationLineSummary,
  SalesAllocationSource,
} from "./types";

function toQuantity(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function quantityString(value: number) {
  return normalizeNumeric(roundQuantity(Math.max(0, value)));
}

function getLineStatus(
  remainingQty: number,
  allocatedQty: number,
  sources: SalesAllocationLineSummary["sources"]
): SalesAllocationLineSummary["status"] {
  if (allocatedQty <= 0) return "short";
  if (roundQuantity(allocatedQty) < roundQuantity(remainingQty)) return "partial";
  return sources.some((source) => source.sourceType === "manufacturing_order")
    ? "waiting_production"
    : "ready";
}

function buildSourceSummary(sources: SalesAllocationLineSummary["sources"]) {
  if (sources.length === 0) return "\u2014";
  return sources
    .map((source) => `${quantityString(toQuantity(source.quantity))} ${source.label}`)
    .join(", ");
}

function sourceStatus(status: string): SalesAllocationSource["status"] {
  if (status === "open" || status === "done") return status;
  return "available";
}

function workspaceToSalesReadModel(workspace: AllocationWorkspace) {
  const lineSummaries = new Map<string, SalesAllocationLineSummary>();
  const demandRows: SalesAllocationDemandRow[] = workspace.demands
    .filter((demand) => demand.demandType === "sales_order_line")
    .map((demand) => {
      const sources = demand.assignments.map((assignment) => ({
        sourceType: assignment.sourceType,
        sourceId: assignment.sourceId,
        label: assignment.sourceLabel,
        quantity: assignment.quantity,
        coverageKind: "explicit" as const,
      }));
      const remainingQty = toQuantity(demand.openQty);
      const allocatedQty = toQuantity(demand.allocatedQty);
      const sourceSummary = buildSourceSummary(sources);
      const status = getLineStatus(remainingQty, allocatedQty, sources);

      lineSummaries.set(demand.demandId, {
        salesOrderLineId: demand.demandId,
        itemId: demand.itemId,
        allocatedQty: demand.allocatedQty,
        shortQty: demand.shortQty,
        sourceSummary,
        status,
        sources,
      });

      return {
        salesOrderLineId: demand.demandId,
        salesOrderId: "",
        orderNumber: demand.label,
        orderStatus: "open",
        customerName: demand.contextLabel ?? "",
        shipDate: demand.requiredDate,
        itemId: demand.itemId,
        itemName: demand.itemName,
        unitName: demand.unitName,
        orderedQty: demand.openQty,
        shippedQty: "0",
        cancelledQty: "0",
        remainingQty: demand.openQty,
        allocatedQty: demand.allocatedQty,
        shortQty: demand.shortQty,
        sourceSummary,
        sources,
        isTarget: demand.isPrimary,
      };
    });

  const supplySources: SalesAllocationSource[] = workspace.sources.map((source) => ({
    sourceType: source.sourceType,
    sourceId: source.sourceId,
    label: source.label,
    status: sourceStatus(source.status),
    date: source.date,
    receivedAt: source.sourceType === "inventory_lot" ? source.date : null,
    createdAt: null,
    priorityRank: null,
    lotNumber: source.sourceType === "inventory_lot" ? source.label : null,
    totalQty: source.totalQty,
    allocatedQty: source.allocatedQty,
    freeQty: source.freeQty,
    currentTargetQty: source.currentPrimaryQty,
    maxQty: source.maxQtyForPrimaryDemand,
    canAllocate: source.canAllocate,
  }));

  return {
    demandRows,
    lineSummaries,
    supplySources,
    uncoveredDemandQty: workspace.totals.shortQty,
  };
}

export async function getSalesAllocationReadModelForItemInTx(
  tx: Tx,
  orgId: string,
  itemId: string,
  options?: { targetLineId?: string | null }
) {
  const workspace = await getAllocationWorkspaceInTx(tx, {
    organizationId: orgId,
    primaryDemand: options?.targetLineId
      ? { demandType: "sales_order_line", demandId: options.targetLineId }
      : null,
    itemId,
  });
  if (!workspace) {
    return {
      demandRows: [],
      lineSummaries: new Map<string, SalesAllocationLineSummary>(),
      supplySources: [],
      uncoveredDemandQty: "0",
    };
  }
  return workspaceToSalesReadModel(workspace);
}
