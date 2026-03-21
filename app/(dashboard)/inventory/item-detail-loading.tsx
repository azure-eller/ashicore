import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ItemType } from "./types";

interface ItemDetailLoadingProps {
  itemType: ItemType;
}

interface DetailTableSkeletonProps {
  columnsClassName: string;
  headerWidths: string[];
  rowWidths: string[];
  cellClassNames?: string[];
  rows?: number;
}

function DetailTableSkeleton({
  columnsClassName,
  headerWidths,
  rowWidths,
  cellClassNames = [],
  rows = 3,
}: DetailTableSkeletonProps) {
  return (
    <div className="rounded-md border">
      <div className={cn("grid gap-4 border-b bg-muted/50 px-4 py-2.5", columnsClassName)}>
        {headerWidths.map((width, index) => (
          <Skeleton
            key={index}
            className={cn("h-4", width, cellClassNames[index])}
          />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div
          key={rowIndex}
          className={cn("grid gap-4 border-b px-4 py-3 last:border-0", columnsClassName)}
        >
          {rowWidths.map((width, columnIndex) => (
            <Skeleton
              key={columnIndex}
              className={cn("h-4", width, cellClassNames[columnIndex])}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ItemDetailLoading({ itemType }: ItemDetailLoadingProps) {
  const showBom = itemType === "product";
  const metadataCount = itemType === "material" ? 10 : 9;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-8 w-56" />
        </div>
        <Skeleton className="h-9 w-16" />
      </div>

      <Separator />

      <Skeleton className="h-4 w-full max-w-2xl" />

      <div className="grid max-w-2xl grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
        {Array.from({ length: metadataCount }).map((_, index) => (
          <div key={index} className="space-y-1.5">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-32" />
          </div>
        ))}
      </div>

      {showBom && (
        <>
          <Separator />
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Skeleton className="h-7 w-52" />
              <Skeleton className="h-4 w-28" />
            </div>
            <DetailTableSkeleton
              columnsClassName="grid-cols-[minmax(0,1.4fr)_7rem_5rem_6rem]"
              headerWidths={["w-24", "w-10", "w-8", "w-10"]}
              rowWidths={["w-40", "w-14", "w-10", "w-16"]}
              cellClassNames={["", "", "justify-self-end", "justify-self-end"]}
              rows={2}
            />
          </div>
        </>
      )}

      <Separator />
      <div className="space-y-3">
        <Skeleton className="h-7 w-12" />
        <DetailTableSkeleton
          columnsClassName="grid-cols-[minmax(0,1fr)_7rem_8rem_9rem]"
          headerWidths={["w-20", "w-12", "w-16", "w-16"]}
          rowWidths={["w-24", "w-10", "w-16", "w-20"]}
          cellClassNames={["", "justify-self-end", "justify-self-end", "justify-self-end"]}
          rows={3}
        />
      </div>

      <Separator />
      <div className="space-y-3">
        <Skeleton className="h-7 w-36" />
        <DetailTableSkeleton
          columnsClassName="grid-cols-[10rem_8rem_10rem]"
          headerWidths={["w-10", "w-12", "w-10"]}
          rowWidths={["w-16", "w-12", "w-16"]}
          cellClassNames={["", "justify-self-end", ""]}
          rows={4}
        />
      </div>
    </div>
  );
}
