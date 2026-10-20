import { Check, ChevronDown, ExternalLink, Pause, Star, Undo2, X } from "lucide-react";
import { opportunityNotesAction, opportunityStatusAction } from "@/app/(app)/opportunities/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type { OpportunityRow } from "@/db/queries/opportunities";
import { formatDay } from "@/lib/dates";
import type { OpportunityStatus } from "@/lib/opportunities";
import { kindLabel } from "@/lib/radar/types";
import { cn } from "@/lib/utils";

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function StatusButton({ id, status, label, icon, variant = "outline" }: {
  id: string;
  status: OpportunityStatus;
  label: string;
  icon: React.ReactNode;
  variant?: "default" | "outline" | "ghost";
}) {
  return (
    <form action={opportunityStatusAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <Button type="submit" variant={variant} size="lg">
        {icon}
        {label}
      </Button>
    </form>
  );
}

function scoreClass(score: number) {
  return score >= 80 ? "bg-section-general-soft text-section-general-ink" : score >= 60 ? "bg-section-investors-soft text-section-investors-ink" : "bg-secondary text-secondary-foreground";
}

export function OpportunityCard({ item }: { item: OpportunityRow }) {
  const toApply = item.status === "new" || item.status === "seen" || item.status === "saved";
  const saved = item.status === "saved";
  return (
    <Card className={cn("gap-3 p-5", (item.status === "dismissed" || item.status === "on_hold") && "opacity-70")}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <h3 className="flex items-center gap-2 text-base font-medium">
            {item.status === "new" ? <span role="img" aria-label="New" className="size-2 shrink-0 rounded-full bg-primary" /> : null}
            {saved ? <Star role="img" aria-label="Saved" className="size-4 shrink-0 fill-current text-primary" /> : null}
            {item.url ? (
              <a href={item.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                {item.title}
              </a>
            ) : (
              item.title
            )}
          </h3>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="secondary">{kindLabel(item.kind)}</Badge>
            {item.tags.includes("rice") ? <Badge variant="outline">Rice</Badge> : null}
            {item.eventDate ? <Badge variant="outline">{formatDay(item.eventDate)}</Badge> : null}
            {item.deadline ? <Badge variant="outline">Apply by {formatDay(item.deadline)}</Badge> : null}
            {item.location ? <Badge variant="outline">{item.location}</Badge> : null}
            {item.tags
              .filter((t) => t !== "rice")
              .slice(0, 4)
              .map((t) => (
                <Badge key={t} variant="ghost" className="text-muted-foreground">
                  {t}
                </Badge>
              ))}
          </div>
        </div>
        <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-medium tabular-nums", scoreClass(item.score))} title="Fit score">
          Fit {item.score}
        </span>
      </div>

      {item.summary ? <p className="text-sm">{item.summary}</p> : null}
      {item.whyRelevant ? <p className="text-sm text-muted-foreground">{item.whyRelevant}</p> : null}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {toApply ? (
          <>
            <StatusButton id={item.id} status="applied" label="Applied" icon={<Check aria-hidden />} variant="default" />
            <StatusButton
              id={item.id}
              status={saved ? "seen" : "saved"}
              label={saved ? "Saved" : "Save"}
              icon={<Star aria-hidden className={saved ? "fill-current" : undefined} />}
            />
            <StatusButton id={item.id} status="on_hold" label="On hold" icon={<Pause aria-hidden />} variant="ghost" />
            <StatusButton id={item.id} status="dismissed" label="Dismiss" icon={<X aria-hidden />} variant="ghost" />
          </>
        ) : (
          <StatusButton id={item.id} status="seen" label="Back to To apply" icon={<Undo2 aria-hidden />} />
        )}
        {item.url ? (
          <a href={item.url} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline">
            {host(item.url)}
            <ExternalLink aria-hidden className="size-3" />
          </a>
        ) : null}
      </div>

      <details className="text-sm">
        <summary className="flex min-h-11 cursor-pointer items-center gap-1 py-2.5 text-muted-foreground">
          <ChevronDown aria-hidden className="size-4" />
          {item.notes ? "Notes" : "Add notes"}
        </summary>
        <form action={opportunityNotesAction} className="space-y-2">
          <input type="hidden" name="id" value={item.id} />
          <label htmlFor={`notes-${item.id}`} className="sr-only">
            Notes on {item.title}
          </label>
          <Textarea id={`notes-${item.id}`} name="notes" defaultValue={item.notes} placeholder="Deadlines, what to submit, who to ask…" />
          <Button type="submit" variant="outline" size="lg">
            Save notes
          </Button>
        </form>
      </details>
    </Card>
  );
}
