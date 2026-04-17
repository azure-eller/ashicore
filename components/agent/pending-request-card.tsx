"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type {
  AgentPendingRequestRecord,
  AgentPendingRequestResponse,
  AgentQuestion,
} from "@/lib/agent/erp/types";

function buildQuestionAnswerPayload(args: {
  questions: AgentQuestion[];
  singleAnswers: Record<string, string>;
  multiAnswers: Record<string, string[]>;
  otherValues: Record<string, string>;
}) {
  return {
    answers: Object.fromEntries(
      args.questions.map((question) => {
        const other = args.otherValues[question.question]?.trim();

        if (question.multiSelect) {
          const selected = args.multiAnswers[question.question] ?? [];
          return [
            question.question,
            other ? [...selected, other] : selected,
          ];
        }

        return [
          question.question,
          other || args.singleAnswers[question.question] || "",
        ];
      })
    ),
  };
}

export function PendingRequestCard({
  pendingRequest,
  isSubmitting,
  onResolve,
}: {
  pendingRequest: AgentPendingRequestRecord;
  isSubmitting: boolean;
  onResolve: (response: AgentPendingRequestResponse) => Promise<void>;
}) {
  const [singleAnswers, setSingleAnswers] = useState<Record<string, string>>({});
  const [multiAnswers, setMultiAnswers] = useState<Record<string, string[]>>({});
  const [otherValues, setOtherValues] = useState<Record<string, string>>({});
  const [activePreviewLabels, setActivePreviewLabels] = useState<Record<string, string>>({});

  const questions = useMemo(
    () =>
      pendingRequest.kind === "question" && "questions" in pendingRequest.payload
        ? pendingRequest.payload.questions
        : [],
    [pendingRequest]
  );

  if (pendingRequest.kind === "permission") {
    return (
      <Card className="border-dashed bg-card/80">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Approval Needed</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{pendingRequest.payload.summary}</p>
          <div className="flex gap-3">
            <Button disabled={isSubmitting} onClick={() => onResolve({ approved: true })}>
              {isSubmitting ? "Submitting…" : "Approve"}
            </Button>
            <Button
              variant="outline"
              disabled={isSubmitting}
              onClick={() => onResolve({ approved: false })}
            >
              Deny
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-dashed bg-card/80">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Clarification Needed</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {questions.map((question) => (
          <div key={question.question} className="space-y-3">
            <div className="space-y-1">
              <p className="text-sm font-medium">{question.question}</p>
              <p className="text-xs text-muted-foreground">{question.header}</p>
            </div>
            <div
              className={
                question.multiSelect || !question.options.some((option) => option.preview)
                  ? "space-y-2"
                  : "grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.9fr)] lg:items-start"
              }
            >
              <div className="space-y-2">
                {question.options.map((option) => {
                  if (question.multiSelect) {
                    const selected = multiAnswers[question.question] ?? [];
                    const checked = selected.includes(option.label);
                    return (
                      <label
                        key={option.label}
                        className="flex items-start gap-3 rounded-xl border border-border/60 p-3"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(value) => {
                            setMultiAnswers((prev) => {
                              const next = new Set(prev[question.question] ?? []);
                              if (value) {
                                next.add(option.label);
                              } else {
                                next.delete(option.label);
                              }
                              return {
                                ...prev,
                                [question.question]: [...next],
                              };
                            });
                          }}
                        />
                        <span className="space-y-1">
                          <span className="block text-sm font-medium">{option.label}</span>
                          <span className="block text-xs text-muted-foreground">
                            {option.description}
                          </span>
                        </span>
                      </label>
                    );
                  }

                  const checked = singleAnswers[question.question] === option.label;
                  return (
                    <label
                      key={option.label}
                      className={`flex items-start gap-3 rounded-xl border p-3 ${
                        checked
                          ? "border-foreground/20 bg-muted/70"
                          : "border-border/60"
                      }`}
                      onMouseEnter={() =>
                        setActivePreviewLabels((prev) => ({
                          ...prev,
                          [question.question]: option.label,
                        }))
                      }
                    >
                      <input
                        type="radio"
                        name={question.question}
                        checked={checked}
                        onChange={() =>
                          setSingleAnswers((prev) => ({
                            ...prev,
                            [question.question]: option.label,
                          }))
                        }
                        onFocus={() =>
                          setActivePreviewLabels((prev) => ({
                            ...prev,
                            [question.question]: option.label,
                          }))
                        }
                      />
                      <span className="space-y-1">
                        <span className="block text-sm font-medium">{option.label}</span>
                        <span className="block text-xs text-muted-foreground">
                          {option.description}
                        </span>
                      </span>
                    </label>
                  );
                })}
                <Input
                  value={otherValues[question.question] ?? ""}
                  onChange={(event) =>
                    setOtherValues((prev) => ({
                      ...prev,
                      [question.question]: event.target.value,
                    }))
                  }
                  placeholder="Other…"
                />
              </div>
              {!question.multiSelect && question.options.some((option) => option.preview) ? (
                <div className="rounded-xl border border-border/60 bg-muted/40 p-4">
                  <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Preview
                  </p>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-6 text-foreground">
                    {question.options.find(
                      (option) =>
                        option.label ===
                        (activePreviewLabels[question.question] ||
                          singleAnswers[question.question] ||
                          question.options.find((candidate) => candidate.preview)?.label)
                    )?.preview ?? "Select an option to compare it here."}
                  </pre>
                </div>
              ) : null}
            </div>
          </div>
        ))}
        <div className="flex gap-3">
          <Button
            disabled={isSubmitting}
            onClick={() =>
              onResolve(
                buildQuestionAnswerPayload({
                  questions,
                  singleAnswers,
                  multiAnswers,
                  otherValues,
                })
              )
            }
          >
            {isSubmitting ? "Submitting…" : "Continue"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
