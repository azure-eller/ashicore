"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, PencilEdit02Icon, RefreshIcon } from "@hugeicons/core-free-icons";
import {
  formatAccessLevelLabel,
  formatAccessPresetLabel,
  formatModuleLabel,
  getAccessPresetKeys,
  getAccessPresetModuleAccess,
  type AccessPresetKey,
  type DerivedAccessPresetKey,
  MODULE_KEYS,
  type ModuleAccessLevel,
} from "@/lib/authz";
import { DateTimeText } from "@/components/date-time-text";
import { createTeamInvitationSchema, moduleAccessSchema } from "@/lib/schemas/team";
import { Badge } from "@/components/ui/badge";
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
import type { TeamMemberRow, TeamPageData } from "./types";

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

async function parseJson<T>(response: Response): Promise<T | null> {
  return response.json().catch(() => null);
}

function AccessPresetBadge({ presetKey }: { presetKey: DerivedAccessPresetKey }) {
  if (presetKey === "admin") {
    return <Badge>{formatAccessPresetLabel(presetKey)}</Badge>;
  }

  if (presetKey === "custom") {
    return <Badge variant="secondary">{formatAccessPresetLabel(presetKey)}</Badge>;
  }

  return <Badge variant="outline">{formatAccessPresetLabel(presetKey)}</Badge>;
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
      const response = await fetch("/api/team/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const body = await parseJson<{ error?: string; errors?: Record<string, string[]> }>(
        response
      );

      if (!response.ok) {
        if (body?.errors) {
          Object.entries(body.errors).forEach(([field, messages]) => {
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

        throw new Error(body?.error ?? "Failed to send invite.");
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
      <DialogContent className="bg-background text-foreground sm:max-w-2xl">
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
      <DialogContent className="bg-background text-foreground sm:max-w-3xl">
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

          <div className="overflow-hidden border">
            <div className="divide-y">
              {MODULE_KEYS.map((moduleKey) => (
                <div
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
                </div>
              ))}
            </div>
          </div>
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
  const [customizingMember, setCustomizingMember] = useState<TeamMemberRow | null>(null);

  const { data = initialData } = useQuery<TeamPageData>({
    queryKey: ["team"],
    queryFn: async () => {
      const response = await fetch("/api/team");
      const body = await parseJson<TeamPageData & { error?: string }>(response);

      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to load team settings.");
      }

      return body as TeamPageData;
    },
    initialData,
    initialDataUpdatedAt: 0,
  });

  const refreshData = async () => {
    setActionError(null);
    await queryClient.invalidateQueries({ queryKey: ["team"] });
  };

  const resendMutation = useMutation({
    mutationFn: async (invitationId: string) => {
      const response = await fetch(`/api/team/invitations/${invitationId}/resend`, {
        method: "POST",
      });
      const body = await parseJson<{ error?: string }>(response);

      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to resend invite.");
      }
    },
    onSuccess: refreshData,
    onError: (error) => setActionError(error.message),
  });

  const cancelInviteMutation = useMutation({
    mutationFn: async (invitationId: string) => {
      const response = await fetch(`/api/team/invitations/${invitationId}`, {
        method: "DELETE",
      });
      const body = await parseJson<{ error?: string }>(response);

      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to cancel invite.");
      }
    },
    onSuccess: refreshData,
    onError: (error) => setActionError(error.message),
  });

  const updateMemberMutation = useMutation({
    mutationFn: async (values: UpdateMemberPayload) => {
      const response = await fetch(`/api/team/members/${values.memberId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          moduleAccess: values.moduleAccess,
        }),
      });
      const body = await parseJson<{ error?: string }>(response);

      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to update member access.");
      }
    },
    onSuccess: async () => {
      await refreshData();
      setCustomizingMember(null);
    },
    onError: (error) => setActionError(error.message),
  });

  const removeMemberMutation = useMutation({
    mutationFn: async (memberId: string) => {
      const response = await fetch(`/api/team/members/${memberId}`, {
        method: "DELETE",
      });
      const body = await parseJson<{ error?: string }>(response);

      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to remove member.");
      }
    },
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

  return (
    <>
      <section id="team" className="scroll-mt-(--space-24) border">
        <div className="flex items-center justify-between gap-(--space-8) p-(--space-12)">
          <h2 className="text-[length:var(--text-base)] leading-[var(--leading-base)] font-semibold tracking-[var(--tracking-tight)]">
            Team{" "}
            <span className="text-[length:var(--text-sm)] font-normal text-muted-foreground">
              · {memberCount} {memberCount === 1 ? "member" : "members"}
              {pendingCount > 0 ? ` · ${pendingCount} pending` : ""}
            </span>
          </h2>
          <InviteMemberDialog
            canGrantTeamManagement={data.canGrantTeamManagement}
            onSuccess={refreshData}
          />
        </div>

        {actionError ? (
          <div className="px-6 pb-4">
            <FieldError>{actionError}</FieldError>
          </div>
        ) : null}

        <div className="divide-y border-t">
          {data.members.map((member) => {
            const manageable = member.canManage && !member.isCurrentUser;

            return (
              <div
                key={member.id}
                data-email={member.email}
                className="group grid grid-cols-[minmax(0,1fr)_minmax(8rem,auto)_2rem] items-center gap-4 px-6 py-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-foreground">
                    {member.name}
                    {member.isCurrentUser ? (
                      <span className="ml-2 text-xs text-muted-foreground">(You)</span>
                    ) : null}
                  </div>
                  <div className="truncate text-sm text-muted-foreground">
                    {member.email}
                  </div>
                </div>

                <div className="flex flex-wrap justify-end gap-2">
                  {member.presetKey ? <AccessPresetBadge presetKey={member.presetKey} /> : null}
                  {member.role === "owner" ? (
                    <TeamRoleBadge role={member.role} />
                  ) : null}
                </div>

                {manageable ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={mutationPending}
                    onClick={() => setCustomizingMember(member)}
                    className="justify-self-end bg-transparent text-muted-foreground opacity-0 transition-opacity hover:bg-transparent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                    aria-label={`Edit ${member.name}`}
                  >
                    <HugeiconsIcon icon={PencilEdit02Icon} />
                  </Button>
                ) : (
                  <span aria-hidden="true" className="h-8 w-8" />
                )}
              </div>
            );
          })}

          {data.pendingInvites.map((invite) => (
            <div
              key={invite.id}
              data-email={invite.email}
              data-pending="true"
              className="flex items-center justify-between gap-4 px-6 py-4 opacity-60"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-foreground">{invite.email}</div>
                <div className="text-sm text-muted-foreground">
                  pending · expires <DateTimeText value={invite.expiresAt} />
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <AccessPresetBadge presetKey={invite.presetKey} />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={mutationPending}
                  onClick={() => resendMutation.mutate(invite.id)}
                >
                  <HugeiconsIcon icon={RefreshIcon} data-icon="inline-start" />
                  Resend
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={mutationPending}
                  onClick={() => cancelInviteMutation.mutate(invite.id)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ))}
        </div>
      </section>

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
