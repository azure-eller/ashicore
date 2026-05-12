import { notFound } from "next/navigation";

import { InventoryVisualsDemo } from "@/components/inventory-visuals/demo";

export default function InventoryVisualsDevPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return <InventoryVisualsDemo />;
}
