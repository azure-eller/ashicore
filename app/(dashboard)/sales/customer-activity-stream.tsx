"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { shortDayLabel } from "./customer-meta";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  Call02Icon,
  Cancel01Icon,
  Folder01Icon,
  Mail01Icon,
  StickyNote02Icon,
  Tick02Icon,
  UserIcon,
  UserMultiple02Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { FieldError } from "@/components/ui/field";
import { DatePicker } from "@/components/ui/date-picker";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  CardSection,
} from "@/components/card-page/card-page";
import {
  CardTextField,
} from "@/components/card-page/card-field";
import {
  cardSaveMutationKey,
} from "@/components/card-page/card-save-status";
import {
  createCustomerActivity,
  createCustomerProject,
  patchCustomerActivity,
} from "@/lib/api/clients/customers";
import {
  toDateOnlyString,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  CustomerActivityRow,
  CustomerActivityType,
  CustomerContactRow,
  CustomerProjectRow,
} from "@/lib/sales/types";
import styles from "@/components/card-page/card-page.module.css";
import { queryKeys } from "@/lib/client/query-keys";

const noActivityProjectValue = "__no_activity_project__";
const newProjectSentinel = "__new_project__";


export type ActivityStreamFilter =
  | { kind: "project"; id: string; name: string }
  | { kind: "contact"; id: string; name: string }
  | null;



const activityComposerMeta: Record<
  CustomerActivityType,
  { label: string; submitLabel: string; placeholder: string }
> = {
  note: { label: "Note", submitLabel: "Log note", placeholder: "Write a note… (@ to mention a contact)" },
  call: { label: "Call", submitLabel: "Log call", placeholder: "What happened on the call?" },
  email: { label: "Email", submitLabel: "Log email", placeholder: "Summarize the email…" },
  meeting: { label: "Meeting", submitLabel: "Log meeting", placeholder: "What was discussed?" },
  task: { label: "Task", submitLabel: "Create task", placeholder: "What needs to happen next?" },
};

const activityTimelineIcons: Record<CustomerActivityType, IconSvgElement> = {
  note: StickyNote02Icon,
  call: Call02Icon,
  email: Mail01Icon,
  meeting: UserMultiple02Icon,
  task: Tick02Icon,
};


export function ActivitySection({
  customerId,
  rows: allRows,
  projects,
  contacts,
  filter,
  onFilterChange,
  readOnly,
}: {
  customerId: string | null;
  rows: CustomerActivityRow[];
  projects: CustomerProjectRow[];
  contacts: CustomerContactRow[];
  filter: ActivityStreamFilter;
  onFilterChange: (filter: ActivityStreamFilter) => void;
  readOnly: boolean;
}) {
  const queryClient = useQueryClient();
  const [type, setType] = useState<CustomerActivityType>("note");
  const [body, setBody] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [projectId, setProjectId] = useState(noActivityProjectValue);
  const [mention, setMention] = useState<{
    query: string;
    start: number;
    end: number;
  } | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [streamSheetOpen, setStreamSheetOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectStatus, setNewProjectStatus] = useState<"planning" | "active">("planning");
  const [newProjectTargetDate, setNewProjectTargetDate] = useState("");

  const rows = !filter
    ? allRows
    : filter.kind === "project"
      ? allRows.filter((row) => row.customerProjectId === filter.id)
      : allRows.filter((row) =>
          row.attendees.some((attendee) => attendee.contactId === filter.id)
        );
  const mentionMatches =
    mention === null
      ? []
      : contacts.filter(
          (contact) =>
            contact.name.trim() &&
            contact.name.toLowerCase().startsWith(mention.query.toLowerCase())
        );
  const insertMention = (name: string) => {
    if (!mention) return;
    const caret = mention.start + name.length + 2;
    setBody(
      (current) =>
        `${current.slice(0, mention.start)}@${name} ${current.slice(mention.end)}`
    );
    setMention(null);
    requestAnimationFrame(() => {
      const input = bodyRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(caret, caret);
    });
  };
  const isTask = type === "task";
  const openTasks = rows
    .filter((row) => row.type === "task" && row.status === "open")
    .sort((a, b) => {
      if (a.dueDate !== b.dueDate) {
        if (a.dueDate == null) return 1;
        if (b.dueDate == null) return -1;
        return a.dueDate < b.dueDate ? -1 : 1;
      }
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  const timeline = rows
    .filter((row) => !(row.type === "task" && row.status === "open"))
    .sort((a, b) => timelineDate(b).getTime() - timelineDate(a).getTime());
  const timelineMonths = groupTimelineByMonth(timeline);
  const today = toDateOnlyString(new Date()) ?? "";

  const invalidate = async () => {
    if (customerId) {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.customers.card(customerId),
      });
    }
  };

  const createMutation = useMutation({
    mutationKey: cardSaveMutationKey(
      "customer",
      customerId ?? "__draft__",
      "activity-create"
    ),
    mutationFn: () =>
      createCustomerActivity(customerId as string, {
        type,
        occurredAt: undefined,
        title: isTask ? body.trim().replace(/\s+/g, " ") : null,
        body: isTask ? null : body.trim() || null,
        dueDate: isTask && dueDate ? dueDate : null,
        customerProjectId:
          projectId === noActivityProjectValue ? null : projectId,
        attendeeContactIds: contacts
          .filter(
            (contact) =>
              contact.name.trim() && body.includes(`@${contact.name}`)
          )
          .map((contact) => contact.id),
      }),
    onSuccess: async () => {
      setBody("");
      setDueDate("");
      setMention(null);
      await invalidate();
    },
  });

  const patchMutation = useMutation({
    mutationKey: cardSaveMutationKey(
      "customer",
      customerId ?? "__draft__",
      "activity-patch"
    ),
    mutationFn: ({
      activityId,
      status,
    }: {
      activityId: string;
      status: "open" | "done";
    }) => patchCustomerActivity(customerId as string, activityId, { status }),
    onSuccess: invalidate,
  });

  const newProjectMutation = useMutation({
    mutationKey: cardSaveMutationKey(
      "customer",
      customerId ?? "__draft__",
      "activity-new-project"
    ),
    mutationFn: () =>
      createCustomerProject(customerId as string, {
        name: newProjectName.trim(),
        status: newProjectStatus,
        startDate: null,
        targetEndDate: newProjectTargetDate || null,
        summary: null,
      }),
    onSuccess: async (project) => {
      setNewProjectOpen(false);
      setNewProjectName("");
      setNewProjectStatus("planning");
      setNewProjectTargetDate("");
      if (project) setProjectId(project.id);
      await invalidate();
    },
  });

  const pending = patchMutation.isPending;
  const error =
    createMutation.error ?? patchMutation.error ?? newProjectMutation.error;

  return (
    <CardSection
      title="Activity"
      count={`· ${rows.length}`}
      actions={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-[var(--color-accent-ink)]"
          onClick={() => setStreamSheetOpen(true)}
        >
          View all →
        </Button>
      }
    >
      <div className="grid gap-(--space-10)">
        {!readOnly ? (
          <div className="grid gap-0 rounded-(--radius-md) border-[1.5px] border-[var(--color-line)] transition-[border-color,box-shadow] duration-(--duration-1) ease-(--ease-out) focus-within:border-[var(--color-accent)] focus-within:shadow-[0_0_0_4px_var(--color-accent-soft)]">
            <div className="flex flex-wrap items-center gap-(--space-2) p-(--space-4) pb-0">
              {(Object.keys(activityComposerMeta) as CustomerActivityType[]).map(
                (option) => (
                  <Button
                    key={option}
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-pressed={type === option}
                    className={cn(
                      "rounded-full font-medium",
                      type === option
                        ? "border-transparent bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)] hover:bg-[var(--color-accent-soft)]"
                        : "text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
                    )}
                    onClick={() => setType(option)}
                  >
                    {activityComposerMeta[option].label}
                  </Button>
                )
              )}
            </div>
            <div className="relative">
              <Textarea
                ref={bodyRef}
                value={body}
                rows={2}
                disabled={createMutation.isPending}
                aria-label={isTask ? "Task title" : "Activity notes"}
                placeholder={activityComposerMeta[type].placeholder}
                className="field-sizing-fixed border-0 bg-transparent shadow-none hover:border-0 focus-visible:border-0 focus-visible:shadow-none text-[length:var(--text-md)] leading-[var(--leading-md)]"
                onChange={(event) => {
                  const value = event.target.value;
                  setBody(value);
                  const caret = event.target.selectionStart ?? value.length;
                  const match = value
                    .slice(0, caret)
                    .match(/@([A-Za-z]+(?: [A-Za-z]+)?)$/);
                  setMention(
                    match
                      ? {
                          query: match[1],
                          start: caret - match[0].length,
                          end: caret,
                        }
                      : null
                  );
                }}
                onBlur={() => setMention(null)}
              />
              {mentionMatches.length > 0 ? (
                <div className="absolute bottom-full left-(--space-4) z-10 mb-(--space-1) grid min-w-56 rounded-(--radius-md) border border-[var(--color-line)] bg-[var(--color-surface)] py-(--space-2) shadow-md">
                  {mentionMatches.slice(0, 6).map((contact) => (
                    <button
                      key={contact.id}
                      type="button"
                      className="flex items-center gap-(--space-3) px-(--space-4) py-(--space-2) text-left text-[length:var(--text-sm)] hover:bg-[var(--color-surface-alt)]"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        insertMention(contact.name);
                      }}
                    >
                      <span className="flex size-(--space-12) shrink-0 items-center justify-center rounded-full border border-[var(--color-line)] text-[length:var(--text-3xs)] text-[var(--color-ink-faint)]">
                        {contactInitials(contact.name)}
                      </span>
                      {contact.name}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-(--space-3) border-t border-[var(--color-line)] bg-[var(--color-surface-alt)] p-(--space-4)">
              <Select
                value={projectId}
                onValueChange={(value) => {
                  if (value === newProjectSentinel) {
                    setNewProjectOpen(true);
                    return;
                  }
                  setProjectId(value);
                }}
              >
                <SelectTrigger aria-label="Project" size="sm" className="rounded-full">
                  <HugeiconsIcon
                    icon={Folder01Icon}
                    className="size-(--space-5) shrink-0 text-[var(--color-ink-faint)]"
                  />
                  <SelectValue>
                    {projectId === noActivityProjectValue
                      ? "No project"
                      : projects.find((project) => project.id === projectId)
                          ?.name ?? "No project"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={noActivityProjectValue}>
                    No project
                  </SelectItem>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                  <SelectSeparator />
                  <SelectItem
                    value={newProjectSentinel}
                    className="font-medium text-[var(--color-accent-ink)]"
                  >
                    <HugeiconsIcon icon={Add01Icon} data-icon="inline-start" />
                    New project
                  </SelectItem>
                </SelectContent>
              </Select>
              {filter ? (
                <span className="flex items-center gap-(--space-2) rounded-full border border-[var(--color-line)] bg-[var(--color-surface-alt)] px-(--space-3) py-(--space-1) font-mono text-[length:var(--text-xs)] text-[var(--color-ink-faint)]">
                  <HugeiconsIcon
                    icon={filter.kind === "project" ? Folder01Icon : UserIcon}
                    className="size-(--space-5)"
                  />
                  {filter.name}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Clear filter"
                    onClick={() => onFilterChange(null)}
                  >
                    <HugeiconsIcon icon={Cancel01Icon} />
                  </Button>
                </span>
              ) : null}
              {isTask ? (
                <div className="w-52">
                  <DatePicker
                    value={dueDate}
                    placeholder="Due date"
                    disabled={createMutation.isPending}
                    onChange={(value) => setDueDate(value ?? "")}
                  />
                </div>
              ) : null}
              <div className="ml-auto flex items-center gap-(--space-4)">
                {error ? <FieldError>{error.message}</FieldError> : null}
                <Button
                  type="button"
                  className="rounded-full"
                  disabled={!body.trim() || createMutation.isPending}
                  onClick={() => {
                    if (!customerId || readOnly) return;
                    createMutation.mutate();
                  }}
                >
                  {createMutation.isPending
                    ? "Adding..."
                    : activityComposerMeta[type].submitLabel}
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        <ActivityStreamLists
          openTasks={openTasks}
          timelineMonths={timelineMonths}
          readOnly={readOnly}
          pending={pending}
          today={today}
          onToggle={(args) => patchMutation.mutate(args)}
          onFilterChange={onFilterChange}
        />
      </div>

      <Sheet open={streamSheetOpen} onOpenChange={setStreamSheetOpen}>
        <SheetContent
          side="right"
          className="gap-0 overflow-hidden p-0 data-[side=right]:w-[min(560px,94vw)] data-[side=right]:sm:max-w-[min(560px,94vw)]"
        >
          <SheetHeader>
            <SheetTitle>Activity · {rows.length}</SheetTitle>
            <SheetDescription className="sr-only">
              The full activity stream for this customer.
            </SheetDescription>
          </SheetHeader>
          <div className="grid min-h-0 flex-1 content-start gap-(--space-5) overflow-y-auto p-(--space-8)">
            <ActivityStreamLists
              openTasks={openTasks}
              timelineMonths={timelineMonths}
              readOnly={readOnly}
              pending={pending}
              today={today}
              onToggle={(args) => patchMutation.mutate(args)}
              onFilterChange={onFilterChange}
            />
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={newProjectOpen} onOpenChange={setNewProjectOpen}>
        <SheetContent
          side="right"
          className="gap-0 overflow-hidden p-0 data-[side=right]:w-[min(420px,94vw)] data-[side=right]:sm:max-w-[min(420px,94vw)]"
        >
          <SheetHeader>
            <SheetTitle>New project</SheetTitle>
            <SheetDescription className="sr-only">
              Create a project to tag activities and orders with.
            </SheetDescription>
          </SheetHeader>
          <div className="grid min-h-0 flex-1 content-start gap-(--space-6) overflow-y-auto p-(--space-8)">
            <CardTextField
              label="Project name"
              value={newProjectName}
              autoFocus
              controlStyle="dialog"
              onChange={(event) => setNewProjectName(event.target.value)}
            />
            <div className="grid gap-(--space-3)">
              <h3 className={styles.sectionHeading}>Status</h3>
              <div className="flex gap-(--space-2)">
                {(["planning", "active"] as const).map((status) => (
                  <Button
                    key={status}
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-pressed={newProjectStatus === status}
                    className={cn(
                      "rounded-full",
                      newProjectStatus === status &&
                        "border-transparent bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)] hover:bg-[var(--color-accent-soft)]"
                    )}
                    onClick={() => setNewProjectStatus(status)}
                  >
                    {status === "planning" ? "Planning" : "Active"}
                  </Button>
                ))}
              </div>
            </div>
            <div className="grid gap-(--space-3)">
              <h3 className={styles.sectionHeading}>Target date</h3>
              <DatePicker
                value={newProjectTargetDate}
                placeholder="Target date"
                onChange={(value) => setNewProjectTargetDate(value ?? "")}
              />
            </div>
          </div>
          <SheetFooter className="flex-row items-center justify-end gap-(--space-4)">
            <Button
              type="button"
              variant="outline"
              onClick={() => setNewProjectOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!newProjectName.trim() || newProjectMutation.isPending}
              onClick={() => newProjectMutation.mutate()}
            >
              {newProjectMutation.isPending ? "Creating..." : "Create project"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </CardSection>
  );
}

function ActivityStreamLists({
  openTasks,
  timelineMonths,
  readOnly,
  pending,
  today,
  onToggle,
  onFilterChange,
}: {
  openTasks: CustomerActivityRow[];
  timelineMonths: Array<{ label: string; entries: CustomerActivityRow[] }>;
  readOnly: boolean;
  pending: boolean;
  today: string;
  onToggle: (args: { activityId: string; status: "open" | "done" }) => void;
  onFilterChange: (filter: ActivityStreamFilter) => void;
}) {
  return (
    <>
        {!readOnly || openTasks.length > 0 ? (
          <div className="grid gap-(--space-2)">
            <div className="flex items-center gap-(--space-4)">
              <h3 className={styles.sectionHeading}>
                Upcoming · {openTasks.length}
              </h3>
              <div className="h-px flex-1 bg-[var(--color-line)]" />
            </div>
            {openTasks.length === 0 ? (
              <p className="rounded-(--radius-md) border border-dashed border-[var(--color-line)] px-(--space-4) py-(--space-3) text-[length:var(--text-sm)] text-[var(--color-ink-faint)]">
                Nothing scheduled — create a task above.
              </p>
            ) : null}
            <ul className="divide-y divide-[var(--color-line-2)]">
              {openTasks.map((task) => {
                return (
                  <li
                    key={task.id}
                    className="flex items-center gap-(--space-3) py-(--space-6)"
                  >
                    <button
                      type="button"
                      aria-label={`Complete "${task.title}"`}
                      disabled={readOnly || pending}
                      className="grid size-(--space-12) shrink-0 place-items-center rounded-full border-[1.5px] border-[var(--color-line)] bg-[var(--color-surface)] text-transparent transition-colors duration-(--duration-1) ease-(--ease-out) outline-none hover:border-[var(--status-success-ink)] hover:bg-[var(--color-success-soft)] hover:text-[var(--status-success-ink)] focus-visible:border-[var(--color-accent)] focus-visible:shadow-[0_0_0_4px_var(--color-accent-soft)] disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() =>
                        onToggle({
                          activityId: task.id,
                          status: "done",
                        })
                      }
                    >
                      <HugeiconsIcon
                        icon={Tick02Icon}
                        strokeWidth={2}
                        className="size-(--space-7)"
                      />
                    </button>
                    <span className="min-w-0 truncate text-[length:var(--text-md)]">
                      {renderWithMentions(task.title ?? "", task.attendees, onFilterChange)}
                    </span>
                    {task.projectName && task.customerProjectId ? (
                      <ActivityProjectChip
                        name={task.projectName}
                        onSelect={() =>
                          onFilterChange({
                            kind: "project",
                            id: task.customerProjectId as string,
                            name: task.projectName as string,
                          })
                        }
                      />
                    ) : null}
                    <span className="flex-1" />
                    <span
                      className={cn(
                        "inline-flex h-(--space-16) items-center whitespace-nowrap rounded-full border px-(--space-6) font-mono text-[length:var(--text-xs)]",
                        !task.dueDate &&
                          "border-dashed border-[var(--color-line)] text-[var(--color-ink-faint)]",
                        task.dueDate && task.dueDate < today
                          ? "border-transparent bg-[var(--color-danger-soft)] text-[var(--color-danger)]"
                          : task.dueDate === today
                            ? "border-transparent bg-[var(--color-warning-soft)] text-[var(--color-accent-ink)]"
                            : task.dueDate
                              ? "border-[var(--color-line)] text-[var(--color-ink-faint)]"
                              : undefined
                      )}
                    >
                      {task.dueDate
                        ? `Due ${shortDayLabel(task.dueDate)}${
                            task.dueDate < today
                              ? " · Overdue"
                              : task.dueDate === today
                                ? " · Today"
                                : ""
                          }`
                        : "No due date"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {timelineMonths.length > 0 ? (
          <div className="grid gap-(--space-8)">
            {timelineMonths.map((month) => (
              <div key={month.label} className="grid gap-(--space-3)">
                <div className="flex items-center gap-(--space-4)">
                  <h3 className={styles.sectionHeading}>{month.label}</h3>
                  <div className="h-px flex-1 bg-[var(--color-line)]" />
                </div>
                <ul className="divide-y divide-[var(--color-line-2)]">
                  {month.entries.map((entry) => (
                    <li key={entry.id} className="flex gap-(--space-6) py-(--space-7)">
                      {entry.type === "task" ? (
                        <span className="mt-(--space-1) flex size-(--space-16) shrink-0 items-center justify-center">
                          <Checkbox
                            aria-label={`Reopen "${entry.title}"`}
                            checked
                            disabled={readOnly || pending}
                            className="size-(--space-12) rounded-full data-checked:border-transparent data-checked:bg-[var(--color-success-soft)] data-checked:text-[var(--status-success-ink)]"
                            onCheckedChange={() =>
                              onToggle({
                                activityId: entry.id,
                                status: "open",
                              })
                            }
                          />
                        </span>
                      ) : (
                        <span className="mt-(--space-1) flex size-(--space-16) shrink-0 items-center justify-center rounded-full border border-[var(--color-line)] bg-[var(--color-surface-alt)] text-[var(--color-ink-soft)]">
                          <HugeiconsIcon
                            icon={activityTimelineIcons[entry.type]}
                            className="size-(--space-8)"
                          />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-(--space-4)">
                          <span
                            className={cn(
                              "font-mono text-[length:var(--text-xs)] font-semibold uppercase tracking-wide",
                              entry.type === "task"
                                ? "text-[var(--status-success-ink)]"
                                : "text-[var(--color-accent-ink)]"
                            )}
                          >
                            {activityComposerMeta[entry.type].label}
                            {entry.type === "task" ? " · Done" : ""}
                          </span>
                          {entry.createdByName ? (
                            <span className="text-[length:var(--text-base)] font-semibold text-[var(--color-ink)]">
                              {entry.createdByName}
                            </span>
                          ) : null}
                          <span className="font-mono text-[length:var(--text-xs)] text-[var(--color-ink-faint)]">
                            {relativeDayLabel(timelineDate(entry))}
                          </span>
                          {entry.projectName && entry.customerProjectId ? (
                            <ActivityProjectChip
                              name={entry.projectName}
                              onSelect={() =>
                                onFilterChange({
                                  kind: "project",
                                  id: entry.customerProjectId as string,
                                  name: entry.projectName as string,
                                })
                              }
                            />
                          ) : null}
                        </div>
                        {entry.title ? (
                          <p className="mt-(--space-3) max-w-[72ch] text-[length:var(--text-md)] leading-[var(--leading-md)]">
                            {renderWithMentions(entry.title, entry.attendees, onFilterChange)}
                          </p>
                        ) : null}
                        {entry.body ? (
                          <p className="mt-(--space-3) max-w-[72ch] whitespace-pre-wrap text-[length:var(--text-md)] leading-[var(--leading-md)] text-[var(--color-ink-2)]">
                            {renderWithMentions(entry.body, entry.attendees, onFilterChange)}
                          </p>
                        ) : null}
                        {entry.attendees.some(
                          (attendee) =>
                            !`${entry.title ?? ""} ${entry.body ?? ""}`.includes(
                              `@${attendee.contactName}`
                            )
                        ) ? (
                          <p className="mt-(--space-2) flex flex-wrap gap-(--space-3) text-[length:var(--text-xs)]">
                            {entry.attendees
                              .filter(
                                (attendee) =>
                                  !`${entry.title ?? ""} ${entry.body ?? ""}`.includes(
                                    `@${attendee.contactName}`
                                  )
                              )
                              .map((attendee) => (
                                <MentionToken
                                  key={attendee.id}
                                  name={attendee.contactName}
                                  contactId={attendee.contactId}
                                  onFilterChange={onFilterChange}
                                />
                              ))}
                          </p>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : openTasks.length === 0 ? (
          <EmptyState density="compact">No activity yet.</EmptyState>
        ) : null}
    </>
  );
}


function contactInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function MentionToken({
  name,
  contactId,
  onFilterChange,
}: {
  name: string;
  contactId: string | null;
  onFilterChange: (filter: ActivityStreamFilter) => void;
}) {
  if (!contactId) {
    return <span className="text-[var(--color-ink-faint)]">@{name}</span>;
  }
  return (
    <button
      type="button"
      className="font-semibold text-[var(--color-accent-ink)] hover:underline"
      onClick={() => onFilterChange({ kind: "contact", id: contactId, name })}
    >
      @{name}
    </button>
  );
}

function renderWithMentions(
  text: string,
  attendees: CustomerActivityRow["attendees"],
  onFilterChange: (filter: ActivityStreamFilter) => void
) {
  const named = attendees.filter((attendee) => attendee.contactName.trim());
  if (named.length === 0 || !text.includes("@")) return text;

  const pattern = new RegExp(
    `@(${named
      .map((attendee) =>
        attendee.contactName.replace(/[.*+?^$()|[\]{}\\]/g, "\\$&")
      )
      .join("|")})`,
    "g"
  );
  const parts = text.split(pattern);
  return parts.map((part, index) => {
    const attendee = named.find((candidate) => candidate.contactName === part);
    if (index % 2 === 1 && attendee) {
      return (
        <MentionToken
          key={`${attendee.id}-${index}`}
          name={attendee.contactName}
          contactId={attendee.contactId}
          onFilterChange={onFilterChange}
        />
      );
    }
    return part;
  });
}

function ActivityProjectChip({
  name,
  onSelect,
}: {
  name: string;
  onSelect?: () => void;
}) {
  return (
    <button
      type="button"
      className="flex max-w-56 items-center gap-(--space-2) rounded-full border border-[var(--color-line)] bg-[var(--color-surface-alt)] px-(--space-3) py-(--space-1) text-[length:var(--text-xs)] text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
      onClick={onSelect}
    >
      <HugeiconsIcon icon={Folder01Icon} className="size-(--space-5) shrink-0" />
      <span className="truncate whitespace-nowrap">{name}</span>
    </button>
  );
}

function groupTimelineByMonth(entries: CustomerActivityRow[]) {
  const months: Array<{ label: string; entries: CustomerActivityRow[] }> = [];
  for (const entry of entries) {
    const label = timelineDate(entry)
      .toLocaleDateString(undefined, { month: "long", year: "numeric" })
      .toUpperCase();
    const current = months[months.length - 1];
    if (current && current.label === label) {
      current.entries.push(entry);
    } else {
      months.push({ label, entries: [entry] });
    }
  }
  return months;
}

function timelineDate(entry: CustomerActivityRow) {
  return new Date(entry.completedAt ?? entry.occurredAt);
}

function relativeDayLabel(date: Date) {
  const day = toDateOnlyString(date);
  const today = toDateOnlyString(new Date());
  const yesterday = toDateOnlyString(new Date(Date.now() - 86_400_000));
  if (day && day === today) return "Today";
  if (day && day === yesterday) return "Yesterday";
  return day ? shortDayLabel(day) : "";
}


