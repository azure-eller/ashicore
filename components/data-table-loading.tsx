import { Spinner } from "@/components/ui/spinner";

export default function DataTableLoading() {
  return (
    <div
      className="w-full"
      data-testid="data-table-loading"
      role="status"
      aria-live="polite"
    >
      <div className="h-16" aria-hidden="true" />
      <div className="flex min-h-80 items-start justify-center pt-24">
        <Spinner className="size-9" />
        <span className="sr-only">Loading</span>
      </div>
    </div>
  );
}
