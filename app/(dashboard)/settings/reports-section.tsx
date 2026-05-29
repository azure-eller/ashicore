"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Settings02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { apiJson } from "@/lib/client/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DailyManufacturingReportScheduleData } from "@/lib/dal/reports";
import type { DailyManufacturingReportPayload } from "@/lib/reports/daily-manufacturing-schema";
import {
  formatDate,
  formatDateTime,
  formatPrice,
  formatQuantity,
  todayInTimeZone,
} from "@/lib/format";
import { SettingsPanel, SettingsPanelHeader } from "./settings-panel";

type FormState = {
  enabled: boolean;
  emailEnabled: boolean;
  localSendTime: string;
  timeZone: string;
  recipientUserIds: string[];
};

type DailyManufacturingReportRun = {
  id: string;
  reportDate: string;
  status: string;
  createdAt: string;
  failureMessage: string | null;
  payload: DailyManufacturingReportPayload | null;
};

type ManualSendResult = {
  runId: string;
  reportDate: string;
  recipientCount: number;
  source: "generated" | "retried" | "snapshot";
};

function toFormState(data: DailyManufacturingReportScheduleData): FormState {
  return {
    enabled: data.schedule.enabled,
    emailEnabled: data.schedule.emailEnabled,
    localSendTime: data.schedule.localSendTime.slice(0, 5),
    timeZone: data.schedule.timeZone,
    recipientUserIds: data.recipientUserIds,
  };
}

export function ReportsSection({
  initialData,
}: {
  initialData: DailyManufacturingReportScheduleData;
}) {
  const queryClient = useQueryClient();
  const { data = initialData } = useQuery({
    queryKey: ["daily-manufacturing-report-schedule"],
    queryFn: () =>
      apiJson<DailyManufacturingReportScheduleData>(
        "/api/report-schedules/daily-manufacturing"
      ),
    initialData,
  });
  const [formState, setFormState] = useState<FormState>(() => toFormState(initialData));
  const [formError, setFormError] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [manualReportDate, setManualReportDate] = useState(() =>
    todayInTimeZone(initialData.schedule.timeZone)
  );
  const [manualSendError, setManualSendError] = useState<string | null>(null);
  const [manualSendMessage, setManualSendMessage] = useState<string | null>(null);
  const selectedRecipients = useMemo(
    () => new Set(formState.recipientUserIds),
    [formState.recipientUserIds]
  );
  const historyQuery = useQuery({
    queryKey: ["daily-manufacturing-report-history"],
    queryFn: () =>
      apiJson<DailyManufacturingReportRun[]>("/api/reports/daily-manufacturing"),
    enabled: historyOpen,
  });
  const detailQuery = useQuery({
    queryKey: ["daily-manufacturing-report", selectedReportId],
    queryFn: () =>
      apiJson<DailyManufacturingReportRun>(
        `/api/reports/daily-manufacturing/${selectedReportId}`
      ),
    enabled: historyOpen && selectedReportId != null,
  });

  const saveMutation = useMutation({
    mutationFn: async (nextState: FormState) =>
      apiJson<DailyManufacturingReportScheduleData>(
        "/api/report-schedules/daily-manufacturing",
        {
          method: "PUT",
          body: nextState,
          fallbackError: "Failed to save report settings.",
        }
      ),
    onMutate: () => setFormError(null),
    onSuccess: (nextData) => {
      queryClient.setQueryData(["daily-manufacturing-report-schedule"], nextData);
      setFormState(toFormState(nextData));
    },
    onError: (error) => {
      setFormError(
        error instanceof Error ? error.message : "Failed to save report settings."
      );
    },
  });

  const manualSendMutation = useMutation({
    mutationFn: async () =>
      apiJson<ManualSendResult>("/api/reports/daily-manufacturing/manual-send", {
        method: "POST",
        body: {
          reportDate: manualReportDate,
          recipientUserIds: formState.recipientUserIds,
        },
        fallbackError: "Failed to send report.",
      }),
    onMutate: () => {
      setManualSendError(null);
      setManualSendMessage(null);
    },
    onSuccess: async (result) => {
      setManualSendMessage(
        `Report sent to ${result.recipientCount} ${result.recipientCount === 1 ? "recipient" : "recipients"}.`
      );
      await queryClient.invalidateQueries({
        queryKey: ["daily-manufacturing-report-history"],
      });
    },
    onError: (error) => {
      setManualSendError(error instanceof Error ? error.message : "Failed to send report.");
    },
  });

  function saveSettings(nextState: FormState) {
    saveMutation.mutate(nextState);
  }

  function updateEnabled(enabled: boolean) {
    const nextState = {
      ...formState,
      enabled,
      emailEnabled: enabled ? true : formState.emailEnabled,
    };

    setFormState(nextState);
    saveSettings(nextState);
  }

  function openConfigDialog() {
    setFormState(toFormState(data));
    setFormError(null);
    setManualReportDate(todayInTimeZone(data.schedule.timeZone));
    setManualSendError(null);
    setManualSendMessage(null);
    setConfigOpen(true);
  }

  function toggleRecipient(userId: string, checked: boolean) {
    setFormState((current) => ({
      ...current,
      recipientUserIds: checked
        ? [...current.recipientUserIds, userId]
        : current.recipientUserIds.filter((id) => id !== userId),
    }));
  }

  return (
    <SettingsPanel id="reports">
      <SettingsPanelHeader
        title="Reports"
        action={
          <Button type="button" size="sm" variant="outline" onClick={() => setHistoryOpen(true)}>
            Past reports
          </Button>
        }
      />

      <div className="divide-y">
        <div className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-(--space-6) px-(--space-12) py-(--space-6) transition-colors hover:bg-muted/40">
          <label className="flex min-w-0 cursor-pointer items-center gap-(--space-4)">
            <Checkbox
              checked={formState.enabled}
              disabled={saveMutation.isPending}
              onCheckedChange={(checked) => updateEnabled(checked === true)}
              aria-label="Enable daily manufacturing report"
            />
            <span className="min-w-0 text-[length:var(--text-sm)] font-medium text-foreground">
              Enable daily manufacturing report
            </span>
          </label>

          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={saveMutation.isPending}
            onClick={openConfigDialog}
            className="text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:opacity-0 md:transition-opacity md:hover:bg-transparent md:focus-visible:opacity-100 md:group-hover:opacity-100"
            aria-label="Configure daily manufacturing report"
          >
            <HugeiconsIcon icon={Settings02Icon} strokeWidth={2} />
          </Button>
        </div>
        {formError ? (
          <div className="px-(--space-12) py-(--space-4) text-[length:var(--text-sm)] text-destructive">
            {formError}
          </div>
        ) : null}
      </div>

      <Dialog open={configOpen} onOpenChange={setConfigOpen}>
        <DialogContent size="lg" className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Daily Manufacturing Report</DialogTitle>
          </DialogHeader>

          <FieldGroup>
            <div className="flex items-center justify-between gap-4 border-b pb-3">
              <FieldLabel>Email delivery</FieldLabel>
              <Switch
                checked={formState.emailEnabled}
                onCheckedChange={(emailEnabled) =>
                  setFormState((current) => ({ ...current, emailEnabled }))
                }
                aria-label="Enable report email delivery"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="daily-report-send-time">Send time</FieldLabel>
                <Input
                  id="daily-report-send-time"
                  type="time"
                  value={formState.localSendTime}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      localSendTime: event.target.value,
                    }))
                  }
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="daily-report-time-zone">Time zone</FieldLabel>
                <Input
                  id="daily-report-time-zone"
                  value={formState.timeZone}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      timeZone: event.target.value,
                    }))
                  }
                />
              </Field>
            </div>

            <Field>
              <FieldLabel>Recipients</FieldLabel>
              <div className="max-h-72 overflow-y-auto divide-y border bg-card">
                {data.members.map((member) => (
                  <label
                    key={member.userId}
                    className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm"
                  >
                    <Checkbox
                      checked={selectedRecipients.has(member.userId)}
                      onCheckedChange={(checked) =>
                        toggleRecipient(member.userId, checked === true)
                      }
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {member.name} <span className="text-muted-foreground">{member.email}</span>
                    </span>
                  </label>
                ))}
              </div>
            </Field>

            <FieldError errors={formError ? [{ message: formError }] : []} />

            <div className="grid gap-4 border-t pt-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <Field>
                <FieldLabel htmlFor="daily-report-manual-date">Manual send date</FieldLabel>
                <DatePicker
                  id="daily-report-manual-date"
                  value={manualReportDate}
                  onChange={setManualReportDate}
                  disabled={manualSendMutation.isPending}
                />
              </Field>
              <Button
                type="button"
                variant="outline"
                disabled={manualSendMutation.isPending || !manualReportDate}
                onClick={() => manualSendMutation.mutate()}
              >
                {manualSendMutation.isPending ? "Sending..." : "Send report"}
              </Button>
              <div className="md:col-span-2">
                <FieldError
                  errors={manualSendError ? [{ message: manualSendError }] : []}
                />
                {manualSendMessage ? (
                  <div className="text-[length:var(--text-sm)] text-success">
                    {manualSendMessage}
                  </div>
                ) : null}
              </div>
            </div>
          </FieldGroup>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfigOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={saveMutation.isPending}
              onClick={() =>
                saveMutation.mutate(formState, {
                  onSuccess: () => setConfigOpen(false),
                })
              }
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent size="3xl" className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Daily Manufacturing Report History</DialogTitle>
          </DialogHeader>

          <ReportHistoryDialog
            reports={historyQuery.data ?? []}
            selectedReport={detailQuery.data ?? null}
            selectedReportId={selectedReportId}
            timeZone={data.schedule.timeZone}
            isLoadingHistory={historyQuery.isLoading}
            isLoadingDetail={detailQuery.isLoading}
            historyError={historyQuery.error}
            detailError={detailQuery.error}
            onSelectReport={setSelectedReportId}
          />
        </DialogContent>
      </Dialog>
    </SettingsPanel>
  );
}

function ReportHistoryDialog({
  reports,
  selectedReport,
  selectedReportId,
  timeZone,
  isLoadingHistory,
  isLoadingDetail,
  historyError,
  detailError,
  onSelectReport,
}: {
  reports: DailyManufacturingReportRun[];
  selectedReport: DailyManufacturingReportRun | null;
  selectedReportId: string | null;
  timeZone: string;
  isLoadingHistory: boolean;
  isLoadingDetail: boolean;
  historyError: unknown;
  detailError: unknown;
  onSelectReport: (id: string) => void;
}) {
  return (
    <div className="grid gap-5">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Products</TableHead>
              <TableHead>Generated</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {historyError ? (
              <TableRow>
                <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                  Failed to load report history.
                </TableCell>
              </TableRow>
            ) : isLoadingHistory ? (
              <TableRow>
                <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                  Loading reports...
                </TableCell>
              </TableRow>
            ) : reports.length > 0 ? (
              reports.map((report) => (
                <TableRow key={report.id} data-state={selectedReportId === report.id ? "selected" : undefined}>
                  <TableCell>{formatDate(report.reportDate)}</TableCell>
                  <TableCell>
                    <ReportStatusBadge status={report.status} />
                  </TableCell>
                  <TableCell>
                    {report.payload?.summary.productsWithRecordedOutput ?? "-"}
                  </TableCell>
                  <TableCell>{formatDateTime(report.createdAt, timeZone)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => onSelectReport(report.id)}
                    >
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                  No reports yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {selectedReportId ? (
        detailError ? (
          <div className="rounded-md border p-4 text-sm text-muted-foreground">
            Failed to load report.
          </div>
        ) : isLoadingDetail || !selectedReport ? (
          <div className="rounded-md border p-4 text-sm text-muted-foreground">
            Loading report...
          </div>
        ) : (
          <ReportDetail report={selectedReport} timeZone={timeZone} />
        )
      ) : null}
    </div>
  );
}

function ReportDetail({
  report,
  timeZone,
}: {
  report: DailyManufacturingReportRun;
  timeZone: string;
}) {
  const payload = report.payload;

  return (
    <div className="grid gap-4 rounded-md border p-4">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-sm font-medium">
          Daily Manufacturing Report - {formatDate(report.reportDate)}
        </h3>
        <ReportStatusBadge status={report.status} />
      </div>

      {!payload ? (
        <p className="text-sm text-muted-foreground">
          {report.failureMessage ?? "This saved report payload is unavailable."}
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryMetric
              label="Products with output"
              value={payload.summary.productsWithRecordedOutput}
            />
            <SummaryMetric label="Batches" value={payload.summary.completedBatches} />
            <SummaryMetric label="Shipments" value={payload.summary.shipmentsShipped} />
            <SummaryMetric
              label="Shipped line value"
              value={formatPrice(payload.summary.shippedLineValue) ?? "$0"}
            />
          </div>
          <div className="text-sm text-muted-foreground">
            Generated {formatDateTime(report.createdAt, timeZone)}
          </div>

          <ReportTable
            title="Output by product"
            headers={["Product", "Quantity"]}
            rows={payload.outputByProduct.map((row) => [
              row.productSku ? `${row.productName} (${row.productSku})` : row.productName,
              `${formatQuantity(row.quantity)} ${row.unit}`,
            ])}
          />
          <ReportTable
            title="Output by recorded-by user"
            headers={["User", "Quantity"]}
            rows={payload.outputByRecordedBy.map((row) => [
              row.userEmail ? `${row.userName} (${row.userEmail})` : row.userName,
              row.quantities
                .map((quantity) => `${formatQuantity(quantity.quantity)} ${quantity.unit}`)
                .join(", "),
            ])}
          />
          <ReportTable
            title="Batches"
            headers={["Product", "Output", "Batches"]}
            rows={payload.completedBatches.map((row) => [
              row.productSku ? `${row.productName} (${row.productSku})` : row.productName,
              `${formatQuantity(row.totalOutput)} ${row.unit}`,
              row.batchCount,
            ])}
          />
          <ReportTable
            title="Materials consumed"
            headers={["Material", "Quantity"]}
            rows={payload.materialsConsumed.map((row) => [
              row.materialSku ? `${row.materialName} (${row.materialSku})` : row.materialName,
              `${formatQuantity(row.quantity)} ${row.unit}`,
            ])}
          />
        </>
      )}
    </div>
  );
}

function ReportStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={status === "failed" ? "destructive" : "secondary"}>
      {status}
    </Badge>
  );
}

function SummaryMetric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      <div className="mt-1 text-sm text-muted-foreground">{label}</div>
    </div>
  );
}

function ReportTable({
  title,
  headers,
  rows,
}: {
  title: string;
  headers: string[];
  rows: Array<Array<ReactNode>>;
}) {
  return (
    <div>
      <h4 className="mb-2 text-sm font-medium">{title}</h4>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {headers.map((header) => (
                <TableHead key={header}>{header}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length > 0 ? (
              rows.map((row, index) => (
                <TableRow key={index}>
                  {row.map((cell, cellIndex) => (
                    <TableCell key={cellIndex}>{cell}</TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={headers.length} className="h-14 text-center text-muted-foreground">
                  No rows.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
