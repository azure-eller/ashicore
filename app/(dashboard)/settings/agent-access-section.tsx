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
  LinkSquare02Icon,
} from "@hugeicons/core-free-icons";
import { DateTimeText } from "@/components/date-time-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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

function AgentTokenDialog({
  defaultName = "ChatGPT production planner",
  onCreated,
  triggerLabel = "Create token",
}: {
  defaultName?: string;
  onCreated: () => Promise<void>;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaultName);
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
          setName(defaultName);
          createMutation.reset();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>
          {triggerLabel}
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

function ProviderMark({ label }: { label: string }) {
  return (
    <span className="flex size-(--space-10) shrink-0 items-center justify-center border bg-background font-mono text-[length:var(--text-xs)] font-semibold">
      {label}
    </span>
  );
}

function ClaudeConnectDialog({
  installUrl,
  serverUrl,
}: {
  installUrl: string;
  serverUrl: string;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button className="h-auto justify-start gap-(--space-4) px-(--space-5) py-(--space-4)">
          <ProviderMark label="C" />
          <span className="grid text-left">
            <span>Connect Claude</span>
            <span className="text-[length:var(--text-xs)] font-normal text-primary-foreground/80">
              Remote MCP
            </span>
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Connect Claude</DialogTitle>
          <DialogDescription>
            Add Ashicore as a custom connector in Claude. The connector name and
            server URL will be filled in for you.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-(--space-5) text-[length:var(--text-sm)] leading-[var(--leading-sm)] text-foreground">
          <div className="grid gap-(--space-3)">
            <div className="font-medium">In Claude</div>
            <ol className="grid list-decimal gap-(--space-2) pl-(--space-6) text-muted-foreground">
              <li>Click Add.</li>
              <li>Leave OAuth client ID and client secret blank.</li>
              <li>If Claude says you are not connected, click Connect.</li>
              <li>Approve Ashicore access when prompted.</li>
            </ol>
          </div>

          <div className="border bg-muted/20 p-(--space-5)">
            <div className="mb-(--space-2) text-[length:var(--text-xs)] font-semibold uppercase tracking-[var(--tracking-caps)] text-muted-foreground">
              Server URL
            </div>
            <code className="break-all font-mono text-[length:var(--text-xs)]">
              {serverUrl}
            </code>
          </div>
        </div>

        <DialogFooter>
          <Button asChild>
            <a href={installUrl} target="_blank" rel="noreferrer">
              <HugeiconsIcon icon={LinkSquare02Icon} data-icon="inline-start" />
              Open Claude
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChatGptConnectDialog({
  builderUrl,
  openApiUrl,
  onCreated,
}: {
  builderUrl: string;
  openApiUrl: string;
  onCreated: () => Promise<void>;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="h-auto justify-start gap-(--space-4) px-(--space-5) py-(--space-4)"
        >
          <ProviderMark label="GPT" />
          <span className="grid text-left">
            <span>Set up ChatGPT</span>
            <span className="text-[length:var(--text-xs)] font-normal text-muted-foreground">
              Custom GPT Action
            </span>
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Set up ChatGPT</DialogTitle>
          <DialogDescription>
            Use a Custom GPT Action when you want ChatGPT to read Ashicore
            production planning data.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-(--space-5) text-[length:var(--text-sm)] leading-[var(--leading-sm)] text-foreground">
          <AgentTokenDialog
            defaultName="ChatGPT production planner"
            triggerLabel="Create ChatGPT token"
            onCreated={onCreated}
          />

          <ol className="grid list-decimal gap-(--space-2) pl-(--space-6) text-muted-foreground">
            <li>Create a token and copy it.</li>
            <li>Open ChatGPT, create or edit a GPT, then add an Action.</li>
            <li>Import the OpenAPI schema URL below.</li>
            <li>Set authentication to API Key, Bearer, then paste the token.</li>
            <li>Test the production planning action.</li>
          </ol>

          <div className="border bg-muted/20 p-(--space-5)">
            <div className="mb-(--space-2) text-[length:var(--text-xs)] font-semibold uppercase tracking-[var(--tracking-caps)] text-muted-foreground">
              OpenAPI URL
            </div>
            <code className="break-all font-mono text-[length:var(--text-xs)]">
              {openApiUrl}
            </code>
          </div>
        </div>

        <DialogFooter>
          <Button asChild>
            <a href={builderUrl} target="_blank" rel="noreferrer">
              <HugeiconsIcon icon={LinkSquare02Icon} data-icon="inline-start" />
              Open ChatGPT
            </a>
          </Button>
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
              Ashicore MCP
              <Badge variant={enabledCount > 0 ? "default" : "outline"}>
                {enabledCount > 0 ? "Enabled" : "Disabled"}
              </Badge>
            </div>
          </div>
          <div className="grid gap-(--space-4) sm:grid-cols-2">
            <ClaudeConnectDialog
              installUrl={data.claudeInstallUrl}
              serverUrl={data.mcpServerUrl}
            />
            <ChatGptConnectDialog
              builderUrl={data.chatGptBuilderUrl}
              openApiUrl={data.openApiUrl}
              onCreated={refreshData}
            />
          </div>
        </div>

        <details className="grid gap-(--space-4) border p-(--space-6)">
          <summary className="cursor-pointer text-[length:var(--text-sm)] font-medium">
            Connection details
          </summary>
          <div className="mt-(--space-5) grid gap-(--space-4)">
          <div className="grid gap-(--space-4) md:grid-cols-[7rem_minmax(0,1fr)]">
            <div className="text-[length:var(--text-xs)] font-semibold uppercase tracking-[var(--tracking-caps)] text-muted-foreground">
              Claude MCP
            </div>
            <code className="break-all font-mono text-[length:var(--text-xs)] text-foreground">
              {data.mcpServerUrl}
            </code>
          </div>
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
          <div className="grid gap-(--space-4) md:grid-cols-[7rem_minmax(0,1fr)]">
            <div className="text-[length:var(--text-xs)] font-semibold uppercase tracking-[var(--tracking-caps)] text-muted-foreground">
              OAuth
            </div>
            <div className="text-[length:var(--text-sm)] text-muted-foreground">
              Leave Claude client ID and client secret blank.
            </div>
          </div>
          </div>
        </details>

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
