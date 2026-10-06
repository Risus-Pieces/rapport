import Link from "next/link";
import { CalendarCheck } from "lucide-react";
import { ReminderBadge } from "@/components/reminder-badge";
import { TaskList } from "@/components/tasks/task-list";
import { PipelineSnapshot } from "@/components/pipeline-snapshot";
import { pipelineSnapshot, recentActivities } from "@/db/queries/dashboard";
import { formatDay } from "@/lib/dates";
import { listFollowUps } from "@/db/queries/contacts";
import { listOpenTasks } from "@/db/queries/tasks";
import { todayString } from "@/lib/dates";
import { groupOpenTasks } from "@/lib/tasks";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { firstName } from "@/lib/greeting";
import { PRIMARY_NAV, SECTION_STYLES, type SectionAccent } from "@/lib/nav";
import { requireSession } from "@/lib/session";
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
  const session = await requireSession();
  const today = todayString();
  const [openTasks, followUps, restaurants, investors, recent] = await Promise.all([
    listOpenTasks(session.user.id),
    listFollowUps(session.user.id),
    pipelineSnapshot(session.user.id, "restaurants"),
    pipelineSnapshot(session.user.id, "investors"),
    recentActivities(session.user.id),
  ]);
  const groups = groupOpenTasks(openTasks, today);
  const dueTasks = [...groups.overdue, ...groups.today];
  const total = dueTasks.length + followUps.length;
  const summary =
    total === 0
      ? "Nothing needs you today."
      : `${total} ${total === 1 ? "thing needs" : "things need"} you today.`;
  return (
    <>
      <PageHeader title={`Welcome back, ${firstName(session.user.name)}`} description={summary} />
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
