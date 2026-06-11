"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import {
  Add01Icon,
  AiBrain03Icon,
  AiChat02Icon,
  Copy01Icon,
  LinkSquare02Icon,
  Robot01Icon,
} from "@hugeicons/core-free-icons";
import { DateTimeText } from "@/components/date-time-text";
import { InsetPanel } from "@/components/inset-panel";
import { SurfacePanel } from "@/components/surface-panel";
import {
  FramedTable,
  FramedTableBody,
  FramedTableCell,
  FramedTableHead,
  FramedTableHeaderCell,
  FramedTableRow,
  TableFrame,
} from "@/components/table-frame";
import {
  SettingsBlock,
  SettingsCard,
  SettingsFootnote,
  SettingsPageHeader,
} from "@/components/settings-panel";
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
import { apiJson, requireApiProperty } from "@/lib/client/api";
import { queryKeys } from "@/lib/client/query-keys";
import type {
  AgentAccessPageData,
  AgentApiTokenRow,
  AgentMcpOAuthGrantRow,
} from "./types";

type CreateTokenResponse = {
  token: string;
  tokenRecord: AgentApiTokenRow;
};

type CredentialRow = {
  id: string;
  kind: "oauth" | "token";
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
};

function isActiveToken(token: AgentApiTokenRow) {
  if (token.revokedAt) return false;
  return !token.expiresAt || new Date(token.expiresAt) > new Date();
}

function isActiveMcpOAuthGrant(grant: AgentMcpOAuthGrantRow) {
  return !grant.revokedAt && new Date(grant.refreshTokenExpiresAt) > new Date();
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
      const body = await apiJson<CreateTokenResponse>("/api/agent/api-tokens", {
        method: "POST",
        body: { name },
        fallbackError: "Failed to create agent token.",
      });

      requireApiProperty(body, "token", "Failed to create agent token.");

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
          <HugeiconsIcon icon={Add01Icon} data-icon="inline-start" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent size="2xl">
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
            <InsetPanel tone="subtle" padding="lg">
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
              <p className="mt-(--space-4) text-[length:var(--text-xs)] leading-[var(--leading-xs)] text-[var(--color-ink-faint)]">
                This token is shown once. Store it in ChatGPT, Claude, or your
                local agent environment before closing this dialog.
              </p>
            </InsetPanel>
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
        <Button size="sm">Connect Claude</Button>
      </DialogTrigger>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Connect Claude</DialogTitle>
          <DialogDescription>
            Add Ashicore as a custom connector in Claude. The connector name and
            server URL will be filled in for you.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-(--space-5) text-[length:var(--text-sm)] leading-[var(--leading-sm)] text-[var(--color-ink)]">
          <div className="grid gap-(--space-3)">
            <div className="font-medium">In Claude</div>
            <ol className="grid list-decimal gap-(--space-2) pl-(--space-6) text-[var(--color-ink-faint)]">
              <li>Click Add.</li>
              <li>Leave OAuth client ID and client secret blank.</li>
              <li>If Claude says you are not connected, click Connect.</li>
              <li>Approve Ashicore access when prompted.</li>
            </ol>
          </div>

          <InsetPanel tone="subtle" padding="md">
            <div className="mb-(--space-2) text-[length:var(--text-xs)] font-semibold uppercase tracking-[var(--tracking-caps)] text-[var(--color-ink-faint)]">
              Server URL
            </div>
            <code className="break-all font-mono text-[length:var(--text-xs)]">
              {serverUrl}
            </code>
          </InsetPanel>
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
        <Button variant="outline" size="sm">
          Setup guide
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

        <div className="grid gap-(--space-5) text-[length:var(--text-sm)] leading-[var(--leading-sm)] text-[var(--color-ink)]">
          <AgentTokenDialog
            defaultName="ChatGPT production planner"
            triggerLabel="Create ChatGPT token"
            onCreated={onCreated}
          />

          <ol className="grid list-decimal gap-(--space-2) pl-(--space-6) text-[var(--color-ink-faint)]">
            <li>Create a token and copy it.</li>
            <li>Open ChatGPT, create or edit a GPT, then add an Action.</li>
            <li>Import the OpenAPI schema URL below.</li>
            <li>Set authentication to API Key, Bearer, then paste the token.</li>
            <li>Test the production planning action.</li>
          </ol>

          <InsetPanel tone="subtle" padding="md">
            <div className="mb-(--space-2) text-[length:var(--text-xs)] font-semibold uppercase tracking-[var(--tracking-caps)] text-[var(--color-ink-faint)]">
              OpenAPI URL
            </div>
            <code className="break-all font-mono text-[length:var(--text-xs)]">
              {openApiUrl}
            </code>
          </InsetPanel>
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

function ProviderWell({
  icon,
  title,
  subtitle,
  description,
  children,
}: {
  icon: IconSvgElement;
  title: string;
  subtitle: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <SurfacePanel
      tone="background"
      className="flex min-w-0 flex-col gap-(--space-6) p-(--space-8) shadow-none"
    >
      <div className="flex items-center gap-(--space-4)">
        <SurfacePanel
          as="span"
          className="flex size-(--space-16) shrink-0 items-center justify-center p-0 text-[var(--color-ink-soft)] shadow-none"
        >
          <HugeiconsIcon icon={icon} size={18} aria-hidden />
        </SurfacePanel>
        <div className="min-w-0">
          <div className="text-[length:var(--text-sm)] font-semibold text-[var(--color-ink)]">
            {title}
          </div>
          <div className="font-mono text-[length:var(--text-3xs)] tracking-[var(--tracking-caps)] text-[var(--color-ink-faint)] uppercase">
            {subtitle}
          </div>
        </div>
      </div>
      <p className="min-w-0 break-words text-[length:var(--text-xs)] leading-[var(--leading-xs)] text-[var(--color-ink-faint)]">
        {description}
      </p>
      <div className="mt-auto flex items-center gap-(--space-4)">{children}</div>
    </SurfacePanel>
  );
}

export function AgentAccessSection({
  initialData,
}: {
  initialData: AgentAccessPageData;
}) {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [schemaUrlCopied, setSchemaUrlCopied] = useState(false);

  const { data = initialData } = useQuery<AgentAccessPageData>({
    queryKey: queryKeys.agentAccess.root,
    queryFn: async () => {
      const [tokensBody, grantsBody] = await Promise.all([
        apiJson<{ tokens?: AgentApiTokenRow[] }>("/api/agent/api-tokens", {
          fallbackError: "Failed to load agent tokens.",
        }),
        apiJson<{ grants?: AgentMcpOAuthGrantRow[] }>(
          "/api/agent/mcp/oauth/tokens",
          { fallbackError: "Failed to load Claude OAuth grants." }
        ),
      ]);

      const tokens = requireApiProperty(
        tokensBody,
        "tokens",
        "Failed to load agent tokens."
      );
      const mcpOAuthGrants = requireApiProperty(
        grantsBody,
        "grants",
        "Failed to load Claude OAuth grants."
      );

      return {
        ...initialData,
        tokens,
        mcpOAuthGrants,
      };
    },
    initialData,
    initialDataUpdatedAt: 0,
  });

  const refreshData = async () => {
    setActionError(null);
    await queryClient.invalidateQueries({ queryKey: queryKeys.agentAccess.root });
  };

  const revokeTokenMutation = useMutation({
    mutationFn: (tokenId: string) =>
      apiJson<void>(`/api/agent/api-tokens/${tokenId}`, {
        method: "DELETE",
        fallbackError: "Failed to revoke agent token.",
      }),
    onSuccess: refreshData,
    onError: (error) => setActionError(error.message),
  });
  const revokeMcpOAuthGrantMutation = useMutation({
    mutationFn: (grantId: string) =>
      apiJson<void>(`/api/agent/mcp/oauth/tokens/${grantId}`, {
        method: "DELETE",
        fallbackError: "Failed to revoke Claude OAuth grant.",
      }),
    onSuccess: refreshData,
    onError: (error) => setActionError(error.message),
  });

  const revokePending =
    revokeTokenMutation.isPending || revokeMcpOAuthGrantMutation.isPending;

  const credentials: CredentialRow[] = [
    ...data.mcpOAuthGrants.filter(isActiveMcpOAuthGrant).map((grant) => ({
      id: grant.id,
      kind: "oauth" as const,
      name: grant.userName || grant.userEmail || grant.clientId,
      createdAt: grant.createdAt,
      lastUsedAt: grant.lastUsedAt,
    })),
    ...data.tokens.filter(isActiveToken).map((token) => ({
      id: token.id,
      kind: "token" as const,
      name: token.name,
      createdAt: token.createdAt,
      lastUsedAt: token.lastUsedAt,
    })),
  ];

  const copySchemaUrl = async () => {
    await navigator.clipboard.writeText(data.openApiUrl);
    setSchemaUrlCopied(true);
    window.setTimeout(() => setSchemaUrlCopied(false), 2000);
  };

  return (
    <div className="flex flex-col gap-(--space-8)">
      <SettingsPageHeader
        title="Agent API"
        sub="Give AI assistants read access to your inventory, orders and production planning data."
        action={<AgentTokenDialog triggerLabel="Create API token" onCreated={refreshData} />}
      />

      <SettingsCard>
        <SettingsBlock title="Connect an assistant">
          <div className="grid min-w-0 gap-(--space-6) sm:grid-cols-[repeat(2,minmax(0,1fr))]">
            <ProviderWell
              icon={AiBrain03Icon}
              title="Claude"
              subtitle="Remote MCP"
              description="Add Ashicore as a custom connector. No token needed — Claude signs in with OAuth."
            >
              <ClaudeConnectDialog
                installUrl={data.claudeInstallUrl}
                serverUrl={data.mcpServerUrl}
              />
            </ProviderWell>
            <ProviderWell
              icon={AiChat02Icon}
              title="ChatGPT"
              subtitle="Custom GPT action"
              description="Create an API token, then import the OpenAPI schema as a GPT action."
            >
              <ChatGptConnectDialog
                builderUrl={data.chatGptBuilderUrl}
                openApiUrl={data.openApiUrl}
                onCreated={refreshData}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void copySchemaUrl()}
                className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
              >
                <HugeiconsIcon icon={Copy01Icon} data-icon="inline-start" />
                {schemaUrlCopied ? "Copied" : "Copy schema URL"}
              </Button>
            </ProviderWell>
          </div>
        </SettingsBlock>

        <SettingsBlock title="Active credentials" count={credentials.length}>
          {actionError ? (
            <div className="mb-(--space-6)">
              <FieldError>{actionError}</FieldError>
            </div>
          ) : null}

          {credentials.length > 0 ? (
            <TableFrame>
              <FramedTable>
                <FramedTableHead>
                  <tr>
                    <FramedTableHeaderCell className="w-28">
                      Type
                    </FramedTableHeaderCell>
                    <FramedTableHeaderCell>Name</FramedTableHeaderCell>
                    <FramedTableHeaderCell className="w-72">
                      Activity
                    </FramedTableHeaderCell>
                    <FramedTableHeaderCell className="w-20" />
                  </tr>
                </FramedTableHead>
                <FramedTableBody>
                  {credentials.map((credential) => (
                    <FramedTableRow key={`${credential.kind}-${credential.id}`}>
                      <FramedTableCell>
                        {credential.kind === "oauth" ? (
                          <Badge>OAuth</Badge>
                        ) : (
                          <Badge variant="secondary">Token</Badge>
                        )}
                      </FramedTableCell>
                      <FramedTableCell strong>{credential.name}</FramedTableCell>
                      <FramedTableCell>
                        <span className="font-mono text-[length:var(--text-2xs)] text-[var(--color-ink-faint)]">
                          {credential.kind === "oauth" ? "Granted" : "Created"}{" "}
                          <DateTimeText value={credential.createdAt} /> · last used{" "}
                          {credential.lastUsedAt ? (
                            <DateTimeText value={credential.lastUsedAt} />
                          ) : (
                            "never"
                          )}
                        </span>
                      </FramedTableCell>
                      <FramedTableCell align="right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={revokePending}
                          onClick={() =>
                            credential.kind === "oauth"
                              ? revokeMcpOAuthGrantMutation.mutate(credential.id)
                              : revokeTokenMutation.mutate(credential.id)
                          }
                          className="text-[var(--status-danger-ink)] hover:bg-[var(--color-danger-soft)] hover:text-[var(--status-danger-ink)]"
                        >
                          Revoke
                        </Button>
                      </FramedTableCell>
                    </FramedTableRow>
                  ))}
                </FramedTableBody>
              </FramedTable>
            </TableFrame>
          ) : (
            <div className="flex flex-col items-center justify-center gap-(--space-4) py-(--space-12) text-center text-[var(--color-ink-faint)]">
              <HugeiconsIcon icon={Robot01Icon} size={20} aria-hidden />
              <span className="text-[length:var(--text-status)]">
                Nothing connected yet. Connect Claude or create a token for ChatGPT.
              </span>
            </div>
          )}
        </SettingsBlock>
      </SettingsCard>

      <SettingsFootnote>
        Credentials are read-only in v1 — assistants can look things up but can&apos;t
        change your data.
      </SettingsFootnote>
    </div>
  );
}
