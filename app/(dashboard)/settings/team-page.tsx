"use client";

import { useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  Delete02Icon,
  MoreVerticalIcon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";
import {
  getAssignableRoles,
  type AssignableAppRole,
  type AppRole,
} from "@/lib/authz";
import { createTeamInvitationSchema } from "@/lib/schemas/team";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldSeparator,
  FieldLegend,
} from "@/components/ui/field";
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
import type { TeamPageData } from "./types";
import { TeamRoleBadge } from "./team-role-badge";

type InviteFormValues = {
  email: string;
  role: AssignableAppRole;
};

async function parseJson<T>(response: Response): Promise<T | null> {
  return response.json().catch(() => null);
}

function labelRole(role: AssignableAppRole) {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function InviteMemberDialog({
  currentRole,
  onSuccess,
}: {
  currentRole: AppRole;
  onSuccess: () => Promise<void>;
}) {
  const roleOptions = useMemo(() => getAssignableRoles(currentRole), [currentRole]);
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<InviteFormValues>({
    resolver: zodResolver(createTeamInvitationSchema),
    mode: "onBlur",
    defaultValues: {
      email: "",
      role: roleOptions[0] ?? "viewer",
    },
  });

  const inviteMutation = useMutation({
    mutationFn: async (values: InviteFormValues) => {
      const response = await fetch("/api/team/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const body = await parseJson<{ error?: string; errors?: Record<string, string[]> }>(response);

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
        role: roleOptions[0] ?? "viewer",
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
        <Button disabled={roleOptions.length === 0}>
          <HugeiconsIcon icon={Add01Icon} className="h-4 w-4" />
          Invite Member
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-background text-foreground sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Invite a teammate</DialogTitle>
          <DialogDescription>
            Send an email invite and assign a fixed app role.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-6"
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
                  <FieldDescription>
                    The invite link will be sent to this email address.
                  </FieldDescription>
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />

            <Controller
              name="role"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>Role</FieldLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id={field.name} aria-invalid={fieldState.invalid}>
                      <SelectValue placeholder="Select a role" />
                    </SelectTrigger>
                    <SelectContent className="bg-popover text-popover-foreground">
                      {roleOptions.map((role) => (
                        <SelectItem key={role} value={role}>
                          {labelRole(role)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    Operators can work in inventory and manufacturing. Viewers are read-only.
                  </FieldDescription>
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />
          </FieldGroup>

          {formError && <FieldError>{formError}</FieldError>}

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
              {inviteMutation.isPending ? "Sending Invite..." : "Send Invite"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TeamPage({ initialData }: { initialData: TeamPageData }) {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);

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

  const updateRoleMutation = useMutation({
    mutationFn: async ({
      memberId,
      role,
    }: {
      memberId: string;
      role: AssignableAppRole;
    }) => {
      const response = await fetch(`/api/team/members/${memberId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const body = await parseJson<{ error?: string }>(response);

      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to update role.");
      }
    },
    onSuccess: refreshData,
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
    onSuccess: refreshData,
    onError: (error) => setActionError(error.message),
  });

  const roleOptions = getAssignableRoles(data.currentRole);

  return (
    <div className="mx-auto w-full max-w-6xl py-8">
      <div className="space-y-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1.5">
            <h1 className="text-3xl font-semibold tracking-tight">Team</h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Manage who can access {data.organization.name}, invite teammates, and keep roles aligned with the simplified ERP permission model.
            </p>
          </div>
          <InviteMemberDialog currentRole={data.currentRole} onSuccess={refreshData} />
        </div>

        {actionError && <FieldError>{actionError}</FieldError>}

        <FieldGroup className="gap-8">
          <FieldSet className="gap-4">
            <FieldLegend>Active Members</FieldLegend>
            <FieldDescription>
              Owners and admins can manage team access directly from here.
            </FieldDescription>
            <div className="overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead className="w-[72px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.members.map((member) => {
                    const manageable =
                      member.role !== "owner" &&
                      (data.currentRole === "owner" ||
                        member.role === "operator" ||
                        member.role === "viewer" ||
                        member.role === "member");
                    const nextRoles = roleOptions.filter((role) => role !== member.role);

                    return (
                      <TableRow key={member.id}>
                        <TableCell className="font-medium">
                          {member.name}
                          {member.isCurrentUser ? (
                            <span className="ml-2 text-xs text-muted-foreground">(You)</span>
                          ) : null}
                        </TableCell>
                        <TableCell>{member.email}</TableCell>
                        <TableCell>
                          <TeamRoleBadge role={member.role} />
                        </TableCell>
                        <TableCell>{formatDateTime(member.createdAt)}</TableCell>
                        <TableCell className="text-right">
                          {manageable ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="icon"
                                  disabled={
                                    updateRoleMutation.isPending || removeMemberMutation.isPending
                                  }
                                  aria-label={`Manage ${member.name}`}
                                >
                                  <HugeiconsIcon icon={MoreVerticalIcon} className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent
                                align="end"
                                className="bg-popover text-popover-foreground"
                              >
                                {nextRoles.map((role) => (
                                  <DropdownMenuItem
                                    key={role}
                                    onClick={() =>
                                      updateRoleMutation.mutate({ memberId: member.id, role })
                                    }
                                  >
                                    Change to {labelRole(role)}
                                  </DropdownMenuItem>
                                ))}
                                <DropdownMenuItem
                                  variant="destructive"
                                  onClick={() => removeMemberMutation.mutate(member.id)}
                                >
                                  <HugeiconsIcon icon={Delete02Icon} className="h-4 w-4" />
                                  Remove member
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
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
          </FieldSet>

          <FieldSeparator />

          <FieldSet className="gap-4">
            <FieldLegend>Pending Invites</FieldLegend>
            <FieldDescription>
              Resend or cancel invites while they are still pending.
            </FieldDescription>
            <div className="overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Sent</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead className="w-[180px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.pendingInvites.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground">
                        No pending invites.
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.pendingInvites.map((invite) => {
                      const manageable =
                        data.currentRole === "owner" ||
                        invite.role === "operator" ||
                        invite.role === "viewer" ||
                        invite.role === "member";

                      return (
                        <TableRow key={invite.id}>
                          <TableCell className="font-medium">{invite.email}</TableCell>
                          <TableCell>
                            <TeamRoleBadge role={invite.role} />
                          </TableCell>
                          <TableCell>{formatDateTime(invite.createdAt)}</TableCell>
                          <TableCell>{formatDateTime(invite.expiresAt)}</TableCell>
                          <TableCell className="text-right">
                            {manageable ? (
                              <div className="flex justify-end gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  disabled={resendMutation.isPending}
                                  onClick={() => resendMutation.mutate(invite.id)}
                                >
                                  <HugeiconsIcon icon={RefreshIcon} className="h-4 w-4" />
                                  Resend
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  disabled={cancelInviteMutation.isPending}
                                  onClick={() => cancelInviteMutation.mutate(invite.id)}
                                >
                                  Cancel
                                </Button>
                              </div>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </FieldSet>
        </FieldGroup>
      </div>
    </div>
  );
}
