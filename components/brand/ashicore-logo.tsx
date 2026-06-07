import { cn } from "@/lib/utils";

type AshicoreLogoProps = {
  className?: string;
  markClassName?: string;
  showWordmark?: boolean;
};

export function AshicoreLogo({
  className,
  markClassName,
  showWordmark = true,
}: AshicoreLogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-[11px]", className)}>
      <AshicoreMark className={markClassName} />
      {showWordmark ? (
        <span className="font-display font-semibold tracking-[0]">Ashicore</span>
      ) : null}
    </span>
  );
}

export function AshicoreMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 32 32"
      className={cn("size-(--space-10) shrink-0", className)}
      fill="none"
    >
      <rect width="32" height="32" fill="#11151A" />
      <path d="M8 23V9h3.2v14H8Zm6.4 0V9h3.2v14h-3.2Zm6.4 0V9H24v14h-3.2Z" fill="#F7F8F5" />
      <path d="M8 23h16v-3H8v3Z" fill="#65B99F" />
    </svg>
  );
}
