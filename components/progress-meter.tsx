export function clampProgressPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function ProgressMeter({
  label,
  percent,
  segmentCount,
  completedSegmentCount = 0,
}: {
  label: string;
  percent: number;
  segmentCount?: number;
  completedSegmentCount?: number;
}) {
  const clampedPercent = clampProgressPercent(percent);

  return (
    <span className="block min-w-0" aria-label={label} title={label}>
      {segmentCount && segmentCount > 1 ? (
        <span
          className="grid h-[3px] gap-[2px]"
          style={{
            gridTemplateColumns: `repeat(${segmentCount}, minmax(0, 1fr))`,
          }}
        >
          {Array.from({ length: segmentCount }, (_, index) => (
            <span
              key={index}
              className={
                index < completedSegmentCount
                  ? "rounded-full bg-current"
                  : "rounded-full bg-[color-mix(in_oklch,currentColor,transparent_78%)]"
              }
              aria-hidden="true"
            />
          ))}
        </span>
      ) : (
        <span className="block h-[3px] rounded-full bg-[color-mix(in_oklch,currentColor,transparent_78%)]">
          <span
            className="block h-full rounded-full bg-current transition-[width]"
            style={{ width: `${clampedPercent}%` }}
          />
        </span>
      )}
    </span>
  );
}
