import { sql } from "drizzle-orm";
import type { SQLWrapper } from "drizzle-orm/sql/sql";
import type { Tx } from "@/lib/db/with-org-context";
import {
  documentNumberPattern,
  type DocumentNumberPrefix,
} from "@/lib/document-number-format";

type DocumentNumberKind = "purchase_order" | "sales_order" | "manufacturing_order";

type DocumentNumberSource = {
  prefix: DocumentNumberPrefix;
  tableName: string;
  organizationColumnName: string;
  orderNumberColumnName: string;
};

const DOCUMENT_NUMBER_SOURCES: Record<DocumentNumberKind, DocumentNumberSource> = {
  purchase_order: {
    prefix: "PO",
    tableName: "purchasing.purchase_orders",
    organizationColumnName: "organization_id",
    orderNumberColumnName: "order_number",
  },
  sales_order: {
    prefix: "SO",
    tableName: "sales.sales_orders",
    organizationColumnName: "organization_id",
    orderNumberColumnName: "order_number",
  },
  manufacturing_order: {
    prefix: "MO",
    tableName: "manufacturing.manufacturing_orders",
    organizationColumnName: "organization_id",
    orderNumberColumnName: "order_number",
  },
};

export async function generateShortDocumentNumberInTx(
  tx: Tx,
  kind: DocumentNumberKind,
  organizationId: string
) {
  const source = DOCUMENT_NUMBER_SOURCES[kind];
  const pattern = documentNumberPattern(source.prefix);

  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`document-number:${kind}:${organizationId}`}))`
  );

  const result = await tx.execute(sql`
    SELECT COALESCE(
      MAX((substring(${sql.raw(source.orderNumberColumnName)} from ${pattern}))::bigint),
      0
    ) AS max
    FROM ${sql.raw(source.tableName)}
    WHERE ${sql.raw(source.organizationColumnName)} = ${organizationId}
      AND ${sql.raw(source.orderNumberColumnName)} ~ ${pattern}
  `);

  const raw = (result.rows[0] as { max: string | number | bigint | null }).max;
  const next = BigInt(String(raw ?? 0)) + BigInt(1);
  return `${source.prefix}-${next.toString()}`;
}

export function documentNumberSortSql(column: SQLWrapper, prefix: DocumentNumberPrefix) {
  const pattern = documentNumberPattern(prefix);
  return sql<bigint>`COALESCE(
    (substring(${column} from ${pattern}))::bigint,
    9223372036854775807::bigint
  )`;
}
