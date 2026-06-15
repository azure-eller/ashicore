import type { ReactNode } from "react";
import { ProductCardShell } from "../card-shell";

export const dynamic = "force-dynamic";

export default async function ProductCardLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: ReactNode;
}) {
  const { id } = await params;

  return <ProductCardShell itemId={id}>{children}</ProductCardShell>;
}
