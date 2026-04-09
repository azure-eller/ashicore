import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

export default function SettingsLoading() {
  return (
    <div className="mx-auto w-full max-w-7xl">
      <div className="space-y-1.5">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>

      <div className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1fr)_220px] xl:items-start">
        <div className="order-2 min-w-0 xl:order-1">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
            {/* Profile section skeleton */}
            <div className="rounded-xl border bg-background p-6">
              <div className="flex flex-col gap-6">
                <div className="flex flex-col gap-1">
                  <Skeleton className="h-6 w-16" />
                  <Skeleton className="h-4 w-64" />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-12" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-12" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                </div>
                <Separator />
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-56" />
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-28" />
                      <Skeleton className="h-10 w-full" />
                    </div>
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-10 w-full" />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Skeleton className="h-4 w-36" />
                      <Skeleton className="h-10 w-full" />
                    </div>
                  </div>
                </div>
                <Separator />
                <div className="flex justify-end">
                  <Skeleton className="h-10 w-16" />
                </div>
              </div>
            </div>

            {/* Team section skeleton */}
            <div className="rounded-xl border bg-background">
              <div className="flex flex-col gap-4 p-6 md:flex-row md:items-end md:justify-between">
                <div className="flex flex-col gap-1">
                  <Skeleton className="h-6 w-12" />
                  <Skeleton className="h-4 w-48" />
                </div>
                <Skeleton className="h-10 w-36" />
              </div>
              <div className="border-t px-6 py-4">
                <Skeleton className="mb-3 h-4 w-20" />
                <div className="divide-y rounded-xl border">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <div key={index} className="flex items-center justify-between gap-4 px-4 py-4">
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
          </div>
        </div>

        <div className="order-1 xl:order-2 xl:justify-self-end">
          <nav className="w-full xl:w-[220px]">
            <div className="flex gap-2 overflow-x-auto rounded-xl border bg-card p-1 xl:flex-col xl:gap-0 xl:rounded-none xl:border-0 xl:bg-transparent xl:p-0">
              <Skeleton className="h-9 w-20 shrink-0 rounded-lg xl:w-full xl:rounded-none" />
              <Skeleton className="h-9 w-16 shrink-0 rounded-lg xl:w-full xl:rounded-none" />
            </div>
          </nav>
        </div>
      </div>
    </div>
  );
}
