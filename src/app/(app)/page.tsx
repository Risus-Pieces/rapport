import { Inbox } from "lucide-react";
import { StubPage } from "@/components/stub-page";

export const metadata = { title: "Home" };

export default function HomePage() {
  return (
    <StubPage
      title="Home"
      description="What to do today: tasks, follow-ups and your pipelines."
      icon={Inbox}
      phase="The dashboard arrives in build phase 5."
    />
  );
}
