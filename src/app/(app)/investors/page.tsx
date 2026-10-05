import { Landmark } from "lucide-react";
import { StubPage } from "@/components/stub-page";

export const metadata = { title: "Investors" };

export default function InvestorsPage() {
  return (
    <StubPage
      title="Investors"
      accent="investors"
      description="Angels and institutions in your fundraising pipeline."
      icon={Landmark}
      phase="Records arrive in build phase 2 and the pipeline in phase 4."
    />
  );
}
