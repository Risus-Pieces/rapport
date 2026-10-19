import Link from "next/link";
import { ExternalLink, Mail } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { RaiseProgressBar } from "@/components/raise/raise-progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getMonthFacts, getRaise, raiseProgress, weekSummary } from "@/db/queries/raise";
import { formatDay } from "@/lib/dates";
import { kindLabel } from "@/lib/radar/types";
import { requireSession } from "@/lib/session";
import { approveShortlistAction, saveMonthFactsAction, saveRaiseAction, setPhaseAction } from "./actions";

export const metadata = { title: "This week" };

type SearchParams = { [key: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const MESSAGE_LABELS: Record<string, string> = {
  first: "First note",
  followup_1: "Follow-up 1",
  followup_2: "Follow-up 2",
  update: "Monthly update",
  launch_ask: "Launch ask",
  launch_followup: "Launch follow-up",
};

function Section({ title, count, children, id }: { title: string; count?: number; children: React.ReactNode; id?: string }) {
  return (
    <Card id={id} className="scroll-mt-6 gap-4 p-5">
      <h2 className="font-medium">
        {title}
        {count !== undefined ? <span className="ml-2 text-sm text-muted-foreground">{count}</span> : null}
      </h2>
      {children}
    </Card>
  );
}

export default async function WeekPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireSession();
  const userId = session.user.id;
  const sp = await searchParams;
  const [raise, progress, week, month] = await Promise.all([getRaise(userId), raiseProgress(userId), weekSummary(userId), getMonthFacts(userId)]);
  const proposed = week.shortlist.filter((r) => r.status === "proposed");
  const banner =
    one(sp.approved) !== undefined
      ? `Approved ${one(sp.approved)}, skipped ${one(sp.skipped)}. Drafts land in your Gmail Drafts tomorrow morning.`
      : one(sp.saved) === "month"
        ? "Saved. The next monthly update will use these."
        : one(sp.saved) === "raise"
          ? "Raise goal saved."
          : one(sp.confirm) === "launch"
            ? "Tick “Yes, Sooz has launched” to start the raise."
            : one(sp.phase) === "raising"
            ? "Raising. The routine drafts the launch ask for everyone marked Advice call done; they land in Gmail Drafts."
            : null;

  return (
    <>
      <PageHeader
        title="This week"
        description={
          raise.phase === "building"
            ? `Building relationships before launch${raise.launchDate ? ` (${formatDay(raise.launchDate)})` : ""}. First notes ask for advice; the raise comes at launch.`
            : "Raising. Launch asks go to everyone you've had an advice call with."
        }
      />
      <div className="grid max-w-4xl gap-6">
        {banner ? (
          <p role="status" className="rounded-xl bg-accent px-4 py-3 text-sm">
            {banner}
          </p>
        ) : null}

        <Section title={`Pre-seed: $${raise.target.toLocaleString("en-US")}`}>
          <RaiseProgressBar progress={progress} />
          <details className="text-sm">
            <summary className="min-h-11 cursor-pointer py-2.5 text-muted-foreground">Goal, launch date and phase</summary>
            <div className="space-y-4">
              <form action={saveRaiseAction} className="flex flex-wrap items-end gap-3">
                <div className="space-y-1.5">
                  <label htmlFor="raise-target" className="text-sm text-muted-foreground">Target ($)</label>
                  <Input id="raise-target" name="target" inputMode="numeric" defaultValue={String(raise.target)} className="w-36" />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="raise-launch" className="text-sm text-muted-foreground">Launch date</label>
                  <Input id="raise-launch" name="launchDate" type="date" defaultValue={raise.launchDate ?? ""} className="w-44" />
                </div>
                <Button type="submit" size="lg" variant="outline">Save</Button>
              </form>
              <form action={setPhaseAction} className="flex flex-wrap items-center gap-3">
                <input type="hidden" name="phase" value={raise.phase === "building" ? "raising" : "building"} />
                {raise.phase === "building" ? (
                  <label className="flex min-h-11 items-center gap-2">
                    <input type="checkbox" name="confirm" value="yes" required className="size-5 accent-primary" />
                    Yes, Sooz has launched
                  </label>
                ) : null}
                <Button type="submit" size="lg" variant={raise.phase === "building" ? "default" : "outline"}>
                  {raise.phase === "building" ? "We launched: start the raise" : "Back to building relationships"}
                </Button>
                <span className="text-muted-foreground">
                  {raise.phase === "building"
                    ? `Drafts a launch ask for the ${progress.ready} ${progress.ready === 1 ? "person" : "people"} marked Advice call done.`
                    : "Stops new launch asks."}
                </span>
              </form>
            </div>
          </details>
        </Section>

        {week.nudges.tractionStale || week.nudges.monthFactsStale ? (
          <Card className="gap-2 bg-secondary/60 p-5">
            {week.nudges.tractionStale ? (
              <p className="text-sm">
                Your traction fact is empty or more than two weeks old. Drafts may only cite it, so{" "}
                <Link href="/settings#pitch" className="underline underline-offset-4">update it in Settings</Link> (sampling results, café interest, waitlist).
              </p>
            ) : null}
            {week.nudges.monthFactsStale ? (
              <p className="text-sm">
                This month&apos;s update needs fresh facts. Fill in <a href="#month" className="underline underline-offset-4">This month</a> below, or no update goes out.
              </p>
            ) : null}
          </Card>
        ) : null}

        <Section title="This week's shortlist" count={week.shortlist.length}>
          {week.shortlist.length === 0 ? (
            <p className="text-sm text-muted-foreground">The shortlist arrives on Monday morning, with each person&apos;s ask already drafted.</p>
          ) : (
            <form action={approveShortlistAction} className="space-y-3">
              <input type="hidden" name="week" value={week.week} />
              <ul className="divide-y divide-border">
                {week.shortlist.map((r) => (
                  <li key={r.id} className="flex gap-3 py-3">
                    {r.status === "proposed" ? (
                      <input
                        type="checkbox"
                        name="approve"
                        value={r.radarItemId}
                        defaultChecked
                        aria-label={`Approve ${r.name}`}
                        className="mt-1 size-5 shrink-0 accent-primary"
                      />
                    ) : (
                      <span className="mt-0.5 w-5 shrink-0" />
                    )}
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{r.name}</span>
                        <Badge variant="secondary">{r.bucket === "investor" ? kindLabel(r.kind) : "Buyer"}</Badge>
                        {r.status !== "proposed" ? <Badge variant="outline">{r.status === "approved" ? "Approved" : "Skipped"}</Badge> : null}
                        {!r.email ? <Badge variant="outline">No email yet</Badge> : null}
                      </div>
                      {r.details.role || r.details.firm ? <p className="text-sm text-muted-foreground">{[r.details.role, r.details.firm].filter(Boolean).join(" · ")}</p> : null}
                      {r.reason ? <p className="text-sm">{r.reason}</p> : null}
                      {r.ask ? <p className="text-sm"><span className="text-muted-foreground">Ask: </span>{r.ask}</p> : null}
                      {r.body ? (
                        <details className="text-sm">
                          <summary className="cursor-pointer py-1 text-muted-foreground">Draft{r.subject ? `: ${r.subject}` : ""}</summary>
                          <p className="whitespace-pre-wrap rounded-xl bg-secondary/60 px-3 py-2">{r.body}</p>
                        </details>
                      ) : (
                        <p className="text-xs text-muted-foreground">Draft not written yet.</p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              {proposed.length ? (
                <div className="flex flex-wrap items-center gap-3">
                  <Button type="submit" size="lg">Approve selected</Button>
                  <span className="text-sm text-muted-foreground">Approved people go into the CRM; their drafts land in Gmail Drafts. Unchecked ones are skipped for 8 weeks.</span>
                </div>
              ) : null}
            </form>
          )}
        </Section>

        <Section title="In your Gmail drafts" count={week.inGmail.length}>
          {week.inGmail.length === 0 && week.queuedForGmail === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing waiting. Approved drafts are added each morning.</p>
          ) : null}
          {week.inGmail.length ? (
            <ul className="divide-y divide-border text-sm">
              {week.inGmail.map((m) => (
                <li key={m.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    {m.href ? <Link href={m.href} className="font-medium hover:underline">{m.name}</Link> : <span className="font-medium">{m.name}</span>}
                    <span className="text-muted-foreground"> · {MESSAGE_LABELS[m.kind] ?? m.kind}{m.subject ? ` · ${m.subject}` : ""}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button size="lg" variant="outline" render={<a href="https://mail.google.com/mail/#drafts" target="_blank" rel="noopener noreferrer" />}>
              <Mail aria-hidden />
              Open Gmail Drafts
            </Button>
            {week.queuedForGmail ? (
              <span className="text-sm text-muted-foreground">{week.queuedForGmail} more will be added tomorrow morning.</span>
            ) : null}
          </div>
        </Section>

        {week.followupsDue.length ? (
          <Section title="Follow-ups due" count={week.followupsDue.length}>
            <ul className="divide-y divide-border text-sm">
              {week.followupsDue.map((f, i) => (
                <li key={i} className="flex flex-wrap justify-between gap-2 py-2">
                  {f.href ? <Link href={f.href} className="font-medium hover:underline">{f.name}</Link> : <span className="font-medium">{f.name}</span>}
                  <span className="text-muted-foreground">{f.inGmailSoon ? "Goes to Gmail Drafts automatically" : `Due ${formatDay(f.due)}, send from their page`}</span>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {week.applications.length ? (
          <Section title="Applications due in the next 30 days" count={week.applications.length}>
            <ul className="divide-y divide-border text-sm">
              {week.applications.map((a) => (
                <li key={a.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <span>
                    {a.url ? (
                      <a href={a.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
                        {a.title} <ExternalLink aria-hidden className="inline size-3" />
                      </a>
                    ) : (
                      <span className="font-medium">{a.title}</span>
                    )}
                    <span className="text-muted-foreground"> · {kindLabel(a.kind)}</span>
                  </span>
                  <span className="text-muted-foreground">Apply by {formatDay(a.deadline)}</span>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {week.replies.length ? (
          <Section title="Replies in the last two weeks" count={week.replies.length}>
            <ul className="divide-y divide-border text-sm">
              {week.replies.map((r, i) => (
                <li key={i} className="flex flex-wrap justify-between gap-2 py-2">
                  {r.href ? <Link href={r.href} className="font-medium hover:underline">{r.name}</Link> : <span className="font-medium">{r.name}</span>}
                  <span className="text-muted-foreground">{r.summary} · {formatDay(r.at)}</span>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        <Section title="This month" id="month">
          <p className="text-sm text-muted-foreground">
            The monthly update to people you&apos;ve had an advice call with uses only these. If they haven&apos;t changed since the last update, no update goes out.
          </p>
          <form action={saveMonthFactsAction} className="grid gap-3">
            {(["progress", "ask", "next"] as const).map((k) => (
              <div key={k} className="space-y-1.5">
                <label htmlFor={`month-${k}`} className="text-sm text-muted-foreground">
                  {k === "progress" ? "Progress this month" : k === "ask" ? "One ask" : "What's next"}
                </label>
                <Textarea id={`month-${k}`} name={k} rows={2} defaultValue={month[k]} />
              </div>
            ))}
            <div>
              <Button type="submit" size="lg" variant="outline">Save</Button>
              {month.updatedAt ? <span className="ml-3 text-sm text-muted-foreground">Last changed {formatDay(month.updatedAt)}</span> : null}
            </div>
          </form>
        </Section>
      </div>
    </>
  );
}
