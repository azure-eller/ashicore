"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  ApiIcon,
  Copy01Icon,
  Delete02Icon,
  Key01Icon,
} from "@hugeicons/core-free-icons";
import { DateTimeText } from "@/components/date-time-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { AgentAccessPageData, AgentApiTokenRow } from "./types";
import { SettingsPanel, SettingsPanelHeader } from "./settings-panel";

type CreateTokenResponse = {
  token: string;
  tokenRecord: AgentApiTokenRow;
};

async function parseJson<T>(response: Response): Promise<T | null> {
  return response.json().catch(() => null);
}

function activeTokens(tokens: AgentApiTokenRow[]) {
  return tokens.filter((token) => !token.revokedAt);
}

function tokenStatus(token: AgentApiTokenRow) {
  if (token.revokedAt) return "Revoked";
  if (token.expiresAt && new Date(token.expiresAt) <= new Date()) return "Expired";
  return "Active";
}

function AgentTokenDialog({ onCreated }: { onCreated: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("ChatGPT production planner");
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/agent/api-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = await parseJson<CreateTokenResponse & { error?: string }>(
        response
      );

      if (!response.ok || !body?.token) {
        throw new Error(body?.error ?? "Failed to create agent token.");
      }

      return body;
    },
    onSuccess: async (body) => {
      setCreatedToken(body.token);
      setCopyStatus(null);
      await onCreated();
    },
  });

  const copyToken = async () => {
    if (!createdToken) return;

    await navigator.clipboard.writeText(createdToken);
    setCopyStatus("Copied");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          setCreatedToken(null);
          setCopyStatus(null);
          createMutation.reset();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>
          Create token
          <HugeiconsIcon icon={Add01Icon} data-icon="inline-end" />
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-background text-foreground sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create agent API token</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-(--space-8)">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="agent-token-name">Name</FieldLabel>
              <Input
                id="agent-token-name"
                value={name}
                disabled={createMutation.isPending || !!createdToken}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
          </FieldGroup>

          {createMutation.error ? (
            <FieldError>{createMutation.error.message}</FieldError>
          ) : null}

          {createdToken ? (
            <div className="border bg-muted/20 p-(--space-6)">
              <div className="mb-(--space-4) flex items-center justify-between gap-(--space-4)">
                <div className="text-[length:var(--text-sm)] font-medium">
                  Token
                </div>
                <Button type="button" variant="outline" size="sm" onClick={copyToken}>
                  <HugeiconsIcon icon={Copy01Icon} data-icon="inline-start" />
                  {copyStatus ?? "Copy"}
                </Button>
              </div>
              <Textarea
                readOnly
                value={createdToken}
                className="min-h-24 font-mono text-[length:var(--text-xs)]"
              />
              <p className="mt-(--space-4) text-[length:var(--text-xs)] leading-[var(--leading-xs)] text-muted-foreground">
                This token is shown once. Store it in ChatGPT, Claude, or your
                local agent environment before closing this dialog.
              </p>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Close
          </Button>
          {!createdToken ? (
            <Button
              type="button"
              disabled={createMutation.isPending || name.trim().length === 0}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? "Creating..." : "Create token"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AgentAccessSection({
  initialData,
}: {
  initialData: AgentAccessPageData;
}) {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);

  const { data = initialData } = useQuery<AgentAccessPageData>({
    queryKey: ["agent-api-tokens"],
    queryFn: async () => {
      const response = await fetch("/api/agent/api-tokens");
      const body = await parseJson<{
        tokens?: AgentApiTokenRow[];
        error?: string;
      }>(response);

      if (!response.ok || !body?.tokens) {
        throw new Error(body?.error ?? "Failed to load agent tokens.");
      }

      return {
        ...initialData,
        tokens: body.tokens,
      };
    },
    initialData,
    initialDataUpdatedAt: 0,
  });

  const refreshData = async () => {
    setActionError(null);
    await queryClient.invalidateQueries({ queryKey: ["agent-api-tokens"] });
  };

  const revokeMutation = useMutation({
    mutationFn: async (tokenId: string) => {
      const response = await fetch(`/api/agent/api-tokens/${tokenId}`, {
        method: "DELETE",
      });
      const body = await parseJson<{ error?: string }>(response);

      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to revoke agent token.");
      }
    },
    onSuccess: refreshData,
    onError: (error) => setActionError(error.message),
  });

  const enabledCount = activeTokens(data.tokens).length;

  return (
    <SettingsPanel id="agent-access">
      <SettingsPanelHeader
        title="Agent API"
        meta={`${enabledCount > 0 ? "Enabled" : "Not enabled"} · ${enabledCount} active ${enabledCount === 1 ? "token" : "tokens"}`}
        action={<AgentTokenDialog onCreated={refreshData} />}
      />

      {actionError ? (
        <div className="px-(--space-12) py-(--space-6)">
          <FieldError>{actionError}</FieldError>
        </div>
      ) : null}

      <div className="grid gap-(--space-8) p-(--space-8)">
        <div className="grid gap-(--space-6) border bg-muted/20 p-(--space-8) md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <div className="min-w-0">
            <div className="flex items-center gap-(--space-4) text-[length:var(--text-sm)] font-medium">
              <HugeiconsIcon icon={ApiIcon} className="size-(--space-7)" />
              Production planning context
            </div>
          </div>
          <Badge variant={enabledCount > 0 ? "default" : "outline"}>
            {enabledCount > 0 ? "Enabled" : "Disabled"}
          </Badge>
        </div>

        <div className="grid gap-(--space-4)">
          <div className="grid gap-(--space-4) md:grid-cols-[7rem_minmax(0,1fr)]">
            <div className="text-[length:var(--text-xs)] font-semibold uppercase tracking-[var(--tracking-caps)] text-muted-foreground">
              OpenAPI
            </div>
            <code className="break-all font-mono text-[length:var(--text-xs)] text-foreground">
              {data.openApiUrl}
            </code>
          </div>
          <div className="grid gap-(--space-4) md:grid-cols-[7rem_minmax(0,1fr)]">
            <div className="text-[length:var(--text-xs)] font-semibold uppercase tracking-[var(--tracking-caps)] text-muted-foreground">
              Scope
            </div>
            <div className="text-[length:var(--text-sm)] text-foreground">
              production_planning:read
            </div>
          </div>
        </div>

        <div className="border">
          {data.tokens.length === 0 ? (
            <div className="px-(--space-8) py-(--space-10) text-[length:var(--text-sm)] text-muted-foreground">
              No agent API tokens yet.
            </div>
          ) : (
            <div className="divide-y">
              {data.tokens.map((token) => {
                const status = tokenStatus(token);
                const active = status === "Active";

                return (
                  <div
                    key={token.id}
                    className="grid gap-(--space-6) px-(--space-8) py-(--space-7) md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-(--space-4)">
                        <div className="flex min-w-0 items-center gap-(--space-3) font-medium">
                          <HugeiconsIcon
                            icon={Key01Icon}
                            className="size-(--space-7)"
                          />
                          <span className="truncate">{token.name}</span>
                        </div>
                        <Badge variant={active ? "default" : "outline"}>
                          {status}
                        </Badge>
                      </div>
                      <div className="mt-(--space-2) flex flex-wrap gap-x-(--space-6) gap-y-(--space-2) text-[length:var(--text-xs)] leading-[var(--leading-xs)] text-muted-foreground">
                        <span className="font-mono">{token.tokenPrefix}</span>
                        <span>
                          created <DateTimeText value={token.createdAt} />
                        </span>
                        {token.lastUsedAt ? (
                          <span>
                            last used <DateTimeText value={token.lastUsedAt} />
                          </span>
                        ) : (
                          <span>never used</span>
                        )}
                      </div>
                    </div>

                    {active ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={revokeMutation.isPending}
                        onClick={() => revokeMutation.mutate(token.id)}
                      >
                        <HugeiconsIcon icon={Delete02Icon} data-icon="inline-start" />
                        Revoke
                      </Button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </SettingsPanel>
  );
}
