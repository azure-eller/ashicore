import Link from "next/link";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { DataTable } from "../data-table";
import { getItems } from "../queries";

export default async function ProductsPage() {
  const items = await getItems({ itemType: "product" });
  return (
    <>
      <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
        <div className="flex items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mr-2 data-vertical:h-4 data-vertical:self-auto"
          />
          <nav className="flex items-center gap-4 text-sm">
            <span className="font-medium text-foreground">Products</span>
            <Link
              href="/inventory/materials"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              Materials
            </Link>
          </nav>
        </div>
      </header>
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <DataTable initialData={items} itemType="product" />
      </div>
    </>
  );
}
