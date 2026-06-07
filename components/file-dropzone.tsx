import { Upload01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { InsetPanel } from "@/components/inset-panel";
import { cn } from "@/lib/utils";

type FileDropzoneProps = {
  label?: string;
  disabled?: boolean;
  className?: string;
  onBrowse: () => void;
  onFiles: (files: FileList) => void;
};

export function FileDropzone({
  label = "Upload or drop files",
  disabled = false,
  className,
  onBrowse,
  onFiles,
}: FileDropzoneProps) {
  return (
    <InsetPanel
      className={cn(
        "flex items-center justify-center gap-(--space-4) border-dashed bg-[var(--color-surface-alt)] px-(--space-6) py-(--space-10) text-[length:var(--text-sm)] text-[var(--color-ink-faint)] transition-colors duration-(--duration-1) ease-(--ease-out)",
        !disabled && "hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]",
        disabled && "opacity-60",
        className,
      )}
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        if (disabled) return;
        onFiles(event.dataTransfer.files);
      }}
    >
      <HugeiconsIcon icon={Upload01Icon} size={16} aria-hidden />
      <button
        type="button"
        className="font-medium text-[var(--color-ink)] outline-none transition-colors duration-(--duration-1) ease-(--ease-out) hover:text-[var(--color-accent-ink)] focus-visible:rounded-[var(--radius-sm)] focus-visible:shadow-[0_0_0_4px_var(--color-accent-soft)]"
        onClick={onBrowse}
        disabled={disabled}
      >
        {label}
      </button>
    </InsetPanel>
  );
}
