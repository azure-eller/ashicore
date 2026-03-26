import { FieldSeparator } from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { FieldSkeleton } from "@/components/field-skeleton";

export default function PurchaseOrderFormLoading() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
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
            <Skeleton className="h-6 w-16" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
          <div className="grid gap-4">
            <FieldSkeleton />
            <FieldSkeleton />
          </div>
        </div>

        <FieldSeparator />

        <div className="space-y-5">
          <div className="space-y-1">
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
          <div className="rounded-lg border">
            <div className="grid grid-cols-[minmax(0,1.5fr)_8rem_7rem_8rem_8rem_3rem] gap-4 border-b px-4 py-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-4 w-16" />
              ))}
            </div>
            {Array.from({ length: 2 }).map((_, rowIndex) => (
              <div
                key={rowIndex}
                className="grid grid-cols-[minmax(0,1.5fr)_8rem_7rem_8rem_8rem_3rem] gap-4 border-b px-4 py-4 last:border-0"
              >
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-4 w-10 self-center" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-4 w-12 self-center" />
                <Skeleton className="h-8 w-8 self-center" />
              </div>
            ))}
          </div>
          <Skeleton className="h-9 w-28" />
        </div>

        <FieldSeparator />

        <div className="max-w-4xl space-y-5">
          <div className="space-y-1">
            <Skeleton className="h-6 w-16" />
            <Skeleton className="h-4 w-64 max-w-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-14" />
            <Skeleton className="h-32 w-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
