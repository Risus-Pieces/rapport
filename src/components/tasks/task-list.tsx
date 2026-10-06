import Link from "next/link";
import { CircleAlert, Circle, CircleCheck } from "lucide-react";
import { deleteTaskAction, toggleTaskAction } from "@/app/actions/records";
import { ConfirmDelete } from "@/components/confirm-delete";
import { Button } from "@/components/ui/button";
import type { TaskRow } from "@/db/queries/tasks";
import { formatDay } from "@/lib/dates";

type TaskListProps = {
  tasks: TaskRow[];
  today: string;
  showContact?: boolean;
};

export function TaskList({ tasks, today, showContact = false }: TaskListProps) {
  return (
    <ul className="divide-y divide-border">
      {tasks.map((task) => {
        const done = task.doneAt !== null;
        const overdue = !done && task.dueDate !== null && task.dueDate < today;
        return (
          <li key={task.id} className="flex items-center gap-1 py-1">
            <form action={toggleTaskAction}>
              <input type="hidden" name="id" value={task.id} />
              <input type="hidden" name="done" value={done ? "false" : "true"} />
              <Button type="submit" variant="ghost" size="icon-lg" aria-label={done ? `Reopen ${task.title}` : `Mark ${task.title} done`}>
                {done ? <CircleCheck aria-hidden className="text-primary" /> : <Circle aria-hidden />}
              </Button>
            </form>
            <div className="min-w-0 flex-1 py-1">
              <p className={done ? "text-muted-foreground line-through" : undefined}>{task.title}</p>
              <p className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
                {task.dueDate ? (
                  <span className="inline-flex items-center gap-1">
                    {overdue ? <CircleAlert aria-hidden className="size-3.5 text-destructive" /> : null}
                    {overdue ? "Overdue · " : "Due "}
                    {formatDay(task.dueDate)}
                  </span>
                ) : (
                  <span>No due date</span>
                )}
                {showContact && task.contactId && task.contactName ? (
                  // Only General has contact pages so far; other sections get theirs in Phase 4.
                  task.contactSection === "general" ? (
                    <Link className="underline underline-offset-4 hover:text-foreground" href={`/general/${task.contactId}`}>
                      {task.contactName}
                    </Link>
                  ) : (
                    <span>{task.contactName}</span>
                  )
                ) : null}
              </p>
            </div>
            <ConfirmDelete
              id={task.id}
              action={deleteTaskAction}
              label={`task ${task.title}`}
              title="Delete this task?"
              description="This cannot be undone."
            />
          </li>
        );
      })}
    </ul>
  );
}
