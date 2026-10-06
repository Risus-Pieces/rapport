import { Download } from "lucide-react";
import { ImportForm } from "@/components/import-form";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EXPORT_KINDS } from "@/db/queries/export";
import { PIPELINES } from "@/lib/sections";
import { requireSession } from "@/lib/session";

export const metadata = { title: "Settings" };

const EXPORT_LABELS: Record<(typeof EXPORT_KINDS)[number], string> = {
  contacts: "Contacts",
  companies: "Companies",
  deals: "Deals",
  activities: "Activities",
  tasks: "Tasks",
};

export default async function SettingsPage() {
  const session = await requireSession();
  return (
    <>
      <PageHeader title="Settings" description="Backups, import, pipeline stages and your account." />
      <div className="grid max-w-3xl gap-6">
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

        <Card className="gap-2 p-5">
          <h2 className="font-medium">Account</h2>
          <p className="text-sm text-muted-foreground">Signed in as {session.user.email}.</p>
          <p className="text-sm text-muted-foreground">
            To change your password, run <code>npm run reset:owner-password</code> on a computer that has the project and its <code>.env.local</code>. It signs out every session.
          </p>
        </Card>
      </div>
    </>
  );
}
