import { Skeleton } from "@/components/ui/skeleton";

export default function TeamLoading() {
  return (
    <div className="mx-auto w-full max-w-6xl py-8">
      <div className="space-y-8">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-10 w-40" />
            <Skeleton className="h-4 w-[32rem]" />
          </div>
          <Skeleton className="h-10 w-36" />
        </div>
        <Skeleton className="h-[18rem] w-full" />
        <Skeleton className="h-[16rem] w-full" />
      </div>
    </div>
  );
}
