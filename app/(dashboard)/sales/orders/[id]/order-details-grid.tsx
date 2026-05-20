"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import type { SalesOrderDetail } from "@/app/(dashboard)/sales/types";
import { formatAddressLines, formatDate } from "@/lib/format";
import cardStyles from "@/components/card-page/card-page.module.css";
import styles from "./order-card.module.css";

export type OrderDetailsGridProps = {
  order: SalesOrderDetail;
  editable: boolean;
  onEditCustomer?: () => void;
  onEditProject?: () => void;
  onEditShipTo?: () => void;
  onEditOrderDate?: () => void;
  onEditShipDate?: () => void;
  onEditRequestedDate?: () => void;
};

export function OrderDetailsGrid({
  order,
  editable,
  onEditCustomer,
  onEditProject,
  onEditShipTo,
  onEditOrderDate,
  onEditShipDate,
  onEditRequestedDate,
}: OrderDetailsGridProps) {
  const shipAddress = formatAddressLines({
    line1: order.shipLine1,
    line2: order.shipLine2,
    city: order.shipCity,
    region: order.shipRegion,
    postcode: order.shipPostcode,
    country: order.shipCountry,
  });

  return (
    <section className={cardStyles.section}>
      <h2 className={cardStyles.sectionHeading}>Order details</h2>
      <div className={styles.detailsGrid}>
        <DetailsCell
          label="Customer"
          span={2}
          editable={editable}
          onEdit={onEditCustomer}
        >
          <div className={styles.detailsCellValue}>
            <span>{order.customerName}</span>
          </div>
          {order.customerEmail ? (
            <div className={styles.detailsCellSub}>{order.customerEmail}</div>
          ) : null}
        </DetailsCell>

        <DetailsCell
          label="Project / Job"
          editable={editable}
          onEdit={onEditProject}
        >
          {order.customerProjectName ? (
            <div className={styles.detailsCellValue}>{order.customerProjectName}</div>
          ) : (
            <div className={`${styles.detailsCellValue} ${styles.detailsCellPlaceholder}`}>—</div>
          )}
        </DetailsCell>

        <DetailsCell
          label="Order date"
          editable={editable}
          onEdit={onEditOrderDate}
        >
          <div className={`${styles.detailsCellValue} ${styles.detailsCellValue} ${cardStyles.mono}`}>
            {formatDate(order.orderDate)}
          </div>
        </DetailsCell>

        <DetailsCell
          label="Ship to"
          span={2}
          editable={editable}
          onEdit={onEditShipTo}
        >
          {shipAddress.length > 0 ? (
            <div className={styles.detailsCellValue} style={{ flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
              {shipAddress.map((line, idx) => (
                <span key={idx}>{line}</span>
              ))}
            </div>
          ) : (
            <div className={`${styles.detailsCellValue} ${styles.detailsCellPlaceholder}`}>
              No shipping address set
            </div>
          )}
        </DetailsCell>

        <DetailsCell
          label="Shipping date"
          editable={editable}
          onEdit={onEditShipDate}
        >
          {order.shipDate ? (
            <div className={`${styles.detailsCellValue} ${cardStyles.mono}`}>
              {formatDate(order.shipDate)}
            </div>
          ) : (
            <div className={`${styles.detailsCellValue} ${styles.detailsCellPlaceholder}`}>—</div>
          )}
        </DetailsCell>

        <DetailsCell
          label="Requested date"
          editable={editable}
          onEdit={onEditRequestedDate}
        >
          {order.requestedDate ? (
            <div className={`${styles.detailsCellValue} ${cardStyles.mono}`}>
              {formatDate(order.requestedDate)}
            </div>
          ) : (
            <div className={`${styles.detailsCellValue} ${styles.detailsCellPlaceholder}`}>—</div>
          )}
        </DetailsCell>
      </div>
    </section>
  );
}

type DetailsCellProps = {
  label: string;
  span?: 1 | 2;
  editable: boolean;
  onEdit?: () => void;
  children: React.ReactNode;
};

function DetailsCell({ label, span, editable, onEdit, children }: DetailsCellProps) {
  const cellClass = [
    styles.detailsCell,
    span === 2 ? styles.detailsCellSpan2 : "",
    editable && onEdit ? styles.detailsCellEditable : "",
  ]
    .filter(Boolean)
    .join(" ");

  const inner = (
    <>
      <div className={styles.detailsCellLabel}>{label}</div>
      {children}
      {editable && onEdit ? (
        <span className={styles.detailsCellChevron} aria-hidden="true">
          <HugeiconsIcon icon={ArrowRight01Icon} size={12} />
        </span>
      ) : null}
    </>
  );

  if (editable && onEdit) {
    return (
      <button type="button" className={cellClass} onClick={onEdit}>
        {inner}
      </button>
    );
  }

  return <div className={cellClass}>{inner}</div>;
}
