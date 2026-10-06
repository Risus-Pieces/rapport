import type { LucideIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import type { SectionAccent } from "@/lib/nav";
import { requireSession } from "@/lib/session";

type StubPageProps = {
  title: string;
  description: string;
  accent?: SectionAccent;
  icon: LucideIcon;
  phase: string;
};

export async function StubPage({ title, description, accent, icon, phase }: StubPageProps) {
  await requireSession();
  return (
    <>
      <PageHeader title={title} description={description} accent={accent} />
      <EmptyState icon={icon} title="Coming soon">
        {phase}
      </EmptyState>
    </>
  );
}
