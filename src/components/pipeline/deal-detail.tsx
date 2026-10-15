import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import { ActivityForm } from "@/components/activity/activity-form";
import { Timeline } from "@/components/activity/timeline";
import { AddPersonForm } from "@/components/pipeline/add-person-form";
import { DeleteDealDialog } from "@/components/pipeline/delete-deal-dialog";
import { PageHeader } from "@/components/page-header";
import { TaskForm } from "@/components/tasks/task-form";
import { TaskList } from "@/components/tasks/task-list";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { listDealActivities } from "@/db/queries/activities";
import { getCompanyDeleteImpact, listCompanyContacts } from "@/db/queries/companies";
import { getContactDeleteImpact } from "@/db/queries/contacts";
import { getDeal } from "@/db/queries/deals";
import { listDoneTasks, listOpenTasks } from "@/db/queries/tasks";
import { formatDay, todayString } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { deletionSummary } from "@/lib/delete-summary";
import { FIRM_TYPE_LABELS, getStage, INVESTOR_TYPE_LABELS, investorTypeOf, PIPELINES, type PipelineSection } from "@/lib/sections";
import { OutreachPanel } from "@/components/radar/outreach-panel";
import { getOutreachFor } from "@/db/queries/radar";
import { requireSession } from "@/lib/session";
import { uuid } from "@/lib/validation/common";

export async function loadDeal(section: PipelineSection, rawId: string) {
  const session = await requireSession();
  const id = uuid.safeParse(rawId);
  if (!id.success) notFound();
  const deal = await getDeal(session.user.id, id.data);
  if (!deal || deal.section !== section) notFound();
  return { userId: session.user.id, deal };
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

const str = (value: unknown) => (typeof value === "string" && value ? value : null);

export async function DealDetail({ section, id, outreachError }: { section: PipelineSection; id: string; outreachError?: string }) {
  const { userId, deal } = await loadDeal(section, id);
  const config = PIPELINES[section];
  const stage = getStage(section, deal.stage);
  const type = investorTypeOf(deal.details);
  const company = deal.companyDetails ?? {};
  const contact = deal.contactDetails ?? {};
  const today = todayString();

  const [activities, openTasks, doneTasks, people, impact, outreach] = await Promise.all([
    listDealActivities(userId, deal.id),
    listOpenTasks(userId, { dealId: deal.id }),
    listDoneTasks(userId, { dealId: deal.id, limit: 5 }),
    deal.companyId ? listCompanyContacts(userId, deal.companyId) : Promise.resolve([]),
    deal.companyId
      ? getCompanyDeleteImpact(userId, deal.companyId).then((i) => ({ activities: i.activities, deals: i.deals, tasks: i.tasks, contacts: i.contacts }))
      : deal.contactId
        ? getContactDeleteImpact(userId, deal.contactId).then((i) => ({ ...i, contacts: 0 }))
        : Promise.resolve({ activities: 0, deals: 0, tasks: 0, contacts: 0 }),
    getOutreachFor(userId, { dealId: deal.id }),
  ]);
  const summary = `${deletionSummary(impact).replace("this contact", "this record")}${impact.contacts > 0 ? ` ${impact.contacts} ${impact.contacts === 1 ? "person stays" : "people stay"} but lose the link to this company.` : ""}`;

  return (
    <>
      <Button variant="ghost" size="lg" className="-ml-3 mb-2" render={<Link href={`/${section}`} />}>
        <ArrowLeft aria-hidden />
        {config.label}
      </Button>
      <PageHeader
        title={deal.title}
        accent={section}
        description={[stage?.label, type ? INVESTOR_TYPE_LABELS[type] : null].filter(Boolean).join(" · ")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="lg" render={<Link href={`/${section}/${deal.id}/edit`} />}>
              <Pencil aria-hidden />
              Edit
            </Button>
            <DeleteDealDialog id={deal.id} name={deal.title} summary={summary} />
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          {outreach ? <OutreachPanel userId={userId} outreach={outreach} back={`/${section}/${deal.id}`} error={outreachError} /> : null}
          <Card className="gap-4 p-5">
            <h2 className="font-medium">Next step</h2>
            {deal.nextStep ? (
              <p>
                {deal.nextStep}
                {deal.nextStepDate ? <span className="text-muted-foreground"> · {formatDay(deal.nextStepDate)}</span> : null}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">None set. Use Edit to add one.</p>
            )}
          </Card>

          <Card className="gap-4 p-5">
            <h2 className="font-medium">Tasks</h2>
            <TaskForm dealId={deal.id} />
            {openTasks.length === 0 && doneTasks.length === 0 ? <p className="text-sm text-muted-foreground">No tasks yet.</p> : null}
            {openTasks.length > 0 ? <TaskList tasks={openTasks} today={today} /> : null}
            {doneTasks.length > 0 ? (
              <details className="text-sm">
                <summary className="min-h-11 cursor-pointer py-2.5 text-muted-foreground">Completed ({doneTasks.length})</summary>
                <TaskList tasks={doneTasks} today={today} />
              </details>
            ) : null}
          </Card>

          <Card className="gap-4 p-5">
            <h2 className="font-medium">Log activity</h2>
            <ActivityForm dealId={deal.id} />
          </Card>

          <Card className="gap-2 p-5">
            <h2 className="font-medium">Timeline</h2>
            {activities.length === 0 ? <p className="text-sm text-muted-foreground">Nothing logged yet.</p> : <Timeline items={activities} />}
          </Card>
        </div>

        <div className="space-y-6 self-start">
          <Card className="gap-4 p-5">
            <h2 className="font-medium">Details</h2>
            <dl className="space-y-4 text-sm">
              <Fact label="Stage">{stage?.label ?? deal.stage}</Fact>
              {deal.amountCents !== null ? <Fact label={section === "restaurants" ? "Order value" : "Check size"}>{formatCents(deal.amountCents)}</Fact> : null}
              {section === "restaurants" ? (
                <>
                  {deal.companyCity ? <Fact label="City">{deal.companyCity}</Fact> : null}
                  {str(company.neighborhood) ? <Fact label="Neighborhood">{str(company.neighborhood)}</Fact> : null}
                  {str(company.cuisine) ? <Fact label="Cuisine">{str(company.cuisine)}</Fact> : null}
                  {str(company.currentSupplier) ? <Fact label="Current supplier">{str(company.currentSupplier)}</Fact> : null}
                  {str(company.orderFrequency) ? <Fact label="Order frequency">{str(company.orderFrequency)}</Fact> : null}
                </>
              ) : null}
              {type === "angel" ? (
                <>
                  {deal.contactEmail ? (
                    <Fact label="Email">
                      <a className="text-primary underline underline-offset-4" href={`mailto:${deal.contactEmail}`}>
                        {deal.contactEmail}
                      </a>
                    </Fact>
                  ) : null}
                  {str(contact.background) ? <Fact label="Background"><span className="whitespace-pre-wrap">{str(contact.background)}</span></Fact> : null}
                </>
              ) : null}
              {type === "institution" ? (
                <>
                  {str(company.firmType) ? <Fact label="Firm type">{FIRM_TYPE_LABELS[company.firmType as keyof typeof FIRM_TYPE_LABELS] ?? str(company.firmType)}</Fact> : null}
                  {str(company.focusStage) ? <Fact label="Focus stage">{str(company.focusStage)}</Fact> : null}
                  {str(company.checkSize) ? <Fact label="Check size range">{str(company.checkSize)}</Fact> : null}
                  {str(company.introducedBy) ? <Fact label="Introduced by">{str(company.introducedBy)}</Fact> : null}
                </>
              ) : null}
              <Fact label="Added">{formatDay(deal.createdAt)}</Fact>
              {deal.closedAt ? <Fact label="Closed">{formatDay(deal.closedAt)}</Fact> : null}
            </dl>
          </Card>

          {deal.companyId ? (
            <Card className="gap-4 p-5">
              <h2 className="font-medium">People</h2>
              {people.length === 0 ? (
                <p className="text-sm text-muted-foreground">No one added yet.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {people.map((person) => (
                    <li key={person.id}>
                      <span className="block font-medium">{person.name}</span>
                      <span className="block text-muted-foreground">{[person.title, person.email].filter(Boolean).join(" · ")}</span>
                    </li>
                  ))}
                </ul>
              )}
              <AddPersonForm dealId={deal.id} />
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
