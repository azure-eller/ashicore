import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-md bg-muted ${className}`} />;
}

export default function SalesOrdersTableLoading() {
  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div className="space-y-2">
          <SkeletonBlock className="h-7 w-44" />
          <SkeletonBlock className="h-4 w-56" />
        </div>
        <SkeletonBlock className="h-4 w-32" />
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <Card key={index} size="sm" className="rounded-lg py-3 shadow-xs">
            <CardContent className="flex items-center justify-between gap-3 px-3">
              <div className="space-y-2">
                <SkeletonBlock className="h-3 w-20" />
                <SkeletonBlock className="h-6 w-16" />
              </div>
              <SkeletonBlock className="size-9" />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="rounded-xl border bg-card/70 p-3 shadow-xs">
        <div className="flex flex-wrap gap-2">
          <SkeletonBlock className="h-8 w-72" />
          <SkeletonBlock className="h-8 w-40" />
          <SkeletonBlock className="h-8 w-44" />
          <SkeletonBlock className="h-8 w-36" />
        </div>
      </div>

      <ScrollArea className="-mx-4 overflow-hidden pb-3" viewportClassName="px-4 pb-3">
        <div className="flex gap-3">
          {Array.from({ length: 5 }).map((_, laneIndex) => (
            <section
              key={laneIndex}
              className="flex h-[calc(100vh-20rem)] min-h-[32rem] max-h-[46rem] w-[19rem] shrink-0 flex-col rounded-xl bg-muted/25 p-2.5 ring-1 ring-border/60"
            >
              <div className="mb-2 flex items-start justify-between px-1">
                <div className="space-y-2">
                  <SkeletonBlock className="h-4 w-28" />
                  <SkeletonBlock className="h-3 w-36" />
                </div>
                <SkeletonBlock className="size-7" />
              </div>
              <ScrollArea
                className="min-h-0 flex-1 overflow-hidden"
                viewportClassName="pl-1 pr-3 pb-4"
              >
                <div className="flex flex-col gap-2">
                  {Array.from({ length: laneIndex === 1 ? 3 : 2 }).map(
                    (_, cardIndex) => (
                      <Card
                        key={cardIndex}
                        size="sm"
                        className="gap-0 rounded-lg py-0 shadow-xs"
                      >
                        <CardContent className="space-y-3 px-3 py-3">
                          <div className="flex justify-between gap-3">
                            <div className="space-y-2">
                              <SkeletonBlock className="h-4 w-28" />
                              <SkeletonBlock className="h-3 w-20" />
                            </div>
                            <SkeletonBlock className="h-5 w-16" />
                          </div>
                          <SkeletonBlock className="h-1.5 w-full" />
                          <SkeletonBlock className="h-3 w-40" />
                        </CardContent>
                      </Card>
                    )
                  )}
                </div>
              </ScrollArea>
            </section>
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  );
}
