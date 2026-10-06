export type ContactImpact = { activities: number; deals: number; tasks: number };

function noun(n: number, singular: string, plural = `${singular}s`) {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** The sentence a delete confirmation shows: what goes with the record and what stays. */
export function deletionSummary({ activities, deals, tasks }: ContactImpact): string {
  const goes = [
    activities > 0 ? noun(activities, "logged activity", "logged activities") : null,
    deals > 0 ? noun(deals, "deal") : null,
  ]
    .filter(Boolean)
    .join(" and ");
  const stays = tasks > 0 ? ` ${noun(tasks, "task")} will stay but lose the link.` : "";
  return `${goes ? `This also deletes ${goes}.` : "Nothing else is attached to this contact."}${stays}`;
}
