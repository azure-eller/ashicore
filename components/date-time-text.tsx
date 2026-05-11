"use client";

import { useOrganizationTimeZone } from "@/components/time-zone-provider";
import { formatDateTime } from "@/lib/format";

export function DateTimeText({
  value,
}: {
  value: string | Date | null | undefined;
}) {
  const timeZone = useOrganizationTimeZone();
  return <>{formatDateTime(value, timeZone)}</>;
}
