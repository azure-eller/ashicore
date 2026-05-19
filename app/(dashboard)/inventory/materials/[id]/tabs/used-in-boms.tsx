"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { ICellRendererParams } from "ag-grid-community";
import { ERPDataGrid, type ColDef } from "@/components/erp-data-grid";
import styles from "@/components/card-page/card-page.module.css";

type UsedInBomRow = {
  id: string;
  name: string;
  displayName: string;
};

export type MaterialUsedInBomsTabProps = {
  usedInBoms: UsedInBomRow[];
};

export function MaterialUsedInBomsTab({ usedInBoms }: MaterialUsedInBomsTabProps) {
  const columns = useMemo<Array<ColDef<UsedInBomRow>>>(
    () => [
      {
        field: "displayName",
        headerName: "Product",
        flex: 1,
        cellRenderer: (params: ICellRendererParams<UsedInBomRow>) => {
          if (!params.data) return null;
          return (
            <Link
              href={`/inventory/products/${params.data.id}/recipe`}
              style={{
                color: "var(--color-accent)",
                textDecoration: "underline",
              }}
            >
              {params.data.displayName}
            </Link>
          );
        },
      },
    ],
    [],
  );

  if (usedInBoms.length === 0) {
    return (
      <section className={styles.section}>
        <p className={styles.helper}>Not used in any BOMs yet.</p>
      </section>
    );
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionHeading}>
        BOMs <span className={styles.count}>· {usedInBoms.length}</span>
      </h2>
      <ERPDataGrid<UsedInBomRow>
        rows={usedInBoms}
        columns={columns}
        getRowId={(row) => row.id}
        headerHeight={30}
        rowHeight={34}
      />
    </section>
  );
}
