import { PRIORITY_LABELS, PRIORITY_STEPS } from "@/lib/reminders";
import type { Priority } from "@/db/schema";
import { cn } from "@/lib/utils";

const STEP_HEIGHTS = ["h-2", "h-3", "h-4", "h-5"] as const;

// Four rising bars plus a text label. Priority never uses color hues: on-steps are the
// primary tone, off-steps the accent tone, and the label carries the meaning.
export function PriorityMeter({ priority, className }: { priority: Priority | null; className?: string }) {
  const filled = priority ? PRIORITY_STEPS[priority] : 0;
  const label = priority ? PRIORITY_LABELS[priority] : "No priority";
  return (
    <span className={cn("inline-flex items-center gap-2 text-sm", className)}>
      <span aria-hidden className="flex items-end gap-0.5">
        {STEP_HEIGHTS.map((height, index) => (
          <span
            key={height}
            className={cn("w-1 rounded-full", height, index < filled ? "bg-primary" : "bg-accent")}
          />
        ))}
      </span>
      <span>{label}</span>
    </span>
  );
}
