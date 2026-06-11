"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  ArrowDown01Icon,
  MoreHorizontalIcon,
} from "@hugeicons/core-free-icons";
import {
  formatAccessLevelLabel,
  formatAccessPresetLabel,
  formatModuleLabel,
  getAccessPresetKeys,
  getAccessPresetModuleAccess,
  type AccessPresetKey,
  MODULE_KEYS,
  type ModuleAccessLevel,
} from "@/lib/authz";
import { ApiJsonError, apiJson } from "@/lib/client/api";
import { ListFrame, ListFrameItem } from "@/components/list-frame";
import {
  FramedTable,
  FramedTableBody,
  FramedTableCell,
  FramedTableEmptyRow,
  FramedTableHead,
  FramedTableHeaderCell,
  FramedTableRow,
  TableFrame,
} from "@/components/table-frame";
import {
  SettingsBlock,
  SettingsCard,
  SettingsPageHeader,
} from "@/components/settings-panel";
import { createTeamInvitationSchema, moduleAccessSchema } from "@/lib/schemas/team";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import type { PendingInviteRow, TeamMemberRow, TeamPageData } from "./types";
import { queryKeys } from "@/lib/client/query-keys";

type InviteFormValues = {
  email: string;
  presetKey: AccessPresetKey;
};

type UpdateMemberPayload = {
  memberId: string;
  moduleAccess: TeamMemberRow["moduleAccess"];
};

const FULL_ACCESS_OPTIONS: ModuleAccessLevel[] = ["none", "read", "operate", "admin"];
const ACCESS_PRESET_KEYS = getAccessPresetKeys();

function memberInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function MemberCell({
  name,
  email,
  isCurrentUser,
  invited,
}: {
  name: string | null;
  email: string;
  isCurrentUser?: boolean;
  invited?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-(--space-5)">
      <Avatar
        className={
          invited
            ? "size-(--space-16) border border-dashed border-[var(--color-line)]"
            : "size-(--space-16) border border-[var(--color-line)]"
        }
      >
        <AvatarFallback
          className={
            invited
              ? "bg-[var(--color-bg)] text-[var(--color-ink-faint)]"
              : "bg-[var(--color-accent-soft)] font-mono text-[length:var(--text-3xs)] font-semibold text-[var(--color-ink-soft)]"
          }
        >
          {name ? memberInitials(name) : ""}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <div className="flex items-center gap-(--space-3)">
          {name ? (
            <span className="truncate font-semibold text-[var(--color-ink)]">
              {name}
            </span>
          ) : (
            <span className="text-[var(--color-ink-faint)]">Invitation pending</span>
          )}
          {isCurrentUser ? (
            <span className="shrink-0 font-mono text-[length:var(--text-3xs)] font-semibold tracking-[var(--tracking-caps)] text-[var(--color-ink-faint)] uppercase">
              · You
            </span>
          ) : null}
        </div>
        <div className="truncate font-mono text-[length:var(--text-xs)] leading-[var(--leading-xs)] text-[var(--color-ink-faint)]">
          {email}
        </div>
      </div>
    </div>
  );
}

function AccessCell({
  member,
  canGrantTeamManagement,
  disabled,
  onSelectPreset,
  onCustomize,
}: {
  member: TeamMemberRow;
  canGrantTeamManagement: boolean;
  disabled: boolean;
  onSelectPreset: (presetKey: AccessPresetKey) => void;
  onCustomize: () => void;
}) {
  if (member.role === "owner") {
    return <Badge variant="warning">Owner</Badge>;
  }

  const label = formatAccessPresetLabel(member.presetKey ?? "custom");

  if (!member.canManage || member.isCurrentUser) {
    return <Badge variant="outline">{label}</Badge>;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          className="rounded-full font-mono text-[length:var(--text-2xs)] font-semibold tracking-[var(--tracking-caps)] uppercase"
        >
          {label}
          <HugeiconsIcon icon={ArrowDown01Icon} data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {ACCESS_PRESET_KEYS.filter(
          (presetKey) => canGrantTeamManagement || presetKey !== "admin"
        ).map((presetKey) => (
          <DropdownMenuItem
            key={presetKey}
            onSelect={() => onSelectPreset(presetKey)}
          >
            {formatAccessPresetLabel(presetKey)}
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem onSelect={onCustomize}>Custom…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
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
        <Button>
          <HugeiconsIcon icon={Add01Icon} data-icon="inline-start" />
          Invite member
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
                          className={`rounded-[var(--radius-md)] border px-(--space-8) py-(--space-8) text-left outline-none transition-colors duration-(--duration-1) ease-(--ease-out) focus-visible:border-[var(--color-accent)] focus-visible:shadow-[0_0_0_4px_var(--color-accent-soft)] ${
                            selected
                              ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]"
                              : "border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink)] hover:bg-[var(--color-surface-alt)]"
                          }`}
                          aria-pressed={selected}
                        >
                          <span className="font-medium">
                            {formatAccessPresetLabel(presetKey)}
                          </span>
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
  pending,
}: {
  canGrantTeamManagement: boolean;
  member: TeamMemberRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (member: TeamMemberRow, moduleAccess: TeamMemberRow["moduleAccess"]) => void;
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
                <SelectContent className="bg-[var(--color-surface)] text-[var(--color-ink)]">
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
    queryKey: queryKeys.team.root,
    queryFn: () =>
      apiJson<TeamPageData>("/api/team", {
        fallbackError: "Failed to load team settings.",
      }),
    initialData,
    initialDataUpdatedAt: 0,
  });

  const refreshData = async () => {
    setActionError(null);
    await queryClient.invalidateQueries({ queryKey: queryKeys.team.root });
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

  const memberCount = data.members.length;
  const query = searchValue.trim().toLowerCase();
  const matches = (name: string | null, email: string) =>
    !query ||
    (name ?? "").toLowerCase().includes(query) ||
    email.toLowerCase().includes(query);

  const members = data.members.filter((row) => matches(row.name, row.email));
  const invites = data.pendingInvites.filter((row) => matches(null, row.email));

  const memberOverflow = (member: TeamMemberRow) => {
    if (!member.canManage || member.isCurrentUser || member.role === "owner") {
      return null;
    }

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={mutationPending}
            aria-label={`Actions for ${member.email}`}
          >
            <HugeiconsIcon icon={MoreHorizontalIcon} strokeWidth={2} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            className="text-[var(--status-danger-ink)] focus:text-[var(--status-danger-ink)]"
            onSelect={() => removeMemberMutation.mutate(member.id)}
          >
            Remove member
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const inviteOverflow = (invite: PendingInviteRow) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={mutationPending}
          aria-label={`Actions for ${invite.email}`}
        >
          <HugeiconsIcon icon={MoreHorizontalIcon} strokeWidth={2} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => resendMutation.mutate(invite.id)}>
          Resend invite
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-[var(--status-danger-ink)] focus:text-[var(--status-danger-ink)]"
          onSelect={() => cancelInviteMutation.mutate(invite.id)}
        >
          Revoke invite
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="flex flex-col gap-(--space-8)">
      <SettingsPageHeader
        title="Team"
        sub={`${memberCount} ${memberCount === 1 ? "member" : "members"} · access controls what each person can see and do.`}
        action={
          <InviteMemberDialog
            canGrantTeamManagement={data.canGrantTeamManagement}
            onSuccess={refreshData}
          />
        }
      />

      <SettingsCard>
        <SettingsBlock
          actions={
            <Input
              type="search"
              value={searchValue}
              onChange={(event) => setSearchValue(event.target.value)}
              placeholder="Search members…"
              aria-label="Search members"
              className="h-(--height-input-sm) w-56 rounded-full"
            />
          }
        >
          {actionError ? (
            <div className="mb-(--space-6)">
              <FieldError>{actionError}</FieldError>
            </div>
          ) : null}

          <TableFrame>
            <FramedTable>
              <FramedTableHead>
                <tr>
                  <FramedTableHeaderCell>Member</FramedTableHeaderCell>
                  <FramedTableHeaderCell className="w-44">
                    Access
                  </FramedTableHeaderCell>
                  <FramedTableHeaderCell className="w-32">
                    Status
                  </FramedTableHeaderCell>
                  <FramedTableHeaderCell className="w-12" />
                </tr>
              </FramedTableHead>
              <FramedTableBody>
                {members.map((member) => (
                  <FramedTableRow key={member.id}>
                    <FramedTableCell>
                      <MemberCell
                        name={member.name}
                        email={member.email}
                        isCurrentUser={member.isCurrentUser}
                      />
                    </FramedTableCell>
                    <FramedTableCell>
                      <AccessCell
                        member={member}
                        canGrantTeamManagement={data.canGrantTeamManagement}
                        disabled={mutationPending}
                        onSelectPreset={(presetKey) =>
                          updateMemberMutation.mutate({
                            memberId: member.id,
                            moduleAccess: getAccessPresetModuleAccess(presetKey),
                          })
                        }
                        onCustomize={() => setCustomizingMember(member)}
                      />
                    </FramedTableCell>
                    <FramedTableCell>
                      <Badge variant="success">
                        <span className="size-(--space-3) bg-current" />
                        Active
                      </Badge>
                    </FramedTableCell>
                    <FramedTableCell align="right">
                      {memberOverflow(member)}
                    </FramedTableCell>
                  </FramedTableRow>
                ))}
                {invites.map((invite) => (
                  <FramedTableRow key={invite.id}>
                    <FramedTableCell>
                      <MemberCell name={null} email={invite.email} invited />
                    </FramedTableCell>
                    <FramedTableCell>
                      <Badge variant="outline">
                        {formatAccessPresetLabel(invite.presetKey)}
                      </Badge>
                    </FramedTableCell>
                    <FramedTableCell>
                      <Badge>Invited</Badge>
                    </FramedTableCell>
                    <FramedTableCell align="right">
                      {inviteOverflow(invite)}
                    </FramedTableCell>
                  </FramedTableRow>
                ))}
                {members.length === 0 && invites.length === 0 ? (
                  <FramedTableEmptyRow colSpan={4} height="compact">
                    {query ? `No members match “${searchValue}”.` : "No team members found."}
                  </FramedTableEmptyRow>
                ) : null}
              </FramedTableBody>
            </FramedTable>
          </TableFrame>
        </SettingsBlock>
      </SettingsCard>

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
          onSave={(member, moduleAccess) =>
            updateMemberMutation.mutate({ memberId: member.id, moduleAccess })
          }
          pending={mutationPending}
        />
      ) : null}
    </div>
  );
}
