import Link from "next/link";
import { CalendarCheck } from "lucide-react";
import { ReminderBadge } from "@/components/reminder-badge";
import { TaskList } from "@/components/tasks/task-list";
import { PipelineSnapshot } from "@/components/pipeline-snapshot";
import { pipelineSnapshot } from "@/db/queries/dashboard";
import { outreachDraftCounts } from "@/db/queries/radar";
import { relationshipCounts } from "@/db/queries/relationships";
import { formatDay } from "@/lib/dates";
import { listFollowUps } from "@/db/queries/contacts";
import { todayString } from "@/lib/dates";
import { groupOpenTasks } from "@/lib/tasks";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { firstName } from "@/lib/greeting";
import { PRIMARY_NAV, SECTION_STYLES, type SectionAccent } from "@/lib/nav";
import { generalCounts, newOpportunityCountsScoped, openTasks as scopedOpenTasks, recentActivitiesScoped } from "@/db/queries/access";
import { getScope } from "@/lib/scope";
import { cn } from "@/lib/utils";

export const metadata = { title: "Home" };

const SECTION_BLURBS: Record<SectionAccent, string> = {
  restaurants: "Accounts you sell to",
  investors: "Angels and funds you are raising from",
  general: "Friends, family and everyone else",
};

// Tiles come from the nav config so labels, links and icons never drift from the sidebar.
const SECTION_TILES = PRIMARY_NAV.flatMap((item) => (item.accent ? [{ ...item, accent: item.accent }] : []));

export default async function HomePage() {
  const scope = await getScope();
  const today = todayString();
  const [openTasks, followUps, restaurants, investors, recent, fresh, investorRels, generalRels, drafts] = await Promise.all([
    scopedOpenTasks(scope),
    listFollowUps(scope.userId),
    pipelineSnapshot(scope.workspaceId, "restaurants"),
    pipelineSnapshot(scope.workspaceId, "investors"),
    recentActivitiesScoped(scope),
    newOpportunityCountsScoped(scope),
    relationshipCounts(scope.workspaceId, "investors"),
    generalCounts(scope),
    outreachDraftCounts(scope.workspaceId),
  ]);
  const radarLinks = [
    { label: "investors to reach out", n: investorRels.to_reach_out, href: "/investors?rel=to_reach_out" },
    { label: "people to reach out", n: generalRels.to_reach_out, href: "/general?rel=to_reach_out" },
    { label: "ghosted", n: investorRels.ghosted + generalRels.ghosted, href: investorRels.ghosted ? "/investors?rel=ghosted" : "/general?rel=ghosted" },
    { label: "new Sooz opportunities", n: fresh.sooz, href: "/opportunities" },
    { label: "new Personal", n: fresh.personal, href: "/opportunities?feed=personal" },
    { label: "new Career", n: fresh.career, href: "/opportunities?feed=career" },
    { label: drafts.waiting === 1 ? "draft waiting for your approval" : "drafts waiting for your approval", n: drafts.waiting, href: "/week" },
  ].filter((l) => l.n > 0);
  const groups = groupOpenTasks(openTasks, today);
  const dueTasks = [...groups.overdue, ...groups.today];
  const total = dueTasks.length + followUps.length;
  const summary =
    total === 0
      ? "Nothing needs you today."
      : `${total} ${total === 1 ? "thing needs" : "things need"} you today.`;
  return (
    <>
      <PageHeader title={`Welcome back, ${firstName(scope.name)}`} description={summary} />
      <div className="space-y-6">
        <Card className="gap-4 p-5">
          <h2 className="text-base font-medium">Today</h2>
          {total === 0 ? (
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-primary"
              >
                <CalendarCheck className="size-5" />
              </span>
              <p className="text-sm text-muted-foreground">
                You are all caught up. Follow-ups and tasks show up here when they are due.
              </p>
            </div>
          ) : null}
          {dueTasks.length > 0 ? (
            <section aria-labelledby="home-tasks">
              <h3 id="home-tasks" className="mb-1 text-sm font-medium text-muted-foreground">
                Tasks due
              </h3>
              <TaskList tasks={dueTasks} today={today} showContact />
            </section>
          ) : null}
          {followUps.length > 0 ? (
            <section aria-labelledby="home-followups">
              <h3 id="home-followups" className="mb-1 text-sm font-medium text-muted-foreground">
                Follow up
              </h3>
              <ul className="divide-y divide-border">
                {followUps.slice(0, 10).map((contact) => (
                  <li key={contact.id}>
                    <Link
                      href={contact.section === "general" ? `/general/${contact.id}` : `/${contact.section}`}
                      className="flex min-h-14 items-center justify-between gap-4 rounded-xl px-1 py-2 transition-colors hover:bg-accent"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{contact.name}</span>
                        <span className="block truncate text-sm text-muted-foreground capitalize">{contact.section}</span>
                      </span>
                      <ReminderBadge reminder={contact.reminder} />
                    </Link>
                  </li>
                ))}
              </ul>
              {followUps.length > 10 ? (
                <p className="pt-2 text-sm text-muted-foreground">And {followUps.length - 10} more.</p>
              ) : null}
            </section>
          ) : null}
        </Card>
        <Card className="gap-3 p-5">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-base font-medium">Outreach and opportunities</h2>
            <span className="flex gap-4">
              <Link href="/week" className="text-sm text-primary hover:underline">
                This week
              </Link>
              <Link href="/opportunities" className="text-sm text-primary hover:underline">
                Opportunities
              </Link>
            </span>
          </div>
          {radarLinks.length === 0 && drafts.ready === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing new. Research runs Mondays (Sooz) and Thursdays (Personal and Career).</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {drafts.ready > 0 ? (
                <li className="rounded-full bg-accent px-3 py-1.5 text-sm">
                  {drafts.ready} {drafts.ready === 1 ? "draft" : "drafts"} ready to send from the CRM
                </li>
              ) : null}
              {radarLinks.map((l) => (
                <li key={l.label}>
                  <Link href={l.href} className="inline-flex min-h-9 items-center rounded-full border border-input px-3 text-sm hover:bg-accent">
                    {l.n} {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <section aria-labelledby="pipelines-heading">
          <h2 id="pipelines-heading" className="mb-3 text-base font-medium">
            Pipelines
          </h2>
          <div className="grid gap-3 lg:grid-cols-2">
            <PipelineSnapshot snapshot={restaurants} />
            <PipelineSnapshot snapshot={investors} />
          </div>
        </section>
        {recent.length > 0 ? (
          <Card className="gap-2 p-5">
            <h2 className="text-base font-medium">Recent activity</h2>
            <ul className="divide-y divide-border">
              {recent.map((item) => {
                const who = item.contactName ?? item.companyName ?? "Unknown";
                const href = item.dealId && item.dealSection ? `/${item.dealSection}/${item.dealId}` : item.contactSection === "general" && item.contactId ? `/general/${item.contactId}` : null;
                const body = (
                  <>
                    <span className="min-w-0">
                      <span className="block truncate">
                        <span className="font-medium capitalize">{item.type}</span>
                        <span className="text-muted-foreground"> · {item.summary}</span>
                      </span>
                      <span className="block truncate text-sm text-muted-foreground">{who}</span>
                    </span>
                    <time dateTime={item.occurredAt.toISOString()} className="shrink-0 text-sm text-muted-foreground">
                      {formatDay(item.occurredAt)}
                    </time>
                  </>
                );
                return (
                  <li key={item.id}>
                    {href ? (
                      <Link href={href} className="flex min-h-14 items-center justify-between gap-4 rounded-xl px-1 py-2 transition-colors hover:bg-accent">
                        {body}
                      </Link>
                    ) : (
                      <div className="flex min-h-14 items-center justify-between gap-4 px-1 py-2">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        ) : null}
        <section aria-labelledby="sections-heading">
          <h2 id="sections-heading" className="sr-only">
            Sections
          </h2>
          <div className="grid gap-3 lg:grid-cols-3">
            {SECTION_TILES.map(({ href, label, icon: Icon, accent }) => (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-4 rounded-2xl border border-border bg-card p-5 transition-colors hover:border-input lg:flex-col lg:items-start"
              >
                <span
                  aria-hidden
                  className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl", SECTION_STYLES[accent].chip)}
                >
                  <Icon className="size-5" />
                </span>
                <span className="min-w-0 space-y-0.5">
                  <span className="block font-medium">{label}</span>
                  <span className="block text-sm text-muted-foreground">{SECTION_BLURBS[accent]}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
