import Link from "next/link";
import { Plus, Search, Users } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PriorityMeter } from "@/components/priority-meter";
import { ReminderBadge } from "@/components/reminder-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { listContacts } from "@/db/queries/contacts";
import { describeLastTouch } from "@/lib/reminders";
import { requireSession } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata = { title: "General" };

const FILTERS = [
  { key: "all", label: "All" },
  { key: "overdue", label: "Overdue" },
  { key: "due_soon", label: "Due soon" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function hrefFor(params: { filter?: FilterKey; q?: string; archived?: boolean }) {
  const query = new URLSearchParams();
  if (params.filter && params.filter !== "all") query.set("filter", params.filter);
  if (params.q) query.set("q", params.q);
  if (params.archived) query.set("archived", "1");
  const text = query.toString();
  return text ? `/general?${text}` : "/general";
}

export default async function GeneralPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireSession();
  const sp = await searchParams;
  const q = one(sp.q).trim().slice(0, 100);
  const archived = one(sp.archived) === "1";
  const requested = one(sp.filter);
  const filter: FilterKey = FILTERS.some((f) => f.key === requested) ? (requested as FilterKey) : "all";

  const all = await listContacts(session.user.id, "general", { archived, q });
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

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <form action="/general" role="search" className="relative w-full sm:w-72">
          <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <label htmlFor="q" className="sr-only">
            Search contacts
          </label>
          <Input id="q" name="q" type="search" defaultValue={q} placeholder="Search name, email or role" className="pl-10" />
          {archived ? <input type="hidden" name="archived" value="1" /> : null}
        </form>
        <nav aria-label="Filter contacts" className="flex flex-wrap gap-2">
          {FILTERS.map(({ key, label }) => {
            const active = filter === key;
            return (
              <Link
                key={key}
                href={hrefFor({ filter: key, q, archived })}
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
          <Link
            href={hrefFor({ filter, q, archived: !archived })}
            className="inline-flex min-h-11 items-center rounded-full px-4 text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            {archived ? "Hide archived" : "Show archived"}
          </Link>
        </nav>
      </div>

      {shown.length === 0 ? (
        all.length === 0 && !q && !archived ? (
          <EmptyState icon={Users} title="No contacts yet">
            Add the people you want to stay in touch with and set how often you want to reach out.
          </EmptyState>
        ) : (
          <EmptyState icon={Users} title={archived ? "Nothing archived here" : "No matches"}>
            {q ? `No contacts match "${q}".` : "Try another filter."}
          </EmptyState>
        )
      ) : (
        <Card className="p-2">
          <ul>
            {shown.map((contact) => (
              <li key={contact.id}>
                <Link
                  href={`/general/${contact.id}`}
                  className="flex min-h-16 flex-wrap items-center gap-x-6 gap-y-2 rounded-xl px-3 py-3 transition-colors hover:bg-accent"
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
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
