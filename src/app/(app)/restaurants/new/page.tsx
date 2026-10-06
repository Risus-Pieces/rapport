import { PageHeader } from "@/components/page-header";
import { DealForm } from "@/components/pipeline/deal-form";
import { requireSession } from "@/lib/session";

export const metadata = { title: "Add restaurant" };

export default async function NewPage() {
  await requireSession();
  return (
    <>
      <PageHeader title="Add restaurant" accent="restaurants" />
      <DealForm section="restaurants" cancelHref="/restaurants" />
    </>
  );
}
