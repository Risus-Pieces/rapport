import { UtensilsCrossed } from "lucide-react";
import { StubPage } from "@/components/stub-page";

export const metadata = { title: "Restaurants" };

export default function RestaurantsPage() {
  return (
    <StubPage
      title="Restaurants"
      accent="restaurants"
      description="Restaurant accounts and their sales pipeline."
      icon={UtensilsCrossed}
      phase="Records arrive in build phase 2 and the pipeline in phase 4."
    />
  );
}
