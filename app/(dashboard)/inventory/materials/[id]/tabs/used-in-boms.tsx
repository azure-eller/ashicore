"use client";

import Link from "next/link";
import styles from "@/components/card-page/card-page.module.css";

export type MaterialUsedInBomsTabProps = {
  usedInBoms: Array<{
    id: string;
    name: string;
    displayName: string;
  }>;
};

export function MaterialUsedInBomsTab({ usedInBoms }: MaterialUsedInBomsTabProps) {
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
        BOMs
        <span className={styles.count}>· {usedInBoms.length}</span>
      </h2>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Product</th>
          </tr>
        </thead>
        <tbody>
          {usedInBoms.map((bom) => (
            <tr key={bom.id}>
              <td>
                <Link
                  href={`/inventory/products/${bom.id}?view=card&tab=recipe&variant=${bom.id}`}
                  style={{ color: "var(--color-accent)", textDecoration: "underline" }}
                >
                  {bom.displayName}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
