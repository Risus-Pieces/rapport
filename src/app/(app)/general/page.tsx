import { Users } from "lucide-react";
import { StubPage } from "@/components/stub-page";

export const metadata = { title: "General" };

export default function GeneralPage() {
  return (
    <StubPage
      title="General"
      accent="general"
      description="Friends, family and professional contacts, and who to reach out to next."
      icon={Users}
      phase="Contacts and follow-up reminders arrive in build phase 2."
    />
  );
}
