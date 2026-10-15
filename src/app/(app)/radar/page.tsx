import Link from "next/link";
import { Radar, Search } from "lucide-react";
import { RadarCard } from "@/components/radar/radar-card";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  RADAR_SORTS,
  RADAR_VIEWS,
  listRadar,
  radarCounts,
  radarKindCounts,
  radarNewCounts,
  radarPeopleNewCount,
  recentRadarRuns,
  warmMatches,
  type RadarSort,
  type RadarView,
} from "@/db/queries/radar";
import { KINDS, isPersonKind, kindLabel, type Feed } from "@/lib/radar/types";
import { requireSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { seeAllRadarAction } from "./actions";

export const metadata = { title: "Radar" };

// Four tabs over three feeds: Sooz is split into its people and everything else.
const TABS = [
  { key: "people", label: "Sooz people", feed: "sooz", people: true, blurb: "Angels, brand partners, buyers and press. Approve someone to add them to the CRM." },
  { key: "sooz", label: "Sooz", feed: "sooz", people: false, blurb: "Events, sampling slots, funding and resources for Sooz." },
  { key: "personal", label: "Personal", feed: "personal", people: undefined, blurb: "Hackathons, Houston events, talks, passes, perks, leadership and culture." },
  { key: "career", label: "Career", feed: "career", people: undefined, blurb: "Internships, externships, programs, fellowships and scholarships." },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const VIEW_LABELS: Record<RadarView, string> = { inbox: "Inbox", saved: "Saved", approved: "In CRM", dismissed: "Dismissed" };
const SORT_LABELS: Record<RadarSort, string> = { score: "Best fit", date: "Soonest", newest: "Newest" };
const DATED = new Set(["event", "hackathon", "sampling", "talk", "pass", "speaking", "program", "internship", "externship"]);

type SearchParams = { [key: string]: string | string[] | undefined };
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

function pill(active: boolean) {
  return cn(
    "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm transition-colors",
    active ? "border-primary bg-accent font-medium ring-1 ring-primary" : "border-input hover:bg-accent",
  );
}

export default async function RadarPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireSession();
  const userId = session.user.id;
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === one(sp.tab)) ?? TABS[0];
  const feed = tab.feed as Feed;
  const view = (RADAR_VIEWS as readonly string[]).includes(one(sp.view)) ? (one(sp.view) as RadarView) : "inbox";
  const kindOptions = KINDS[feed].filter((k) => tab.people === undefined || isPersonKind(k) === tab.people);
  const kind = kindOptions.includes(one(sp.kind)) ? one(sp.kind) : undefined;
  const q = one(sp.q).trim().slice(0, 100) || undefined;
  const rice = one(sp.rice) === "1";
  const defaultSort: RadarSort = kind && DATED.has(kind) ? "date" : tab.key === "people" ? "score" : "date";
  const sort = (RADAR_SORTS as readonly string[]).includes(one(sp.sort)) ? (one(sp.sort) as RadarSort) : defaultSort;
  const err = one(sp.err);

  const state: { tab: TabKey; view: RadarView; kind?: string; q?: string; rice: boolean; sort?: RadarSort } = { tab: tab.key, view, kind, q, rice, sort };
  const href = (over: Partial<typeof state>) => {
    const s = { ...state, ...over };
    const query = new URLSearchParams();
    if (s.tab !== "people") query.set("tab", s.tab);
    if (s.view !== "inbox") query.set("view", s.view);
    if (s.kind) query.set("kind", s.kind);
    if (s.q) query.set("q", s.q);
    if (s.rice) query.set("rice", "1");
    if (s.sort && s.sort !== defaultSort) query.set("sort", s.sort);
    const text = query.toString();
    return text ? `/radar?${text}` : "/radar";
  };

  const [items, counts, kinds, newCounts, peopleNew, runs] = await Promise.all([
    listRadar(userId, { feed, view, kind, q, rice, sort, people: tab.people }),
    radarCounts(userId, feed, tab.people),
    radarKindCounts(userId, feed, view, tab.people),
    radarNewCounts(userId),
    radarPeopleNewCount(userId),
    recentRadarRuns(userId),
  ]);
  const warm = await warmMatches(userId, items.filter((i) => isPersonKind(i.kind)).map((i) => i.id));
  const tabNew: Record<TabKey, number> = {
    people: peopleNew,
    sooz: newCounts.sooz - peopleNew,
    personal: newCounts.personal,
    career: newCounts.career,
  };
  const freshHere = tabNew[tab.key];
  const lastRun = runs.find((r) => r.finishedAt && !r.error);
  const back = href({});

  return (
    <>
      <PageHeader title="Radar" description={tab.blurb} />

      <nav aria-label="Feeds" className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link key={t.key} href={href({ tab: t.key, view: "inbox", kind: undefined, q: undefined, rice: false, sort: undefined })} aria-current={t.key === tab.key ? "page" : undefined} className={pill(t.key === tab.key)}>
            {t.label}
            {tabNew[t.key] > 0 ? <span className="rounded-full bg-primary px-2 text-xs text-primary-foreground">{tabNew[t.key]}</span> : null}
          </Link>
        ))}
      </nav>

      {err ? (
        <p role="alert" className="mb-4 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          {err}
        </p>
      ) : null}

      <div className="mb-6 space-y-3">
        <nav aria-label="Views" className="flex flex-wrap gap-2">
          {RADAR_VIEWS.map((v) => (
            <Link key={v} href={href({ view: v, kind: undefined })} aria-current={v === view ? "page" : undefined} className={pill(v === view)}>
              {VIEW_LABELS[v]} <span className="text-muted-foreground">{counts[v]}</span>
            </Link>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-3">
          <form action="/radar" role="search" className="relative w-full sm:w-72">
            <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <label htmlFor="radar-q" className="sr-only">
              Search the radar
            </label>
            <Input id="radar-q" name="q" type="search" defaultValue={q} placeholder="Search names, firms, topics" className="pl-10" />
            {tab.key !== "people" ? <input type="hidden" name="tab" value={tab.key} /> : null}
            {view !== "inbox" ? <input type="hidden" name="view" value={view} /> : null}
            {kind ? <input type="hidden" name="kind" value={kind} /> : null}
            {rice ? <input type="hidden" name="rice" value="1" /> : null}
          </form>
        </div>
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
          {RADAR_SORTS.map((s) => (
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
          {freshHere > 0 ? (
            <form action={seeAllRadarAction}>
              <input type="hidden" name="feed" value={feed} />
              <Button type="submit" variant="link" className="h-auto p-0">
                Mark {feed === "sooz" ? "all Sooz" : "all"} new as seen
              </Button>
            </form>
          ) : null}
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState icon={Radar} title={q || kind || rice ? "No matches" : view === "inbox" ? "Nothing new" : "Nothing here"}>
          {q || kind || rice
            ? "Try a different search or filter."
            : view === "inbox"
              ? "The weekly research fills this in (Sooz on Mondays, Personal and Career on Thursdays)."
              : "Nothing in this view yet."}
        </EmptyState>
      ) : (
        <div className="grid gap-4">
          {items.map((item) => (
            <RadarCard key={item.id} item={item} warm={warm.get(item.id) ?? []} back={back} />
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

