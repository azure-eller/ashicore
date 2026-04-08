"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  Delete02Icon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";
import {
  formatAccessLevelLabel,
  formatModuleLabel,
  MODULE_KEYS,
  type ModuleAccessLevel,
} from "@/lib/authz";
import { formatDate } from "@/lib/format";
import {
  createTeamInvitationSchema,
  moduleAccessSchema,
} from "@/lib/schemas/team";
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
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { TeamMemberRow, TeamPageData } from "./types";

type InviteFormValues = {
  email: string;
};

type UpdateMemberPayload = {
  memberId: string;
  moduleAccess: TeamMemberRow["moduleAccess"];
};

const FULL_ACCESS_OPTIONS: ModuleAccessLevel[] = ["none", "read", "operate", "admin"];

async function parseJson<T>(response: Response): Promise<T | null> {
  return response.json().catch(() => null);
}

function InviteMemberDialog({ onSuccess }: { onSuccess: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<InviteFormValues>({
    resolver: zodResolver(createTeamInvitationSchema),
    mode: "onBlur",
    defaultValues: {
      email: "",
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
      form.reset({ email: "" });
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
      <DialogContent className="bg-background text-foreground sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Invite member</DialogTitle>
          <DialogDescription>
            Invite a teammate. Access is configured from the permissions matrix after
            they join.
          </DialogDescription>
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

export function TeamSection({ initialData }: { initialData: TeamPageData }) {
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

  const mutationPending =
    resendMutation.isPending ||
    cancelInviteMutation.isPending ||
    updateMemberMutation.isPending ||
    removeMemberMutation.isPending;

  const updateMember = (member: TeamMemberRow, moduleAccess: TeamMemberRow["moduleAccess"]) => {
    updateMemberMutation.mutate({
      memberId: member.id,
      moduleAccess: moduleAccessSchema.parse(moduleAccess),
    });
  };

  return (
    <section id="team" className="rounded-xl border bg-card">
      <div className="flex flex-col gap-4 p-6 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-tight">Team</h2>
          <p className="text-sm text-muted-foreground">
            Manage access from one permissions matrix. Settings admin users can invite
            teammates and edit non-owner users.
          </p>
        </div>
        <InviteMemberDialog onSuccess={refreshData} />
      </div>

      {actionError ? (
        <div className="px-6 pb-4">
          <FieldError>{actionError}</FieldError>
        </div>
      ) : null}

      {data.pendingInvites.length > 0 ? (
        <>
          <div className="border-t px-6 py-4">
            <h3 className="text-sm font-medium">Pending invites</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Invitations stay here until the teammate creates their account.
            </p>
          </div>
          <div className="overflow-x-auto border-t px-6 pb-6 pt-4">
            <Table className="min-w-[720px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="w-[180px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.pendingInvites.map((invite) => (
                  <TableRow key={invite.id}>
                    <TableCell className="font-medium">{invite.email}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(invite.expiresAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
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
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      ) : null}

      <div className="overflow-x-auto border-t px-6 pb-6 pt-4">
        <Table className="min-w-[1080px]">
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[320px]">User</TableHead>
              {MODULE_KEYS.map((module) => (
                <TableHead key={module} className="min-w-[156px]">
                  {formatModuleLabel(module)}
                </TableHead>
              ))}
              <TableHead className="w-[80px] text-right"> </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.members.map((member) => {
              const manageable = member.canManage && !member.isCurrentUser;

              return (
                <TableRow key={member.id}>
                  <TableCell className="align-top">
                    <div className="min-w-0 space-y-1">
                      <div className="font-medium text-foreground">
                        {member.name}
                        {member.isCurrentUser ? (
                          <span className="ml-2 text-xs text-muted-foreground">(You)</span>
                        ) : null}
                      </div>
                      <div className="truncate text-sm text-muted-foreground">
                        {member.email}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {member.role === "owner" ? "Owner" : "User"}
                      </div>
                    </div>
                  </TableCell>
                  {MODULE_KEYS.map((module) => {
                    const value = member.moduleAccess[module];

                    return (
                      <TableCell key={module} className="align-middle">
                        {manageable ? (
                          <Select
                            value={value}
                            onValueChange={(nextValue) =>
                              updateMember(member, {
                                ...member.moduleAccess,
                                [module]: nextValue as ModuleAccessLevel,
                              })
                            }
                            disabled={mutationPending}
                          >
                            <SelectTrigger
                              size="sm"
                              className="w-full min-w-[132px]"
                              aria-label={`${formatModuleLabel(module)} access`}
                            >
                              <SelectValue placeholder="Select access" />
                            </SelectTrigger>
                            <SelectContent align="start">
                              {FULL_ACCESS_OPTIONS.map((option) => (
                                <SelectItem key={option} value={option}>
                                  {formatAccessLevelLabel(option)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <div className="text-sm text-foreground">
                            {formatAccessLevelLabel(value)}
                          </div>
                        )}
                      </TableCell>
                    );
                  })}
                  <TableCell className="text-right align-top">
                    {manageable ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            disabled={mutationPending}
                            onClick={() => removeMemberMutation.mutate(member.id)}
                            aria-label={`Remove ${member.email}`}
                            className="shrink-0 text-muted-foreground"
                          >
                            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">Remove member</TooltipContent>
                      </Tooltip>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
