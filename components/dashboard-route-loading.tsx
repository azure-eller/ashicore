import { Spinner } from "@/components/ui/spinner";

export default function DashboardRouteLoading() {
  return (
    <div className="flex min-h-64 flex-1 items-center justify-center p-6">
      <div className="flex items-center gap-3 rounded-md border bg-background px-4 py-3 text-sm text-muted-foreground shadow-xs">
        <Spinner className="text-foreground" />
        <span>Loading</span>
      </div>
    </div>
  );
}
