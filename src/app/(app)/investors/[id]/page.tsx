import { DealDetail } from "@/components/pipeline/deal-detail";

export const metadata = { title: "Investors" };

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const error = (await searchParams).outreachError;
  return <DealDetail section="investors" id={(await params).id} outreachError={typeof error === "string" ? error : undefined} />;
}
