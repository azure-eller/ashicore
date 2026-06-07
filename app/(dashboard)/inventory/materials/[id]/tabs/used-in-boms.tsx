"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { ICellRendererParams } from "ag-grid-community";
import { CardSection } from "@/components/card-page/card-page";
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
              className="font-medium text-[var(--color-accent-ink)] underline underline-offset-2 hover:text-[var(--color-ink)]"
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
      <CardSection>
        <p className={styles.helper}>Not used in any current product recipes.</p>
      </CardSection>
    );
  }

  return (
    <CardSection title="BOMs" count={`· ${usedInBoms.length}`}>
      <ERPDataGrid<UsedInBomRow>
        rows={usedInBoms}
        columns={columns}
        getRowId={(row) => row.id}
        headerHeight={36}
        rowHeight={44}
      />
    </CardSection>
  );
}
