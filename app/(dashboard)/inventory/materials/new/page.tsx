import { redirect } from "next/navigation";

export default async function NewMaterialPage() {
  redirect("/inventory/material");
}
