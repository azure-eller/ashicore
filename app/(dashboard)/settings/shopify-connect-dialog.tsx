"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { apiJson } from "@/lib/client/api";
import type { ShopifyConnectionSummary } from "@/lib/dal/shopify";

export function ShopifyConnectDialog({
  open,
  connection,
  onOpenChange,
}: {
  open: boolean;
  connection: ShopifyConnectionSummary | null;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [shopDomain, setShopDomain] = useState(connection?.shopDomain ?? "");
  const [accessToken, setAccessToken] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      apiJson("/api/shopify/connection", {
        method: "PUT",
        body: { shopDomain, accessToken },
        fallbackError: "Failed to save Shopify connection.",
      }),
    onSuccess: () => {
      setAccessToken("");
      setError(null);
      onOpenChange(false);
      router.refresh();
      queryClient.invalidateQueries();
    },
    onError: (err) => setError((err as Error).message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Shopify</DialogTitle>
          <DialogDescription>Private Admin API connection.</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="shopify-domain">Shop domain</FieldLabel>
            <Input
              id="shopify-domain"
              value={shopDomain}
              onChange={(event) => setShopDomain(event.target.value)}
              placeholder="store.myshopify.com"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="shopify-token">Admin API token</FieldLabel>
            <Input
              id="shopify-token"
              type="password"
              value={accessToken}
              onChange={(event) => setAccessToken(event.target.value)}
            />
          </Field>
          {error ? <FieldError>{error}</FieldError> : null}
        </FieldGroup>
        <DialogFooter>
          <Button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
