import { Spinner } from "@/components/ui/spinner";

export default function DataTableSkeleton() {
  return (
    <div className="flex min-h-40 w-full items-center justify-center">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Spinner className="text-foreground" />
        <span>Loading</span>
      </div>
    </div>
  );
}
