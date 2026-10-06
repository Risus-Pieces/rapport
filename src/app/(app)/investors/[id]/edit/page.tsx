import { PageHeader } from "@/components/page-header";
import { loadDeal } from "@/components/pipeline/deal-detail";
import { DealForm } from "@/components/pipeline/deal-form";
import { centsToInput } from "@/lib/money";
import { investorTypeOf } from "@/lib/sections";

export const metadata = { title: "Edit" };

const text = (value: unknown) => (typeof value === "string" ? value : "");

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { deal } = await loadDeal("investors", (await params).id);
  const company = deal.companyDetails ?? {};
  const contact = deal.contactDetails ?? {};
  return (
    <>
      <PageHeader title={`Edit ${deal.title}`} accent="investors" />
      <DealForm
        section="investors"
        cancelHref={`/investors/${deal.id}`}
        defaults={{
          id: deal.id,
          name: deal.title,
          stage: deal.stage,
          amount: centsToInput(deal.amountCents),
          nextStep: deal.nextStep ?? "",
          nextStepDate: deal.nextStepDate ?? "",
          city: deal.companyCity ?? "",
          cuisine: text(company.cuisine),
          neighborhood: text(company.neighborhood),
          currentSupplier: text(company.currentSupplier),
          orderFrequency: text(company.orderFrequency),
          investorType: investorTypeOf(deal.details) ?? undefined,
          email: deal.contactEmail ?? "",
          background: text(contact.background),
          firmType: text(company.firmType),
          focusStage: text(company.focusStage),
          checkSize: text(company.checkSize),
          introducedBy: text(company.introducedBy),
        }}
      />
    </>
  );
}
