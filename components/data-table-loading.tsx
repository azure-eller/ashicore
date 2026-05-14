import { Spinner } from "@/components/ui/spinner";

export default function DataTableLoading() {
  return (
    <div className="w-full" data-testid="data-table-loading">
      <div className="h-16" aria-hidden="true" />
      <div className="flex min-h-80 items-start justify-center rounded-md border bg-card pt-24">
        <Spinner className="size-9 text-foreground" />
      </div>
    </div>
  );
}
