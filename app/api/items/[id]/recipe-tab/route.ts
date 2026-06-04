import { NextResponse } from "next/server";
import {
  getAvailableComponents,
  getBomComponents,
  getBomRevisionHistory,
  getItem,
} from "@/app/(dashboard)/inventory/queries";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { jsonNotFound } from "@/lib/api/responses";
import { getAuthedMemberContext, assertModuleReadAccess } from "@/lib/dal/auth";
import {
  canManageLockedBom,
  canViewLockedBom,
  canViewUnlockedBom,
  hasModuleAccess,
} from "@/lib/authz";

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleReadAccess("inventory", request.headers);
  const { id } = await ((ctx as RouteContext).params as Promise<{ id: string }>);
  const [context, item] = await Promise.all([
    getAuthedMemberContext(),
    getItem(id),
  ]);

  if (!item || item.itemType !== "product") {
    return jsonNotFound("Product variant not found");
  }

  const canViewBom = item.bomLocked
    ? canViewLockedBom(context.assignedRoles)
    : canViewUnlockedBom(context.assignedRoles);
  const canEditProduct = item.bomLocked
    ? hasModuleAccess(context.assignedRoles, "inventory", "admin") &&
      canManageLockedBom(context.assignedRoles)
    : hasModuleAccess(context.assignedRoles, "inventory", "operate");
  const [bomRows, availableComponents, bomRevisions] = await Promise.all([
    canViewBom ? getBomComponents(id) : Promise.resolve([]),
    getAvailableComponents(id),
    canViewBom ? getBomRevisionHistory(id) : Promise.resolve([]),
  ]);
  const currentRevision = bomRevisions.find((revision) => revision.isCurrent);

  return NextResponse.json({
    focusItemId: id,
    initialBomRows: bomRows.map((row) => ({
      componentId: row.componentId,
      quantity: row.quantity,
      minimumLotAgeDays: row.minimumLotAgeDays ?? null,
      alternates: row.alternates.map((alternate) => ({
        itemId: alternate.itemId,
      })),
    })),
    initialBomRevisionId: currentRevision?.id ?? null,
    initialOutputQuantity: currentRevision?.outputQuantity ?? "1",
    initialRecipeBasis: currentRevision?.recipeBasis === "batch" ? "batch" : "unit",
    initialExpectedBatchYield: item.expectedBatchYield,
    bomRevisions,
    availableComponents: availableComponents.map((component) => ({
      id: component.id,
      name: component.name,
      displayName: component.displayName,
      itemType: component.itemType,
      unit: component.unit,
    })),
    canViewBom,
    canEditProduct,
  });
});
