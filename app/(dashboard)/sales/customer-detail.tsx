"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Separator } from "@/components/ui/separator";
import { formatAddress, formatDateTime } from "@/lib/format";
import type { CustomerRow } from "./types";

export function CustomerDetail({ customer }: { customer: CustomerRow }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/customers/${customer.id}`, {
        method: "DELETE",
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to delete customer.");
      }
    },
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["customers"] });
      router.push("/sales/customers");
    },
    onError: (error) => {
      setActionError(error.message);
    },
  });

  const isDeleted = customer.deletedAt != null;

  return (
    <>
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <Link
              href="/sales/customers"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} size={14} aria-hidden /> Back to Customers
            </Link>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{customer.name}</h1>
              {isDeleted && <Badge variant="outline">Deleted</Badge>}
            </div>
          </div>

          {!isDeleted && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link href={`/sales/customers/${customer.id}/edit`}>Edit</Link>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDeleteOpen(true)}
                disabled={deleteMutation.isPending}
              >
                Delete
              </Button>
            </div>
          )}
        </div>

        <Separator />

        {customer.notes && (
          <p className="max-w-2xl text-sm text-muted-foreground">{customer.notes}</p>
        )}

        {actionError && (
          <p className="text-sm text-destructive">{actionError}</p>
        )}

        <dl className="grid max-w-2xl grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Pricing</dt>
            <dd className="mt-1 text-sm">
              {customer.customerCategoryName ?? "Everyone"}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Email</dt>
            <dd className="mt-1 text-sm">{customer.email ?? "\u2014"}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Phone</dt>
            <dd className="mt-1 text-sm">{customer.phone ?? "\u2014"}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Billing Address</dt>
            <dd className="mt-1 whitespace-pre-wrap text-sm">
              {formatAddress({
                line1: customer.billingLine1,
                line2: customer.billingLine2,
                city: customer.billingCity,
                region: customer.billingRegion,
                postcode: customer.billingPostcode,
                country: customer.billingCountry,
              }) || "\u2014"}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Shipping Address</dt>
            <dd className="mt-1 whitespace-pre-wrap text-sm">
              {formatAddress({
                line1: customer.shipLine1,
                line2: customer.shipLine2,
                city: customer.shipCity,
                region: customer.shipRegion,
                postcode: customer.shipPostcode,
                country: customer.shipCountry,
              }) || "\u2014"}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Created</dt>
            <dd className="mt-1 text-sm">{formatDateTime(customer.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Updated</dt>
            <dd className="mt-1 text-sm">{formatDateTime(customer.updatedAt)}</dd>
          </div>
          {customer.deletedAt && (
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Deleted</dt>
              <dd className="mt-1 text-sm">{formatDateTime(customer.deletedAt)}</dd>
            </div>
          )}
        </dl>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this customer?</AlertDialogTitle>
            <AlertDialogDescription>
              The customer will be soft-deleted. Customers with active draft or confirmed orders cannot be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate()}>
              {deleteMutation.isPending ? "Deleting..." : "Delete Customer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
