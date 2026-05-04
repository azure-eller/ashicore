"use client";

import Link from "next/link";
import { itemDetailHref } from "@/app/(dashboard)/inventory/types";
import { QuantityWithUnit } from "@/components/quantity-with-unit";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { OversellWarningProduct } from "./types";

export const OVERSELL_WARNING_DESCRIPTION =
  "Manufacture or purchase the short stock before shipping.";

type OversellWarningTableProps = {
  products: OversellWarningProduct[];
  linkItems?: boolean;
  rowKeyPrefix?: string;
};

export function OversellWarningTable({
  products,
  linkItems = false,
  rowKeyPrefix,
}: OversellWarningTableProps) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Item</TableHead>
            <TableHead>Current Stock</TableHead>
            <TableHead>Order Amount</TableHead>
            <TableHead>Short</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.map((product) => (
            <TableRow key={`${rowKeyPrefix ?? "oversell"}-${product.itemId}`}>
              <TableCell>
                <OversellItemName product={product} linkItem={linkItems} />
              </TableCell>
              <TableCell>
                <QuantityWithUnit value={product.inStock} unitName={product.unitName} />
              </TableCell>
              <TableCell>
                <QuantityWithUnit value={product.addedQty} unitName={product.unitName} />
              </TableCell>
              <TableCell>
                <QuantityWithUnit
                  value={product.projectedShortageQty}
                  unitName={product.unitName}
                  tone="destructive"
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function OversellItemName({
  product,
  linkItem,
}: {
  product: OversellWarningProduct;
  linkItem: boolean;
}) {
  const content = (
    <>
      <div className="font-medium">{product.itemName}</div>
      {product.itemSku ? (
        <div className="text-xs text-muted-foreground">{product.itemSku}</div>
      ) : null}
    </>
  );

  if (!linkItem) {
    return content;
  }

  return (
    <Link href={itemDetailHref("product", product.itemId)} className="hover:underline">
      {content}
    </Link>
  );
}
