import { SectionPage } from "@/components/pipeline/section-page";

export const metadata = { title: "Investors" };

export default async function Page({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  return <SectionPage section="investors" searchParams={await searchParams} />;
}
