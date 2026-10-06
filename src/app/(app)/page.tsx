import Link from "next/link";
import { CalendarCheck } from "lucide-react";
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
  return (
    <>
      <PageHeader title={`Welcome back, ${firstName(session.user.name)}`} description="Nothing needs you yet." />
      <div className="space-y-6">
        <Card className="gap-3 p-5">
          <h2 className="text-base font-medium">Today</h2>
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-primary"
            >
              <CalendarCheck className="size-5" />
            </span>
            <p className="text-sm text-muted-foreground">
              Follow-ups and tasks will show up here once you add people.
            </p>
          </div>
        </Card>
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
