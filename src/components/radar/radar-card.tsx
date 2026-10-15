import Link from "next/link";
import { ArrowRight, Check, ChevronDown, ExternalLink, Star, Undo2, UserPlus, X } from "lucide-react";
import { approveRadarAction, radarNotesAction, radarStatusAction } from "@/app/(app)/radar/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type { RadarRow, WarmMatch } from "@/db/queries/radar";
import { formatDay } from "@/lib/dates";
import { crmHref, isPersonKind, kindLabel, type RadarDetails } from "@/lib/radar/types";
import { cn } from "@/lib/utils";

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function Status({ id, status, label, icon, variant = "outline" }: {
  id: string;
  status: "seen" | "saved" | "dismissed";
  label: string;
  icon: React.ReactNode;
  variant?: "outline" | "ghost";
}) {
  return (
    <form action={radarStatusAction}>
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

export function RadarCard({ item, warm, back }: { item: RadarRow; warm: WarmMatch[]; back: string }) {
  const d = item.details as RadarDetails;
  const person = isPersonKind(item.kind);
  const approvable = person && item.feed === "sooz";
  const inCrm = crmHref(item);
  const facts: [string, React.ReactNode][] = [];
  if (person) {
    if (d.role || d.firm) facts.push(["Who", [d.role, d.firm].filter(Boolean).join(" · ")]);
    if (d.rice_connection) facts.push(["Rice", d.rice_connection]);
    if (d.check_size) facts.push(["Check size", d.check_size]);
    if (d.contact_path) facts.push(["Reach via", d.contact_path]);
  }
  const knows = warm.filter((w) => w.kind === "same_company");
  if (warm.some((w) => w.kind === "same_person")) facts.push(["You know", "You're already connected on LinkedIn"]);
  else if (knows.length) facts.push(["You know", knows.map((w) => `${w.full_name}${w.position ? ` (${w.position})` : ""}`).join(", ")]);

  return (
    <Card className={cn("gap-3 p-5", item.status === "dismissed" && "opacity-70")}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <h3 className="flex items-center gap-2 text-base font-medium">
            {item.status === "new" ? <span role="img" aria-label="New" className="size-2 shrink-0 rounded-full bg-primary" /> : null}
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
            {item.hasDraft && !inCrm ? <Badge>Draft ready</Badge> : null}
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

      {facts.length ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {facts.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="break-words">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {item.draft && !inCrm ? (
        <details className="rounded-xl bg-secondary/60 px-4 py-2 text-sm">
          <summary className="min-h-11 cursor-pointer py-2.5 font-medium">Draft ready · approve to send it from the CRM</summary>
          {item.draft.subject ? <p className="pb-1 font-medium">{item.draft.subject}</p> : null}
          <p className="whitespace-pre-wrap pb-2 text-muted-foreground">{item.draft.body}</p>
        </details>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {approvable && inCrm ? (
          <Button size="lg" variant="outline" render={<Link href={inCrm} />}>
            <Check aria-hidden />
            In CRM
            <ArrowRight aria-hidden />
          </Button>
        ) : null}
        {approvable && !inCrm && item.status !== "dismissed" ? (
          <form action={approveRadarAction}>
            <input type="hidden" name="id" value={item.id} />
            <input type="hidden" name="back" value={back} />
            <Button type="submit" size="lg">
              <UserPlus aria-hidden />
              {item.status === "approved" ? "Approve again" : "Approve"}
            </Button>
          </form>
        ) : null}
        {item.status === "approved" && inCrm ? null : item.status === "dismissed" ? (
          <Status id={item.id} status="seen" label="Restore" icon={<Undo2 aria-hidden />} />
        ) : (
          <>
            <Status
              id={item.id}
              status={item.status === "saved" ? "seen" : "saved"}
              label={item.status === "saved" ? "Saved" : "Save"}
              icon={<Star aria-hidden className={item.status === "saved" ? "fill-current" : undefined} />}
            />
            <Status id={item.id} status="dismissed" label="Dismiss" icon={<X aria-hidden />} variant="ghost" />
          </>
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
        <form action={radarNotesAction} className="space-y-2">
          <input type="hidden" name="id" value={item.id} />
          <label htmlFor={`notes-${item.id}`} className="sr-only">
            Notes on {item.title}
          </label>
          <Textarea id={`notes-${item.id}`} name="notes" defaultValue={item.notes} placeholder="Intro paths, follow-ups, who to ask…" />
          <Button type="submit" variant="outline" size="lg">
            Save notes
          </Button>
        </form>
      </details>
    </Card>
  );
}
