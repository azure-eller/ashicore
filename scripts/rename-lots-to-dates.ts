import { loadWorktreeEnv } from "./load-worktree-env";

loadWorktreeEnv();

void main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown lot rename error";
  console.error(message);
  process.exit(1);
});

type ParsedArgs = {
  apply: boolean;
  confirm: string | null;
  orgRef: string;
  help: boolean;
};

type LotRow = {
  id: string;
  organizationId: string;
  itemId: string;
  itemName: string;
  lotNumber: string;
  receivedAt: Date;
  createdAt: Date;
};

type LotRename = LotRow & {
  nextLotNumber: string;
};

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    apply: false,
    confirm: null,
    orgRef: "paonia-soil-company",
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    } else if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--apply") {
      parsed.apply = true;
    } else if (arg === "--confirm") {
      parsed.confirm = argv[++index] ?? null;
    } else if (arg === "--org") {
      parsed.orgRef = argv[++index] ?? parsed.orgRef;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function printUsage() {
  console.log(
    [
      "Usage:",
      "  pnpm rename:paonia-lots",
      "  pnpm rename:paonia-lots -- --apply --confirm paonia-soil-company",
      "",
      "Flags:",
      "  --org <id|slug|name>   Org to rename lots in (default: paonia-soil-company)",
      "  --apply                Write changes. Omit for dry-run preview.",
      "  --confirm <org-slug>   Required with --apply.",
    ].join("\n")
  );
}

function nextLotNumber(baseLotNumber: string, used: Set<string>) {
  if (!used.has(baseLotNumber)) {
    used.add(baseLotNumber);
    return baseLotNumber;
  }

  for (let suffix = 1; suffix < 100; suffix += 1) {
    const candidate = `${baseLotNumber}-${String(suffix).padStart(2, "0")}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }

  throw new Error(`Could not allocate a lot suffix for ${baseLotNumber}.`);
}

function planRenames(
  rows: LotRow[],
  timeZone: string,
  formatLotDate: (value: Date, timeZone: string) => string
) {
  const rowsByItem = new Map<string, LotRow[]>();
  for (const row of rows) {
    const bucket = rowsByItem.get(row.itemId) ?? [];
    bucket.push(row);
    rowsByItem.set(row.itemId, bucket);
  }

  const renames: LotRename[] = [];
  for (const itemRows of rowsByItem.values()) {
    const rowsByDate = new Map<string, LotRow[]>();
    for (const row of itemRows) {
      const baseLotNumber = formatLotDate(row.receivedAt, timeZone);
      const bucket = rowsByDate.get(baseLotNumber) ?? [];
      bucket.push(row);
      rowsByDate.set(baseLotNumber, bucket);
    }

    for (const [baseLotNumber, dateRows] of rowsByDate.entries()) {
      const used = new Set(
        dateRows
          .map((row) => row.lotNumber)
          .filter(
            (lotNumber) =>
              lotNumber === baseLotNumber ||
              new RegExp(`^${baseLotNumber}-\\d{2}$`).test(lotNumber)
          )
      );
      const sortedRows = dateRows.toSorted((left, right) => {
        const receivedCompare = left.receivedAt.getTime() - right.receivedAt.getTime();
        if (receivedCompare !== 0) return receivedCompare;
        const createdCompare = left.createdAt.getTime() - right.createdAt.getTime();
        if (createdCompare !== 0) return createdCompare;
        return left.id.localeCompare(right.id);
      });

      for (const row of sortedRows) {
        if (used.has(row.lotNumber)) {
          continue;
        }

        const next = nextLotNumber(baseLotNumber, used);
        if (next !== row.lotNumber) {
          renames.push({ ...row, nextLotNumber: next });
        }
      }
    }
  }

  return renames;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const { and, asc, eq, sql } = await import("drizzle-orm");
  const { db } = await import("@/lib/db");
  const { inventoryEvents, items, lots, organization } = await import("@/lib/db/schema");
  const { withOrgContext } = await import("@/lib/db/with-org-context");
  const { formatLotDate } = await import("@/lib/inventory/lot-numbers");
  const { resolveOrganization } = await import("./load/engine/org");

  const org = await resolveOrganization(args.orgRef);
  if (args.apply && args.confirm !== org.slug) {
    throw new Error(
      `--apply requires --confirm ${org.slug} for the resolved organization.`
    );
  }

  const [orgDetails] = await db
    .select({ timeZone: organization.timeZone })
    .from(organization)
    .where(eq(organization.id, org.id));
  const timeZone = orgDetails?.timeZone ?? "America/Denver";

  const result = await withOrgContext(org.id, async (tx) => {
    const rows = await tx
      .select({
        id: lots.id,
        organizationId: lots.organizationId,
        itemId: lots.itemId,
        itemName: items.name,
        lotNumber: lots.lotNumber,
        receivedAt: lots.receivedAt,
        createdAt: lots.createdAt,
      })
      .from(lots)
      .innerJoin(items, eq(items.id, lots.itemId))
      .where(eq(lots.organizationId, org.id))
      .orderBy(asc(items.name), asc(lots.receivedAt), asc(lots.createdAt), asc(lots.id))
      .for("update");

    const renames = planRenames(rows, timeZone, formatLotDate);
    const eventUpdates: Array<{ lotId: string; updatedEvents: number }> = [];

    if (args.apply && renames.length > 0) {
      for (const rename of renames) {
        await tx
          .update(lots)
          .set({
            lotNumber: `__RENAMING__${rename.id}`,
            updatedAt: new Date(),
          })
          .where(eq(lots.id, rename.id));
      }

      for (const rename of renames) {
        await tx
          .update(lots)
          .set({
            lotNumber: rename.nextLotNumber,
            updatedAt: new Date(),
          })
          .where(eq(lots.id, rename.id));

        const updatedEvents = await tx
          .update(inventoryEvents)
          .set({
            metadata: sql`jsonb_set(COALESCE(${inventoryEvents.metadata}, '{}'::jsonb), '{lotNumber}', to_jsonb(${rename.nextLotNumber}::text), true)`,
          })
          .where(
            and(
              eq(inventoryEvents.organizationId, org.id),
              eq(inventoryEvents.lotId, rename.id),
              sql`${inventoryEvents.metadata} ? 'lotNumber'`
            )
          )
          .returning({ id: inventoryEvents.id });

        eventUpdates.push({
          lotId: rename.id,
          updatedEvents: updatedEvents.length,
        });
      }
    }

    return { rows, renames, eventUpdates };
  });

  const mode = args.apply ? "Apply" : "Dry run";
  console.log(`${mode} lot rename summary for ${org.name} (${org.slug}):`);
  console.log(`  Lots inspected: ${result.rows.length}`);
  console.log(`  Lots ${args.apply ? "renamed" : "to rename"}: ${result.renames.length}`);
  if (args.apply) {
    console.log(
      `  Inventory event metadata rows updated: ${result.eventUpdates.reduce(
        (sum, row) => sum + row.updatedEvents,
        0
      )}`
    );
  }

  if (result.renames.length > 0) {
    console.log("");
    console.log("Lot changes:");
    for (const rename of result.renames) {
      console.log(
        `  - ${rename.itemName}: ${rename.lotNumber} -> ${rename.nextLotNumber}`
      );
    }
  }
}
