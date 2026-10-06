import { ListChecks } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { TaskForm } from "@/components/tasks/task-form";
import { TaskList } from "@/components/tasks/task-list";
import { Card } from "@/components/ui/card";
import { listDoneTasks, listOpenTasks } from "@/db/queries/tasks";
import { todayString } from "@/lib/dates";
import { requireSession } from "@/lib/session";
import { groupOpenTasks } from "@/lib/tasks";

export const metadata = { title: "Tasks" };

export default async function TasksPage() {
  const session = await requireSession();
  const [open, done] = await Promise.all([listOpenTasks(session.user.id), listDoneTasks(session.user.id)]);
  const today = todayString();
  const groups = groupOpenTasks(open, today);
  const sections = [
    { key: "overdue", title: "Overdue", tasks: groups.overdue },
    { key: "today", title: "Today", tasks: groups.today },
    { key: "upcoming", title: "Upcoming", tasks: groups.upcoming },
    { key: "someday", title: "No due date", tasks: groups.someday },
  ].filter((group) => group.tasks.length > 0);

  return (
    <>
      <PageHeader title="Tasks" description="Things to do, with or without a person attached." />
      <Card className="mb-6 p-5">
        <TaskForm />
      </Card>
      {open.length === 0 ? (
        <EmptyState icon={ListChecks} title="Nothing to do">
          Add a task above, or from a contact&apos;s page to attach it to them.
        </EmptyState>
      ) : (
        <div className="space-y-6">
          {sections.map((group) => (
            <section key={group.key} aria-labelledby={`tasks-${group.key}`}>
              <h2 id={`tasks-${group.key}`} className="mb-2 text-sm font-medium text-muted-foreground">
                {group.title} <span aria-hidden>·</span> {group.tasks.length}
              </h2>
              <Card className="px-3 py-1">
                <TaskList tasks={group.tasks} today={today} showContact />
              </Card>
            </section>
          ))}
        </div>
      )}
      {done.length > 0 ? (
        <details className="mt-8">
          <summary className="min-h-11 cursor-pointer py-2.5 text-sm text-muted-foreground">
            Recently completed ({done.length})
          </summary>
          <Card className="px-3 py-1">
            <TaskList tasks={done} today={today} showContact />
          </Card>
        </details>
      ) : null}
    </>
  );
}
