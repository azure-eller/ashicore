import { Skeleton } from "@/components/ui/skeleton";

export default function PlanningLoading() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-48" />
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <Skeleton className="h-8 w-full max-w-sm" />
          <Skeleton className="h-8 w-36" />
        </div>
      </div>
      <div className="rounded-lg border">
        <div className="flex flex-col gap-3 p-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-8 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
