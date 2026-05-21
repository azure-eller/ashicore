"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Activity03Icon,
  Add01Icon,
  ArrowLeft01Icon,
  Building03Icon,
  Calendar03Icon,
  Call02Icon,
  CheckmarkCircle02Icon,
  Delete02Icon,
  Download01Icon,
  File02Icon,
  Folder01Icon,
  Mail01Icon,
  MoreVerticalIcon,
  NoteIcon,
  Search01Icon,
  TelephoneIcon,
  Upload01Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Avatar,
  AvatarFallback,
} from "@/components/ui/avatar";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Field,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { DetailPageActions } from "@/components/detail-page-actions";
import { TooltipHeader } from "@/components/tooltip-header";
import { cn } from "@/lib/utils";
import { formatAddress, formatDate, formatDateTime, formatPrice } from "@/lib/format";
import { useOrganizationTimeZone } from "@/components/time-zone-provider";
import { CUSTOMER_PRICING_TOOLTIP } from "@/lib/tooltip-copy";
import { SalesOrderStatusBadge } from "./status-badge";
import type {
  CustomerContactRole,
  CustomerContactRow,
  CustomerCorrespondenceRow,
  CustomerCorrespondenceType,
  CustomerDetailData,
  CustomerProjectFileRow,
  CustomerProjectRow,
  CustomerProjectStatus,
} from "./types";

type CustomerDetailTab = "overview" | "contacts" | "activity" | "projects";

type ContactFormState = {
  id?: string;
  name: string;
  title: string;
  email: string;
  phone: string;
  roles: CustomerContactRole[];
  notes: string;
};

type ActivityFormState = {
  type: CustomerCorrespondenceType;
  title: string;
  body: string;
  attendeeContactIds: string[];
};

type ProjectFormState = {
  id?: string;
  name: string;
  status: CustomerProjectStatus;
  startDate: string | null;
  targetEndDate: string | null;
  summary: string;
};

const emptyContactForm: ContactFormState = {
  name: "",
  title: "",
  email: "",
  phone: "",
  roles: [],
  notes: "",
};

const emptyActivityForm: ActivityFormState = {
  type: "note",
  title: "",
  body: "",
  attendeeContactIds: [],
};

const emptyProjectForm: ProjectFormState = {
  name: "",
  status: "planning",
  startDate: null,
  targetEndDate: null,
  summary: "",
};

const roleOptions: Array<{ value: CustomerContactRole; label: string }> = [
  { value: "primary", label: "Primary" },
  { value: "shipping", label: "Shipping recipient" },
  { value: "invoicing", label: "Invoicing recipient" },
  { value: "billing", label: "Billing CC" },
  { value: "field", label: "On-site contact" },
];

const activityTypes: Array<{
  value: CustomerCorrespondenceType;
  label: string;
  icon: typeof NoteIcon;
}> = [
  { value: "note", label: "Note", icon: NoteIcon },
  { value: "call", label: "Call", icon: Call02Icon },
  { value: "email", label: "Email", icon: Mail01Icon },
  { value: "meeting", label: "Meeting", icon: UserGroupIcon },
];

const projectStatuses: Array<{ value: CustomerProjectStatus; label: string }> = [
  { value: "planning", label: "Planning" },
  { value: "active", label: "Active" },
  { value: "hold", label: "On hold" },
  { value: "done", label: "Complete" },
];

const accountStateLabels = {
  active: "Active",
  growth: "Growth",
  at_risk: "At risk",
  former: "Former",
} as const;

const accountPriorityLabels = {
  strategic: "Strategic",
  high: "High",
  standard: "Standard",
  low: "Low",
} as const;

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function ContactAvatar({ name, size = "default" }: { name: string; size?: "sm" | "default" | "lg" }) {
  return (
    <Avatar size={size}>
      <AvatarFallback>{initials(name)}</AvatarFallback>
    </Avatar>
  );
}

function roleLabel(role: CustomerContactRole) {
  return roleOptions.find((option) => option.value === role)?.label ?? role;
}

function RoleBadge({ role }: { role: CustomerContactRole }) {
  const variant =
    role === "primary"
      ? "default"
      : role === "invoicing"
        ? "success"
        : role === "billing"
          ? "warning"
          : role === "field"
            ? "outline"
            : "secondary";

  return <Badge variant={variant}>{roleLabel(role)}</Badge>;
}

function ProjectStatusBadge({ status }: { status: CustomerProjectStatus }) {
  const label = projectStatuses.find((option) => option.value === status)?.label ?? status;
  const variant =
    status === "active"
      ? "success"
      : status === "hold"
        ? "warning"
        : status === "done"
          ? "outline"
          : "secondary";

  return <Badge variant={variant}>{label}</Badge>;
}

function AccountPriorityBadge({
  priority,
}: {
  priority: CustomerDetailData["accountPriority"];
}) {
  const variant =
    priority === "strategic"
      ? "default"
      : priority === "high"
        ? "success"
        : priority === "low"
          ? "outline"
          : "secondary";

  return <Badge variant={variant}>{accountPriorityLabels[priority]}</Badge>;
}

function AccountStateBadge({
  state,
}: {
  state: CustomerDetailData["accountState"];
}) {
  const variant =
    state === "at_risk"
      ? "warning"
      : state === "former"
        ? "outline"
        : state === "growth"
          ? "success"
          : "secondary";

  return <Badge variant={variant}>{accountStateLabels[state]}</Badge>;
}

function activityTypeConfig(type: CustomerCorrespondenceType) {
  return activityTypes.find((entry) => entry.value === type) ?? activityTypes[0];
}

function formatRelative(date: Date, timeZone: string) {
  const ms = Date.now() - date.getTime();
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDateTime(date, timeZone);
}

function groupActivity(entries: CustomerCorrespondenceRow[]) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const groups = new Map<string, CustomerCorrespondenceRow[]>();
  for (const entry of entries) {
    const entryDate = new Date(entry.occurredAt);
    entryDate.setHours(0, 0, 0, 0);
    const diff = Math.round((today.getTime() - entryDate.getTime()) / 86400000);
    const label =
      diff <= 0
        ? "Today"
        : diff === 1
          ? "Yesterday"
          : diff < 7
            ? "This week"
            : diff < 30
              ? "This month"
              : entryDate.toLocaleDateString(undefined, {
                  month: "long",
                  year: "numeric",
                });
    groups.set(label, [...(groups.get(label) ?? []), entry]);
  }
  return [...groups.entries()];
}

async function readJsonResponse<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error ?? fallback);
  }
  return body as T;
}

function toContactPayload(form: ContactFormState) {
  return {
    name: form.name,
    title: form.title || null,
    email: form.email || null,
    phone: form.phone || null,
    roles: form.roles,
    notes: form.notes || null,
  };
}

function toProjectPayload(form: ProjectFormState) {
  return {
    name: form.name,
    status: form.status,
    startDate: form.startDate,
    targetEndDate: form.targetEndDate,
    summary: form.summary || null,
  };
}

function contactToForm(contact: CustomerContactRow): ContactFormState {
  return {
    id: contact.id,
    name: contact.name,
    title: contact.title ?? "",
    email: contact.email ?? "",
    phone: contact.phone ?? "",
    roles: contact.roles,
    notes: contact.notes ?? "",
  };
}

function projectToForm(project: CustomerProjectRow): ProjectFormState {
  return {
    id: project.id,
    name: project.name,
    status: project.status,
    startDate: project.startDate,
    targetEndDate: project.targetEndDate,
    summary: project.summary ?? "",
  };
}

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm leading-6">{children}</dd>
    </div>
  );
}

function CustomerDetailTabs({
  tabs,
  activeTab,
  onTabChange,
}: {
  tabs: Array<{ value: CustomerDetailTab; label: string; icon: typeof Building03Icon; count?: number }>;
  activeTab: CustomerDetailTab;
  onTabChange: (tab: CustomerDetailTab) => void;
}) {
  return (
    <nav className="flex gap-1 overflow-x-auto border-b" aria-label="Customer detail sections">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.value;
        return (
          <button
            id={`customer-tab-${tab.value}`}
            key={tab.value}
            type="button"
            aria-current={isActive ? "page" : undefined}
            aria-controls={`customer-panel-${tab.value}`}
            className={cn(
              "inline-flex h-(--height-toolbar) shrink-0 items-center gap-(--space-3) border-b-2 px-(--space-8) text-[length:var(--text-sm)] font-medium transition-colors",
              isActive
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
            onClick={() => onTabChange(tab.value)}
          >
            <HugeiconsIcon icon={tab.icon} size={15} strokeWidth={2} aria-hidden />
            {tab.label}
            {tab.count != null ? (
              <span
                className={cn(
                  "ml-(--space-2) px-(--space-3) py-(--space-1) font-mono text-[length:var(--text-2xs)] font-medium tabular-nums",
                  isActive ? "bg-foreground text-background" : "bg-muted text-muted-foreground"
                )}
              >
                {tab.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}

function getInitialCustomerTab(): CustomerDetailTab {
  if (typeof window === "undefined") return "overview";
  return window.location.hash === "#projects" ? "projects" : "overview";
}

function getInitialProjectId() {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("project");
}

export function CustomerDetail({ customer }: { customer: CustomerDetailData }) {
  const timeZone = useOrganizationTimeZone();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [detail, setDetail] = useState(customer);
  const [activeTab, setActiveTab] = useState<CustomerDetailTab>(getInitialCustomerTab);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [contactForm, setContactForm] = useState<ContactFormState | null>(null);
  const [projectForm, setProjectForm] = useState<ProjectFormState | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(
    getInitialProjectId() ?? detail.projects[0]?.id ?? null
  );
  const [activityForm, setActivityForm] = useState<ActivityFormState>(emptyActivityForm);
  const [activityFilter, setActivityFilter] = useState<CustomerCorrespondenceType | "all">("all");
  const [contactSearch, setContactSearch] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [fileActionError, setFileActionError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isDeleted = detail.deletedAt != null;
  const primaryContact =
    detail.contacts.find((contact) => contact.roles.includes("primary")) ??
    detail.contacts[0] ??
    null;
  const activeProject =
    detail.projects.find((project) => project.id === activeProjectId) ??
    detail.projects[0] ??
    null;

  useEffect(() => {
    if (activeTab === "projects") {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#projects`);
    } else if (window.location.hash) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }
  }, [activeTab]);
  const filteredContacts = detail.contacts.filter((contact) => {
    const q = contactSearch.trim().toLowerCase();
    if (!q) return true;
    return [contact.name, contact.title, contact.email, contact.phone]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(q));
  });
  const filteredActivity =
    activityFilter === "all"
      ? detail.correspondence
      : detail.correspondence.filter((entry) => entry.type === activityFilter);
  const openSalesOrders = detail.salesOrders.filter((order) => order.status === "open");
  const groupedActivity = useMemo(
    () => groupActivity(filteredActivity),
    [filteredActivity]
  );
  const mostTagged = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of detail.correspondence) {
      for (const attendee of entry.attendees) {
        counts.set(attendee.contactName, (counts.get(attendee.contactName) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, [detail.correspondence]);

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/customers/${detail.id}`, {
        method: "DELETE",
      });
      await readJsonResponse(response, "Failed to delete customer.");
    },
    onMutate: () => setActionError(null),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["customers"] });
      router.push("/sales/customers");
    },
    onError: (error) => setActionError(error.message),
  });

  const saveContactMutation = useMutation({
    mutationFn: async (form: ContactFormState) => {
      const response = await fetch(
        form.id
          ? `/api/customers/${detail.id}/contacts/${form.id}`
          : `/api/customers/${detail.id}/contacts`,
        {
          method: form.id ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toContactPayload(form)),
        }
      );
      return readJsonResponse<CustomerContactRow>(response, "Failed to save contact.");
    },
    onMutate: () => setActionError(null),
    onSuccess: (contact) => {
      setDetail((current) => ({
        ...current,
        contacts: current.contacts.some((row) => row.id === contact.id)
          ? current.contacts.map((row) => (row.id === contact.id ? contact : row))
          : [...current.contacts, contact],
      }));
      setContactForm(null);
    },
    onError: (error) => setActionError(error.message),
  });

  const deleteContactMutation = useMutation({
    mutationFn: async (contactId: string) => {
      const response = await fetch(`/api/customers/${detail.id}/contacts/${contactId}`, {
        method: "DELETE",
      });
      await readJsonResponse(response, "Failed to remove contact.");
      return contactId;
    },
    onSuccess: (contactId) => {
      setDetail((current) => ({
        ...current,
        contacts: current.contacts.filter((contact) => contact.id !== contactId),
      }));
    },
    onError: (error) => setActionError(error.message),
  });

  const saveActivityMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/customers/${detail.id}/correspondence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(activityForm),
      });
      return readJsonResponse<CustomerCorrespondenceRow>(
        response,
        "Failed to log correspondence."
      );
    },
    onMutate: () => setActionError(null),
    onSuccess: (entry) => {
      setDetail((current) => ({
        ...current,
        correspondence: [entry, ...current.correspondence],
      }));
      setActivityForm(emptyActivityForm);
    },
    onError: (error) => setActionError(error.message),
  });

  const saveProjectMutation = useMutation({
    mutationFn: async (form: ProjectFormState) => {
      const response = await fetch(
        form.id
          ? `/api/customers/${detail.id}/projects/${form.id}`
          : `/api/customers/${detail.id}/projects`,
        {
          method: form.id ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toProjectPayload(form)),
        }
      );
      return readJsonResponse<CustomerProjectRow>(response, "Failed to save project.");
    },
    onMutate: () => setActionError(null),
    onSuccess: (project) => {
      setDetail((current) => ({
        ...current,
        projects: current.projects.some((row) => row.id === project.id)
          ? current.projects.map((row) => (row.id === project.id ? project : row))
          : [project, ...current.projects],
      }));
      setActiveProjectId(project.id);
      setProjectForm(null);
    },
    onError: (error) => setActionError(error.message),
  });

  const deleteProjectMutation = useMutation({
    mutationFn: async (projectId: string) => {
      const response = await fetch(`/api/customers/${detail.id}/projects/${projectId}`, {
        method: "DELETE",
      });
      await readJsonResponse(response, "Failed to delete project.");
      return projectId;
    },
    onSuccess: (projectId) => {
      setDetail((current) => {
        const projects = current.projects.filter((project) => project.id !== projectId);
        return { ...current, projects };
      });
      setActiveProjectId(null);
    },
    onError: (error) => setActionError(error.message),
  });

  const uploadFileMutation = useMutation({
    mutationFn: async ({ projectId, file }: { projectId: string; file: File }) => {
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch(
        `/api/customers/${detail.id}/projects/${projectId}/files`,
        { method: "POST", body: formData }
      );
      return readJsonResponse<CustomerProjectFileRow>(response, "Failed to upload file.");
    },
    onMutate: () => setFileActionError(null),
    onSuccess: (file, { projectId }) => {
      setDetail((current) => ({
        ...current,
        projects: current.projects.map((project) =>
          project.id === projectId
            ? { ...project, files: [file, ...project.files] }
            : project
        ),
      }));
    },
    onError: (error) => setFileActionError(error.message),
  });

  const deleteFileMutation = useMutation({
    mutationFn: async (params: { projectId: string; fileId: string }) => {
      const response = await fetch(
        `/api/customers/${detail.id}/projects/${params.projectId}/files/${params.fileId}`,
        { method: "DELETE" }
      );
      await readJsonResponse(response, "Failed to delete file.");
      return params;
    },
    onMutate: () => setFileActionError(null),
    onSuccess: ({ projectId, fileId }) => {
      setDetail((current) => ({
        ...current,
        projects: current.projects.map((project) =>
          project.id === projectId
            ? {
                ...project,
                files: project.files.filter((file) => file.id !== fileId),
              }
            : project
        ),
      }));
    },
    onError: (error) => setFileActionError(error.message),
  });

  const tabs = [
    { value: "overview" as const, label: "Overview", icon: Building03Icon },
    {
      value: "contacts" as const,
      label: "Contacts",
      icon: UserGroupIcon,
      count: detail.contacts.length,
    },
    {
      value: "activity" as const,
      label: "Activity",
      icon: Activity03Icon,
      count: detail.correspondence.length,
    },
    {
      value: "projects" as const,
      label: "Projects",
      icon: Folder01Icon,
      count: detail.projects.length,
    },
  ];

  function toggleContactRole(role: CustomerContactRole) {
    setContactForm((current) => {
      if (!current) return current;
      const roles = current.roles.includes(role)
        ? current.roles.filter((item) => item !== role)
        : [...current.roles, role];
      return { ...current, roles };
    });
  }

  function toggleActivityAttendee(contactId: string) {
    setActivityForm((current) => ({
      ...current,
      attendeeContactIds: current.attendeeContactIds.includes(contactId)
        ? current.attendeeContactIds.filter((id) => id !== contactId)
        : [...current.attendeeContactIds, contactId],
    }));
  }

  function handleFileInput(files: FileList | null) {
    if (!files || files.length === 0 || !activeProject) return;
    const projectId = activeProject.id;
    for (const file of Array.from(files)) {
      uploadFileMutation.mutate({ projectId, file });
    }
  }

  return (
    <>
      <div className="mx-auto w-full max-w-7xl px-8 py-6">
        <div className="space-y-5">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <HugeiconsIcon icon={ArrowLeft01Icon} size={14} aria-hidden />
            <Link href="/sales/customers" className="hover:text-foreground">
              Back to Customers
            </Link>
          </div>

          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight">{detail.name}</h1>
                <AccountPriorityBadge priority={detail.accountPriority} />
                <AccountStateBadge state={detail.accountState} />
                {isDeleted ? <Badge variant="outline">Deleted</Badge> : null}
              </div>
              {detail.notes ? (
                <p className="max-w-3xl text-xs text-muted-foreground">
                  {detail.notes}
                </p>
              ) : null}
            </div>

            {!isDeleted ? (
              <DetailPageActions
                menu={[
                  {
                    label: "Delete",
                    onSelect: () => setDeleteOpen(true),
                    destructive: true,
                    disabled: deleteMutation.isPending,
                  },
                ]}
              />
            ) : null}
          </div>

          {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}

          <CustomerDetailTabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

          <section id={`customer-panel-${activeTab}`} aria-labelledby={`customer-tab-${activeTab}`}>
            {activeTab === "overview" ? (
              <div className="grid gap-6 lg:grid-cols-3">
                <div className="space-y-6 lg:col-span-2">
                  <Card>
                    <CardContent className="pt-0">
                      <dl className="grid gap-x-10 gap-y-6 sm:grid-cols-2">
                        <DetailField label="Pricing">
                          <TooltipHeader
                            label={detail.customerCategoryName ?? "Everyone"}
                            tooltip={CUSTOMER_PRICING_TOOLTIP}
                          />
                        </DetailField>
                        <DetailField label="Priority">
                          <AccountPriorityBadge priority={detail.accountPriority} />
                        </DetailField>
                        <DetailField label="State">
                          <AccountStateBadge state={detail.accountState} />
                        </DetailField>
                        <DetailField label="Open Orders">
                          {detail.openOrderCount} · {formatPrice(detail.openOrderValue)}
                        </DetailField>
                        <DetailField label="Latest Order">
                          {formatDate(detail.latestOrderDate)}
                        </DetailField>
                        <DetailField label="Email">{detail.email ?? "\u2014"}</DetailField>
                        <DetailField label="Phone">{detail.phone ?? "\u2014"}</DetailField>
                        <DetailField label="Billing Address">
                          <span className="whitespace-pre-wrap">
                            {formatAddress({
                              line1: detail.billingLine1,
                              line2: detail.billingLine2,
                              city: detail.billingCity,
                              region: detail.billingRegion,
                              postcode: detail.billingPostcode,
                              country: detail.billingCountry,
                            }) || "\u2014"}
                          </span>
                        </DetailField>
                        <DetailField label="Shipping Address">
                          <span className="whitespace-pre-wrap">
                            {formatAddress({
                              line1: detail.shipLine1,
                              line2: detail.shipLine2,
                              city: detail.shipCity,
                              region: detail.shipRegion,
                              postcode: detail.shipPostcode,
                              country: detail.shipCountry,
                            }) || "\u2014"}
                          </span>
                        </DetailField>
                        <DetailField label="Created">{formatDateTime(detail.createdAt, timeZone)}</DetailField>
                        <DetailField label="Updated">{formatDateTime(detail.updatedAt, timeZone)}</DetailField>
                      </dl>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Recent activity</CardTitle>
                      <CardAction>
                        <Button variant="ghost" size="sm" onClick={() => setActiveTab("activity")}>
                          View all
                        </Button>
                      </CardAction>
                    </CardHeader>
                    <CardContent className="pt-0">
                      {detail.correspondence.length === 0 ? (
                        <EmptyState message="No correspondence logged yet." />
                      ) : (
                        <div className="divide-y">
                          {detail.correspondence.slice(0, 3).map((entry) => {
                            const config = activityTypeConfig(entry.type);
                            return (
                              <div key={entry.id} className="flex gap-3 py-3">
                                <IconTile icon={config.icon} />
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center justify-between gap-2">
                                    <p className="truncate text-sm font-medium">
                                      {entry.title || config.label}
                                    </p>
                                    <span className="shrink-0 text-xs text-muted-foreground">
                                      {formatRelative(new Date(entry.occurredAt), timeZone)}
                                    </span>
                                  </div>
                                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                    {entry.body}
                                  </p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                <div className="space-y-6">
                  <Card>
                    <CardHeader>
                      <CardTitle>Primary contact</CardTitle>
                      <CardAction>
                        <Button variant="ghost" size="sm" onClick={() => setActiveTab("contacts")}>
                          All contacts
                        </Button>
                      </CardAction>
                    </CardHeader>
                    <CardContent className="pt-0">
                      {primaryContact ? (
                        <div className="flex gap-3">
                          <ContactAvatar name={primaryContact.name} size="lg" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium">{primaryContact.name}</p>
                            {primaryContact.title ? (
                              <p className="text-xs text-muted-foreground">{primaryContact.title}</p>
                            ) : null}
                            <div className="mt-3 space-y-1 text-xs">
                              {primaryContact.email ? (
                                <IconText icon={Mail01Icon}>{primaryContact.email}</IconText>
                              ) : null}
                              {primaryContact.phone ? (
                                <IconText icon={TelephoneIcon}>{primaryContact.phone}</IconText>
                              ) : null}
                            </div>
                            <div className="mt-3 flex flex-wrap gap-1">
                              {primaryContact.roles.map((role) => (
                                <RoleBadge key={role} role={role} />
                              ))}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <EmptyState message="No contacts yet." />
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Active projects</CardTitle>
                      <CardAction>
                        <Button variant="ghost" size="sm" onClick={() => setActiveTab("projects")}>
                          All
                        </Button>
                      </CardAction>
                    </CardHeader>
                    <CardContent className="space-y-2 pt-0">
                      {detail.projects.length === 0 ? (
                        <EmptyState message="No projects yet." />
                      ) : (
                        detail.projects.slice(0, 3).map((project) => (
                          <button
                            key={project.id}
                            type="button"
                            className="w-full border p-3 text-left transition-colors hover:bg-muted/50"
                            onClick={() => {
                              setActiveProjectId(project.id);
                              setActiveTab("projects");
                            }}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className="truncate text-sm font-medium">{project.name}</p>
                              <ProjectStatusBadge status={project.status} />
                            </div>
                            <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                              <IconText icon={File02Icon}>{project.files.length} files</IconText>
                              {project.startDate ? (
                                <IconText icon={Calendar03Icon}>
                                  {formatDate(project.startDate)}
                                </IconText>
                              ) : null}
                            </div>
                          </button>
                        ))
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Open orders</CardTitle>
                      <CardAction>
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/sales/order?customerId=${detail.id}`}>
                            New order
                          </Link>
                        </Button>
                      </CardAction>
                    </CardHeader>
                    <CardContent className="space-y-2 pt-0">
                      {openSalesOrders.length === 0 ? (
                        <EmptyState message="No open orders." />
                      ) : (
                        openSalesOrders.slice(0, 4).map((order) => (
                          <Link
                            key={order.id}
                            href={`/sales/orders/${order.id}`}
                            className="block border p-3 hover:bg-muted/50"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-medium">{order.orderNumber}</span>
                              <SalesOrderStatusBadge status={order.status} />
                            </div>
                            <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                              <span>{formatPrice(order.totalAmount)}</span>
                              {order.customerProjectName ? (
                                <span>{order.customerProjectName}</span>
                              ) : null}
                              {order.shipDate ? <span>{formatDate(order.shipDate)}</span> : null}
                            </div>
                          </Link>
                        ))
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>
            ) : null}

            {activeTab === "contacts" ? (
              <div className="space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <h2 className="text-lg font-semibold tracking-tight">Contacts</h2>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <HugeiconsIcon
                        icon={Search01Icon}
                        className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                        aria-hidden
                      />
                      <Input
                        className="w-64 pl-7"
                        placeholder="Search contacts"
                        value={contactSearch}
                        onChange={(event) => setContactSearch(event.target.value)}
                      />
                    </div>
                    <Button onClick={() => setContactForm(emptyContactForm)}>
                      <HugeiconsIcon icon={Add01Icon} data-icon="inline-start" />
                      Add contact
                    </Button>
                  </div>
                </div>

                <Card>
                  <CardContent className="pt-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Roles</TableHead>
                          <TableHead>Phone</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead className="w-10" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredContacts.map((contact) => (
                          <TableRow key={contact.id}>
                            <TableCell>
                              <div className="flex items-center gap-3">
                                <ContactAvatar name={contact.name} />
                                <div className="min-w-0">
                                  <div className="font-medium">{contact.name}</div>
                                  {contact.title ? (
                                    <div className="truncate text-xs text-muted-foreground">
                                      {contact.title}
                                    </div>
                                  ) : null}
                                  {contact.notes ? (
                                    <div className="mt-1 max-w-sm truncate text-xs text-muted-foreground">
                                      {contact.notes}
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {contact.roles.length === 0 ? (
                                  <span className="text-xs text-muted-foreground">{"\u2014"}</span>
                                ) : (
                                  contact.roles.map((role) => <RoleBadge key={role} role={role} />)
                                )}
                              </div>
                            </TableCell>
                            <TableCell>{contact.phone ?? "\u2014"}</TableCell>
                            <TableCell className="max-w-[16rem] truncate">
                              {contact.email ?? "\u2014"}
                            </TableCell>
                            <TableCell>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon-sm" aria-label="Contact actions">
                                    <HugeiconsIcon icon={MoreVerticalIcon} strokeWidth={2} />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="bg-popover text-popover-foreground">
                                  <DropdownMenuItem onSelect={() => setContactForm(contactToForm(contact))}>
                                    Edit contact
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onSelect={() =>
                                      setActivityForm((current) => ({
                                        ...current,
                                        type: "call",
                                        attendeeContactIds: [contact.id],
                                      }))
                                    }
                                  >
                                    Log a call
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    variant="destructive"
                                    onSelect={() => deleteContactMutation.mutate(contact.id)}
                                  >
                                    Remove contact
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>
            ) : null}

            {activeTab === "activity" ? (
              <div className="grid gap-6 lg:grid-cols-3">
                <div className="space-y-6 lg:col-span-2">
                  <Card>
                    <CardHeader>
                      <CardTitle>Log correspondence</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4 pt-0">
                      <div className="flex w-fit bg-muted p-(--space-1)">
                        {activityTypes.map((type) => (
                          <button
                            key={type.value}
                            type="button"
                            className={cn(
                              "inline-flex h-(--height-input-sm) items-center gap-(--space-3) px-(--space-4) text-[length:var(--text-xs)] font-medium transition-colors",
                              activityForm.type === type.value
                                ? "bg-background text-foreground"
                                : "text-muted-foreground hover:text-foreground"
                            )}
                            onClick={() =>
                              setActivityForm((current) => ({ ...current, type: type.value }))
                            }
                          >
                            <HugeiconsIcon icon={type.icon} size={14} aria-hidden />
                            {type.label}
                          </button>
                        ))}
                      </div>
                      <Input
                        placeholder="Optional title"
                        value={activityForm.title}
                        onChange={(event) =>
                          setActivityForm((current) => ({
                            ...current,
                            title: event.target.value,
                          }))
                        }
                      />
                      <Textarea
                        rows={4}
                        placeholder="Jot it down."
                        value={activityForm.body}
                        onChange={(event) =>
                          setActivityForm((current) => ({
                            ...current,
                            body: event.target.value,
                          }))
                        }
                      />
                      <div className="flex flex-wrap items-center gap-(--space-4)">
                        <span className="text-[length:var(--text-xs)] font-medium text-muted-foreground">Tag people</span>
                        {detail.contacts.map((contact) => {
                          const selected = activityForm.attendeeContactIds.includes(contact.id);
                          return (
                            <button
                              key={contact.id}
                              type="button"
                              className={cn(
                                "inline-flex items-center gap-(--space-3) border px-(--space-4) py-(--space-1) text-[length:var(--text-xs)] transition-colors",
                                selected
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-border bg-background text-muted-foreground hover:bg-muted"
                              )}
                              onClick={() => toggleActivityAttendee(contact.id)}
                            >
                              <ContactAvatar name={contact.name} size="sm" />
                              {contact.name.split(" ")[0]}
                              {selected ? <HugeiconsIcon icon={CheckmarkCircle02Icon} size={12} /> : null}
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-muted-foreground">
                          {activityForm.attendeeContactIds.length
                            ? `Tagging ${activityForm.attendeeContactIds.length}`
                            : "No people tagged yet"}
                        </p>
                        <div className="flex gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setActivityForm(emptyActivityForm)}
                          >
                            Clear
                          </Button>
                          <Button
                            size="sm"
                            disabled={!activityForm.body.trim() || saveActivityMutation.isPending}
                            onClick={() => saveActivityMutation.mutate()}
                          >
                            Log {activityTypeConfig(activityForm.type).label.toLowerCase()}
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <div>
                    <div className="mb-(--space-6) flex items-center justify-between gap-(--space-6)">
                      <h3 className="text-[length:var(--text-sm)] font-semibold">Timeline</h3>
                      <div className="flex items-center border bg-background p-(--space-1) text-[length:var(--text-xs)]">
                        {["all" as const, ...activityTypes.map((type) => type.value)].map((type) => (
                          <button
                            key={type}
                            type="button"
                            className={cn(
                              "px-(--space-4) py-(--space-2) transition-colors",
                              activityFilter === type
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:bg-muted hover:text-foreground"
                            )}
                            onClick={() => setActivityFilter(type)}
                          >
                            {type === "all" ? "All" : activityTypeConfig(type).label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {groupedActivity.length === 0 ? (
                      <EmptyState message="No activity logged yet." />
                    ) : (
                      <div className="space-y-(--space-12)">
                        {groupedActivity.map(([label, entries]) => (
                          <div key={label}>
                            <div className="mb-(--space-4) text-[length:var(--text-2xs)] font-semibold tracking-[var(--tracking-caps)] text-muted-foreground uppercase">
                              {label}
                            </div>
                            <div className="space-y-(--space-6) border-l pl-(--space-10)">
                              {entries.map((entry) => {
                                const config = activityTypeConfig(entry.type);
                                return (
                                  <Card key={entry.id} size="sm" className="overflow-visible">
                                    <CardContent className="pt-0">
                                      <div className="flex items-start justify-between gap-4">
                                        <div className="min-w-0 flex-1">
                                          <div className="flex items-center gap-2">
                                            <Badge variant="secondary">{config.label}</Badge>
                                            <p className="truncate text-sm font-semibold">
                                              {entry.title || config.label}
                                            </p>
                                          </div>
                                          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                                            {entry.body}
                                          </p>
                                          {entry.attendees.length > 0 ? (
                                            <div className="mt-(--space-6) flex flex-wrap items-center gap-(--space-3)">
                                              <span className="text-[length:var(--text-2xs)] tracking-[var(--tracking-caps)] text-muted-foreground uppercase">
                                                With
                                              </span>
                                              {entry.attendees.map((attendee) => (
                                                <span
                                                  key={attendee.id}
                                                  className="inline-flex items-center gap-(--space-2) border bg-background px-(--space-4) py-(--space-1) text-[length:var(--text-xs)]"
                                                >
                                                  <ContactAvatar name={attendee.contactName} size="sm" />
                                                  {attendee.contactName}
                                                </span>
                                              ))}
                                            </div>
                                          ) : null}
                                        </div>
                                        <div className="shrink-0 text-right text-xs text-muted-foreground">
                                          <div>{formatDateTime(entry.occurredAt, timeZone)}</div>
                                          <div className="mt-0.5">by {entry.createdByName ?? "System"}</div>
                                        </div>
                                      </div>
                                    </CardContent>
                                  </Card>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  <Card>
                    <CardHeader>
                      <CardTitle>At a glance</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 pt-0">
                      {activityTypes.map((type) => (
                        <div key={type.value} className="flex items-center justify-between text-sm">
                          <IconText icon={type.icon}>{type.label}s</IconText>
                          <span className="font-medium">
                            {detail.correspondence.filter((entry) => entry.type === type.value).length}
                          </span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle>Most tagged</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 pt-0">
                      {mostTagged.length === 0 ? (
                        <EmptyState message="No people tagged yet." />
                      ) : (
                        mostTagged.map(([name, count]) => (
                          <div key={name} className="flex items-center justify-between text-sm">
                            <span className="inline-flex items-center gap-2">
                              <ContactAvatar name={name} size="sm" />
                              {name}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {count} {count === 1 ? "mention" : "mentions"}
                            </span>
                          </div>
                        ))
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>
            ) : null}

            {activeTab === "projects" ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold tracking-tight">Projects & Jobs</h2>
                  <Button onClick={() => setProjectForm(emptyProjectForm)}>
                    <HugeiconsIcon icon={Add01Icon} data-icon="inline-start" />
                    New project
                  </Button>
                </div>

                {detail.projects.length === 0 ? (
                  <EmptyState message="No projects yet." />
                ) : (
                  <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
                    <div className="space-y-2">
                      {detail.projects.map((project) => {
                        const active = activeProject?.id === project.id;
                        return (
                          <button
                            key={project.id}
                            type="button"
                            className={cn(
                              "w-full border p-3 text-left transition-colors",
                              active ? "border-foreground bg-muted/50" : "hover:bg-muted/50"
                            )}
                            onClick={() => setActiveProjectId(project.id)}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex items-center gap-2">
                                <IconTile icon={Folder01Icon} />
                                <p className="truncate text-sm font-medium">{project.name}</p>
                              </div>
                              <ProjectStatusBadge status={project.status} />
                            </div>
                            <div className="mt-2 flex gap-3 text-xs text-muted-foreground">
                              <IconText icon={File02Icon}>{project.files.length}</IconText>
                              {project.startDate ? (
                                <IconText icon={Calendar03Icon}>
                                  {formatDate(project.startDate)}
                                </IconText>
                              ) : null}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {activeProject ? (
                      <div className="space-y-4">
                        <Card>
                          <CardHeader>
                            <div className="flex items-start justify-between gap-4">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <CardTitle className="truncate">{activeProject.name}</CardTitle>
                                  <ProjectStatusBadge status={activeProject.status} />
                                </div>
                                <CardDescription>
                                  {activeProject.startDate ? formatDate(activeProject.startDate) : "No start date"}
                                  {" \u2014 "}
                                  {activeProject.targetEndDate ? formatDate(activeProject.targetEndDate) : "TBD"}
                                </CardDescription>
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setProjectForm(projectToForm(activeProject))}
                                >
                                  Edit
                                </Button>
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => deleteProjectMutation.mutate(activeProject.id)}
                                  disabled={deleteProjectMutation.isPending}
                                >
                                  Delete
                                </Button>
                              </div>
                            </div>
                          </CardHeader>
                          {activeProject.summary ? (
                            <CardContent className="pt-0">
                              <p className="text-sm leading-6 text-muted-foreground">
                                {activeProject.summary}
                              </p>
                            </CardContent>
                          ) : null}
                        </Card>

                        <Card>
                          <CardHeader>
                            <CardTitle>Sales orders</CardTitle>
                            <CardAction>
                              <Button variant="outline" size="sm" asChild>
                                <Link
                                  href={`/sales/order?customerId=${detail.id}&projectId=${activeProject.id}`}
                                >
                                  New order
                                </Link>
                              </Button>
                            </CardAction>
                          </CardHeader>
                          <CardContent className="pt-0">
                            {activeProject.salesOrders.length === 0 ? (
                              <EmptyState message="No linked orders yet." />
                            ) : (
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Order</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Ship</TableHead>
                                    <TableHead>Delivery</TableHead>
                                    <TableHead className="text-right">Total</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {activeProject.salesOrders.map((order) => (
                                    <TableRow key={order.id}>
                                      <TableCell>
                                        <Link
                                          href={`/sales/orders/${order.id}`}
                                          className="font-medium hover:underline"
                                        >
                                          {order.orderNumber}
                                        </Link>
                                      </TableCell>
                                      <TableCell>
                                        <SalesOrderStatusBadge status={order.status} />
                                      </TableCell>
                                      <TableCell>{formatDate(order.shipDate)}</TableCell>
                                      <TableCell>{formatDate(order.requestedDate)}</TableCell>
                                      <TableCell className="text-right">
                                        {formatPrice(order.totalAmount)}
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            )}
                          </CardContent>
                        </Card>

                        <Card>
                          <CardHeader>
                            <CardTitle>Files</CardTitle>
                            <CardAction>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => fileInputRef.current?.click()}
                              >
                                <HugeiconsIcon icon={Upload01Icon} data-icon="inline-start" />
                                Upload
                              </Button>
                            </CardAction>
                          </CardHeader>
                          <CardContent className="space-y-3 pt-0">
                            <input
                              ref={fileInputRef}
                              type="file"
                              multiple
                              className="hidden"
                              onChange={(event) => {
                                handleFileInput(event.target.files);
                                event.currentTarget.value = "";
                              }}
                            />
                            <div
                              className="flex items-center justify-center gap-(--space-4) border border-dashed bg-muted px-(--space-8) py-(--space-16) text-[length:var(--text-sm)] text-muted-foreground"
                              onDragOver={(event) => event.preventDefault()}
                              onDrop={(event) => {
                                event.preventDefault();
                                handleFileInput(event.dataTransfer.files);
                              }}
                            >
                              <HugeiconsIcon icon={Upload01Icon} size={16} aria-hidden />
                              <button
                                type="button"
                                className="font-medium text-foreground underline-offset-4 hover:underline"
                                onClick={() => fileInputRef.current?.click()}
                              >
                                Upload or drop files
                              </button>
                            </div>
                            {fileActionError ? (
                              <p className="text-[length:var(--text-sm)] text-destructive">{fileActionError}</p>
                            ) : null}
                            {activeProject.files.length === 0 ? (
                              <EmptyState message="No files yet." />
                            ) : (
                              <div className="divide-y border">
                                {activeProject.files.map((file) => (
                                  <div key={file.id} className="flex items-center gap-3 px-3 py-2.5">
                                    <FileTypeBadge file={file} />
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-sm font-medium">{file.filename}</p>
                                      <p className="text-xs text-muted-foreground">
                                        {formatBytes(file.sizeBytes)} {"\u00b7"} uploaded {formatDateTime(file.createdAt, timeZone)}
                                      </p>
                                    </div>
                                    <Button variant="ghost" size="icon-sm" asChild>
                                      <a
                                        href={`/api/customers/${detail.id}/projects/${activeProject.id}/files/${file.id}`}
                                        aria-label={`Download ${file.filename}`}
                                      >
                                        <HugeiconsIcon icon={Download01Icon} />
                                      </a>
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon-sm"
                                      aria-label={`Delete ${file.filename}`}
                                      onClick={() =>
                                        deleteFileMutation.mutate({
                                          projectId: activeProject.id,
                                          fileId: file.id,
                                        })
                                      }
                                      disabled={deleteFileMutation.isPending}
                                    >
                                      <HugeiconsIcon icon={Delete02Icon} />
                                    </Button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            ) : null}
          </section>
        </div>
      </div>

      <ContactDialog
        form={contactForm}
        pending={saveContactMutation.isPending}
        onOpenChange={(open) => {
          if (!open) setContactForm(null);
        }}
        onChange={setContactForm}
        onToggleRole={toggleContactRole}
        onSave={() => contactForm && saveContactMutation.mutate(contactForm)}
      />

      <ProjectDialog
        form={projectForm}
        pending={saveProjectMutation.isPending}
        onOpenChange={(open) => {
          if (!open) setProjectForm(null);
        }}
        onChange={setProjectForm}
        onSave={() => projectForm && saveProjectMutation.mutate(projectForm)}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this customer?</AlertDialogTitle>
            <AlertDialogDescription>
              The customer will be soft-deleted. Customers with active sales orders cannot be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete Customer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ContactDialog({
  form,
  pending,
  onOpenChange,
  onChange,
  onToggleRole,
  onSave,
}: {
  form: ContactFormState | null;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (form: ContactFormState | null) => void;
  onToggleRole: (role: CustomerContactRole) => void;
  onSave: () => void;
}) {
  return (
    <Dialog open={form != null} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="bg-background text-foreground">
        <DialogHeader>
          <DialogTitle>{form?.id ? "Edit contact" : "Add contact"}</DialogTitle>
          <DialogDescription>People and routing roles for this customer.</DialogDescription>
        </DialogHeader>
        {form ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="contact-name">Full name</FieldLabel>
              <Input
                id="contact-name"
                value={form.name}
                onChange={(event) => onChange({ ...form, name: event.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="contact-title">Title</FieldLabel>
              <Input
                id="contact-title"
                value={form.title}
                onChange={(event) => onChange({ ...form, title: event.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="contact-email">Email</FieldLabel>
              <Input
                id="contact-email"
                type="email"
                value={form.email}
                onChange={(event) => onChange({ ...form, email: event.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="contact-phone">Phone</FieldLabel>
              <Input
                id="contact-phone"
                value={form.phone}
                onChange={(event) => onChange({ ...form, phone: event.target.value })}
              />
            </Field>
            <Field className="sm:col-span-2">
              <FieldLabel>Roles</FieldLabel>
              <FieldGroup className="grid gap-2 sm:grid-cols-2">
                {roleOptions.map((role) => (
                  <label key={role.value} className="flex items-center gap-2 border p-2 text-sm">
                    <Checkbox
                      checked={form.roles.includes(role.value)}
                      onCheckedChange={() => onToggleRole(role.value)}
                    />
                    {role.label}
                  </label>
                ))}
              </FieldGroup>
            </Field>
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="contact-notes">Notes</FieldLabel>
              <Textarea
                id="contact-notes"
                rows={3}
                value={form.notes}
                onChange={(event) => onChange({ ...form, notes: event.target.value })}
              />
            </Field>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={pending || !form?.name.trim()} onClick={onSave}>
            {pending ? "Saving..." : "Save contact"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProjectDialog({
  form,
  pending,
  onOpenChange,
  onChange,
  onSave,
}: {
  form: ProjectFormState | null;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (form: ProjectFormState | null) => void;
  onSave: () => void;
}) {
  return (
    <Dialog open={form != null} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="bg-background text-foreground">
        <DialogHeader>
          <DialogTitle>{form?.id ? "Edit project" : "New project"}</DialogTitle>
          <DialogDescription>Group job notes and private files for this customer.</DialogDescription>
        </DialogHeader>
        {form ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="project-name">Project name</FieldLabel>
              <Input
                id="project-name"
                value={form.name}
                onChange={(event) => onChange({ ...form, name: event.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="project-status">Status</FieldLabel>
              <Select
                value={form.status}
                onValueChange={(value) =>
                  onChange({ ...form, status: value as CustomerProjectStatus })
                }
              >
                <SelectTrigger id="project-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {projectStatuses.map((status) => (
                    <SelectItem key={status.value} value={status.value}>
                      {status.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div />
            <Field>
              <FieldLabel>Start date</FieldLabel>
              <DatePicker
                value={form.startDate ?? ""}
                onChange={(value) => onChange({ ...form, startDate: value || null })}
              />
            </Field>
            <Field>
              <FieldLabel>Target end</FieldLabel>
              <DatePicker
                value={form.targetEndDate ?? ""}
                onChange={(value) => onChange({ ...form, targetEndDate: value || null })}
              />
            </Field>
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="project-summary">Summary</FieldLabel>
              <Textarea
                id="project-summary"
                rows={3}
                value={form.summary}
                onChange={(event) => onChange({ ...form, summary: event.target.value })}
              />
            </Field>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={pending || !form?.name.trim()} onClick={onSave}>
            {pending ? "Saving..." : "Save project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="border border-dashed bg-muted px-(--space-8) py-(--space-16) text-center text-[length:var(--text-sm)] text-muted-foreground">
      {message}
    </div>
  );
}

function IconTile({ icon }: { icon: typeof NoteIcon }) {
  return (
    <span className="grid size-(--space-16) shrink-0 place-items-center bg-muted text-muted-foreground">
      <HugeiconsIcon icon={icon} size={16} aria-hidden />
    </span>
  );
}

function IconText({ icon, children }: { icon: typeof NoteIcon; children: React.ReactNode }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <HugeiconsIcon icon={icon} size={14} className="shrink-0 text-muted-foreground" aria-hidden />
      <span className="truncate">{children}</span>
    </span>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileTypeBadge({ file }: { file: CustomerProjectFileRow }) {
  const type = file.contentType.includes("pdf")
    ? "PDF"
    : file.contentType.startsWith("image/")
      ? "IMG"
      : file.filename.split(".").pop()?.slice(0, 3).toUpperCase() || "FILE";

  return <Badge variant="outline">{type}</Badge>;
}
