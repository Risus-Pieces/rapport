import { DealDetail } from "@/components/pipeline/deal-detail";

export const metadata = { title: "Restaurants" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <DealDetail section="restaurants" id={(await params).id} />;
}
