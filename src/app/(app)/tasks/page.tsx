import { ListChecks } from "lucide-react";
import { StubPage } from "@/components/stub-page";

export const metadata = { title: "Tasks" };

export default function TasksPage() {
  return (
    <StubPage
      title="Tasks"
      description="Everything you owe someone, across all sections."
      icon={ListChecks}
      phase="Tasks arrive in build phase 3."
    />
  );
}
