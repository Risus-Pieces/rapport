import Link from "next/link";
import { Building2, Landmark, Plus, Search, UserRound, UtensilsCrossed } from "lucide-react";
import { Board } from "@/components/pipeline/board";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { listCompanies } from "@/db/queries/companies";
import { listContacts } from "@/db/queries/contacts";
import { listDeals } from "@/db/queries/deals";
import { formatDay } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import {
  getStage,
  INVESTOR_TYPE_LABELS,
  INVESTOR_TYPES,
  investorTypeOf,
  PIPELINES,
  type InvestorType,
  type PipelineSection,
} from "@/lib/sections";
import { RaiseProgressBar } from "@/components/raise/raise-progress";
import { raiseProgress } from "@/db/queries/raise";
import { refreshGhosted, relationshipCounts } from "@/db/queries/relationships";
import { MOVES_FROM, RelationshipButton } from "@/components/relationship-control";
import { RELATIONSHIP_LABELS, isRelationship, type Relationship } from "@/lib/relationships";
import { getScope } from "@/lib/scope";
import { cn } from "@/lib/utils";

const VIEWS = [
  { key: "pipeline", label: "Pipeline" },
  { key: "list", label: "List" },
  { key: "people", label: "People" },
  { key: "companies", label: "Companies" },
] as const;
type ViewKey = (typeof VIEWS)[number]["key"];

type SearchParams = { [key: string]: string | string[] | undefined };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

// Know them is the pipeline board; the other relationships are lists with quick moves.
const RELATIONSHIP_TABS: Relationship[] = ["to_reach_out", "known", "ghosted", "on_hold", "dismissed"];

const DESCRIPTIONS: Record<PipelineSection, string> = {
  restaurants: "Restaurants you are selling to, from first lead to active account.",
  investors: "Angels and institutions you are raising from.",
};

function pill(active: boolean) {
  return cn(
    "inline-flex min-h-11 items-center rounded-full border px-4 text-sm transition-colors",
    active ? "border-primary bg-accent font-medium ring-1 ring-primary" : "border-input hover:bg-accent",
  );
}

export async function SectionPage({ section, searchParams }: { section: PipelineSection; searchParams: SearchParams }) {
  // Restaurants and Investors are the shared Sooz workspace.
  const userId = (await getScope()).workspaceId;
  const requestedView = one(searchParams.view);
  const view: ViewKey = VIEWS.some((v) => v.key === requestedView) ? (requestedView as ViewKey) : "pipeline";
  const q = one(searchParams.q).trim().slice(0, 100);
  const requestedRel = one(searchParams.rel);
  const rel: Relationship = isRelationship(requestedRel) ? requestedRel : "known";
  const requestedType = one(searchParams.type);
  const type: InvestorType | undefined =
    section === "investors" && INVESTOR_TYPES.includes(requestedType as InvestorType) ? (requestedType as InvestorType) : undefined;
  const config = PIPELINES[section];
  const base = `/${section}`;
  const href = (params: { view?: ViewKey; type?: InvestorType; q?: string; rel?: Relationship }) => {
    const query = new URLSearchParams();
    if (params.rel && params.rel !== "known") query.set("rel", params.rel);
    if (params.view && params.view !== "pipeline") query.set("view", params.view);
    if (params.type) query.set("type", params.type);
    if (params.q) query.set("q", params.q);
    const text = query.toString();
    return text ? `${base}?${text}` : base;
  };

  const dealsView = view === "pipeline" || view === "list";
  await refreshGhosted(userId);
  const [deals, relCounts] = await Promise.all([
    dealsView ? listDeals(userId, section, { type, q, relationship: rel }) : Promise.resolve([]),
    relationshipCounts(userId, section),
  ]);
  const showBoard = view === "pipeline" && rel === "known";
  const back = href({ view, type, q, rel });
  const people = view === "people" ? await listContacts(userId, section, { q }) : [];
  const companies = view === "companies" ? await listCompanies(userId, section, { q }) : [];
  const progress = section === "investors" ? await raiseProgress(userId) : null;
  const Icon = section === "restaurants" ? UtensilsCrossed : Landmark;

  return (
    <>
      <PageHeader
        title={config.label}
        accent={section}
        description={DESCRIPTIONS[section]}
        actions={
          <Button size="lg" render={<Link href={`${base}/new`} />}>
            <Plus aria-hidden />
            Add {config.noun}
          </Button>
        }
      />

      {progress ? (
        <Link href="/week" className="mb-6 block max-w-xl rounded-2xl border border-border p-4 transition-colors hover:border-input">
          <RaiseProgressBar progress={progress} compact />
        </Link>
      ) : null}

      <div className="mb-6 space-y-3">
        <nav aria-label="Relationship" className="flex flex-wrap gap-2">
          {RELATIONSHIP_TABS.map((r) => (
            <Link key={r} href={href({ rel: r, view: r === "known" ? view : "list", type, q })} aria-current={rel === r ? "page" : undefined} className={pill(rel === r)}>
              {RELATIONSHIP_LABELS[r]}
              <span className="ml-2 text-muted-foreground">{relCounts[r]}</span>
            </Link>
          ))}
        </nav>
        <nav aria-label="Views" className="flex flex-wrap gap-2">
          {VIEWS.filter(({ key }) => rel === "known" || key !== "pipeline").map(({ key, label }) => (
            <Link key={key} href={href({ view: key, type, q, rel })} aria-current={view === key || (key === "list" && view === "pipeline" && !showBoard) ? "page" : undefined} className={pill(view === key || (key === "list" && view === "pipeline" && !showBoard))}>
              {label}
            </Link>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-3">
          <form action={base} role="search" className="relative w-full sm:w-72">
            <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <label htmlFor="q" className="sr-only">
              Search {config.label.toLowerCase()}
            </label>
            <Input id="q" name="q" type="search" defaultValue={q} placeholder="Search" className="pl-10" />
            {view !== "pipeline" ? <input type="hidden" name="view" value={view} /> : null}
            {rel !== "known" ? <input type="hidden" name="rel" value={rel} /> : null}
            {type ? <input type="hidden" name="type" value={type} /> : null}
          </form>
          {section === "investors" && dealsView ? (
            <nav aria-label="Investor type" className="flex flex-wrap gap-2">
              <Link href={href({ view, q, rel })} aria-current={!type ? "true" : undefined} className={pill(!type)}>
                All
              </Link>
              {INVESTOR_TYPES.map((t) => (
                <Link key={t} href={href({ view, type: t, q, rel })} aria-current={type === t ? "true" : undefined} className={pill(type === t)}>
                  {INVESTOR_TYPE_LABELS[t]}s
                </Link>
              ))}
            </nav>
          ) : null}
        </div>
      </div>

      {dealsView && deals.length === 0 ? (
        <EmptyState icon={Icon} title={q || type ? "No matches" : rel === "known" ? `No ${config.noun}s yet` : "Nobody here"}>
          {q || type
            ? "Try a different search or filter."
            : rel === "known"
              ? `Add your first ${config.noun} to start the pipeline.`
              : rel === "to_reach_out"
                ? "People the research finds, and ones you add at the first stage, show up here until you reach out."
                : "Nobody in this list right now."}
        </EmptyState>
      ) : null}

      {showBoard && deals.length > 0 ? <Board section={section} deals={deals} locked={Boolean(q || type)} /> : null}

      {dealsView && !showBoard && deals.length > 0 ? (
        <Card className="p-2">
          <ul>
            {deals.map((deal) => {
              const stage = getStage(section, deal.stage);
              const investorType = investorTypeOf(deal.details);
              return (
                <li key={deal.id} className="flex flex-wrap items-center gap-2">
                  <Link href={`${base}/${deal.id}`} className="flex min-h-16 min-w-0 flex-1 basis-80 flex-wrap items-center gap-x-6 gap-y-1 rounded-xl px-3 py-3 transition-colors hover:bg-accent">
                    <span className="min-w-0 flex-1 basis-48">
                      <span className="block truncate font-medium">{deal.title}</span>
                      <span className="block truncate text-sm text-muted-foreground">
                        {[investorType ? INVESTOR_TYPE_LABELS[investorType] : null, deal.nextStep ? `Next: ${deal.nextStep}${deal.nextStepDate ? ` · ${formatDay(deal.nextStepDate)}` : ""}` : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    <span className="w-28 text-sm">{stage?.label ?? deal.stage}</span>
                    <span className="w-24 text-right text-sm text-muted-foreground">{formatCents(deal.amountCents)}</span>
                  </Link>
                  {rel !== "known" ? (
                    <span className="flex flex-wrap gap-1 px-2 pb-2 sm:pb-0">
                      {MOVES_FROM[rel].map((move) => (
                        <RelationshipButton key={move} kind="deal" id={deal.id} move={move} back={back} variant="ghost" />
                      ))}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      {view === "people" ? (
        people.length === 0 ? (
          <EmptyState icon={UserRound} title="No people yet">
            Add owners, chefs or partners from a {config.noun}&apos;s page.
          </EmptyState>
        ) : (
          <Card className="p-2">
            <ul>
              {people.map((person) => (
                <li key={person.id} className="rounded-xl px-3 py-3">
                  <span className="block font-medium">{person.name}</span>
                  <span className="block text-sm text-muted-foreground">
                    {[person.title, person.companyName, person.email].filter(Boolean).join(" · ") || "No details"}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )
      ) : null}

      {view === "companies" ? (
        companies.length === 0 ? (
          <EmptyState icon={Building2} title="No companies yet">
            Companies appear when you add a {section === "restaurants" ? "restaurant" : "firm"}.
          </EmptyState>
        ) : (
          <Card className="p-2">
            <ul>
              {companies.map((company) => (
                <li key={company.id} className="rounded-xl px-3 py-3">
                  <span className="block font-medium">{company.name}</span>
                  <span className="block text-sm text-muted-foreground">{company.city ?? "No city"}</span>
                </li>
              ))}
            </ul>
          </Card>
        )
      ) : null}
    </>
  );
}
