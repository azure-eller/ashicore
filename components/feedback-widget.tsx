"use client";

import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { AlertCircleIcon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldError } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

const MAX_SCREENSHOTS = 3;
const MAX_BYTES_PER_SCREENSHOT = 1_000_000;
const MAX_TOTAL_ENCODED_BYTES = 3_500_000;
const MAX_MESSAGE_LENGTH = 5000;

type Screenshot = {
  id: string;
  filename: string;
  contentBase64: string;
  previewUrl: string;
};

async function parseError(response: Response, fallback: string) {
  if (response.ok) return;

  const body = await response.json().catch(() => null);
  const fieldError = Object.values(
    (body?.errors as Record<string, string[]> | undefined) ?? {}
  )
    .flat()
    .find((message): message is string => typeof message === "string" && message.length > 0);

  throw new Error(body?.error ?? fieldError ?? fallback);
}

function readFileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Failed to read file"));
        return;
      }
      const commaIndex = result.indexOf(",");
      resolve(commaIndex === -1 ? result : result.slice(commaIndex + 1));
    };
    reader.readAsDataURL(file);
  });
}

export function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [justSent, setJustSent] = useState(false);
  const screenshotsRef = useRef(screenshots);
  useEffect(() => {
    screenshotsRef.current = screenshots;
  }, [screenshots]);
  useEffect(() => {
    return () => {
      screenshotsRef.current.forEach((shot) => URL.revokeObjectURL(shot.previewUrl));
    };
  }, []);

  const resetForm = () => {
    setMessage("");
    setScreenshots((prev) => {
      prev.forEach((shot) => URL.revokeObjectURL(shot.previewUrl));
      return [];
    });
    setMessageError(null);
    setAttachmentError(null);
    setSubmitError(null);
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      resetForm();
      setJustSent(false);
    }
  };

  const addFiles = async (files: File[]) => {
    setAttachmentError(null);

    if (!files.length) return;

    const remaining = MAX_SCREENSHOTS - screenshots.length;
    if (remaining <= 0) {
      setAttachmentError(`At most ${MAX_SCREENSHOTS} screenshots.`);
      return;
    }

    const accepted: Screenshot[] = [];
    let runningEncodedTotal = screenshots.reduce(
      (sum, shot) => sum + shot.contentBase64.length,
      0
    );

    for (const file of files.slice(0, remaining)) {
      if (!file.type.startsWith("image/")) {
        setAttachmentError("Only image files are supported.");
        continue;
      }
      if (file.size > MAX_BYTES_PER_SCREENSHOT) {
        setAttachmentError("Each screenshot must be 1 MB or smaller.");
        continue;
      }

      try {
        const contentBase64 = await readFileAsBase64(file);
        if (runningEncodedTotal + contentBase64.length > MAX_TOTAL_ENCODED_BYTES) {
          setAttachmentError(
            "Combined screenshots are too large — remove one or use smaller images."
          );
          continue;
        }
        runningEncodedTotal += contentBase64.length;
        accepted.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          filename: file.name || `screenshot-${Date.now()}.png`,
          contentBase64,
          previewUrl: URL.createObjectURL(file),
        });
      } catch {
        setAttachmentError("Failed to read screenshot.");
      }
    }

    if (accepted.length) {
      setScreenshots((prev) => [...prev, ...accepted]);
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const items = event.clipboardData?.items;
    if (!items) return;

    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file && file.type.startsWith("image/")) files.push(file);
      }
    }

    if (files.length) {
      event.preventDefault();
      void addFiles(files);
    }
  };

  const removeScreenshot = (id: string) => {
    setScreenshots((prev) => {
      const next = prev.filter((shot) => shot.id !== id);
      const removed = prev.find((shot) => shot.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return next;
    });
    setAttachmentError(null);
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const trimmed = message.trim();
      if (!trimmed) {
        setMessageError("Please describe the issue.");
        throw new Error("Message is required");
      }
      if (trimmed.length > MAX_MESSAGE_LENGTH) {
        setMessageError(`Please keep it under ${MAX_MESSAGE_LENGTH} characters.`);
        throw new Error("Message is too long");
      }

      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          pageUrl: typeof window !== "undefined" ? window.location.href : undefined,
          userAgent:
            typeof navigator !== "undefined" ? navigator.userAgent : undefined,
          screenshots: screenshots.map((shot) => ({
            filename: shot.filename,
            contentBase64: shot.contentBase64,
          })),
        }),
      });

      await parseError(response, "Failed to send feedback.");
    },
    onSuccess: () => {
      setJustSent(true);
      resetForm();
      setTimeout(() => {
        setOpen(false);
        setJustSent(false);
      }, 1200);
    },
    onError: (error) => {
      const fallback = "Failed to send feedback.";
      const text = error instanceof Error ? error.message : fallback;
      if (text === "Message is required" || text === "Message is too long") return;
      setSubmitError(text);
    },
  });

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          size="lg"
          className="fixed bottom-6 right-6 z-50 h-11 px-4 text-sm shadow-lg"
        >
          Feedback
        </Button>
      </DialogTrigger>
      <DialogContent size="lg" onPaste={handlePaste}>
        <DialogHeader>
          <DialogTitle>Send feedback or report an issue</DialogTitle>
        </DialogHeader>

        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitError(null);
            setMessageError(null);
            mutation.mutate();
          }}
        >
          <Field data-invalid={messageError != null}>
            <Textarea
              id="feedback-message"
              aria-label="Feedback"
              autoFocus
              rows={8}
              maxLength={MAX_MESSAGE_LENGTH}
              className="min-h-40"
              placeholder="Describe the feedback or issue. You can also paste images."
              value={message}
              aria-invalid={messageError != null}
              onChange={(event) => {
                setMessage(event.target.value);
                if (messageError) setMessageError(null);
              }}
            />
            <FieldError errors={messageError ? [{ message: messageError }] : []} />
          </Field>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">
              Pasted images{" "}
              <span className="font-normal text-muted-foreground">
                ({screenshots.length}/{MAX_SCREENSHOTS})
              </span>
            </span>

            {screenshots.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {screenshots.map((shot) => (
                  <li
                    key={shot.id}
                    className="relative h-20 w-20 overflow-hidden rounded-md border border-border bg-muted"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={shot.previewUrl}
                      alt={shot.filename}
                      className="h-full w-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removeScreenshot(shot.id)}
                      aria-label={`Remove ${shot.filename}`}
                      className="absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-background/90 text-foreground shadow"
                    >
                      <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={2} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {attachmentError && (
              <p className="text-sm text-destructive">{attachmentError}</p>
            )}
          </div>

          {submitError && (
            <p className="text-sm text-destructive">{submitError}</p>
          )}

          <DialogFooter className="sm:items-center sm:justify-between">
            <div className="inline-flex w-fit items-center gap-1 rounded-full border border-border bg-background px-2 py-1 text-xs text-muted-foreground">
              <HugeiconsIcon icon={AlertCircleIcon} size={12} strokeWidth={2} />
              Feedback is sent anonymously.
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={mutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending || justSent}>
                {justSent ? "Sent — thanks!" : mutation.isPending ? "Sending…" : "Send"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
