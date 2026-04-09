import { Skeleton } from "@/components/ui/skeleton";
import { FieldSeparator } from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import { FieldSkeleton } from "@/components/field-skeleton";
import type { ItemType } from "./types";

interface ItemFormLoadingProps {
  itemType?: ItemType;
}

export function ItemFormLoading({ itemType = "material" }: ItemFormLoadingProps) {
  const isProduct = itemType === "product";

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <div className="flex gap-3">
          <Skeleton className="h-10 w-20" />
          <Skeleton className="h-10 w-32" />
        </div>
      </div>

      <Separator />

      <div className="space-y-8">
        <div className="max-w-4xl space-y-5">
          <div className="space-y-1">
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
          <div className="space-y-6">
            <FieldSkeleton />
            <div className="space-y-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-24 w-full" />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <FieldSkeleton />
              <FieldSkeleton />
            </div>
            <FieldSkeleton />
          </div>
        </div>

        <FieldSeparator />

        <div className="max-w-4xl space-y-5">
          <div className="space-y-1">
            <Skeleton className="h-6 w-28" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {!isProduct && <FieldSkeleton />}
            <FieldSkeleton />
            <FieldSkeleton />
            <FieldSkeleton />
          </div>
        </div>

        {isProduct && (
          <>
            <FieldSeparator />
            <div className="space-y-6">
              <div className="space-y-1">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-4 w-80 max-w-full" />
              </div>
              <Skeleton className="h-10 w-52" />
              <div className="rounded-lg border">
                <div className="grid grid-cols-[minmax(0,1fr)_8rem_6rem_3rem] gap-4 border-b px-4 py-3">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-10" />
                  <Skeleton className="h-4 w-10" />
                  <Skeleton className="h-4 w-4" />
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_8rem_6rem_3rem] gap-4 px-4 py-4">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-4 w-8 self-center" />
                  <Skeleton className="h-8 w-8 self-center" />
                </div>
              </div>
              <Skeleton className="h-9 w-32" />
            </div>

            <FieldSeparator />
            <div className="max-w-4xl space-y-5">
              <div className="space-y-1">
                <Skeleton className="h-6 w-36" />
                <Skeleton className="h-4 w-80 max-w-full" />
              </div>
              <FieldSkeleton />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
