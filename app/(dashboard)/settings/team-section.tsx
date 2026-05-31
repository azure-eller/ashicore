"use client";

import { useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ICellRendererParams } from "ag-grid-community";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, PencilEdit02Icon, RefreshIcon } from "@hugeicons/core-free-icons";
import {
  formatAccessLevelLabel,
  formatAccessPresetLabel,
  formatRoleLabel,
  formatModuleLabel,
  getAccessPresetKeys,
  getAccessPresetModuleAccess,
  type AccessPresetKey,
  type DerivedAccessPresetKey,
  MODULE_KEYS,
  type ModuleAccessLevel,
} from "@/lib/authz";
import { ApiJsonError, apiJson } from "@/lib/client/api";
import { DateTimeText } from "@/components/date-time-text";
import { ERPDataGrid, type ColDef } from "@/components/erp-data-grid";
import { ListFrame, ListFrameItem } from "@/components/list-frame";
import {
  ConfiguredBadge,
  type ConfiguredBadgeConfig,
} from "@/components/configured-badge";
import { createTeamInvitationSchema, moduleAccessSchema } from "@/lib/schemas/team";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { TeamRoleBadge } from "./team-role-badge";
import type { PendingInviteRow, TeamMemberRow, TeamPageData } from "./types";
import { SettingsPanel, SettingsPanelHeader } from "./settings-panel";

type InviteFormValues = {
  email: string;
  presetKey: AccessPresetKey;
};

type UpdateMemberPayload = {
  memberId: string;
  moduleAccess: TeamMemberRow["moduleAccess"];
};

type TeamGridRow =
  | {
      id: string;
      kind: "member";
      name: string;
      email: string;
      accessLabel: string;
      roleLabel: string;
      statusLabel: string;
      member: TeamMemberRow;
      invite: null;
    }
  | {
      id: string;
      kind: "invite";
      name: string;
      email: string;
      accessLabel: string;
      roleLabel: string;
      statusLabel: string;
      member: null;
      invite: PendingInviteRow;
    };

const FULL_ACCESS_OPTIONS: ModuleAccessLevel[] = ["none", "read", "operate", "admin"];
const ACCESS_PRESET_KEYS = getAccessPresetKeys();

const accessPresetBadgeConfig = Object.fromEntries(
  ACCESS_PRESET_KEYS.map((presetKey) => [
    presetKey,
    {
      label: formatAccessPresetLabel(presetKey),
      variant: presetKey === "admin" ? undefined : "outline",
    },
  ]),
) as ConfiguredBadgeConfig<AccessPresetKey>;

const derivedAccessPresetBadgeConfig = {
  ...accessPresetBadgeConfig,
  custom: { label: formatAccessPresetLabel("custom"), variant: "secondary" },
} satisfies ConfiguredBadgeConfig<DerivedAccessPresetKey>;

const teamStatusBadgeConfig = {
  active: { label: "Active", variant: "outline" },
  current: { label: "You", variant: "secondary" },
  pending: { label: "Pending", variant: "secondary" },
} satisfies ConfiguredBadgeConfig<"active" | "current" | "pending">;

function AccessPresetBadge({ presetKey }: { presetKey: DerivedAccessPresetKey }) {
  return (
    <ConfiguredBadge value={presetKey} config={derivedAccessPresetBadgeConfig} />
  );
}

function TeamStatusBadge({ row }: { row: TeamGridRow }) {
  if (row.kind === "invite") {
    return (
      <div className="flex min-w-0 items-center gap-(--space-3)">
        <ConfiguredBadge value="pending" config={teamStatusBadgeConfig} />
        <span className="truncate text-[length:var(--text-xs)] text-muted-foreground">
          expires <DateTimeText value={row.invite.expiresAt} />
        </span>
      </div>
    );
  }

  if (row.member.isCurrentUser) {
    return <ConfiguredBadge value="current" config={teamStatusBadgeConfig} />;
  }

  return <ConfiguredBadge value="active" config={teamStatusBadgeConfig} />;
}

function InviteMemberDialog({
  canGrantTeamManagement,
  onSuccess,
}: {
  canGrantTeamManagement: boolean;
  onSuccess: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<InviteFormValues>({
    resolver: zodResolver(createTeamInvitationSchema),
    mode: "onBlur",
    defaultValues: {
      email: "",
      presetKey: "view_only",
    },
  });

  const inviteMutation = useMutation({
    mutationFn: async (values: InviteFormValues) => {
      try {
        await apiJson<void>("/api/team/invitations", {
          method: "POST",
          body: values,
          fallbackError: "Failed to send invite.",
        });
      } catch (error) {
        if (error instanceof ApiJsonError && error.errors) {
          Object.entries(error.errors).forEach(([field, messages]) => {
            if (!messages?.length) {
              return;
            }

            form.setError(field as keyof InviteFormValues, {
              type: "server",
              message: messages[0],
            });
          });
          throw new Error("validation");
        }

        throw error;
      }
    },
    onMutate: () => {
      setFormError(null);
    },
    onSuccess: async () => {
      await onSuccess();
      form.reset({
        email: "",
        presetKey: "view_only",
      });
      setOpen(false);
    },
    onError: (error) => {
      if (error.message !== "validation") {
        setFormError(error.message);
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          Invite member
          <HugeiconsIcon icon={Add01Icon} data-icon="inline-end" />
        </Button>
      </DialogTrigger>
      <DialogContent size="2xl">
        <DialogHeader>
          <DialogTitle>Invite member</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-6"
          onSubmit={form.handleSubmit((values) => inviteMutation.mutate(values))}
        >
          <FieldGroup>
            <Controller
              name="email"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>Email</FieldLabel>
                  <Input
                    {...field}
                    id={field.name}
                    type="email"
                    aria-invalid={fieldState.invalid}
                    autoComplete="email"
                    placeholder="teammate@example.com"
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />

            <Controller
              name="presetKey"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel>Default role</FieldLabel>
                  <div className="grid gap-(--space-6) sm:grid-cols-2">
                    {ACCESS_PRESET_KEYS.filter(
                      (presetKey) => canGrantTeamManagement || presetKey !== "admin"
                    ).map((presetKey) => {
                      const selected = field.value === presetKey;

                      return (
                        <button
                          key={presetKey}
                          type="button"
                          onClick={() => field.onChange(presetKey)}
                          className={`border px-(--space-8) py-(--space-8) text-left transition-colors ${
                            selected
                              ? "border-ring bg-accent text-accent-foreground"
                              : "border-border bg-card text-card-foreground hover:bg-accent/50"
                          }`}
                          aria-pressed={selected}
                        >
                          <div className="flex items-center justify-between gap-(--space-6)">
                            <span className="font-medium">
                              {formatAccessPresetLabel(presetKey)}
                            </span>
                            <AccessPresetBadge presetKey={presetKey} />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
          </FieldGroup>

          {formError ? <FieldError>{formError}</FieldError> : null}

          <div className="flex justify-end gap-(--space-6)">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={inviteMutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={inviteMutation.isPending}>
              {inviteMutation.isPending ? "Sending invite..." : "Send invite"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CustomizeAccessDialog({
  canGrantTeamManagement,
  member,
  open,
  onOpenChange,
  onSave,
  onRemove,
  pending,
}: {
  canGrantTeamManagement: boolean;
  member: TeamMemberRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (member: TeamMemberRow, moduleAccess: TeamMemberRow["moduleAccess"]) => void;
  onRemove: (member: TeamMemberRow) => void;
  pending: boolean;
}) {
  const [moduleAccess, setModuleAccess] = useState<TeamMemberRow["moduleAccess"]>(
    member.moduleAccess
  );
  const [presetKey, setPresetKey] = useState<AccessPresetKey | "custom">(
    member.presetKey && member.presetKey !== "custom" ? member.presetKey : "custom"
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="3xl">
        <DialogHeader>
          <DialogTitle>Edit access</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <FieldGroup>
            <Field>
              <FieldLabel>Preset</FieldLabel>
              <Select
                value={presetKey}
                onValueChange={(nextValue) => {
                  if (nextValue === "custom") {
                    setPresetKey("custom");
                    return;
                  }

                  const nextPreset = nextValue as AccessPresetKey;
                  setPresetKey(nextPreset);
                  setModuleAccess(getAccessPresetModuleAccess(nextPreset));
                }}
                disabled={pending}
              >
                <SelectTrigger className="w-full sm:w-[220px]">
                  <SelectValue placeholder="Select preset" />
                </SelectTrigger>
                <SelectContent className="bg-popover text-popover-foreground">
                  {ACCESS_PRESET_KEYS.filter(
                    (preset) => canGrantTeamManagement || preset !== "admin"
                  ).map((preset) => (
                    <SelectItem key={preset} value={preset}>
                      {formatAccessPresetLabel(preset)}
                    </SelectItem>
                  ))}
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>

          <ListFrame className="overflow-hidden">
            {MODULE_KEYS.map((moduleKey) => (
              <ListFrameItem
                key={moduleKey}
                data-module-key={moduleKey}
                className="flex flex-col gap-(--space-6) px-(--space-8) py-(--space-8) sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="font-medium">{formatModuleLabel(moduleKey)}</div>
                <ToggleGroup
                  type="single"
                  value={moduleAccess[moduleKey]}
                  onValueChange={(nextValue) => {
                    if (!nextValue) {
                      return;
                    }

                    setPresetKey("custom");
                    setModuleAccess({
                      ...moduleAccess,
                      [moduleKey]: nextValue as ModuleAccessLevel,
                    });
                  }}
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  className="flex w-full flex-wrap justify-start sm:w-auto sm:justify-end"
                >
                  {FULL_ACCESS_OPTIONS.filter(
                    (option) => canGrantTeamManagement || !(moduleKey === "settings" && option === "admin")
                  ).map((option) => (
                    <ToggleGroupItem key={option} value={option} aria-label={option}>
                      {formatAccessLevelLabel(option)}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </ListFrameItem>
            ))}
          </ListFrame>
        </div>

        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={() => onRemove(member)}
          >
            Remove member
          </Button>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={pending}
              onClick={() => onSave(member, moduleAccessSchema.parse(moduleAccess))}
            >
              {pending ? "Saving..." : "Save access"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function TeamSection({ initialData }: { initialData: TeamPageData }) {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [searchValue, setSearchValue] = useState("");
  const [customizingMember, setCustomizingMember] = useState<TeamMemberRow | null>(null);

  const { data = initialData } = useQuery<TeamPageData>({
    queryKey: ["team"],
    queryFn: () =>
      apiJson<TeamPageData>("/api/team", {
        fallbackError: "Failed to load team settings.",
      }),
    initialData,
    initialDataUpdatedAt: 0,
  });

  const refreshData = async () => {
    setActionError(null);
    await queryClient.invalidateQueries({ queryKey: ["team"] });
  };

  const resendMutation = useMutation({
    mutationFn: (invitationId: string) =>
      apiJson<void>(`/api/team/invitations/${invitationId}/resend`, {
        method: "POST",
        fallbackError: "Failed to resend invite.",
      }),
    onSuccess: refreshData,
    onError: (error) => setActionError(error.message),
  });

  const cancelInviteMutation = useMutation({
    mutationFn: (invitationId: string) =>
      apiJson<void>(`/api/team/invitations/${invitationId}`, {
        method: "DELETE",
        fallbackError: "Failed to cancel invite.",
      }),
    onSuccess: refreshData,
    onError: (error) => setActionError(error.message),
  });

  const updateMemberMutation = useMutation({
    mutationFn: (values: UpdateMemberPayload) =>
      apiJson<void>(`/api/team/members/${values.memberId}`, {
        method: "PATCH",
        body: {
          moduleAccess: values.moduleAccess,
        },
        fallbackError: "Failed to update member access.",
      }),
    onSuccess: async () => {
      await refreshData();
      setCustomizingMember(null);
    },
    onError: (error) => setActionError(error.message),
  });

  const removeMemberMutation = useMutation({
    mutationFn: (memberId: string) =>
      apiJson<void>(`/api/team/members/${memberId}`, {
        method: "DELETE",
        fallbackError: "Failed to remove member.",
      }),
    onSuccess: async () => {
      await refreshData();
      setCustomizingMember(null);
    },
    onError: (error) => setActionError(error.message),
  });

  const mutationPending =
    resendMutation.isPending ||
    cancelInviteMutation.isPending ||
    updateMemberMutation.isPending ||
    removeMemberMutation.isPending;

  const updateMember = (member: TeamMemberRow, moduleAccess: TeamMemberRow["moduleAccess"]) => {
    updateMemberMutation.mutate({
      memberId: member.id,
      moduleAccess,
    });
  };

  const memberCount = data.members.length;
  const pendingCount = data.pendingInvites.length;
  const rows = useMemo<TeamGridRow[]>(
    () => [
      ...data.members.map((member) => ({
        id: `member-${member.id}`,
        kind: "member" as const,
        name: member.name,
        email: member.email,
        accessLabel: member.presetKey
          ? formatAccessPresetLabel(member.presetKey)
          : "",
        roleLabel: formatRoleLabel(member.role),
        statusLabel: member.isCurrentUser ? "You" : "Active",
        member,
        invite: null,
      })),
      ...data.pendingInvites.map((invite) => ({
        id: `invite-${invite.id}`,
        kind: "invite" as const,
        name: "Pending invite",
        email: invite.email,
        accessLabel: formatAccessPresetLabel(invite.presetKey),
        roleLabel: "",
        statusLabel: "Pending",
        member: null,
        invite,
      })),
    ],
    [data.members, data.pendingInvites]
  );
  const columns = useMemo<ColDef<TeamGridRow>[]>(
    () => [
      {
        field: "name",
        headerName: "Name",
        minWidth: 180,
        flex: 1,
        cellRenderer: ({ data: row }: ICellRendererParams<TeamGridRow>) => {
          if (!row) return null;

          return row.kind === "member" ? (
            <span className="min-w-0 truncate font-medium text-foreground">
              {row.name}
              {row.member.isCurrentUser ? (
                <span className="ml-(--space-2) text-[length:var(--text-xs)] font-normal text-muted-foreground">
                  (You)
                </span>
              ) : null}
            </span>
          ) : (
            <span className="text-muted-foreground">Pending invite</span>
          );
        },
      },
      {
        field: "email",
        headerName: "Email",
        minWidth: 230,
        flex: 1.35,
      },
      {
        field: "accessLabel",
        headerName: "Access",
        width: 150,
        minWidth: 130,
        cellRenderer: ({ data: row }: ICellRendererParams<TeamGridRow>) =>
          row?.kind === "member" && row.member.presetKey ? (
            <AccessPresetBadge presetKey={row.member.presetKey} />
          ) : row?.kind === "invite" ? (
            <AccessPresetBadge presetKey={row.invite.presetKey} />
          ) : (
            "—"
          ),
      },
      {
        field: "roleLabel",
        headerName: "Role",
        width: 120,
        minWidth: 100,
        cellRenderer: ({ data: row }: ICellRendererParams<TeamGridRow>) =>
          row?.kind === "member" ? (
            <TeamRoleBadge role={row.member.role} />
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        field: "statusLabel",
        headerName: "Status",
        width: 220,
        minWidth: 180,
        cellRenderer: ({ data: row }: ICellRendererParams<TeamGridRow>) =>
          row ? <TeamStatusBadge row={row} /> : null,
      },
      {
        colId: "actions",
        headerName: "",
        width: 176,
        minWidth: 150,
        maxWidth: 210,
        sortable: false,
        resizable: false,
        cellRenderer: ({ data: row }: ICellRendererParams<TeamGridRow>) => {
          if (!row) return null;

          if (row.kind === "invite") {
            return (
              <div className="flex h-full items-center justify-end gap-(--space-3)">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  disabled={mutationPending}
                  onClick={() => resendMutation.mutate(row.invite.id)}
                  aria-label={`Resend invite to ${row.email}`}
                >
                  <HugeiconsIcon icon={RefreshIcon} />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={mutationPending}
                  onClick={() => cancelInviteMutation.mutate(row.invite.id)}
                >
                  Cancel
                </Button>
              </div>
            );
          }

          const manageable = row.member.canManage && !row.member.isCurrentUser;

          return manageable ? (
            <div className="flex h-full items-center justify-end">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={mutationPending}
                onClick={() => setCustomizingMember(row.member)}
                className="bg-transparent text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label={`Edit ${row.member.name}`}
              >
                <HugeiconsIcon icon={PencilEdit02Icon} />
              </Button>
            </div>
          ) : null;
        },
        getQuickFilterText: () => "",
      },
    ],
    [
      cancelInviteMutation,
      mutationPending,
      resendMutation,
      setCustomizingMember,
    ]
  );
  const gridHeight = Math.max(160, Math.min(680, 40 + rows.length * 34));

  return (
    <>
      <SettingsPanel id="team">
        <SettingsPanelHeader
          title="Team"
          meta={`${memberCount} ${memberCount === 1 ? "member" : "members"}${pendingCount > 0 ? ` · ${pendingCount} pending` : ""}`}
          action={
            <InviteMemberDialog
              canGrantTeamManagement={data.canGrantTeamManagement}
              onSuccess={refreshData}
            />
          }
        />

        {actionError ? (
          <div className="px-(--space-12) py-(--space-6)">
            <FieldError>{actionError}</FieldError>
          </div>
        ) : null}

        <div className="p-(--space-8)">
          <ERPDataGrid
            rows={rows}
            columns={columns}
            height={gridHeight}
            rowHeight={34}
            headerHeight={32}
            emptyMessage="No team members found."
            searchValue={searchValue}
            onSearchChange={setSearchValue}
            searchAriaLabel="Search team"
          />
        </div>
      </SettingsPanel>

      {customizingMember ? (
        <CustomizeAccessDialog
          key={customizingMember.id}
          canGrantTeamManagement={data.canGrantTeamManagement}
          member={customizingMember}
          open
          onOpenChange={(open) => {
            if (!open) {
              setCustomizingMember(null);
            }
          }}
          onSave={updateMember}
          onRemove={(member) => removeMemberMutation.mutate(member.id)}
          pending={mutationPending}
        />
      ) : null}
    </>
  );
}
