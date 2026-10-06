import Link from "next/link";
import { Card } from "@/components/ui/card";
import { SECTION_STYLES } from "@/lib/nav";
import { formatCents } from "@/lib/money";
import { PIPELINES } from "@/lib/sections";
import type { Snapshot } from "@/lib/snapshot";
import { cn } from "@/lib/utils";

// Counts and value by stage as text, so nothing depends on color.
export function PipelineSnapshot({ snapshot }: { snapshot: Snapshot }) {
  const { section } = snapshot;
  const label = PIPELINES[section].label;
  const total = snapshot.stages.reduce((sum, stage) => sum + stage.count, 0);
  return (
    <Card className="gap-4 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-2 font-medium">
            <span aria-hidden className={cn("size-2.5 rounded-full", SECTION_STYLES[section].dot)} />
            <Link href={`/${section}`} className="underline-offset-4 hover:underline">
              {label}
            </Link>
          </h3>
          <p className="text-sm text-muted-foreground">
            {snapshot.openCount} open
            {snapshot.openCents > 0 ? ` · ${formatCents(snapshot.openCents)}` : ""} · {snapshot.wonCount} won
          </p>
        </div>
      </div>
      {total === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing in the pipeline yet.</p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          {snapshot.stages.map((stage) => (
            <div key={stage.key} className="flex items-baseline justify-between gap-2 border-b border-border pb-1">
              <dt className="text-muted-foreground">{stage.label}</dt>
              <dd>
                {stage.count}
                {stage.amountCents > 0 ? <span className="text-muted-foreground"> · {formatCents(stage.amountCents)}</span> : null}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}
