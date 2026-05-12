import { and, eq, or, sql } from "drizzle-orm";
import { lots, organization } from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";
import { isValidTimeZone } from "@/lib/time-zone";

const DEFAULT_LOT_TIME_ZONE = "America/Denver";
const LOT_NUMBER_PREFIX = "LOT-";

export function formatLotDate(value: Date, timeZone: string) {
  const effectiveTimeZone = isValidTimeZone(timeZone)
    ? timeZone
    : DEFAULT_LOT_TIME_ZONE;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: effectiveTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error(`Unable to format lot date for timezone: ${effectiveTimeZone}`);
  }

  return `${year}-${month}-${day}`;
}

export function formatDateLotNumber(value: Date, timeZone: string) {
  return `${LOT_NUMBER_PREFIX}${formatLotDate(value, timeZone)}`;
}

function nextDateLotNumber(baseLotNumber: string, existingLotNumbers: string[]) {
  if (!existingLotNumbers.includes(baseLotNumber)) {
    return baseLotNumber;
  }

  const suffixPattern = new RegExp(`^${baseLotNumber}-(\\d+)$`);
  const suffixes = existingLotNumbers
    .map((lotNumber) => suffixPattern.exec(lotNumber)?.[1])
    .filter((suffix): suffix is string => suffix != null)
    .map((suffix) => Number.parseInt(suffix, 10))
    .filter((suffix) => Number.isFinite(suffix));
  const nextSuffix = Math.max(0, ...suffixes) + 1;

  return `${baseLotNumber}-${String(nextSuffix).padStart(2, "0")}`;
}

async function getOrganizationTimeZoneInTx(tx: Tx, organizationId: string) {
  const [row] = await tx
    .select({ timeZone: organization.timeZone })
    .from(organization)
    .where(eq(organization.id, organizationId));

  return row?.timeZone ?? DEFAULT_LOT_TIME_ZONE;
}

export async function generateDateLotNumberInTx(
  tx: Tx,
  params: {
    organizationId: string;
    itemId: string;
    receivedAt: Date;
  }
) {
  const timeZone = await getOrganizationTimeZoneInTx(tx, params.organizationId);
  const baseLotNumber = formatDateLotNumber(params.receivedAt, timeZone);
  const existingLots = await tx
    .select({ lotNumber: lots.lotNumber })
    .from(lots)
    .where(
      and(
        eq(lots.organizationId, params.organizationId),
        eq(lots.itemId, params.itemId),
        or(
          eq(lots.lotNumber, baseLotNumber),
          sql`${lots.lotNumber} LIKE ${`${baseLotNumber}-%`}`
        )
      )
    )
    .for("update");

  return nextDateLotNumber(
    baseLotNumber,
    existingLots.map((lot) => lot.lotNumber)
  );
}
