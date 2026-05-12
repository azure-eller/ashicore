"use client";

import {
  Kanban,
  KanbanBoard,
  KanbanItem,
  KanbanOverlay,
} from "@/components/reui/kanban";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import type { SalesOrderListRow } from "../types";
import { SalesOrderCard, type DeleteTarget } from "./sales-order-card";
import { SalesOrderColumn, type SalesOrderShipmentMarker } from "./sales-order-column";
import {
  getSalesOrderDropCommand,
  type SalesOrderDropCommand,
} from "./sales-order-drop-rules";
import type {
  SalesOrderLaneDefinition,
  SalesOrderLaneId,
} from "./sales-order-lane-model";
import { deriveSalesOrderLane } from "./sales-order-lane-model";

export function SalesOrderKanban({
  visibleLanes,
  ordersByLane,
  selectedItemId,
  expandedOrderId,
  density,
  onToggleExpanded,
  onDelete,
  onDropCommand,
}: {
  visibleLanes: SalesOrderLaneDefinition[];
  ordersByLane: Record<SalesOrderLaneId, SalesOrderListRow[]>;
  selectedItemId: string | null;
  expandedOrderId: string | null;
  density: "compact" | "comfortable";
  onToggleExpanded: (orderId: string) => void;
  onDelete: (target: DeleteTarget) => void;
  onDropCommand: (command: SalesOrderDropCommand, order: SalesOrderListRow) => void;
}) {
  const laneIds = new Set(visibleLanes.map((lane) => lane.id));
  const boardValue = Object.fromEntries(
    visibleLanes.map((lane) => [lane.id, ordersByLane[lane.id]])
  ) as Record<string, SalesOrderListRow[]>;
  const shipmentMarkersByLane: Record<SalesOrderLaneId, SalesOrderShipmentMarker[]> = {
    draft: [],
    supply_needed: [],
    in_production: [],
    ready_to_ship: [],
    shipped: [],
    cancelled: [],
  };
  const ordersById = new Map(
    visibleLanes.flatMap((lane) =>
      ordersByLane[lane.id].map((order) => [order.id, order] as const)
    )
  );
  visibleLanes.forEach((lane) => {
    ordersByLane[lane.id].forEach((order) => {
      const orderLane = deriveSalesOrderLane(order);
      order.shipments.forEach((shipment) => {
        const shipmentLane = getStandaloneShipmentLane(shipment.status);
        if (!shipmentLane || shipmentLane === orderLane || !laneIds.has(shipmentLane)) {
          return;
        }
        shipmentMarkersByLane[shipmentLane].push({ order, shipment });
      });
    });
  });

  return (
    <ScrollArea className="-mx-4 overflow-hidden pb-3" viewportClassName="px-4 pt-1 pb-3">
      <Kanban
        value={boardValue}
        onValueChange={() => undefined}
        getItemValue={(order) => order.id}
        onMove={({ activeContainer, overContainer, event }) => {
          if (!laneIds.has(activeContainer as SalesOrderLaneId)) return;
          if (!laneIds.has(overContainer as SalesOrderLaneId)) return;
          const order = ordersById.get(String(event.active.id));
          if (!order) return;

          const command = getSalesOrderDropCommand({
            order,
            fromLane: activeContainer as SalesOrderLaneId,
            toLane: overContainer as SalesOrderLaneId,
          });
          onDropCommand(command, order);
        }}
      >
        <KanbanBoard
          className="grid w-full gap-3"
          style={{
            gridTemplateColumns: `repeat(${visibleLanes.length}, minmax(17rem, 1fr))`,
            minWidth: `calc(${visibleLanes.length} * 17rem + ${Math.max(
              0,
              visibleLanes.length - 1
            )} * 0.75rem)`,
          }}
        >
          {visibleLanes.map((lane) => (
            <SalesOrderColumn
              key={lane.id}
              lane={lane}
              orders={ordersByLane[lane.id]}
              shipmentMarkers={selectedItemId ? [] : shipmentMarkersByLane[lane.id]}
              selectedItemId={selectedItemId}
              expandedOrderId={expandedOrderId}
              density={density}
              onToggleExpanded={onToggleExpanded}
              onDelete={onDelete}
            />
          ))}
        </KanbanBoard>
        <KanbanOverlay>
          {({ value, variant }) => {
            if (variant !== "item") return null;
            const order = ordersById.get(String(value));
            if (!order) return null;

            return (
              <KanbanItem value={order.id}>
                <div className="w-[17rem]">
                  <SalesOrderCard
                    order={order}
                    expanded={false}
                    density={density}
                    onToggleExpanded={() => undefined}
                    onDelete={() => undefined}
                  />
                </div>
              </KanbanItem>
            );
          }}
        </KanbanOverlay>
      </Kanban>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}

function getStandaloneShipmentLane(
  status: SalesOrderListRow["shipments"][number]["status"]
): SalesOrderLaneId | null {
  if (status === "shipped") return "shipped";
  if (status === "cancelled") return "cancelled";
  return null;
}
