import { Badge } from "@/components/ui/badge";
import type { ManufacturingPickProgressStatus } from "./types";

export function ManufacturingPickProgressBadge({
  status,
}: {
  status: ManufacturingPickProgressStatus;
}) {
  if (status === "picked") {
    return <Badge variant="outline">Picked</Badge>;
  }

  if (status === "in_progress") {
    return <Badge>In Progress</Badge>;
  }

  return <Badge variant="secondary">Not Started</Badge>;
}
