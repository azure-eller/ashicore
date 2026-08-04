"use client";

import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiJson } from "@/lib/client/api";
import { reflectPersistedCardUrlWithoutNavigation } from "@/lib/routing/reflect-card-url";
import { useSmartBack } from "@/lib/hooks/use-smart-back";
import { OrderStatusControl } from "@/components/card-page/order-status-control";
import { manufacturingOrderStatusConfig } from "@/components/card-page/order-status-configs";
import { CardPage, CardPageBanner, CardPageBody } from "@/components/card-page/card-page";
import { CardPageHeader } from "@/components/card-page/card-page-header";
import {
  flushClosableCardOrThrow,
  flushSavedCardOrThrow,
  useCardEntityActions,
} from "@/components/card-page/use-card-entity-actions";
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

  const actions = useCardEntityActions({
    entity: "mo-action",
    getId: () => controller.currentOrderId,
    flush: controller.flush,
    invalidateQueryKeys: [queryKeys.manufacturingOrders.root],
    onMutate: () => setActionError(null),
    onError: (error) => setActionError(error.message),
    duplicate: {
      run: (id) =>
        apiJson<{ id: string }>(`/api/manufacturing-orders/${id}/duplicate`, {
          method: "POST",
          idempotencyKey: "manufacturing-order-duplicate",
          fallbackError: "Failed to duplicate order.",
        }),
      navigateTo: (id) => `/manufacturing/order/${id}`,
    },
    delete: {
      label: "Delete order",
      run: (id) =>
        apiJson<void>(`/api/manufacturing-orders/${id}`, {
          method: "DELETE",
          fallbackError: "Failed to delete order.",
        }),
      onDeleted: goBack,
      confirm: {
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
        cancelLabel: "Back",
      },
    },
  });
  const editState = getManufacturingOrderEditState(order);
  const headerSaveState: CardSaveState = actionError
    ? "failed"
    : controller.saveState;
  const headerSaveMessage = actionError ?? controller.saveMessage;
  const ingredientOptions = useMemo(
    () => buildIngredientOptions(productOptions, order.ingredients),
    [order.ingredients, productOptions],
  );
  const handleClose = useCallback(() => {
    void flushClosableCardOrThrow({ flush: controller.flush })
      .then(() => {
        goBack();
      })
      .catch((error) => setActionError((error as Error).message));
  }, [controller, goBack]);
  const flushBeforeStatusTransition = useCallback(async () => {
    await flushSavedCardOrThrow({
      flush: controller.flush,
      blockedMessage: "Save changes before changing status.",
      fallbackError: "Save changes before changing status.",
    });
  }, [controller]);

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
              actionBoundary={{
                flushPolicy: "requireSaved",
                requiresPersistedId: true,
                beforeTransition: flushBeforeStatusTransition,
              }}
              onTransitionError={(error) => setActionError(error.message)}
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
                ...(actions.duplicateAction ? [actions.duplicateAction] : []),
                {
                  label: "Print manufacturing order",
                  href: `/api/manufacturing-orders/${order.id}/pdf?template=manufacturing-order&disposition=inline`,
                  target: "_blank" as const,
                },
                {
                  label: "Download manufacturing order PDF",
                  href: `/api/manufacturing-orders/${order.id}/pdf?template=manufacturing-order&disposition=attachment`,
                },
                {
                  label: "Print manufacturing order without costs",
                  href: `/api/manufacturing-orders/${order.id}/pdf?template=manufacturing-order-without-costs&disposition=inline`,
                  target: "_blank" as const,
                },
                {
                  label: "Print operator notes sheet",
                  href: `/api/manufacturing-orders/${order.id}/pdf?template=manufacturing-order-notes&disposition=inline`,
                  target: "_blank" as const,
                },
                ...(order.startedAt
                  ? [{
                      label: "Print partial-progress order",
                      href: `/api/manufacturing-orders/${order.id}/pdf?template=manufacturing-order-partial&disposition=inline`,
                      target: "_blank" as const,
                    }]
                  : []),
                {
                  label: "Print pick list",
                  href: `/api/manufacturing-orders/${order.id}/pdf?template=pick-list&disposition=inline`,
                  target: "_blank" as const,
                },
                ...(actions.deleteAction ? [actions.deleteAction] : []),
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

      {actions.dialogs}
    </CardPage>
  );
}
