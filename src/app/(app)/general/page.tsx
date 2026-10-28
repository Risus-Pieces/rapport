import Link from "next/link";
import { Plus, Search, Users } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PriorityMeter } from "@/components/priority-meter";
import { ReminderBadge } from "@/components/reminder-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { refreshGhosted } from "@/db/queries/relationships";
import { MOVES_FROM, RelationshipButton } from "@/components/relationship-control";
import { RELATIONSHIP_LABELS, isRelationship, type Relationship } from "@/lib/relationships";
import { describeLastTouch } from "@/lib/reminders";
import { generalCounts, listGeneral } from "@/db/queries/access";
import { getScope } from "@/lib/scope";
import { cn } from "@/lib/utils";

export const metadata = { title: "General" };

const FILTERS = [
  { key: "all", label: "All" },
  { key: "overdue", label: "Overdue" },
  { key: "due_soon", label: "Due soon" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];
const RELATIONSHIP_TABS: Relationship[] = ["to_reach_out", "known", "ghosted", "on_hold", "dismissed"];

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function hrefFor(params: { filter?: FilterKey; q?: string; rel?: Relationship }) {
  const query = new URLSearchParams();
  if (params.rel && params.rel !== "known") query.set("rel", params.rel);
  if (params.filter && params.filter !== "all") query.set("filter", params.filter);
  if (params.q) query.set("q", params.q);
  const text = query.toString();
  return text ? `/general?${text}` : "/general";
}

export default async function GeneralPage({ searchParams }: { searchParams: SearchParams }) {
  const scope = await getScope();
  const sp = await searchParams;
  const q = one(sp.q).trim().slice(0, 100);
  // ?archived=1 is the old link for what is now On hold.
  const requestedRel = one(sp.rel) || (one(sp.archived) === "1" ? "on_hold" : "");
  const rel: Relationship = isRelationship(requestedRel) ? requestedRel : "known";
  const requested = one(sp.filter);
  const filter: FilterKey = rel === "known" && FILTERS.some((f) => f.key === requested) ? (requested as FilterKey) : "all";

  await refreshGhosted(scope.workspaceId);
  const [all, relCounts] = await Promise.all([listGeneral(scope, { q, relationship: rel }), generalCounts(scope)]);
  const back = hrefFor({ filter, q, rel });
  const counts = {
    all: all.length,
    overdue: all.filter((c) => c.reminder.status === "overdue").length,
    due_soon: all.filter((c) => c.reminder.status === "due_soon").length,
  };
  const shown = filter === "all" ? all : all.filter((c) => c.reminder.status === filter);

  return (
    <>
      <PageHeader
        title="General"
        accent="general"
        description="Friends, family and professional contacts, and who to reach out to next."
        actions={
          <Button size="lg" render={<Link href="/general/new" />}>
            <Plus aria-hidden />
            Add contact
          </Button>
        }
      />

      <nav aria-label="Relationship" className="mb-3 flex flex-wrap gap-2">
        {RELATIONSHIP_TABS.map((r) => (
          <Link
            key={r}
            href={hrefFor({ q, rel: r })}
            aria-current={rel === r ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm transition-colors",
              rel === r ? "border-primary bg-accent font-medium ring-1 ring-primary" : "border-input hover:bg-accent",
            )}
          >
            {RELATIONSHIP_LABELS[r]}
            <span className="text-muted-foreground">{relCounts[r]}</span>
          </Link>
        ))}
      </nav>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <form action="/general" role="search" className="relative w-full sm:w-72">
          <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <label htmlFor="q" className="sr-only">
            Search contacts
          </label>
          <Input id="q" name="q" type="search" defaultValue={q} placeholder="Search name, email or role" className="pl-10" />
          {rel !== "known" ? <input type="hidden" name="rel" value={rel} /> : null}
        </form>
        {rel === "known" ? (
          <nav aria-label="Filter contacts" className="flex flex-wrap gap-2">
            {FILTERS.map(({ key, label }) => {
              const active = filter === key;
              return (
                <Link
                  key={key}
                  href={hrefFor({ filter: key, q })}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm transition-colors",
                    active
                      ? "border-primary bg-accent font-medium ring-1 ring-primary"
                      : "border-input hover:bg-accent",
                  )}
                >
                  {label}
                  <span className="text-muted-foreground">{counts[key]}</span>
                </Link>
              );
            })}
          </nav>
        ) : null}
      </div>

      {shown.length === 0 ? (
        all.length === 0 && !q && rel === "known" && relCounts.known === 0 ? (
          <EmptyState icon={Users} title="No contacts yet">
            Add the people you want to stay in touch with and set how often you want to reach out.
          </EmptyState>
        ) : (
          <EmptyState icon={Users} title={q ? "No matches" : rel === "known" ? "No matches" : "Nobody here"}>
            {q
              ? `No contacts match "${q}".`
              : rel === "to_reach_out"
                ? "Creators, celebrities and press the research finds show up here until you reach out."
                : rel === "known"
                  ? "Try another filter."
                  : "Nobody in this list right now."}
          </EmptyState>
        )
      ) : (
        <div className="space-y-6">
          {[
            { key: "sooz", label: "Sooz people", hint: "Shared with your team", items: shown.filter((c) => c.shared) },
            { key: "mine", label: "Yours", hint: "Only you see these", items: shown.filter((c) => !c.shared) },
          ]
            .filter((group) => group.items.length > 0)
            .map((group) => (
              <section key={group.key} aria-label={group.label} className="space-y-2">
                <h2 className="flex items-baseline gap-2 px-1 text-sm font-medium">
                  {group.label} <span className="font-normal text-muted-foreground">{group.hint}</span>
                </h2>
                  <Card className="p-2">
                    <ul>
                      {group.items.map((contact) => (
                        <li key={contact.id} className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/general/${contact.id}`}
                            className="flex min-h-16 min-w-0 flex-1 basis-80 flex-wrap items-center gap-x-6 gap-y-2 rounded-xl px-3 py-3 transition-colors hover:bg-accent"
                          >
                            <span className="min-w-0 flex-1 basis-48">
                              <span className="block truncate font-medium">{contact.name}</span>
                              <span className="block truncate text-sm text-muted-foreground">
                                {[contact.title, describeLastTouch(contact.reminder.daysSince, contact.lastTouchAt !== null)]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </span>
                            </span>
                            <PriorityMeter priority={contact.priority} className="w-36 shrink-0 text-muted-foreground" />
                            <span className="flex min-w-28 justify-end">
                              <ReminderBadge reminder={contact.reminder} />
                            </span>
                          </Link>
                          {rel !== "known" ? (
                            <span className="flex flex-wrap gap-1 px-2 pb-2 sm:pb-0">
                              {MOVES_FROM[rel].map((move) => (
                                <RelationshipButton key={move} kind="contact" id={contact.id} move={move} back={back} variant="ghost" />
                              ))}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </Card>
              </section>
            ))}
        </div>
      )}
    </>
  );
}
