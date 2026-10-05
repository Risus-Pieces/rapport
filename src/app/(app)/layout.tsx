import { BottomTabs } from "@/components/bottom-tabs";
import { MobileHeader } from "@/components/mobile-header";
import { Sidebar } from "@/components/sidebar";
import { requireSession } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  return (
    <div className="min-h-dvh md:flex">
      <Sidebar email={session.user.email} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileHeader />
        <main className="flex-1 px-4 pb-24 pt-6 md:px-10 md:pb-10 md:pt-10">{children}</main>
      </div>
      <BottomTabs />
    </div>
  );
}
