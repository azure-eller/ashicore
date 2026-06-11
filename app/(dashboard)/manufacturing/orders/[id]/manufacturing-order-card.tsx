"use client";

import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { apiJson } from "@/lib/client/api";
import { reflectPersistedCardUrlWithoutNavigation } from "@/lib/routing/reflect-card-url";
import { useSmartBack } from "@/lib/hooks/use-smart-back";
import { OrderStatusControl } from "@/components/card-page/order-status-control";
import {
  isManufacturingStatusDisabled,
  manufacturingOrderStatusConfig,
} from "@/components/card-page/order-status-configs";
import { CardPage, CardPageBanner, CardPageBody } from "@/components/card-page/card-page";
import { CardPageHeader } from "@/components/card-page/card-page-header";
import { useConfirmMutation } from "@/components/card-page/use-confirm-mutation";
import { useDeleteEntity } from "@/components/card-page/use-delete-entity";
import { useDuplicateEntity } from "@/components/card-page/use-duplicate-entity";
import { DetailHeaderTitle } from "@/components/card-page/detail-header-title";
import type { CardSaveState } from "@/components/card-page/card-save-status";
import type {
  ManufacturingOrderDetail,
} from "@/lib/manufacturing/types";
import { queryKeys } from "@/lib/client/query-keys";
import {
  useManufacturingOrderDraftController,
  makeDraftManufacturingOrder,
} from "./use-manufacturing-order-draft-controller";

import {
  buildIngredientOptions,
  getManufacturingOrderEditState,
  IngredientsSection,
  NotesSection,
  OperationsSection,
  OrderDetailsSection,
} from "./manufacturing-order-sections";
import type { ManufacturingProductOption } from "./manufacturing-order-sections";
export type { ManufacturingProductOption } from "./manufacturing-order-sections";

export function ManufacturingOrderCard({
  initialOrder,
  productOptions = [],
}: {
  initialOrderId: string | null;
  initialOrder: ManufacturingOrderDetail | null;
  productOptions?: ManufacturingProductOption[];
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [actionError, setActionError] = useState<string | null>(null);
  const goBack = useSmartBack("/manufacturing/orders");
  const initialDraft = useMemo(() => makeDraftManufacturingOrder(), []);
  const controller = useManufacturingOrderDraftController({
    initialOrder,
    initialDraft,
    queryClient,
    onPersisted: (id) => {
      reflectPersistedCardUrlWithoutNavigation(`/manufacturing/order/${id}`);
    },
  });
  const order = controller.draft;
  const currentOrderId = controller.currentOrderId;
  const isDraft = !controller.hasPersistedOrder;

  const refreshOrder = useCallback(() => {
    void controller.refreshFromServer();
    if (currentOrderId != null) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.manufacturingOrders.detail(currentOrderId) });
    }
  }, [controller, currentOrderId, queryClient]);

  const duplicateMutation = useDuplicateEntity({
    mutationKey: ["mo-action", currentOrderId ?? "__draft__", "duplicate"],
    onMutate: () => setActionError(null),
    mutationFn: async () => {
      await controller.flush();
      return apiJson<{ id: string }>(
        `/api/manufacturing-orders/${currentOrderId}/duplicate`,
        {
          method: "POST",
          idempotencyKey: "manufacturing-order-duplicate",
          fallbackError: "Failed to duplicate order.",
        },
      );
    },
    invalidateQueryKeys: [queryKeys.manufacturingOrders.root],
    onDuplicated: (created) => router.push(`/manufacturing/order/${created.id}`),
    onError: (error) => setActionError((error as Error).message),
  });

  const deleteMutation = useDeleteEntity({
    mutationKey: ["mo-action", currentOrderId ?? "__draft__", "delete"],
    onMutate: () => setActionError(null),
    mutationFn: async () => {
      await controller.flush();
      await apiJson<void>(`/api/manufacturing-orders/${currentOrderId}`, {
        method: "DELETE",
        fallbackError: "Failed to delete order.",
      });
    },
    invalidateQueryKeys: [queryKeys.manufacturingOrders.root],
    onDeleted: goBack,
    onError: (error) => setActionError((error as Error).message),
  });
  const deleteConfirm = useConfirmMutation<void>({
    title: "Delete this order?",
    description: (
      <>
        Open orders are removed from normal views and reversible picked or
        open-demand inventory is released. For batch orders with completed
        batches, completed output and consumed ingredients are kept as
        production history while remaining work is cancelled. This action
        cannot be undone.
      </>
    ),
    confirmLabel: "Delete Order",
    pendingLabel: "Deleting...",
    cancelLabel: "Back",
    mutation: deleteMutation,
  });
  const editState = getManufacturingOrderEditState(order);
  const headerSaveState: CardSaveState =
    controller.status === "saving" || controller.status === "dirty"
      ? "saving"
      : controller.status === "error" || actionError
        ? "failed"
        : isDraft
          ? "not_saved"
          : "saved";
  const headerSaveMessage =
    controller.status === "error" ? controller.error : actionError;
  const ingredientOptions = useMemo(
    () => buildIngredientOptions(productOptions, order.ingredients),
    [order.ingredients, productOptions],
  );
  const handleClose = useCallback(() => {
    void controller.flush().then(goBack).catch((error) => {
      setActionError(error instanceof Error ? error.message : "Failed to save manufacturing order.");
    });
  }, [controller, goBack]);

  return (
    <CardPage>
      <CardPageHeader
        title={
          !isDraft ? (
            <DetailHeaderTitle
              recordNumber={order.orderNumber}
              name={order.productName}
              subId={order.productSku}
            />
          ) : (
            "New manufacturing order"
          )
        }
        statusControl={
          !isDraft ? (
            <OrderStatusControl
              config={manufacturingOrderStatusConfig}
              ctx={{
                order: {
                  id: order.id,
                  status: order.status,
                  isBlocked: order.isBlocked,
                  manufacturingMode: order.manufacturingMode,
                  pickProgressStatus: order.pickProgressStatus,
                  completedBatchCount: order.batches.filter(
                    (batch) => batch.status === "completed",
                  ).length,
                  startedAt: order.startedAt,
                  actualQuantity: order.actualQuantity,
                },
              }}
              disabled={isManufacturingStatusDisabled(order)}
              onChanged={refreshOrder}
            />
          ) : null
        }
        saveState={headerSaveState}
        saveMessage={headerSaveMessage}
        showPrint={false}
        menuActions={
          !isDraft
            ? [
                {
                  label: "Duplicate",
                  onClick: () => duplicateMutation.mutate(),
                  disabled: duplicateMutation.isPending,
                },
                {
                  label: "Print",
                  onClick: () => window.print(),
                },
                {
                  label: "Delete order",
                  onClick: () => deleteConfirm.trigger(undefined),
                  destructive: true,
                },
              ]
            : []
        }
        onClose={handleClose}
        fallbackHref="/manufacturing/orders"
      />

      {actionError ? <CardPageBanner>{actionError}</CardPageBanner> : null}

      <CardPageBody>
        <OrderDetailsSection
          order={order}
          controller={controller}
          productOptions={productOptions}
          canEditMetadata={editState.canEditMetadata}
          canEditPlanning={editState.canEditPlanning}
          planningLockedReason={editState.planningLockedReason}
        />
        <IngredientsSection
          order={order}
          controller={controller}
          ingredientOptions={ingredientOptions}
          canEditPlanning={editState.canEditPlanning}
          planningLockedReason={editState.planningLockedReason}
        />
        <OperationsSection order={order} />
        <NotesSection
          order={order}
          controller={controller}
          canEdit={editState.canEditMetadata}
        />
      </CardPageBody>

      {deleteConfirm.dialog}
    </CardPage>
  );
}

