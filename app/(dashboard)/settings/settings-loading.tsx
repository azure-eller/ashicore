import { Skeleton } from "@/components/ui/skeleton";

export default function SettingsLoading() {
  return (
    <div className="mx-auto w-full max-w-5xl">
      <Skeleton className="h-9 w-32" />

      <div className="mt-8 flex flex-col-reverse gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_160px] lg:gap-8">
        <div className="flex min-w-0 flex-col gap-6">
          {/* Account section skeleton */}
          <div className="rounded-lg border p-6">
            <Skeleton className="mb-4 h-5 w-20" />
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={index}
                className="flex items-center justify-between gap-4 border-t py-3 first:border-t-0"
              >
                <div className="flex flex-1 items-center gap-4">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-40" />
                </div>
                <Skeleton className="h-8 w-14" />
              </div>
            ))}
          </div>

          {/* Team section skeleton */}
          <div className="rounded-lg border">
            <div className="flex items-center justify-between gap-4 p-6">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-9 w-32" />
            </div>
            <div className="divide-y border-t">
              {Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between gap-4 px-6 py-4"
                >
                  <div className="space-y-1">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                  <Skeleton className="h-5 w-20" />
                </div>
              ))}
            </div>
          </div>
        </div>

        <nav className="w-full">
          <div className="flex gap-2 overflow-x-auto rounded-lg border bg-card p-1 lg:flex-col lg:gap-0 lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0">
            <Skeleton className="h-7 w-20 shrink-0 rounded-md lg:w-full lg:rounded-none" />
            <Skeleton className="h-7 w-16 shrink-0 rounded-md lg:w-full lg:rounded-none" />
            <Skeleton className="h-7 w-24 shrink-0 rounded-md lg:w-full lg:rounded-none" />
          </div>
        </nav>
      </div>
    </div>
  );
}
