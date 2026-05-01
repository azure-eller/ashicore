import { Spinner } from "@/components/ui/spinner";

export default function DataTableLoading() {
  return (
    <div className="flex min-h-40 w-full items-center justify-center">
      <Spinner className="text-foreground" />
    </div>
  );
}
