import { BottomTabs } from "@/components/bottom-tabs";
import { MobileHeader } from "@/components/mobile-header";
import { Sidebar } from "@/components/sidebar";
import { requireSession } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  return (
    <div className="min-h-dvh md:flex">
      <a
        href="#main"
        className="fixed left-4 top-4 z-50 -translate-y-24 rounded-full bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground focus:translate-y-0"
      >
        Skip to content
      </a>
      <Sidebar name={session.user.name} email={session.user.email} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileHeader />
        <main id="main" className="flex-1 px-4 pb-28 pt-6 md:px-10 md:pb-10 md:pt-10">
          {children}
        </main>
      </div>
      <BottomTabs />
    </div>
  );
}
