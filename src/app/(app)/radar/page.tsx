import { redirect } from "next/navigation";
import { radarRedirect } from "@/lib/opportunities";

// The Radar became Opportunities (people moved into the CRM); old links land on the matching view.
export default async function RadarPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  redirect(radarRedirect(await searchParams));
}
