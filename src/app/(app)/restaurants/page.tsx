import { SectionPage } from "@/components/pipeline/section-page";

export const metadata = { title: "Restaurants" };

export default async function Page({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  return <SectionPage section="restaurants" searchParams={await searchParams} />;
}
