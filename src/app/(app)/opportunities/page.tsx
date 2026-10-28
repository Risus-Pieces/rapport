import Link from "next/link";
import { Compass, Plus, Search } from "lucide-react";
import { OpportunityCard } from "@/components/opportunities/opportunity-card";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  OPPORTUNITY_SORTS,
  listOpportunities,
  opportunityCounts,
  opportunityKindCounts,
  type OpportunitySort,
} from "@/db/queries/opportunities";
import { recentRadarRuns } from "@/db/queries/radar";
import { OPPORTUNITY_VIEWS, OPPORTUNITY_VIEW_LABELS, isOpportunityView, type OpportunityView } from "@/lib/opportunities";
import { FEEDS, FEED_LABELS, KINDS, isFeed, isPersonKind, kindLabel, type Feed } from "@/lib/radar/types";
import { newOpportunityCountsScoped } from "@/db/queries/access";
import { getScope } from "@/lib/scope";
import { cn } from "@/lib/utils";
import { addOpportunityAction, seeAllOpportunitiesAction } from "./actions";

export const metadata = { title: "Opportunities" };

const BLURBS: Record<Feed, string> = {
  sooz: "Events, sampling slots, funding, competitions and resources for Sooz. People the research finds go straight to the CRM.",
  personal: "Hackathons, Houston events, talks, passes, perks, leadership and culture.",
  career: "Internships, externships, programs, fellowships and scholarships.",
};
const SORT_LABELS: Record<OpportunitySort, string> = { date: "Soonest", score: "Best fit", newest: "Newest" };

type SearchParams = { [key: string]: string | string[] | undefined };
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

function pill(active: boolean) {
  return cn(
    "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm transition-colors",
    active ? "border-primary bg-accent font-medium ring-1 ring-primary" : "border-input hover:bg-accent",
  );
}

export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const scope = await getScope();
  const sp = await searchParams;
  const feed: Feed = isFeed(one(sp.feed)) ? (one(sp.feed) as Feed) : "sooz";
  // The Sooz feed is the shared workspace's; Personal and Career are mine.
  const userId = feed === "sooz" ? scope.workspaceId : scope.userId;
  const view: OpportunityView = isOpportunityView(one(sp.view)) ? (one(sp.view) as OpportunityView) : "to_apply";
  const kindOptions = KINDS[feed].filter((k) => !isPersonKind(k));
  const kind = kindOptions.includes(one(sp.kind)) ? one(sp.kind) : undefined;
  const q = one(sp.q).trim().slice(0, 100) || undefined;
  const rice = one(sp.rice) === "1";
  const err = one(sp.err);
  const added = one(sp.added) === "1";
  const sort = (OPPORTUNITY_SORTS as readonly string[]).includes(one(sp.sort)) ? (one(sp.sort) as OpportunitySort) : "date";

  const state = { feed, view, kind, q, rice, sort };
  const href = (over: Partial<typeof state>) => {
    const s = { ...state, ...over };
    const query = new URLSearchParams();
    if (s.feed !== "sooz") query.set("feed", s.feed);
    if (s.view !== "to_apply") query.set("view", s.view);
    if (s.kind) query.set("kind", s.kind);
    if (s.q) query.set("q", s.q);
    if (s.rice) query.set("rice", "1");
    if (s.sort !== "date") query.set("sort", s.sort);
    const text = query.toString();
    return text ? `/opportunities?${text}` : "/opportunities";
  };

  const [items, counts, kinds, fresh, runs] = await Promise.all([
    listOpportunities(userId, { feed, view, kind, q, rice, sort }),
    opportunityCounts(userId, feed),
    opportunityKindCounts(userId, feed, view),
    newOpportunityCountsScoped(scope),
    recentRadarRuns(scope.workspaceId),
  ]);
  const lastRun = runs.find((r) => r.finishedAt && !r.error);

  return (
    <>
      <PageHeader title="Opportunities" description={`${BLURBS[feed]}${feed === "sooz" ? " Shared with your team." : " Only you see this feed."}`} />

      <nav aria-label="Feeds" className="mb-4 flex flex-wrap gap-2">
        {FEEDS.map((f) => (
          <Link key={f} href={href({ feed: f, view: "to_apply", kind: undefined, q: undefined, rice: false })} aria-current={f === feed ? "page" : undefined} className={pill(f === feed)}>
            {FEED_LABELS[f]}
            {fresh[f] > 0 ? <span className="rounded-full bg-primary px-2 text-xs text-primary-foreground">{fresh[f]}</span> : null}
          </Link>
        ))}
      </nav>

      {err ? (
        <p role="alert" className="mb-4 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          {err}
        </p>
      ) : null}
      {added ? (
        <p role="status" className="mb-4 rounded-xl bg-accent px-4 py-3 text-sm">
          Added to To apply. The weekly research will also look for more like it.
        </p>
      ) : null}

      <details className="mb-6 rounded-2xl border border-border p-4">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 font-medium">
          <Plus aria-hidden className="size-4" />
          Add one you found
        </summary>
        <form action={addOpportunityAction} className="mt-3 grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="feed" value={feed} />
          <label className="grid gap-1 text-sm">
            Name
            <Input name="title" required maxLength={160} placeholder="e.g. NextGen Summit Pitch Competition 2027" />
          </label>
          <label className="grid gap-1 text-sm">
            Link
            <Input name="url" type="url" required placeholder="https://" />
          </label>
          <label className="grid gap-1 text-sm">
            Type
            <select name="kind" defaultValue={kindOptions.includes("funding") ? "funding" : kindOptions[0]} className="h-11 rounded-xl border border-input bg-transparent px-3">
              {kindOptions.map((k) => (
                <option key={k} value={k}>
                  {kindLabel(k)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-h-11 items-center gap-2 self-end text-sm">
            <input type="checkbox" name="pitchCompetition" defaultChecked={feed === "sooz"} className="size-4" />
            It&apos;s a pitch competition (the research will look for more like it)
          </label>
          <label className="grid gap-1 text-sm">
            Apply by
            <Input name="deadline" type="date" />
          </label>
          <label className="grid gap-1 text-sm">
            Event date
            <Input name="eventDate" type="date" />
          </label>
          <label className="grid gap-1 text-sm sm:col-span-2">
            Notes
            <Textarea name="notes" maxLength={4000} placeholder="Who can enter, prize, anything worth remembering" />
          </label>
          <div className="sm:col-span-2">
            <Button type="submit" size="lg">
              Add to To apply
            </Button>
          </div>
        </form>
      </details>

      <div className="mb-6 space-y-3">
        <nav aria-label="Views" className="flex flex-wrap gap-2">
          {OPPORTUNITY_VIEWS.map((v) => (
            <Link key={v} href={href({ view: v, kind: undefined })} aria-current={v === view ? "page" : undefined} className={pill(v === view)}>
              {OPPORTUNITY_VIEW_LABELS[v]} <span className="text-muted-foreground">{counts[v]}</span>
            </Link>
          ))}
        </nav>
        <form action="/opportunities" role="search" className="relative w-full sm:w-72">
          <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <label htmlFor="opportunities-q" className="sr-only">
            Search opportunities
          </label>
          <Input id="opportunities-q" name="q" type="search" defaultValue={q} placeholder="Search names, places, topics" className="pl-10" />
          {feed !== "sooz" ? <input type="hidden" name="feed" value={feed} /> : null}
          {view !== "to_apply" ? <input type="hidden" name="view" value={view} /> : null}
          {kind ? <input type="hidden" name="kind" value={kind} /> : null}
          {rice ? <input type="hidden" name="rice" value="1" /> : null}
        </form>
        <div className="flex flex-wrap gap-2" aria-label="Filters">
          <Link href={href({ kind: undefined })} aria-current={!kind ? "true" : undefined} className={pill(!kind)}>
            All types
          </Link>
          {kindOptions.map((k) => {
            const n = kinds.find((x) => x.kind === k)?.n ?? 0;
            if (!n && k !== kind) return null;
            return (
              <Link key={k} href={href({ kind: k })} aria-current={k === kind ? "true" : undefined} className={pill(k === kind)}>
                {kindLabel(k)} <span className="text-muted-foreground">{n}</span>
              </Link>
            );
          })}
          {feed === "sooz" ? (
            <Link href={href({ rice: !rice })} aria-current={rice ? "true" : undefined} className={pill(rice)}>
              Rice only
            </Link>
          ) : null}
          {OPPORTUNITY_SORTS.map((s) => (
            <Link key={s} href={href({ sort: s })} aria-current={s === sort ? "true" : undefined} className={pill(s === sort)}>
              {SORT_LABELS[s]}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>
            {items.length} shown{items.length === 300 ? "+" : ""}
          </span>
          <span>{lastRun?.finishedAt ? `Last research ${lastRun.finishedAt.toISOString().slice(0, 10)}` : "No research runs yet"}</span>
          {fresh[feed] > 0 ? (
            <form action={seeAllOpportunitiesAction}>
              <input type="hidden" name="feed" value={feed} />
              <Button type="submit" variant="link" className="h-auto p-0">
                Mark all new as seen
              </Button>
            </form>
          ) : null}
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState icon={Compass} title={q || kind || rice ? "No matches" : view === "to_apply" ? "Nothing to apply to" : "Nothing here"}>
          {q || kind || rice
            ? "Try a different search or filter."
            : view === "to_apply"
              ? "The weekly research fills this in (Sooz on Mondays, Personal and Career on Thursdays)."
              : "Nothing in this view yet."}
        </EmptyState>
      ) : (
        <div className="grid gap-4">
          {items.map((item) => (
            <OpportunityCard key={item.id} item={item} />
          ))}
        </div>
      )}

      {runs.length > 0 ? (
        <details className="mt-8 text-sm">
          <summary className="min-h-11 cursor-pointer py-2.5 text-muted-foreground">Recent research runs</summary>
          <ul className="divide-y divide-border">
            {runs.map((r) => (
              <li key={r.id} className="flex flex-wrap gap-x-4 py-2">
                <span className="tabular-nums text-muted-foreground">{r.startedAt.toISOString().slice(0, 16).replace("T", " ")}</span>
                <span>{r.taskId}</span>
                <span className={r.error ? "text-destructive" : "text-muted-foreground"}>
                  {r.error ? r.error.slice(0, 80) : r.finishedAt ? `${r.found} found · ${r.inserted} new` : "running…"}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}
