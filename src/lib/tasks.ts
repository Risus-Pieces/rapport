export type TaskLike = { id: string; dueDate: string | null };

export type TaskGroups<T extends TaskLike> = {
  overdue: T[];
  today: T[];
  upcoming: T[];
  someday: T[];
};

/**
 * Splits open tasks into overdue, due today, upcoming and undated, each ordered by due date.
 * Dates are YYYY-MM-DD strings, which compare correctly as text.
 */
export function groupOpenTasks<T extends TaskLike>(tasks: T[], today: string): TaskGroups<T> {
  const byDate = (a: T, b: T) => (a.dueDate ?? "").localeCompare(b.dueDate ?? "");
  const dated = tasks.filter((t) => t.dueDate !== null).sort(byDate);
  return {
    overdue: dated.filter((t) => t.dueDate! < today),
    today: dated.filter((t) => t.dueDate === today),
    upcoming: dated.filter((t) => t.dueDate! > today),
    someday: tasks.filter((t) => t.dueDate === null),
  };
}
