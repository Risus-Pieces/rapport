import { Settings } from "lucide-react";
import { StubPage } from "@/components/stub-page";

export const metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <StubPage
      title="Settings"
      description="CSV import and export, tags and pipeline stages."
      icon={Settings}
      phase="Settings arrive in build phase 5."
    />
  );
}
