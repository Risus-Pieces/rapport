import { PageHeader } from "@/components/page-header";
import { DealForm } from "@/components/pipeline/deal-form";
import { requireSession } from "@/lib/session";

export const metadata = { title: "Add investor" };

export default async function NewPage() {
  await requireSession();
  return (
    <>
      <PageHeader title="Add investor" accent="investors" />
      <DealForm section="investors" cancelHref="/investors" />
    </>
  );
}
