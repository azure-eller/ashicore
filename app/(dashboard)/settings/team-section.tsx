"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, RefreshIcon } from "@hugeicons/core-free-icons";
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
import { formatDate } from "@/lib/format";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

function InviteMemberDialog({ onSuccess }: { onSuccess: () => Promise<void> }) {
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
          <HugeiconsIcon icon={Add01Icon} data-icon="inline-start" />
          Invite member
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
                  <div className="grid gap-3 sm:grid-cols-2">
                    {ACCESS_PRESET_KEYS.map((presetKey) => {
                      const selected = field.value === presetKey;

                      return (
                        <button
                          key={presetKey}
                          type="button"
                          onClick={() => field.onChange(presetKey)}
                          className={`rounded-xl border px-4 py-4 text-left transition-colors ${
                            selected
                              ? "border-ring bg-accent text-accent-foreground"
                              : "border-border bg-card text-card-foreground hover:bg-accent/50"
                          }`}
                          aria-pressed={selected}
                        >
                          <div className="flex items-center justify-between gap-3">
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

          <div className="flex justify-end gap-3">
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
  member,
  open,
  onOpenChange,
  onSave,
  pending,
}: {
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
    member.presetKey === "custom" ? "custom" : member.presetKey
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
                  {ACCESS_PRESET_KEYS.map((preset) => (
                    <SelectItem key={preset} value={preset}>
                      {formatAccessPresetLabel(preset)}
                    </SelectItem>
                  ))}
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>

          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Module</TableHead>
                  <TableHead className="text-right">Access</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {MODULE_KEYS.map((moduleKey) => (
                  <TableRow key={moduleKey}>
                    <TableCell className="font-medium">
                      {formatModuleLabel(moduleKey)}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={moduleAccess[moduleKey]}
                        onValueChange={(nextValue) => {
                          setPresetKey("custom");
                          setModuleAccess({
                            ...moduleAccess,
                            [moduleKey]: nextValue as ModuleAccessLevel,
                          });
                        }}
                        disabled={pending}
                      >
                        <SelectTrigger className="w-full min-w-[180px]">
                          <SelectValue placeholder="Select access" />
                        </SelectTrigger>
                        <SelectContent
                          align="start"
                          className="bg-popover text-popover-foreground"
                        >
                          {FULL_ACCESS_OPTIONS.map((option) => (
                            <SelectItem key={option} value={option}>
                              {formatAccessLevelLabel(option)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
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

  const mutationPending =
    resendMutation.isPending ||
    cancelInviteMutation.isPending ||
    updateMemberMutation.isPending;

  const updateMember = (member: TeamMemberRow, moduleAccess: TeamMemberRow["moduleAccess"]) => {
    updateMemberMutation.mutate({
      memberId: member.id,
      moduleAccess,
    });
  };

  return (
    <>
      <section id="team" className="rounded-xl border bg-card">
        <div className="flex flex-col gap-4 p-6 md:flex-row md:items-end md:justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Team</h2>
          <InviteMemberDialog onSuccess={refreshData} />
        </div>

        {actionError ? (
          <div className="px-6 pb-4">
            <FieldError>{actionError}</FieldError>
          </div>
        ) : null}

        {data.pendingInvites.length > 0 ? (
          <div className="border-t px-6 py-4">
            <div className="space-y-2">
              {data.pendingInvites.map((invite) => (
                <div
                  key={invite.id}
                  className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{invite.email}</div>
                    <div className="mt-1 flex items-center gap-2">
                      <AccessPresetBadge presetKey={invite.presetKey} />
                      <span className="text-xs text-muted-foreground">
                        {formatDate(invite.expiresAt)}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
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
          </div>
        ) : null}

        <div className="border-t px-6 py-4">
          <h3 className="mb-3 text-sm font-medium">Members</h3>
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Access</TableHead>
                  <TableHead className="w-16 text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.members.map((member) => {
                  const manageable = member.canManage && !member.isCurrentUser;

                  return (
                    <TableRow key={member.id} className="group">
                      <TableCell className="align-top">
                        <div className="space-y-1">
                          <div className="font-medium text-foreground">
                            {member.name}
                            {member.isCurrentUser ? (
                              <span className="ml-2 text-xs text-muted-foreground">(You)</span>
                            ) : null}
                          </div>
                          <div className="truncate text-sm text-muted-foreground">
                            {member.email}
                          </div>
                          {member.role === "owner" ? (
                            <TeamRoleBadge role={member.role} />
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        <AccessPresetBadge presetKey={member.presetKey} />
                      </TableCell>
                      <TableCell className="align-top text-right">
                        {manageable ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={mutationPending}
                            onClick={() => setCustomizingMember(member)}
                            className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                          >
                            Edit
                          </Button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      </section>

      {customizingMember ? (
        <CustomizeAccessDialog
          key={customizingMember.id}
          member={customizingMember}
          open
          onOpenChange={(open) => {
            if (!open) {
              setCustomizingMember(null);
            }
          }}
          onSave={updateMember}
          pending={updateMemberMutation.isPending}
        />
      ) : null}
    </>
  );
}
