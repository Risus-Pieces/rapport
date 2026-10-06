import { DealDetail } from "@/components/pipeline/deal-detail";

export const metadata = { title: "Investors" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <DealDetail section="investors" id={(await params).id} />;
}
