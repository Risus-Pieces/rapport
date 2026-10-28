import { Download } from "lucide-react";
import { ImportForm } from "@/components/import-form";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EXPORT_KINDS } from "@/db/queries/export";
import { PIPELINES } from "@/lib/sections";
import { importConnectionsAction, importPeopleAction, savePitchAction } from "@/app/actions/outreach";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getPitch, networkSize } from "@/db/queries/radar";
import { PITCH_FIELDS } from "@/lib/radar/drafts";
import { addMemberAction, removeMemberAction } from "@/app/actions/members";
import { listMembers } from "@/db/queries/members";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";
import { getScope } from "@/lib/scope";
import { requireSession } from "@/lib/session";

export const metadata = { title: "Settings" };

const EXPORT_LABELS: Record<(typeof EXPORT_KINDS)[number], string> = {
  contacts: "Contacts",
  companies: "Companies",
  deals: "Deals",
  activities: "Activities",
  tasks: "Tasks",
  radar: "Radar",
};

type SearchParams = { [key: string]: string | string[] | undefined };
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function SettingsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const scope = await getScope();
  const [pitch, net, team] = await Promise.all([
    getPitch(scope.workspaceId),
    networkSize(scope.userId),
    scope.isOwner ? listMembers(scope.userId) : Promise.resolve([]),
  ]);
  const err = one(sp.err);
  const ok =
    one(sp.member) === "added"
      ? "Added. They can sign in now with that email and password."
      : one(sp.member) === "removed"
        ? "Removed."
        : one(sp.saved) === "pitch"
      ? "Pitch facts saved."
      : one(sp.network)
        ? `Imported ${one(sp.network)} connections.`
        : one(sp.imported) !== undefined
          ? `Added ${one(sp.imported)} of ${one(sp.received)} people to the Radar.`
          : null;
  return (
    <>
      <PageHeader title="Settings" description="Backups, import, pipeline stages and your account." />
      <div className="grid max-w-3xl gap-6">
        {err ? (
          <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
            {err}
          </p>
        ) : null}
        {ok ? (
          <p role="status" className="rounded-xl bg-accent px-4 py-3 text-sm">
            {ok}
          </p>
        ) : null}

        <Card id="pitch" className="scroll-mt-6 gap-4 p-5">
          <div className="space-y-1">
            <h2 className="font-medium">Pitch facts</h2>
            <p className="text-sm text-muted-foreground">
              Outreach drafts use only these facts plus each person&apos;s public, sourced background. Leave anything unverified blank.
            </p>
          </div>
          <form action={savePitchAction} className="grid gap-3 sm:grid-cols-2">
            {PITCH_FIELDS.map((f) => {
              const long = f.key === "pitch.one_liner" || f.key === "pitch.traction";
              const id = `pitch-${f.key.slice(6)}`;
              return (
                <div key={f.key} className={long ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}>
                  <label htmlFor={id} className="text-sm text-muted-foreground">
                    {f.label}
                  </label>
                  {long ? (
                    <Textarea id={id} name={f.key} rows={2} defaultValue={pitch[f.key] ?? ""} placeholder={f.placeholder} />
                  ) : (
                    <Input id={id} name={f.key} defaultValue={pitch[f.key] ?? ""} placeholder={f.placeholder} />
                  )}
                </div>
              );
            })}
            <div className="sm:col-span-2">
              <Button type="submit" size="lg">
                Save pitch facts
              </Button>
            </div>
          </form>
        </Card>

        <Card id="network" className="scroll-mt-6 gap-4 p-5">
          <div className="space-y-1">
            <h2 className="font-medium">LinkedIn connections ({net})</h2>
            <p className="text-sm text-muted-foreground">
              LinkedIn → Settings &amp; Privacy → Data privacy → Get a copy of your data → <b>Connections</b>. Upload the Connections.csv; radar
              cards and outreach panels then show who you already know at each person&apos;s firm.
            </p>
          </div>
          <form action={importConnectionsAction} className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <label htmlFor="connections-file" className="text-sm text-muted-foreground">
                Connections.csv
              </label>
              <Input id="connections-file" name="file" type="file" accept=".csv,text/csv" required className="h-auto py-2.5" />
            </div>
            <Button type="submit" size="lg">
              Import connections
            </Button>
          </form>
        </Card>

        <Card id="import-people" className="scroll-mt-6 gap-4 p-5">
          <div className="space-y-1">
            <h2 className="font-medium">Import people to the Radar</h2>
            <p className="text-sm text-muted-foreground">
              Columns: <code>name</code>, <code>url</code> (public source, required), and optionally <code>kind</code> (angel, celebrity, nextgen,
              creator, buyer or media; blank means angel), <code>purpose</code> (invest, ambassador, buyer, press or intro), <code>firm</code>,{" "}
              <code>role</code>, <code>rice_connection</code>, <code>check_size</code>, <code>contact_path</code>, <code>summary</code>,{" "}
              <code>why_relevant</code>, <code>location</code>, <code>tags</code>, <code>score</code>, <code>linkedin_url</code>, <code>email</code>. Rows are
              checked like research findings and land in Sooz people for you to approve.
            </p>
          </div>
          <form action={importPeopleAction} className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <label htmlFor="people-file" className="text-sm text-muted-foreground">
                People CSV
              </label>
              <Input id="people-file" name="file" type="file" accept=".csv,text/csv" required className="h-auto py-2.5" />
            </div>
            <Button type="submit" size="lg">
              Import people
            </Button>
          </form>
        </Card>
        <Card className="gap-4 p-5">
          <div className="space-y-1">
            <h2 className="font-medium">Export your data</h2>
            <p className="text-sm text-muted-foreground">
              CSV files are your backup, because the free database keeps only a short restore window. Export every so often and keep the files somewhere safe.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {EXPORT_KINDS.map((kind) => (
              <Button key={kind} variant="outline" size="lg" render={<a href={`/api/export/${kind}`} download />}>
                <Download aria-hidden />
                {EXPORT_LABELS[kind]}
              </Button>
            ))}
          </div>
        </Card>

        <Card className="gap-4 p-5">
          <div className="space-y-1">
            <h2 className="font-medium">Import contacts</h2>
            <p className="text-sm text-muted-foreground">
              Needs a <code>name</code> column. Optional columns: <code>section</code> (restaurants, investors or general; blank means general),
              <code> title</code>, <code>email</code>, <code>phone</code>, <code>linkedin_url</code>, <code>priority</code> (very high, high, medium, low, gone),
              <code> tags</code> (separated by semicolons) and <code>notes</code>. Contacts that match an existing email, or an existing name when there is no email, are skipped. The Contacts export is a valid import file.
            </p>
          </div>
          <ImportForm />
        </Card>

        <Card className="gap-4 p-5">
          <div className="space-y-1">
            <h2 className="font-medium">Pipeline stages</h2>
            <p className="text-sm text-muted-foreground">Fixed for now. They are set in <code>src/lib/sections.ts</code>.</p>
          </div>
          <dl className="space-y-3 text-sm">
            {Object.values(PIPELINES).map((pipeline) => (
              <div key={pipeline.label}>
                <dt className="font-medium">{pipeline.label}</dt>
                <dd className="text-muted-foreground">{pipeline.stages.map((stage) => (stage.outcome === "open" ? stage.label : `${stage.label} (${stage.outcome})`)).join(" → ")}</dd>
              </div>
            ))}
          </dl>
        </Card>

        {scope.isOwner ? (
          <Card id="team" className="scroll-mt-6 gap-4 p-5">
            <div className="space-y-1">
              <h2 className="font-medium">Team</h2>
              <p className="text-sm text-muted-foreground">
                People you add share Sooz with you: Restaurants, Investors, the Sooz feed, This week and pitch facts. Their
                General contacts and Personal and Career opportunities stay their own, and yours stay yours.
              </p>
            </div>
            {team.length ? (
              <ul className="divide-y divide-border text-sm">
                {team.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      <span className="font-medium">{m.name}</span>{" "}
                      <span className="text-muted-foreground">{m.email}</span>
                    </span>
                    <form action={removeMemberAction}>
                      <input type="hidden" name="id" value={m.id} />
                      <Button type="submit" variant="ghost" size="lg">
                        Remove
                      </Button>
                    </form>
                  </li>
                ))}
              </ul>
            ) : null}
            <form action={addMemberAction} className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1 text-sm">
                Name
                <Input name="name" required maxLength={100} placeholder="Mo" />
              </label>
              <label className="grid gap-1 text-sm">
                Email
                <Input name="email" type="email" required placeholder="mo@drinksooz.com" />
              </label>
              <label className="grid gap-1 text-sm">
                Starting password
                <Input name="password" type="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" />
              </label>
              <div className="sm:col-span-3">
                <Button type="submit" size="lg">
                  Add to the team
                </Button>
              </div>
            </form>
            <p className="text-xs text-muted-foreground">
              Removing someone deletes their login and their own contacts and opportunities. Shared Sooz work stays.
            </p>
          </Card>
        ) : null}

        <Card className="gap-2 p-5">
          <h2 className="font-medium">Account</h2>
          <p className="text-sm text-muted-foreground">Signed in as {session.user.email}.</p>
          {scope.isOwner ? (
            <p className="text-sm text-muted-foreground">
              To change your password, run <code>npm run reset:owner-password</code> on a computer that has the project and its <code>.env.local</code>. It signs out every session.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">You&apos;re part of {"the owner's"} Sooz workspace. To change your password, ask the owner.</p>
          )}
        </Card>
      </div>
    </>
  );
}
