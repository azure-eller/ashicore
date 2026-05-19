import { redirect } from "next/navigation";

export default async function NewProductPage() {
  redirect("/inventory/product");
}
