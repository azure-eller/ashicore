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
import { formatDateTime } from "@/lib/format";
import type { SupplierRow } from "./types";

export function SupplierDetail({ supplier }: { supplier: SupplierRow }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/suppliers/${supplier.id}`, {
        method: "DELETE",
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to delete supplier.");
      }
    },
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      router.push("/purchasing/suppliers");
    },
    onError: (error) => {
      setActionError(error.message);
    },
  });

  const isDeleted = supplier.deletedAt != null;

  return (
    <>
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <Link
              href="/purchasing/suppliers"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} size={14} aria-hidden /> Back to Suppliers
            </Link>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{supplier.name}</h1>
              {supplier.code && <Badge variant="outline">{supplier.code}</Badge>}
              {isDeleted && <Badge variant="outline">Deleted</Badge>}
            </div>
          </div>

          {!isDeleted && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link href={`/purchasing/suppliers/${supplier.id}/edit`}>Edit</Link>
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

        {supplier.notes && (
          <p className="max-w-2xl text-sm text-muted-foreground">{supplier.notes}</p>
        )}

        {actionError && <p className="text-sm text-destructive">{actionError}</p>}

        <dl className="grid max-w-3xl grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Contact Name</dt>
            <dd className="mt-1 text-sm">{supplier.contactName ?? "\u2014"}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Payment Terms</dt>
            <dd className="mt-1 text-sm">{supplier.paymentTerms ?? "\u2014"}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Email</dt>
            <dd className="mt-1 text-sm">{supplier.email ?? "\u2014"}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Phone</dt>
            <dd className="mt-1 text-sm">{supplier.phone ?? "\u2014"}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-sm font-medium text-muted-foreground">Address</dt>
            <dd className="mt-1 whitespace-pre-wrap text-sm">
              {supplier.address ?? "\u2014"}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Created</dt>
            <dd className="mt-1 text-sm">{formatDateTime(supplier.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Updated</dt>
            <dd className="mt-1 text-sm">{formatDateTime(supplier.updatedAt)}</dd>
          </div>
          {supplier.deletedAt && (
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Deleted</dt>
              <dd className="mt-1 text-sm">{formatDateTime(supplier.deletedAt)}</dd>
            </div>
          )}
        </dl>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this supplier?</AlertDialogTitle>
            <AlertDialogDescription>
              The supplier will be soft-deleted. Suppliers with active draft,
              ordered, or partially received purchase orders cannot be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete Supplier"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
