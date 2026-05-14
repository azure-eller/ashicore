"use client";

import { useId, type CSSProperties, type ReactNode } from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { HugeiconsIcon } from "@hugeicons/react";
import { DragDropVerticalIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SortableReorder({
  ids,
  onMove,
  children,
}: {
  ids: string[];
  onMove: (fromIndex: number, toIndex: number) => void;
  children: ReactNode;
}) {
  const dndContextId = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }

    const fromIndex = ids.indexOf(String(active.id));
    const toIndex = ids.indexOf(String(over.id));

    if (fromIndex < 0 || toIndex < 0) {
      return;
    }

    onMove(fromIndex, toIndex);
  }

  return (
    <DndContext
      id={dndContextId}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

export function useSortableReorderItem(id: string) {
  const {
    attributes,
    isDragging,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 1 : undefined,
  };

  return {
    attributes,
    listeners,
    setNodeRef,
    style,
  };
}

export function SortableDragHandle({
  attributes,
  listeners,
  label = "Reorder row",
  className,
}: {
  attributes: ReturnType<typeof useSortable>["attributes"];
  listeners: ReturnType<typeof useSortable>["listeners"];
  label?: string;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      className={cn("cursor-grab text-muted-foreground active:cursor-grabbing", className)}
      {...attributes}
      {...listeners}
    >
      <HugeiconsIcon icon={DragDropVerticalIcon} strokeWidth={2} />
    </Button>
  );
}
