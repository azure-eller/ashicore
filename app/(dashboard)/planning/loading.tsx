import { Skeleton } from "@/components/ui/skeleton";

export default function PlanningLoading() {
  return (
    <main className="flex w-full flex-col gap-6 px-7 py-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-4 w-96 max-w-full" />
          <Skeleton className="h-3 w-28" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-7 w-24" />
        </div>
      </div>

      <div className="flex border-b">
        <Skeleton className="h-11 w-36 rounded-none" />
        <Skeleton className="h-11 w-40 rounded-none" />
      </div>

      <div className="flex justify-end gap-2">
        <Skeleton className="h-8 w-80" />
        <Skeleton className="h-8 w-20" />
      </div>

      <div className="grid overflow-hidden rounded-lg border md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className={`p-4 ${index > 0 ? "border-t md:border-l md:border-t-0" : ""}`}
          >
            <Skeleton className="h-3 w-32" />
            <Skeleton className="mt-3 h-6 w-24" />
          </div>
        ))}
      </div>

      <div className="space-y-3">
        <div className="flex items-baseline justify-between border-b pb-3">
          <div className="flex items-baseline gap-3">
            <Skeleton className="h-3 w-10" />
            <Skeleton className="h-5 w-28" />
          </div>
          <Skeleton className="h-3 w-32" />
        </div>
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-16 rounded-lg" />
        ))}
      </div>
    </main>
  );
}
