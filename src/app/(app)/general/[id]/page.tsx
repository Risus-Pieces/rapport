import Link from "next/link";
import { notFound } from "next/navigation";
import { Archive, ArchiveRestore, ArrowLeft, ExternalLink, Pencil } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PriorityMeter } from "@/components/priority-meter";
import { ReminderBadge } from "@/components/reminder-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { listContactActivities } from "@/db/queries/activities";
import { getContact, getContactDeleteImpact } from "@/db/queries/contacts";
import { listDoneTasks, listOpenTasks } from "@/db/queries/tasks";
import { ActivityForm } from "@/components/activity/activity-form";
import { QuickLog } from "@/components/activity/quick-log";
import { Timeline } from "@/components/activity/timeline";
import { TaskForm } from "@/components/tasks/task-form";
import { TaskList } from "@/components/tasks/task-list";
import { formatDay, todayString } from "@/lib/dates";
import { describeLastTouch } from "@/lib/reminders";
import { OutreachPanel } from "@/components/radar/outreach-panel";
import { getOutreachFor } from "@/db/queries/radar";
import { requireSession } from "@/lib/session";
import { uuid } from "@/lib/validation/common";
import { archiveContactAction } from "../actions";
import { DeleteContactDialog } from "../_components/delete-contact-dialog";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const id = uuid.safeParse((await params).id);
  const contact = id.success ? await getContact(session.user.id, id.data) : null;
  return { title: contact?.name ?? "Contact" };
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

export default async function ContactPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const outreachError = (await searchParams).outreachError;
  const session = await requireSession();
  const id = uuid.safeParse((await params).id);
  if (!id.success) notFound();
  const contact = await getContact(session.user.id, id.data);
  if (!contact || contact.section !== "general") notFound();
  const [impact, activities, openTasks, doneTasks, outreach] = await Promise.all([
    getContactDeleteImpact(session.user.id, contact.id),
    listContactActivities(session.user.id, contact.id),
    listOpenTasks(session.user.id, { contactId: contact.id }),
    listDoneTasks(session.user.id, { contactId: contact.id, limit: 5 }),
    getOutreachFor(session.user.id, { contactId: contact.id }),
  ]);
  const today = todayString();
  const archived = contact.archivedAt !== null;

  return (
    <>
      <Button variant="ghost" size="lg" className="-ml-3 mb-2" render={<Link href="/general" />}>
        <ArrowLeft aria-hidden />
        General
      </Button>
      <PageHeader
        title={contact.name}
        accent="general"
        description={archived ? "Archived. Restore to get reminders again." : (contact.title ?? undefined)}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="lg" render={<Link href={`/general/${contact.id}/edit`} />}>
              <Pencil aria-hidden />
              Edit
            </Button>
            <form action={archiveContactAction}>
              <input type="hidden" name="id" value={contact.id} />
              <input type="hidden" name="archived" value={archived ? "false" : "true"} />
              <Button type="submit" variant="outline" size="lg">
                {archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
                {archived ? "Restore" : "Archive"}
              </Button>
            </form>
            <DeleteContactDialog id={contact.id} name={contact.name} impact={impact} />
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          {outreach ? (
            <OutreachPanel
              userId={session.user.id}
              outreach={outreach}
              back={`/general/${contact.id}`}
              error={typeof outreachError === "string" ? outreachError : undefined}
            />
          ) : null}
          <Card className="gap-4 p-5">
            <h2 className="font-medium">Stay in touch</h2>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <PriorityMeter priority={contact.priority} />
              <ReminderBadge reminder={contact.reminder} />
              <span className="text-sm text-muted-foreground">
                {describeLastTouch(contact.reminder.daysSince, contact.lastTouchAt !== null)}
              </span>
            </div>
            <QuickLog contactId={contact.id} />
          </Card>

          <Card className="gap-4 p-5">
            <h2 className="font-medium">Tasks</h2>
            <TaskForm contactId={contact.id} />
            {openTasks.length === 0 && doneTasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tasks for {contact.name} yet.</p>
            ) : null}
            {openTasks.length > 0 ? <TaskList tasks={openTasks} today={today} /> : null}
            {doneTasks.length > 0 ? (
              <details className="text-sm">
                <summary className="min-h-11 cursor-pointer py-2.5 text-muted-foreground">
                  Completed ({doneTasks.length})
                </summary>
                <TaskList tasks={doneTasks} today={today} />
              </details>
            ) : null}
          </Card>

          <Card className="gap-4 p-5">
            <h2 className="font-medium">Log activity</h2>
            <ActivityForm contactId={contact.id} />
          </Card>

          <Card className="gap-2 p-5">
            <h2 className="font-medium">Timeline</h2>
            {activities.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing logged yet. Log a call, email or meeting above.</p>
            ) : (
              <Timeline items={activities} />
            )}
          </Card>
        </div>

        <Card className="gap-4 self-start p-5">
          <h2 className="font-medium">Details</h2>
          <dl className="space-y-4 text-sm">
            {contact.email ? (
              <Fact label="Email">
                <a className="text-primary underline underline-offset-4" href={`mailto:${contact.email}`}>
                  {contact.email}
                </a>
              </Fact>
            ) : null}
            {contact.phone ? (
              <Fact label="Phone">
                <a className="text-primary underline underline-offset-4" href={`tel:${contact.phone}`}>
                  {contact.phone}
                </a>
              </Fact>
            ) : null}
            {contact.linkedinUrl ? (
              <Fact label="LinkedIn">
                <a
                  className="inline-flex items-center gap-1 text-primary underline underline-offset-4"
                  href={contact.linkedinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open profile <ExternalLink aria-hidden className="size-3.5" />
                </a>
              </Fact>
            ) : null}
            {contact.tags.length > 0 ? <Fact label="Tags">{contact.tags.join(", ")}</Fact> : null}
            {contact.notes ? <Fact label="Notes"><span className="whitespace-pre-wrap">{contact.notes}</span></Fact> : null}
            <Fact label="Added">{formatDay(contact.createdAt)}</Fact>
          </dl>
        </Card>
      </div>
    </>
  );
}
